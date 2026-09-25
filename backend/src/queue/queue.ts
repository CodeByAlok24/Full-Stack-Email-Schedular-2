import { Queue, QueueEvents } from "bullmq";
import { createRedisConnection } from "../config/redis";
import { env } from "../config/env";

export interface SendEmailJob {
  emailId: string;
  hourlyLimit: number;
  delayBetweenEmailsMs?: number;
}

export const emailQueue = new Queue<SendEmailJob>("email-send", {
  connection: createRedisConnection(),
});

const queueEvents = new QueueEvents("email-send", { connection: createRedisConnection() });
queueEvents.on("waiting", (jobId) => {
  console.log(`[queue] job waiting → ${jobId}`);
});
queueEvents.on("delayed", (jobId) => {
  console.log(`[queue] job delayed → ${jobId}`);
});
queueEvents.on("active", ({ jobId }) => {
  console.log(`[queue] job active → ${jobId}`);
});

export async function enqueueEmail(
  emailId: string,
  initialDelayMs: number,
  hourlyLimit: number,
  delayBetweenEmailsMs = env.minSendDelayMs,
): Promise<void> {
  const scheduledDelayMs = Number.isFinite(initialDelayMs) ? Math.max(0, Math.floor(initialDelayMs)) : 0;
  await emailQueue.add(
    "send-email",
    { emailId, hourlyLimit, delayBetweenEmailsMs: Math.max(0, Math.floor(delayBetweenEmailsMs)) },
    {
      jobId: emailId,
      delay: scheduledDelayMs,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  );
  console.log(`[queue] enqueued email ${emailId} with delay ${scheduledDelayMs}ms`);
}

export async function closeQueue(): Promise<void> {
  await emailQueue.close();
}
