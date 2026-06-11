

export interface ConversationType {
    id?: string;
    userID: string;
    title?: string;
    summary?: string;
    messages: MessageType[];
    metadata?: Record<string, any>;
    createdAt?: Date;
    updatedAt?: Date;
}


export interface MessageType {
    id?: string;
    converstaionID: string;
    role: "user" | "admin" | "assistant";
    content: string;
    tokenCount: number;
    createdAt?: string;
}