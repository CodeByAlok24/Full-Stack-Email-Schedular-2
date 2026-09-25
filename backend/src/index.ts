import { createApp } from "./app";
import { migrate } from "./db/migrate";
import { startWorker } from "./queue/worker";
import { closeQueue } from "./queue/queue";
import { pool } from "./db/client";
import { env, googleConfigured, assertAuthConfiguration } from "./config/env";

async function main(): Promise<void> {
  if (!env.workerOnly) assertAuthConfiguration();
  await migrate();

  if (env.workerOnly) {
    startWorker();
    console.log(`[worker] running (concurrency=${env.workerConcurrency})`);
    return;
  }

  const worker = startWorker();
  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[api] listening on http://localhost:${env.port}`);
    console.log(`[worker] running (concurrency=${env.workerConcurrency})`);
    if (!googleConfigured) console.log("[auth] Google OAuth NOT configured — /api/auth/google returns 503");
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[fatal] Port ${env.port} already in use (EADDRINUSE). Kill the old backend or run: npx kill-port ${env.port}  (Windows: netstat -ano | findstr :${env.port}  then taskkill /PID <pid> /F)`);
      process.exit(1);
    }
    throw err;
  });

  const shutdown = async () => {
    console.log("\n[shutdown] closing…");
    server.close();
    await worker.close();
    await closeQueue();
    await app.locals.sessionStore?.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err);
  });
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
