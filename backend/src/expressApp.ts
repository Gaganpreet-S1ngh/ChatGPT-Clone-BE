import { Ollama } from "ollama";
import { HandleErrorWithLogger } from "./utils/errors";
import { httpLogger } from "./utils/logger";
import express, { NextFunction, Request, Response } from "express";
import { AIRoutes } from "./api/routes/ai.routes";
import cors from "cors";
import { AIController } from "./api/controllers/ai.controller";
import { AIService } from "./services/AI.service";
import { corsOptions } from "./config/cors.config";
import { ConvoRepository } from "./repository/convo.repository";

export const expressApp = async () => {
  const app = express();

  app.use(cors(corsOptions)); // Enable CORS
  app.use(express.json());
  app.use(httpLogger);

  app.get("/", (req: Request, res: Response, next: NextFunction) => {
    res.status(200).json("I am healthy!");
  });

  const ollamaClient = new Ollama({ host: 'http://127.0.0.1:11434' })
  const convoRepository = new ConvoRepository();

  const aiRoutes = new AIRoutes(new AIController(new AIService(ollamaClient, convoRepository)))
  app.use("/", aiRoutes.router)

  app.use(HandleErrorWithLogger);

  return app;
};
