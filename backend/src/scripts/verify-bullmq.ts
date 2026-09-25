import { Queue, Worker, QueueEvents } from "bullmq";
import { createRedisConnection } from "../config/redis";

const QUEUE_NAME = "test-email-foundation";
const EMAIL_ID = `foundation-test-${Date.now()}`;
const DELAY_MS = 1500;

async function main(): Promise<void> {
  console.log(`[verify] REDIS_URL=${process.env.REDIS_URL ?? "from env"}`);
  console.log(`[verify] queue=${QUEUE_NAME} delay=${DELAY_MS}ms jobId=${EMAIL_ID}`);

  const redis = createRedisConnection();
  const pong = await redis.ping();
  console.log(`[verify] redis ping: ${pong}`);
  if (pong !== "PONG") throw new Error("Redis ping failed");

  const queue = new Queue<{ emailId: string }>(QUEUE_NAME, {
    connection: createRedisConnection(),
  });
  await queue.waitUntilReady();
  console.log("[verify] queue ready");

  const worker = new Worker<{ emailId: string }>(
    QUEUE_NAME,
    async (job) => {
      console.log(`[verify] worker processing job ${job.id} payload=${JSON.stringify(job.data)}`);
      if (job.data.emailId !== EMAIL_ID) throw new Error("payload mismatch");
      return { ok: true };
    },
    { connection: createRedisConnection(), concurrency: 2 },
  );
  await worker.waitUntilReady();
  console.log("[verify] worker ready");

  const events = new QueueEvents(QUEUE_NAME, { connection: createRedisConnection() });
  await events.waitUntilReady();

  const completed: Promise<string> = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for delayed job")), 10000);
    events.on("completed", ({ jobId }) => {
      clearTimeout(t);
      resolve(jobId);
    });
    events.on("failed", ({ jobId, failedReason }) => {
      clearTimeout(t);
      reject(new Error(`job ${jobId} failed: ${failedReason}`));
    });
  });

  const job = await queue.add(
    "send-email",
    { emailId: EMAIL_ID },
    { delay: DELAY_MS, jobId: EMAIL_ID, removeOnComplete: true, removeOnFail: true },
  );
  console.log(`[verify] enqueued job ${job.id} with delay ${DELAY_MS}ms`);

  const state = await job.getState();
  console.log(`[verify] job state right after add: ${state}`);
  if (state !== "delayed") console.warn("[verify] expected delayed state, got", state);

  const completedId = await completed;
  console.log(`[verify] completed job ${completedId} — delayed job processed successfully`);

  await worker.close();
  await events.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await redis.quit();
  console.log("[verify] PASS — BullMQ + Redis foundation is correct");
  setTimeout(() => process.exit(0), 200);
}

main().catch((err) => {
  console.error("[verify] FAIL", err);
  process.exit(1);
});
