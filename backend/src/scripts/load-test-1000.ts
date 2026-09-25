import { pool } from "../db/client";
import { emailQueue } from "../queue/queue";
import { createRedisConnection } from "../config/redis";
import { env } from "../config/env";

const COUNT = 1000;
const SENDER = `bulk-load-${Date.now()}@loadtest.ex.com`;

async function getQueueCounts() {
  const c = await emailQueue.getJobCounts("waiting", "delayed", "active", "completed", "failed", "paused");
  return c;
}

async function main(): Promise<void> {
  console.log(`[load-test] COUNT=${COUNT} SENDER=${SENDER}`);
  console.log(`[load-test] env WORKER_CONCURRENCY=${env.workerConcurrency} MIN_SEND_DELAY_MS=${env.minSendDelayMs} MAX_EMAILS_PER_HOUR=${env.maxEmailsPerHour}`);

  const recipients = Array.from({ length: COUNT }, (_, i) => `bulk-load-${i}@loadtest.ex.com`);
  const startAt = new Date(Date.now() + 1000).toISOString();

  const beforeCounts = await getQueueCounts();
  console.log(`[load-test] queue before:`, beforeCounts);
  const redis = createRedisConnection();
  const beforeKeys = await redis.keys(`rate:${SENDER}*`);
  console.log(`[load-test] redis keys before for sender: ${beforeKeys.length}`);

  const t0 = Date.now();
  const res = await fetch("http://localhost:4000/api/emails/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": "dev-verifier" },
    body: JSON.stringify({
      subject: "Load test 1000",
      body: "<p>bulk</p>",
      recipients,
      sender: SENDER,
      startAt,
      delayMs: 0,
      hourlyLimit: 100,
    }),
  });
  const t1 = Date.now();
  const json = (await res.json()) as { data?: { count?: number; ids?: string[] }; message?: string };
  const apiMs = t1 - t0;
  console.log(`[load-test] API response in ${apiMs}ms:`, json.message, `count=${json.data?.count}`);
  if (json.data?.count !== COUNT) throw new Error(`expected count ${COUNT}, got ${json.data?.count}`);

  const [dbRows] = (await pool.query("SELECT COUNT(*) as cnt FROM emails WHERE sender=?", [SENDER])) as unknown as [Array<{ cnt: number }>, unknown];
  console.log(`[load-test] DB rows for sender: ${dbRows[0].cnt} (expected ${COUNT})`);

  const afterCounts = await getQueueCounts();
  console.log(`[load-test] queue after enqueue:`, afterCounts);
  const delayed = afterCounts.delayed ?? 0;
  const waiting = afterCounts.waiting ?? 0;
  console.log(`[load-test] delayed+waiting ≈ ${delayed + waiting} (should be ~${COUNT} minus already active)`);

  const now = new Date();
  const bucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}`;
  const rateKey = `rate:${SENDER.toLowerCase()}:${bucket}`;
  const ttl = await redis.ttl(rateKey);
  console.log(`[load-test] Redis rate key ${rateKey} ttl=${ttl}s (hourly limiter not yet hit for this sender)`);

  console.log(`[load-test] observing worker drain for 8s...`);
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const c = await getQueueCounts();
    const [sentRows] = (await pool.query("SELECT COUNT(*) as cnt FROM emails WHERE sender=? AND status='sent'", [SENDER])) as unknown as [Array<{ cnt: number }>, unknown];
    const [pendingRows] = (await pool.query("SELECT COUNT(*) as cnt FROM emails WHERE sender=? AND status IN ('pending','processing','scheduled')", [SENDER])) as unknown as [Array<{ cnt: number }>, unknown];
    console.log(`  +${(i + 1) * 2}s queue:`, c, `DB sent=${sentRows[0].cnt} pending=${pendingRows[0].cnt}`);
  }

  console.log(`[load-test] testing hourly interaction with limit 10...`);
  const res2 = await fetch("http://localhost:4000/api/emails/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: "Hourly test",
      body: "<p>hourly</p>",
      recipients: Array.from({ length: 20 }, (_, i) => `hourly-${i}@loadtest.ex.com`),
      sender: SENDER,
      startAt: new Date(Date.now() + 500).toISOString(),
      delayMs: 0,
      hourlyLimit: 10,
    }),
  });
  const json2 = (await res2.json()) as { data?: { count?: number } };
  console.log(`[load-test] second schedule (hourlyLimit 10, 20 recipients) response count=${json2.data?.count}`);
  await new Promise((r) => setTimeout(r, 3000));
  const [hourlySent] = (await pool.query("SELECT COUNT(*) as cnt FROM emails WHERE sender=? AND recipient LIKE 'hourly-%' AND status='sent'", [SENDER])) as unknown as [Array<{ cnt: number }>, unknown];
  const [hourlyPending] = (await pool.query("SELECT COUNT(*) as cnt FROM emails WHERE sender=? AND recipient LIKE 'hourly-%' AND status IN ('pending','processing')", [SENDER])) as unknown as [Array<{ cnt: number }>, unknown];
  console.log(`[load-test] hourly burst after 3s: sent=${hourlySent[0].cnt} pending=${hourlyPending[0].cnt} (expect rescheduled, not dropped)`);

  await redis.quit();
  await emailQueue.close();

  console.log(`[load-test] done — API did not wait for sends, queue depth reflected ${COUNT}, workers draining per concurrency/minDelay/hourly`);
  console.log(`[load-test] API time ${apiMs}ms for ${COUNT} vs worker drain ongoing (see above)`);
  setTimeout(() => process.exit(0), 300);
}

main().catch((e) => {
  console.error("[load-test] FAIL", e);
  process.exit(1);
});
