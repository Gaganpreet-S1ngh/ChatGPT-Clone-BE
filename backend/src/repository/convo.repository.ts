import { PrismaClient, Prisma } from "@prisma/client";
import { ConvoInterface } from "../interface/convo.interface";
import { ConversationType, MessageType } from "../types/convo.type";

// ─── Retry Configuration ────────────────────────────────────────────────────

const RETRY_CONFIG = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 2000,
} as const;

/** Prisma error codes that are safe to retry (transient failures) */
const RETRYABLE_ERROR_CODES = new Set([
    "P1001", // Can't reach database server
    "P1002", // Database server timeout
    "P1008", // Operations timed out
    "P1017", // Server closed the connection
    "P2024", // Connection pool timeout
    "P2034", // Transaction conflict (write conflict / deadlock)
]);

function isRetryable(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        return RETRYABLE_ERROR_CODES.has(error.code);
    }
    if (error instanceof Prisma.PrismaClientInitializationError) {
        return true;
    }
    return false;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` with exponential back-off retry.
 * Retries only on transient Prisma errors; all others bubble up immediately.
 */
async function withRetry<T>(
    fn: () => Promise<T>,
    label: string
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (!isRetryable(error) || attempt === RETRY_CONFIG.maxAttempts) {
                break;
            }

            const jitter = Math.random() * 50;
            const delay = Math.min(
                RETRY_CONFIG.baseDelayMs * 2 ** (attempt - 1) + jitter,
                RETRY_CONFIG.maxDelayMs
            );

            console.warn(
                `[ConvoRepository] ${label} failed (attempt ${attempt}/${RETRY_CONFIG.maxAttempts}). ` +
                `Retrying in ${Math.round(delay)}ms… Error: ${(error as Error).message}`
            );

            await sleep(delay);
        }
    }

    throw lastError;
}

// ─── Custom Errors ───────────────────────────────────────────────────────────

export class ConvoNotFoundError extends Error {
    constructor(convoID: string) {
        super(`Conversation not found: ${convoID}`);
        this.name = "ConvoNotFoundError";
    }
}

export class ConvoCreateError extends Error {
    constructor(cause?: unknown) {
        super(`Unable to create conversation: ${(cause as Error)?.message ?? "unknown error"}`);
        this.name = "ConvoCreateError";
    }
}

// ─── Repository ──────────────────────────────────────────────────────────────

export class ConvoRepository implements ConvoInterface {
    private _prisma: PrismaClient;

    constructor(prisma?: PrismaClient) {
        this._prisma = prisma ?? new PrismaClient();
    }

    // ── create ───────────────────────────────────────────────────────────────

    async create(convoDetails: ConversationType): Promise<string> {
        return withRetry(async () => {
            try {
                // Use a transaction so the conversation + all messages are atomic
                const result = await this._prisma.$transaction(async (tx) => {
                    const conversation = await tx.conversation.create({
                        data: {
                            userID: convoDetails.userID,
                            title: convoDetails.title ?? "New Conversation",
                            metadata: convoDetails.metadata ?? {},
                        },
                    });

                    if (convoDetails.messages?.length) {
                        await tx.message.createMany({
                            data: convoDetails.messages.map((msg) => ({
                                conversationID: conversation.id,
                                role: msg.role,
                                content: msg.content,
                                tokenCount: msg.tokenCount,
                            })),
                        });
                    }

                    return conversation;
                });

                return result.id;
            } catch (error) {
                if (error instanceof Prisma.PrismaClientKnownRequestError) {
                    throw new ConvoCreateError(error);
                }
                throw error;
            }
        }, "create");
    }

    // ── update ───────────────────────────────────────────────────────────────

    async update(convoID: string, title: string, summary: string): Promise<ConversationType> {
        return withRetry(async () => {
            try {
                await this._prisma.conversation.update({
                    where: { id: convoID },
                    data: { title, summary },
                });
            } catch (error) {
                if (
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === "P2025" // Record not found
                ) {
                    throw new ConvoNotFoundError(convoID);
                }
                throw error;
            }

            return this.getConvo(convoID);
        }, "update");
    }

    // ── delete ───────────────────────────────────────────────────────────────

    async delete(convoID: string): Promise<boolean> {
        return withRetry(async () => {
            try {
                await this._prisma.conversation.delete({
                    where: { id: convoID },
                });
                return true;
            } catch (error) {
                if (
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === "P2025"
                ) {
                    throw new ConvoNotFoundError(convoID);
                }
                throw error;
            }
        }, "delete");
    }

    // ── getConvo ─────────────────────────────────────────────────────────────

    async getConvo(convoID: string): Promise<ConversationType> {
        return withRetry(async () => {
            const convo = await this._prisma.conversation.findUnique({
                where: { id: convoID },
                include: {
                    messages: {
                        orderBy: { createdAt: "asc" },
                    },
                },

            });

            if (!convo) {
                throw new ConvoNotFoundError(convoID);
            }

            return this._mapConversation(convo);
        }, "getConvo");
    }

    // ── getConvoByUserID ─────────────────────────────────────────────────────────────

    async getConvoByUserID(userID: string): Promise<ConversationType> {
        return withRetry(async () => {
            const convo = await this._prisma.conversation.findFirst({
                where: { userID: userID },
                include: {
                    messages: {
                        orderBy: { createdAt: "desc" },
                        take: 20,
                    },

                },
            });

            if (!convo) {
                throw new ConvoNotFoundError(userID);
            }

            return this._mapConversation(convo);
        }, "getConvoByUserID");
    }

    // ── getConvos ────────────────────────────────────────────────────────────

    async getConvos(
        userID: string,
        limit: number,
        offset: number
    ): Promise<ConversationType[]> {
        return withRetry(async () => {
            const convos = await this._prisma.conversation.findMany({
                where: { userID },
                include: {
                    messages: {
                        orderBy: { createdAt: "asc" },
                    },
                },
                orderBy: { createdAt: "desc" },
                take: limit,
                skip: offset,
            });

            return convos.map((c) => this._mapConversation(c));
        }, "getConvos");
    }

    // ── addMessage ───────────────────────────────────────────────────────────

    async addMessage(
        convoID: string,
        messageDetails: MessageType
    ): Promise<ConversationType> {
        return withRetry(async () => {
            // Verify conversation exists before inserting
            const exists = await this._prisma.conversation.findUnique({
                where: { id: convoID },
                select: { id: true },
            });

            if (!exists) {
                throw new ConvoNotFoundError(convoID);
            }

            try {
                await this._prisma.message.create({
                    data: {
                        conversationID: convoID,
                        role: messageDetails.role,
                        content: messageDetails.content,
                        tokenCount: messageDetails.tokenCount,
                    },
                });
            } catch (error) {
                if (
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === "P2003" // Foreign key constraint failed
                ) {
                    throw new ConvoNotFoundError(convoID);
                }
                throw error;
            }

            return this.getConvo(convoID);
        }, "addMessage");
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /**
     * Maps a raw Prisma record (with its messages relation) to ConversationType.
     * Keeps repository internals decoupled from the Prisma-generated types.
     */
    private _mapConversation(
        convo: Prisma.ConversationGetPayload<{ include: { messages: true } }>
    ): ConversationType {
        return {
            id: convo.id,
            userID: convo.userID,
            title: convo.title ?? undefined,
            metadata: convo.metadata as Record<string, any>,
            createdAt: convo.createdAt,
            updatedAt: convo.updatedAt,
            messages: convo.messages.map((msg) => ({
                id: msg.id,
                converstaionID: msg.conversationID, // preserving the typo from the interface
                role: msg.role,
                content: msg.content,
                tokenCount: msg.tokenCount,
                createdAt: msg.createdAt.toISOString(),
            })),
        };
    }
}