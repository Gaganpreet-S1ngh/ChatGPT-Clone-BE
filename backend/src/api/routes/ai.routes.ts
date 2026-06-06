import { Router, Request, Response } from "express";
import { AIController } from "../controllers/ai.controller";


export class AIRoutes {
    public router: Router;
    private aiController: AIController;

    constructor(aiController: AIController) {
        this.router = Router();
        this.aiController = aiController;
        this.initializeRoutes();
    }

    private initializeRoutes(): void {
        this.router.post("/chat", this.aiController.chatHandler);
    }

}