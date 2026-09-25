import type { Redis } from "ioredis";

export interface HourlyLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  nextWindowStartMs: number;
  count: number;
  remaining: number;
}

export async function checkHourlyLimit(
  redis: Redis,
  sender: string,
  limit: number,
  now = new Date(),
): Promise<HourlyLimitResult> {
  const bucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
    now.getUTCDate(),
  ).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}`;
  const key = `rate:${sender.toLowerCase()}:${bucket}`;

  let count: number;
  try {
    const res = (await (redis as unknown as { eval: (script: string, numKeys: number, key: string) => Promise<unknown> }).eval(
      "local c = redis.call('INCR', KEYS[1]); if c == 1 then redis.call('EXPIRE', KEYS[1], 3600) end return c",
      1,
      key,
    )) as number;
    count = Number(res);
  } catch {
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3600);
  }

  const nextWindowStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours() + 1,
  );
  const retryAfterMs = Math.max(0, nextWindowStartMs - now.getTime());
  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);

  if (allowed) {
    return { allowed: true, retryAfterMs: 0, nextWindowStartMs, count, remaining };
  }
  return { allowed: false, retryAfterMs, nextWindowStartMs, count, remaining: 0 };
}
