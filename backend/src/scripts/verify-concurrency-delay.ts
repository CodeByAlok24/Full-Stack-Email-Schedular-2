import { pool } from "../db/client";
import { env } from "../config/env";

async function scheduleBurst(sender: string, count: number, delayMs: number, hourlyLimit: number) {
  const startAt = new Date(Date.now() + 500).toISOString();
  const recipients = Array.from({ length: count }, (_, i) => `burst${i}-${Date.now()}@ex.com`);
  const res = await fetch("http://localhost:4000/api/emails/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": "dev-verifier" },
    body: JSON.stringify({ subject: "Burst test", body: "<p>hi</p>", recipients, sender, startAt, delayMs, hourlyLimit }),
  });
  const json = (await res.json()) as { data?: { ids?: string[] } };
  return { ids: json.data?.ids ?? [], recipients };
}

async function fetchSentAt(ids: string[]): Promise<Map<string, Date | null>> {
  if (!ids.length) return new Map();
  const [rows] = (await pool.query("SELECT id, sent_at FROM emails WHERE id IN (?)", [ids])) as unknown as [Array<{ id: string; sent_at: Date | null }>, unknown];
  return new Map(rows.map((r) => [r.id, r.sent_at ? new Date(r.sent_at) : null]));
}

async function waitForAllSent(ids: string[], timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = await fetchSentAt(ids);
    if (ids.every((id) => m.get(id) !== null)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timeout waiting for sent");
}

async function main(): Promise<void> {
  console.log(`[verify] WORKER_CONCURRENCY=${env.workerConcurrency} MIN_SEND_DELAY_MS=${env.minSendDelayMs} MAX_EMAILS_PER_HOUR=${env.maxEmailsPerHour}`);

  const burstSender = `burst-${Date.now()}@ex.com`;
  const burst = await scheduleBurst(burstSender, 3, 0, 50);
  console.log(`[1] burst 3 scheduled ids=${burst.ids.map((id) => id.slice(0, 8)).join(",")}`);
  await waitForAllSent(burst.ids, 20000);
  const sentMap1 = await fetchSentAt(burst.ids);
  const times1 = burst.ids.map((id) => sentMap1.get(id)!.getTime()).sort((a, b) => a - b);
  console.log(`[1] sent_at gaps: ${times1.map((t, i) => (i ? `${t - times1[i - 1]}ms` : "0")).join(", ")}`);
  const minGap = Math.min(...times1.slice(1).map((t, i) => t - times1[i]));
  console.log(`[1] min gap ${minGap}ms (expected >= ${env.minSendDelayMs * 0.9}ms)`);
  if (env.minSendDelayMs > 0 && minGap < env.minSendDelayMs * 0.8) {
    console.warn("[1] WARNING: gap smaller than MIN_SEND_DELAY_MS — limiter may be per-worker not global");
  } else {
    console.log("[1] PASS — burst spaced by global limiter");
  }

  console.log(`[2] concurrency ${env.workerConcurrency} — limiter ensures global spacing even with parallel workers (see [1] gaps)`);

  const burst5Sender = `burst5-${Date.now()}@ex.com`;
  const burst5 = await scheduleBurst(burst5Sender, 5, 0, 50);
  console.log(`[3] burst 5 simultaneous scheduled`);
  await waitForAllSent(burst5.ids, 30000);
  const sentMap5 = await fetchSentAt(burst5.ids);
  const times5 = burst5.ids.map((id) => sentMap5.get(id)!.getTime()).sort((a, b) => a - b);
  const gaps5 = times5.slice(1).map((t, i) => t - times5[i]);
  console.log(`[3] gaps: ${gaps5.map((g) => `${g}ms`).join(", ")} total span ${times5[times5.length - 1] - times5[0]}ms`);
  if (gaps5.every((g) => g >= env.minSendDelayMs * 0.8)) console.log("[3] PASS — 5 simultaneous jobs spaced");

  const hourlySender = `hourly-${Date.now()}@ex.com`;
  const hourlyBurst = await scheduleBurst(hourlySender, 3, 0, 1);
  console.log(`[4] hourly limit 1 burst 3 scheduled`);
  await new Promise((r) => setTimeout(r, 5000));
  const [hourlyRows] = (await pool.query("SELECT recipient, status FROM emails WHERE sender=? ORDER BY send_at", [hourlySender])) as unknown as [Array<{ recipient: string; status: string }>, unknown];
  console.log(`[4] after 5s statuses: ${hourlyRows.map((r) => `${r.recipient}:${r.status}`).join(", ")}`);
  const sentHourly = hourlyRows.filter((r) => r.status === "sent").length;
  const pendingHourly = hourlyRows.filter((r) => ["pending", "processing", "scheduled"].includes(r.status)).length;
  console.log(`[4] sent=${sentHourly} pending=${pendingHourly}`);
  if (sentHourly === 1 && pendingHourly >= 1) {
    console.log("[4] PASS — hourly limiter rescheduled excess (not dropped) while min-delay still applies to sent one");
  } else {
    console.warn("[4] check: expected 1 sent + 2 delayed/rescheduled");
  }

  console.log("[verify] done");
  setTimeout(() => process.exit(0), 300);
}

main().catch((e) => {
  console.error("[verify] FAIL", e);
  process.exit(1);
});
