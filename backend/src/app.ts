import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import { env } from "./config/env";
import { scheduleRouter } from "./api/schedule.routes";
import { authRouter } from "./api/auth.routes";
import { RedisSessionStore } from "./session/redisSessionStore";

export function createApp() {
  const app = express();
  const sessionStore = new RedisSessionStore();
  app.locals.sessionStore = sessionStore;
  if (env.isProduction) app.set("trust proxy", 1);
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const allowed = env.isProduction
          ? origin === env.frontendUrl
          : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        return cb(null, allowed ? origin : false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "150mb" }));
  app.use(
    session({
      name: env.sessionCookieName,
      secret: env.sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      proxy: env.isProduction,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.isProduction,
        maxAge: 7 * 24 * 3600 * 1000,
        path: "/",
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/emails", scheduleRouter);
  app.use("/api/auth", authRouter);

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ message: "Not found" });
  });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api]", err);
    res.status(500).json({ message: "Internal server error" });
  });
  return app;
}
