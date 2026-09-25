import { migrate } from "./db/migrate";
import { startWorker } from "./queue/worker";
import { env } from "./config/env";

migrate()
  .then(() => {
    startWorker();
    console.log(`[worker] running standalone (concurrency=${env.workerConcurrency})`);
  })
  .catch((err) => {
    console.error("[fatal]", err);
    process.exit(1);
  });
