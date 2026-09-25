import { randomBytes } from "node:crypto";
import "dotenv/config";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === "true";
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";
const configuredSessionSecret = process.env.SESSION_SECRET?.trim() ?? "";
const sessionSecret = configuredSessionSecret || randomBytes(32).toString("hex");
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL ?? "http://localhost:4000/api/auth/callback";

export const env = {
  nodeEnv,
  isProduction,
  port: num("PORT", 4000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  db: {
    host: process.env.DB_HOST ?? "localhost",
    port: num("DB_PORT", 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "email_scheduler",
  },
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  workerConcurrency: num("WORKER_CONCURRENCY", 5),
  maxEmailsPerHour: num("MAX_EMAILS_PER_HOUR", 50),
  minSendDelayMs: num("MIN_SEND_DELAY_MS", 1000),
  sessionSecret,
  sessionCookieName: "reachinbox.sid",
  workerOnly: bool("WORKER_ONLY", false),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    callbackUrl: googleCallbackUrl,
  },
  ethereal: {
    host: process.env.ETHEREAL_HOST ?? "smtp.ethereal.email",
    port: num("ETHEREAL_PORT", 587),
    user: process.env.ETHEREAL_USER ?? "",
    pass: process.env.ETHEREAL_PASS ?? "",
  },
};

export const googleConfigured = Boolean(env.google.clientId && env.google.clientSecret && env.google.callbackUrl);

export function assertAuthConfiguration(): void {
  if (!isProduction) return;

  const missing: string[] = [];
  if (
    !configuredSessionSecret ||
    Buffer.byteLength(configuredSessionSecret, "utf8") < 32 ||
    configuredSessionSecret === "change-me-to-a-long-random-string"
  ) {
    missing.push("SESSION_SECRET must be set to at least 32 bytes");
  }
  if (!env.google.clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!env.google.clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!process.env.GOOGLE_CALLBACK_URL || !env.google.callbackUrl.startsWith("https://")) {
    missing.push("GOOGLE_CALLBACK_URL must be an explicit HTTPS URL");
  }
  if (!process.env.FRONTEND_URL || !env.frontendUrl.startsWith("https://")) {
    missing.push("FRONTEND_URL must be an explicit HTTPS URL");
  }
  if (missing.length > 0) {
    throw new Error(`Invalid production authentication configuration: ${missing.join("; ")}`);
  }
}
