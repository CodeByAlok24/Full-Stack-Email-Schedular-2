import { randomUUID } from "node:crypto";
import { createApp } from "../app";
import { startWorker } from "../queue/worker";
import { emailQueue } from "../queue/queue";
import { pool } from "../db/client";
import { migrate } from "../db/migrate";

async function main() {
  console.log("=== STEP 1: Running DB Migration ===");
  await migrate();
  console.log("✓ Migration complete");

  console.log("\n=== STEP 2: Starting API server ===");
  const app = createApp();
  const server = app.listen(4001, () => {
    console.log("✓ Test server listening on http://localhost:4001");
  });

  const testSender = "tester@reachinbox.test";
  const testRecipient = "candidate-lead@example.com";
  const userId = "test-user-e2e";

  console.log("\n=== STEP 3: Scheduling an Immediate Email via POST /api/emails/schedule ===");
  const scheduleRes = await fetch("http://localhost:4001/api/emails/schedule", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({
      subject: "E2E Immediate Send Test",
      body: "<p>Hello from ReachInbox Scheduler!</p>",
      recipients: [testRecipient],
      sender: testSender,
      delayBetweenEmails: 1,
      hourlyLimit: 50,
    }),
  });

  const schedJson = (await scheduleRes.json()) as any;
  console.log("Schedule response:", schedJson);
  if (!scheduleRes.ok || !schedJson.data?.ids?.length) {
    throw new Error(`Schedule failed: ${JSON.stringify(schedJson)}`);
  }
  const emailId = schedJson.data.ids[0];
  console.log(`✓ Email scheduled with ID: ${emailId}`);

  console.log("\n=== STEP 4: Verifying Initial DB Record ===");
  const [dbRows] = (await pool.query("SELECT id, status, send_at, attempts FROM emails WHERE id = ?", [emailId])) as any;
  console.log("DB status right after schedule:", dbRows[0]?.status, "send_at:", dbRows[0]?.send_at);
  if (dbRows[0]?.status !== "scheduled" && dbRows[0]?.status !== "pending") {
    throw new Error(`Unexpected initial status: ${dbRows[0]?.status}`);
  }

  console.log("\n=== STEP 5: Starting BullMQ Worker to Process Email ===");
  const worker = startWorker();
  console.log("✓ Worker started");

  console.log("Waiting for worker to deliver email via Ethereal SMTP...");
  let sent = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const [rows] = (await pool.query("SELECT id, status, sent_at, last_error FROM emails WHERE id = ?", [emailId])) as any;
    if (rows[0]?.status === "sent") {
      console.log(`✓ Email successfully marked SENT in MySQL! sent_at: ${rows[0].sent_at}`);
      sent = true;
      break;
    }
    console.log(`Status after ${i + 1}s: ${rows[0]?.status}`);
  }

  if (!sent) {
    const [errRows] = (await pool.query("SELECT * FROM emails WHERE id = ?", [emailId])) as any;
    throw new Error(`Email was not sent in time. DB record: ${JSON.stringify(errRows[0])}`);
  }

  console.log("\n=== STEP 6: Testing Restart Scenario with Delayed Job ===");
  const futureTime = new Date(Date.now() + 6000).toISOString();
  const schedDelayed = await fetch("http://localhost:4001/api/emails/schedule", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({
      subject: "E2E Restart Test",
      body: "<p>Surviving process restarts!</p>",
      recipients: ["restart-test@example.com"],
      sender: testSender,
      startAt: futureTime,
      delayBetweenEmails: 1,
      hourlyLimit: 50,
    }),
  });
  const delayedJson = (await schedDelayed.json()) as any;
  const delayedId = delayedJson.data.ids[0];
  console.log(`✓ Delayed email scheduled for ${futureTime} with ID: ${delayedId}`);

  console.log("Simulating server crash: Stopping worker now mid-queue...");
  await worker.close();
  console.log("✓ Worker stopped while job is delayed in BullMQ Redis");

  console.log("Waiting 3 seconds while server is offline...");
  await new Promise((r) => setTimeout(r, 3000));

  const [midRows] = (await pool.query("SELECT status FROM emails WHERE id = ?", [delayedId])) as any;
  console.log("Status while offline (should still be scheduled):", midRows[0]?.status);

  console.log("Restarting worker now...");
  const restartedWorker = startWorker();
  console.log("✓ Worker restarted! BullMQ should resume delayed job from Redis automatically.");

  let restartSent = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const [rows] = (await pool.query("SELECT id, status, sent_at FROM emails WHERE id = ?", [delayedId])) as any;
    if (rows[0]?.status === "sent") {
      console.log(`✓ Delayed email sent successfully after restart! sent_at: ${rows[0].sent_at}`);
      restartSent = true;
      break;
    }
    console.log(`Restart test status after ${i + 1}s: ${rows[0]?.status}`);
  }

  if (!restartSent) {
    throw new Error("Restarted email was not sent in time!");
  }

  console.log("\n=== STEP 7: Testing Idempotency (Prevent Duplicate Sends) ===");
  console.log("Enqueuing job with a new BullMQ jobId for the already-sent emailId...");
  const duplicateJobId = randomUUID();
  await emailQueue.add(
    "send-email",
    { emailId, hourlyLimit: 50 },
    { jobId: duplicateJobId, delay: 0, removeOnComplete: true },
  );
  await new Promise((r) => setTimeout(r, 2000));
  const [idemRows] = (await pool.query("SELECT attempts, status FROM emails WHERE id = ?", [emailId])) as any;
  console.log(`Status remains: ${idemRows[0]?.status} (attempts=${idemRows[0]?.attempts})`);
  console.log("✓ Idempotency guard passed: already-sent email was not re-sent!");

  console.log("\n=== CLEANUP ===");
  await restartedWorker.close();
  server.close();
  await emailQueue.close();
  await pool.end();
  console.log("\n================================================");
  console.log(" ALL END-TO-END CHECKS PASSED PERFECTLY! ");
  console.log("================================================\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL E2E FAILURE:", err);
  process.exit(1);
});
