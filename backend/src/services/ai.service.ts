import { Message, Ollama } from "ollama";
import { ConvoInterface } from "../interface/convo.interface";
import { ConversationType, MessageType } from "../types/convo.type";
import { logger } from "../utils/logger";

export class AIService {

    private _repo: ConvoInterface;
    private aiModel = "phi4-mini";
    private ollama: Ollama;

    // auth

    constructor(ollamaClient: Ollama, convoRepository: ConvoInterface) {
        this.ollama = ollamaClient;
        this._repo = convoRepository;
    }

    async getAnswer(role: string, prompt: string): Promise<string> {
        const response = await this.ollama.chat({
            model: this.aiModel,
            messages: [
                {
                    role: role as "user" | "assistant" | "system",
                    content: prompt,
                },
            ],
        });

        return response.message.content;
    }

    async streamAnswer(prompt: string): Promise<any> {

        const userID = "RandomUser1";
        // find if conversation exists

        let conversation: ConversationType | null = null;

        try {
            conversation = await this._repo.getConvoByUserID(userID)
        } catch (error) {
            conversation = null;
        }

        let convoID: string;

        // create a new Convo if it doesnt exists
        if (!conversation) {
            try {
                // Get convo id
                convoID = await this._repo.create({
                    userID: userID,
                    messages: []
                });

                // new conversation also create a title here
                conversation = {
                    id: convoID,
                    userID,
                    messages: [],
                }
            } catch (error) {
                logger.error(error, "Error creating a new conversation!");
                throw error;
            }
        } else {
            convoID = conversation.id!;
        }

        // Save user message now
        const userMessage: MessageType = {
            converstaionID: convoID,
            role: "user",
            content: prompt,
            tokenCount: 0
        }

        try {
            await this._repo.addMessage(convoID, userMessage)
        } catch (error) {
            logger.error(error, "Error creating user message!");
        }


        const stream = await this.ollama.chat({
            model: this.aiModel,
            stream: true,
            messages: [
                {
                    role: "system",
                    content: `Conversation Summary: ${conversation.summary || "New Conversation"}. Last 20 Messages : \n`
                },
                ...conversation.messages.map(m => ({
                    role: m.role === "admin"
                        ? "system"
                        : m.role,
                    content: m.content
                })),
                {
                    role: "user",
                    content: `User is currently asking this:\n${prompt}`
                }
            ]
        })

        /*
        This pattern is wrapping Ollama's stream so you can do two things at the same time:
        Stream tokens to the client immediately.
        Capture the full response and save it to the database when the stream finishes. 
        */

        let assistantContent = "";
        const self = this; // Because this cant be accessed inside the below function

        async function* wrappedStream() {
            for await (const chunk of stream) {
                const text = chunk.message?.content ?? "";
                assistantContent += text;
                // Yield is kind of return statement
                yield chunk;
            }

            // Save the assistant message
            const assistantMessage: MessageType = {
                converstaionID: convoID,
                role: "assistant",
                content: assistantContent,
                tokenCount: 0
            }

            try {
                await self._repo.addMessage(convoID, assistantMessage);
                // Here save the updated summary (Do it async in the background)
                const summary = await self.updateSummary(
                    conversation?.summary || "New conversation",
                    [userMessage, assistantMessage]
                );

                await self._repo.update(convoID, "", summary);

            } catch (error) {
                logger.error(error, "Error saving assistant message!")
                throw error;
            }
        }

        return wrappedStream();

    }


    // Helper functions

    private async updateSummary(
        oldSummary: string,
        newMessages: MessageType[]
    ): Promise<string> {

        const response = await this.ollama.chat({
            model: this.aiModel,
            messages: [
                {
                    role: "system",
                    content: `Update the conversation summary.\nExisting summary:\n${oldSummary}\n\nIncorporate the new messages below and return an updated summary in 150 words only strictly.`
                },
                {
                    role: "user",
                    content: newMessages
                        .map(m => `${m.role}: ${m.content}`)
                        .join("\n")
                }
            ]
        });
        return response.message.content;
    }

}
