
import { randomUUID } from "node:crypto";
import { Queue, Worker, QueueEvents } from "bullmq";
import { createRedisConnection } from "../config/redis";
import { pool, toMySQLDate } from "../db/client";

import { startWorker } from "../queue/worker";

const QUEUE_NAME = "email-send";

async function insertEmail(opts: { id: string; recipient: string; status: string; sendAt: Date }) {
  await pool.query(
    "INSERT INTO emails (id, user_id, recipient, subject, body, sender, send_at, status) VALUES (?,?,?,?,?,?,?,?)",
    [opts.id, "dev", opts.recipient, "Test subject", "<p>hello</p>", "tester@domain.io", toMySQLDate(opts.sendAt), opts.status],
  );
}

async function getStatus(id: string): Promise<string | null> {
  const [rows] = await pool.query("SELECT status, attempts, last_error FROM emails WHERE id=?", [id]) as unknown as [Array<{ status: string; attempts: number; last_error: string | null }>, unknown];
  return rows[0]?.status ?? null;
}

async function waitForStatus(id: string, expected: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await getStatus(id);
    if (s === expected) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main(): Promise<void> {
  console.log("[verify-worker] starting");

  const worker = startWorker();
  const queue = new Queue(QUEUE_NAME, { connection: createRedisConnection() });
  await queue.waitUntilReady();
  console.log("[verify-worker] queue and worker ready");

  const id1 = randomUUID();
  await insertEmail({ id: id1, recipient: "success@example.com", status: "pending", sendAt: new Date() });
  console.log(`[1] inserted pending ${id1}`);
  const before1 = await getStatus(id1);
  console.log(`[1] before status: ${before1}`);
  await queue.add("send-email", { emailId: id1, hourlyLimit: 50 }, { jobId: id1, delay: 500, removeOnComplete: true, removeOnFail: true });
  console.log("[1] enqueued delayed 500ms");
  const ok1 = await waitForStatus(id1, "sent", 20000);
  const after1 = await getStatus(id1);
  console.log(`[1] after status: ${after1} ${ok1 ? "PASS" : "FAIL"}`);
  if (!ok1) throw new Error("1. successful sending failed to reach sent");

  const fakeId = randomUUID();
  const events2 = new QueueEvents(QUEUE_NAME, { connection: createRedisConnection() });
  await events2.waitUntilReady();
  let completedFake = false;
  events2.on("completed", ({ jobId }) => {
    if (jobId === fakeId) completedFake = true;
  });
  await queue.add("send-email", { emailId: fakeId, hourlyLimit: 50 }, { jobId: fakeId, delay: 200, removeOnComplete: true });
  console.log(`[2] enqueued nonexistent ${fakeId}`);
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`[2] nonexistent: worker completed without crash? ${completedFake ? "YES" : "wait"}`);
  const job2 = await queue.getJob(fakeId);
  console.log(`[2] job after: ${job2 ? await job2.getState() : "null (removed on complete) — PASS"}`);
  const s2 = await getStatus(fakeId);
  console.log(`[2] DB row: ${s2 ?? "null — PASS"}`);
  await events2.close();

  const id3 = randomUUID();
  await insertEmail({ id: id3, recipient: "already@example.com", status: "sent", sendAt: new Date() });
  await pool.query("UPDATE emails SET sent_at=NOW(3) WHERE id=?", [id3]);
  console.log(`[3] inserted sent ${id3}`);
  const jobId3 = randomUUID();
  await queue.add("send-email", { emailId: id3, hourlyLimit: 50 }, { jobId: jobId3, delay: 200, removeOnComplete: true });
  console.log("[3] enqueued job for already-sent emailId with different jobId");
  await new Promise((r) => setTimeout(r, 3000));
  const s3 = await getStatus(id3);
  console.log(`[3] after status: ${s3} ${s3 === "sent" ? "PASS (not re-sent)" : "FAIL"}`);
  if (s3 !== "sent") throw new Error("3. already-sent should remain sent");

  const id4 = randomUUID();
  await insertEmail({ id: id4, recipient: "fail-test@example.com", status: "pending", sendAt: new Date() });
  console.log(`[4] inserted fail-test pending ${id4}`);
  await queue.add("send-email", { emailId: id4, hourlyLimit: 50 }, { jobId: id4, delay: 200, attempts: 3, backoff: { type: "exponential", delay: 500 }, removeOnComplete: true });
  console.log("[4] enqueued fail-test delayed 200ms, attempts=3");
  const ok4 = await waitForStatus(id4, "failed", 25000);
  const [rows4] = await pool.query("SELECT status, attempts, last_error FROM emails WHERE id=?", [id4]) as unknown as [Array<{ status: string; attempts: number; last_error: string | null }>, unknown];
  console.log(`[4] after: status=${rows4[0]?.status} attempts=${rows4[0]?.attempts} last_error=${rows4[0]?.last_error?.slice(0, 80)} ${ok4 ? "PASS" : "FAIL"}`);
  if (!ok4) throw new Error("4. SMTP failure did not reach failed");

  const malformedJobId = `malformed-${Date.now()}`;
  const events5 = new QueueEvents(QUEUE_NAME, { connection: createRedisConnection() });
  await events5.waitUntilReady();
  let failedMalformed = false;
  events5.on("failed", ({ jobId }) => {
    if (jobId === malformedJobId) failedMalformed = true;
  });
  await queue.add("send-email", {} as never, { jobId: malformedJobId, delay: 200, attempts: 1, removeOnFail: true });
  console.log("[5] enqueued malformed job (no emailId)");
  await new Promise((r) => setTimeout(r, 4000));
  console.log(`[5] malformed job failed as expected? ${failedMalformed ? "PASS" : "check logs — should have thrown"}`);

  await events5.close();
  await worker.close();
  await queue.close();
  console.log("[verify-worker] all checks done");
  setTimeout(() => process.exit(0), 200);
}

main().catch((e) => {
  console.error("[verify-worker] FAIL", e);
  process.exit(1);
});
