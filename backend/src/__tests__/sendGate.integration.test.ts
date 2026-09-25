import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { createRedisConnection } from "../config/redis";
import {
  clearSendGate,
  completeSendSlot,
  releaseSendSlot,
  reserveSendSlot,
} from "../queue/sendGate";

const namespace = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const gapMs = 2000;

describe("Redis send gate", () => {
  let first: Redis;
  let second: Redis;

  beforeAll(async () => {
    first = createRedisConnection();
    second = createRedisConnection();
    await Promise.all([first.ping(), second.ping()]);
    await clearSendGate(first, namespace);
  });

  afterAll(async () => {
    await clearSendGate(first, namespace);
    await Promise.all([first.quit(), second.quit()]);
  });

  it("allows only one concurrent worker to hold the send slot", async () => {
    const reservations = await Promise.all([
      reserveSendSlot(first, gapMs, 5000, namespace),
      reserveSendSlot(second, gapMs, 5000, namespace),
      reserveSendSlot(first, gapMs, 5000, namespace),
    ]);
    const ready = reservations.filter((reservation) => reservation.ready);
    expect(ready).toHaveLength(1);
    expect(ready[0].token).toBeTruthy();
    expect(reservations.filter((reservation) => !reservation.ready).every((reservation) => reservation.retryAtMs > Date.now())).toBe(true);

    const committed = await completeSendSlot(second, ready[0].token!, namespace);
    expect(committed).toBe(true);

    const next = await reserveSendSlot(first, gapMs, 5000, namespace);
    expect(next.ready).toBe(false);
    expect(next.retryAtMs - Date.now()).toBeGreaterThan(1000);
  });

  it("releases a failed reservation without recording a send", async () => {
    await clearSendGate(first, namespace);
    const reservation = await reserveSendSlot(second, gapMs, 5000, namespace);
    expect(reservation.ready).toBe(true);
    expect(await releaseSendSlot(first, reservation.token!, namespace)).toBe(true);
    const next = await reserveSendSlot(second, gapMs, 5000, namespace);
    expect(next.ready).toBe(true);
    expect(await completeSendSlot(first, next.token!, namespace)).toBe(true);
  });
});
