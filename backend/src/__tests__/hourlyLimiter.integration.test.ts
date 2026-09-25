import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRedisConnection } from "../config/redis";
import { checkHourlyLimit } from "../rateLimiter/hourlyLimiter";
import type { Redis } from "ioredis";

function bucketKey(sender: string, now = new Date()): string {
  const bucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
    now.getUTCDate(),
  ).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}`;
  return `rate:${sender.toLowerCase()}:${bucket}`;
}

describe("hourlyLimiter integration (real Redis)", () => {
  let redis: Redis;
  const uniq = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    redis = createRedisConnection();
    await redis.ping();
  });

  afterAll(async () => {
    const keys = await redis.keys(`rate:${uniq}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it("multiple concurrent workers share counter atomically (exactly limit allowed)", async () => {
    const sender = `${uniq}-concurrent@ex.com`;
    const limit = 5;
    const key = bucketKey(sender);
    await redis.del(key);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkHourlyLimit(redis, sender, limit)),
    );
    const allowed = results.filter((r) => r.allowed).length;
    const denied = results.filter((r) => !r.allowed).length;
    expect(allowed).toBe(5);
    expect(denied).toBe(5);
    for (const r of results.filter((r) => !r.allowed)) {
      expect(r.retryAfterMs).toBeGreaterThan(0);
      expect(r.nextWindowStartMs).toBeGreaterThan(Date.now());
    }
    await redis.del(key);
  });

  it("multiple senders are isolated", async () => {
    const senderA = `${uniq}-a@ex.com`;
    const senderB = `${uniq}-b@ex.com`;
    const limit = 3;
    const keyA = bucketKey(senderA);
    const keyB = bucketKey(senderB);
    await redis.del(keyA, keyB);

    for (let i = 0; i < 3; i++) {
      const r = await checkHourlyLimit(redis, senderA, limit);
      expect(r.allowed).toBe(true);
    }
    const overA = await checkHourlyLimit(redis, senderA, limit);
    expect(overA.allowed).toBe(false);

    for (let i = 0; i < 3; i++) {
      const r = await checkHourlyLimit(redis, senderB, limit);
      expect(r.allowed).toBe(true);
    }
    const overB = await checkHourlyLimit(redis, senderB, limit);
    expect(overB.allowed).toBe(false);

    await redis.del(keyA, keyB);
  });

  it("exactly at limit allows, over denies with next window", async () => {
    const sender = `${uniq}-exact@ex.com`;
    const limit = 2;
    const key = bucketKey(sender);
    await redis.del(key);

    const r1 = await checkHourlyLimit(redis, sender, limit);
    expect(r1.allowed).toBe(true);
    expect(r1.count).toBe(1);

    const r2 = await checkHourlyLimit(redis, sender, limit);
    expect(r2.allowed).toBe(true);
    expect(r2.count).toBe(2);
    expect(r2.remaining).toBe(0);

    const r3 = await checkHourlyLimit(redis, sender, limit);
    expect(r3.allowed).toBe(false);
    expect(r3.count).toBe(3);
    expect(r3.retryAfterMs).toBeGreaterThan(0);

    await redis.del(key);
  });
});
