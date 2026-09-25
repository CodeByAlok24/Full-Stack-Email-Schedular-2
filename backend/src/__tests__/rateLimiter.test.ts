import { describe, it, expect, vi } from "vitest";
import { checkHourlyLimit } from "../lib/rateLimiter";

function fakeRedis(count: number) {
  return {
    incr: vi.fn(async () => count),
    expire: vi.fn(async () => 1),
    eval: vi.fn(async () => count),
  } as unknown as import("ioredis").Redis;
}

describe("checkHourlyLimit", () => {
  it("allows when under limit", async () => {
    const r = await checkHourlyLimit(fakeRedis(1), "a@b.com", 5);
    expect(r.allowed).toBe(true);
    expect(r.retryAfterMs).toBe(0);
  });

  it("allows exactly at limit", async () => {
    const r = await checkHourlyLimit(fakeRedis(5), "a@b.com", 5);
    expect(r.allowed).toBe(true);
    expect(r.retryAfterMs).toBe(0);
    expect(r.count).toBe(5);
    expect(r.remaining).toBe(0);
  });

  it("denies when over limit and returns next window", async () => {
    const r = await checkHourlyLimit(fakeRedis(6), "a@b.com", 5);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
    expect(r.retryAfterMs).toBeLessThanOrEqual(3600 * 1000);
    expect(r.nextWindowStartMs).toBeGreaterThan(Date.now());
    expect(r.count).toBe(6);
  });

  it("is case-insensitive on sender", async () => {
    const redis = { incr: vi.fn(async () => 2), expire: vi.fn(async () => 1), eval: vi.fn(async () => 2) } as unknown as import("ioredis").Redis;
    const a = await checkHourlyLimit(redis, "A@B.COM", 5);
    expect(a.allowed).toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, expect.stringContaining("rate:a@b.com:"));
  });

  it("new hourly window uses different bucket", async () => {
    const nowHour10 = new Date(Date.UTC(2026, 0, 1, 10, 15, 0));
    const nowHour11 = new Date(Date.UTC(2026, 0, 1, 11, 0, 0));
    let call = 0;
    const redis = {
      eval: vi.fn(async (_script: string, _n: number, key: string) => {
        call++;
        if (key.includes("T10")) return 6;
        if (key.includes("T11")) return 1;
        return call;
      }),
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
    } as unknown as import("ioredis").Redis;
    const r10 = await checkHourlyLimit(redis, "a@b.com", 5, nowHour10);
    expect(r10.allowed).toBe(false);
    const r11 = await checkHourlyLimit(redis, "a@b.com", 5, nowHour11);
    expect(r11.allowed).toBe(true);
  });
});
