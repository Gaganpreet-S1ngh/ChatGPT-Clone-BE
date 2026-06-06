import { Ollama } from "ollama";

export class AIService {
    private aiModel = "phi4-mini";
    private ollama : Ollama;
  

    constructor(ollamaClient : Ollama) {
        this.ollama = ollamaClient
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
}