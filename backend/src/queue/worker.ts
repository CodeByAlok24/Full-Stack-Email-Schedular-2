import { DelayedError, Worker, type Job } from "bullmq";
import type { RowDataPacket } from "mysql2/promise";
import { pool, type EmailRow } from "../db/client";
import { createRedisConnection } from "../config/redis";
import type { SendEmailJob } from "./queue";
import { checkHourlyLimit } from "../rateLimiter/hourlyLimiter";
import { sendEmail } from "../lib/mailer";
import { env } from "../config/env";
import { parseAttachments, readAttachment, type StoredAttachment } from "../lib/attachments";
import { effectiveSendGapMs } from "../lib/sendDelay";
import { completeSendSlot, releaseSendSlot, reserveSendSlot } from "./sendGate";

async function findEmail(emailId: string): Promise<EmailRow | undefined> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM emails WHERE id = ? LIMIT 1", [
    emailId,
  ]);
  return (rows as EmailRow[])[0];
}

async function deferActiveJob(job: Job<SendEmailJob>, retryAtMs: number, token?: string): Promise<never> {
  const lockToken = token ?? (job as unknown as { token?: string }).token;
  if (!lockToken) {
    throw new Error(`Cannot defer job ${job.id}: missing BullMQ lock token`);
  }
  await job.moveToDelayed(Math.max(Date.now() + 1, retryAtMs), lockToken);
  throw new DelayedError();
}

export function startWorker(): Worker<SendEmailJob> {
  const redis = createRedisConnection();
  const worker = new Worker<SendEmailJob>(
    "email-send",
    async (job: Job<SendEmailJob>, token?: string) => {
      const rawId = (job.data as { emailId?: unknown } | null)?.emailId;
      if (typeof rawId !== "string" || !rawId.trim()) {
        console.error(`[worker] malformed job ${job.id}: missing emailId`, job.data);
        throw new Error("malformed job data: emailId missing");
      }
      const emailId = rawId.trim();
      const hourlyLimit = (job.data as { hourlyLimit?: unknown })?.hourlyLimit;
      const limit =
        typeof hourlyLimit === "number" && hourlyLimit > 0
          ? Math.min(hourlyLimit, 5000)
          : env.maxEmailsPerHour;

      let row: EmailRow | undefined;
      try {
        row = await findEmail(emailId);
      } catch (dbErr) {
        console.error(`[worker] DB load failed for ${emailId}:`, dbErr);
        throw new Error(`DB load failed: ${String((dbErr as Error)?.message ?? dbErr).slice(0, 500)}`);
      }

      if (!row) {
        console.warn(`[worker] email not found for job ${job.id} emailId=${emailId} — skipping`);
        return;
      }

      if (row.status === "sent") {
        console.log(`[worker] already sent ${emailId} — skipping (idempotent)`);
        return;
      }
      if (row.status === "failed") {
        console.log(`[worker] already failed ${emailId} — skipping`);
        return;
      }

      const sendGapMs = effectiveSendGapMs(
        (job.data as { delayBetweenEmailsMs?: unknown }).delayBetweenEmailsMs,
        env.minSendDelayMs,
      );
      const slot = await reserveSendSlot(redis, sendGapMs);
      if (!slot.ready) {
        console.log(`[worker] send gap ${emailId} → retry in ${slot.retryAtMs - Date.now()}ms`);
        await deferActiveJob(job, slot.retryAtMs, token);
      }

      const slotToken = slot.token;
      if (!slotToken) {
        throw new Error(`Cannot send ${emailId}: Redis send gate did not return a reservation`);
      }

      const check = await checkHourlyLimit(redis, row.sender, limit).catch(async (err: unknown) => {
        await releaseSendSlot(redis, slotToken);
        throw err;
      });
      if (!check.allowed) {
        await releaseSendSlot(redis, slotToken);
        console.log(`[worker] rate limited ${emailId} → rescheduled ${Math.round(check.retryAfterMs / 1000)}s`);
        await deferActiveJob(job, Date.now() + check.retryAfterMs + 1000, token);
      }

      try {
        await pool.query("UPDATE emails SET status = 'processing' WHERE id = ? AND status IN ('pending','scheduled')", [
          emailId,
        ]);
        const stored = parseAttachments(row.attachments) as StoredAttachment[];
        const attachments = await Promise.all(
          stored.map(async (a) => {
            if (!a.file) return { name: a.name, size: a.size, type: a.type };
            try {
              const content = await readAttachment(a.file);
              return { name: a.name, size: content.length, type: a.type, content };
            } catch {
              console.warn(`[worker] attachment missing on disk for ${emailId}: ${a.file}`);
              return { name: a.name, size: a.size, type: a.type };
            }
          }),
        );
        const { previewUrl } = await sendEmail({
          from: row.sender,
          to: row.recipient,
          subject: row.subject,
          html: row.body,
          attachments,
        });
        const committed = await completeSendSlot(redis, slotToken);
        if (!committed) {
          throw new Error(`Send gate lease was lost for ${emailId}`);
        }
        try {
          await pool.query(
            "UPDATE emails SET status = 'sent', sent_at = UTC_TIMESTAMP(3), preview_url = ? WHERE id = ?",
            [previewUrl || null, emailId],
          );
        } catch (dbErr) {
          console.error(`[worker] DB update to sent failed for ${emailId} after SMTP success:`, dbErr);
          throw new Error(`DB sent update failed: ${String((dbErr as Error)?.message ?? dbErr).slice(0, 500)}`);
        }
        console.log(`[worker] sent ${emailId} -> ${row.recipient} preview: ${previewUrl}`);
      } catch (err) {
        try {
          await releaseSendSlot(redis, slotToken);
        } catch (releaseErr) {
          console.error(`[worker] send gate release failed for ${emailId}:`, releaseErr);
        }
        const msg = String((err as Error)?.message ?? err).slice(0, 1000);
        try {
          await pool.query("UPDATE emails SET attempts = attempts + 1, last_error = ? WHERE id = ?", [msg, emailId]);
        } catch (dbErr) {
          console.error(`[worker] DB attempts update failed for ${emailId}:`, dbErr);
        }
        throw err;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: env.workerConcurrency,
      ...(env.minSendDelayMs > 0 ? { limiter: { max: 1, duration: env.minSendDelayMs } } : {}),
    },
  );

  const origClose = worker.close.bind(worker);
  worker.close = (async () => {
    await origClose();
    await redis.quit();
  }) as typeof worker.close;

  worker.on("active", (job) => {
    const emailId = (job.data as SendEmailJob)?.emailId;
    console.log(`[worker] started ${job.id} → ${emailId}`);
  });
  worker.on("completed", (job) => console.log(`[worker] completed ${job.id}`));
  worker.on("failed", async (job, err) => {
    const emailId = (job?.data as SendEmailJob)?.emailId;
    console.error(`[worker] job ${job?.id} failed: ${err.message}`);
    if (job && job.attemptsMade + 1 >= (job.opts.attempts ?? 3)) {
      await pool.query("UPDATE emails SET status = 'failed' WHERE id = ?", [emailId]);
      console.log(`[worker] terminal failure ${emailId} → marked failed in DB`);
    } else if (job) {
      console.log(`[worker] retry ${emailId} → attempt ${job.attemptsMade}/${job.opts.attempts ?? 3}`);
    }
  });
  worker.on("error", (err) => console.error("[worker] error:", err));
  return worker;
}
