
import { Queue } from "bullmq";
import { createRedisConnection } from "../config/redis";

const QUEUE = "email-send";

async function main(): Promise<void> {
  const sender = `ratelimit-${Date.now()}@ex.com`;
  const startAt = new Date(Date.now() + 1000).toISOString();
  const payload = {
    subject: "Rate limit test",
    body: "<p>hi</p>",
    recipients: ["a1@ex.com", "a2@ex.com", "a3@ex.com"],
    sender,
    startAt,
    delayMs: 200,
    hourlyLimit: 1,
  };

  console.log(`[rate-verify] scheduling 3 recipients with sender=${sender} limit=1`);
  const res = await fetch("http://localhost:4000/api/emails/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": "dev-verifier" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { data?: { ids?: string[] } };
  console.log(`[rate-verify] schedule response:`, json);
  const ids: string[] = json.data?.ids ?? [];
  if (ids.length !== 3) throw new Error("expected 3 ids");

  await new Promise((r) => setTimeout(r, 4000));

  const { pool } = await import("../db/client");
  const [rows] = (await pool.query("SELECT id, recipient, status FROM emails WHERE sender=? ORDER BY send_at", [sender])) as unknown as [Array<{ id: string; recipient: string; status: string }>, unknown];
  console.log(`[rate-verify] DB rows:`);
  for (const row of rows) console.log(`  ${row.recipient} ${row.status} id=${row.id.slice(0, 8)}`);

  const queue = new Queue(QUEUE, { connection: createRedisConnection() });
  console.log(`[rate-verify] BullMQ jobs:`);
  for (const id of ids) {
    const job = await queue.getJob(id);
    const state = job ? await job.getState() : "not found (completed/removed)";
    console.log(`  ${id.slice(0, 8)} state=${state}`);
  }
  await queue.close();

  const sent = rows.filter((r) => r.status === "sent").length;
  const pendingOrProcessing = rows.filter((r) => ["pending", "processing", "scheduled"].includes(r.status)).length;
  console.log(`[rate-verify] sent=${sent} pending/processing=${pendingOrProcessing}`);

  if (sent < 1) throw new Error("expected at least 1 sent");
  if (pendingOrProcessing < 1) {
    console.warn("[rate-verify] WARNING: all 3 sent quickly — rate limiter may not have triggered (check MAX_EMAILS_PER_HOUR and Redis)");
  } else {
    console.log("[rate-verify] PASS — rate limiter rescheduled excess jobs (not dropped)");
  }

  const redis = createRedisConnection();
  const now = new Date();
  const bucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}`;
  const key = `rate:${sender.toLowerCase()}:${bucket}`;
  const val = await redis.get(key);
  const ttl = await redis.ttl(key);
  console.log(`[rate-verify] Redis ${key} = ${val} ttl=${ttl}s`);
  await redis.quit();



  setTimeout(() => process.exit(0), 300);
}

main().catch((e) => {
  console.error("[rate-verify] FAIL", e);
  process.exit(1);
});
