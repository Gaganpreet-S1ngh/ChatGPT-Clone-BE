import { NextFunction, Request, Response } from "express";
import { AIService } from "../../services/ai.service";

export class AIController {
    private aiService : AIService

    constructor(aiService : AIService){
        this.aiService = aiService
    }

     chatHandler = async (req: Request, res: Response , next : NextFunction) => {
         try {
            const { role, prompt } = req.body;

            if (!role || !prompt) {
                res.status(400).json({
                    error: "role and prompt are required",
                });
                return;
            }

            const answer = await this.aiService.getAnswer(role, prompt);

            res.json({
                success: true,
                answer,
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                error: "Failed to generate response",
            });
        }
    }
}