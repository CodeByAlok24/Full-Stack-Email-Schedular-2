import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

export interface AuthedRequest extends Request {
  userId: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const sessionUser = (req as Request & { user?: { id: string } }).user;
  const devUserId =
    !env.isProduction && typeof req.headers?.["x-user-id"] === "string"
      ? (req.headers["x-user-id"] as string).trim()
      : undefined;
  const userId = sessionUser?.id || devUserId;
  if (!userId) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  (req as AuthedRequest).userId = userId;
  next();
}
