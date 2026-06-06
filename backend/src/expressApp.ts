import { Ollama } from "ollama";
import { HandleErrorWithLogger } from "./utils/errors";
import { httpLogger } from "./utils/logger";
import express, { NextFunction, Request, Response } from "express";
import { AIRoutes } from "./api/routes/ai.routes";
import { AIController } from "./api/controllers/ai.controller";
import { AIService } from "./services/ai.service";

export const expressApp = async () => {
  const app = express();

  app.use(express.json());
  app.use(httpLogger);

  app.get("/", (req: Request, res: Response, next: NextFunction) => {
    res.status(200).json("I am healthy!");
  });

    const ollamaClient = new Ollama({ host: 'http://127.0.0.1:11434' })

  const aiRoutes = new AIRoutes(new AIController(new AIService(ollamaClient)))
  app.use("/" , aiRoutes.router)

  app.use(HandleErrorWithLogger);

  return app;
};
