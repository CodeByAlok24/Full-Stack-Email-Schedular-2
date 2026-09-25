import { pool } from "../db/client";
import { createRedisConnection } from "../config/redis";
import { clearSendGate } from "../queue/sendGate";

const apiUrl = "http://localhost:4000/api/emails/schedule";
const recipients = [
  "bulk-load-delay-1@example.com",
  "bulk-load-delay-2@example.com",
  "bulk-load-delay-3@example.com",
];

async function main(): Promise<void> {
  const redis = createRedisConnection();
  await clearSendGate(redis);
  const startAt = new Date(Date.now() + 1500).toISOString();
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: "Delay verification",
      body: "<p>delay verification</p>",
      recipients,
      sender: `delay-test-${Date.now()}@example.com`,
      startAt,
      delayBetweenEmails: 2,
      hourlyLimit: 50,
    }),
  });
  const payload = (await response.json()) as { data?: { ids?: string[] }; message?: string };
  if (!response.ok || !payload.data?.ids || payload.data.ids.length !== recipients.length) {
    throw new Error(`schedule failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  const ids = payload.data.ids;
  const deadline = Date.now() + 30_000;
  let sent: Array<{ id: string; recipient: string; sentAt: Date }> = [];
  while (Date.now() < deadline) {
    const [rows] = (await pool.query(
      "SELECT id, recipient, sent_at FROM emails WHERE id IN (?)",
      [ids],
    )) as unknown as [Array<{ id: string; recipient: string; sent_at: Date | null }>, unknown];
    if (rows.length === ids.length && rows.every((row) => row.sent_at !== null)) {
      sent = rows.map((row) => ({ id: row.id, recipient: row.recipient, sentAt: new Date(row.sent_at!) }));
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (sent.length !== recipients.length) throw new Error("timed out waiting for three sent timestamps");
  sent.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const gaps = sent.slice(1).map((row, index) => row.sentAt.getTime() - sent[index].sentAt.getTime());
  console.log(JSON.stringify({ startAt, sent: sent.map((row) => ({ recipient: row.recipient, sentAt: row.sentAt.toISOString() })), gapsMs: gaps }, null, 2));
  if (gaps.some((gap) => gap < 1800)) throw new Error(`delay verification failed: ${gaps.join(", ")}ms`);
  await redis.quit();
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
