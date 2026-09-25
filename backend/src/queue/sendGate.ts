import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

export const SEND_GATE_LOCK_KEY = "email-send:send-gate:lock";
export const SEND_GATE_LAST_SEND_KEY = "email-send:send-gate:last-send";

function gateKeys(namespace: string): { lockKey: string; lastSendKey: string } {
  if (namespace === "global") {
    return { lockKey: SEND_GATE_LOCK_KEY, lastSendKey: SEND_GATE_LAST_SEND_KEY };
  }
  return {
    lockKey: `email-send:send-gate:${namespace}:lock`,
    lastSendKey: `email-send:send-gate:${namespace}:last-send`,
  };
}

const RESERVE_SCRIPT = `
local now = redis.call('TIME')
local nowMs = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local lockTtl = redis.call('PTTL', KEYS[1])
if lockTtl == -1 then
  redis.call('DEL', KEYS[1])
  lockTtl = -2
end
if lockTtl > 0 then
  return {0, math.min(lockTtl, 1000), nowMs}
end
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
local readyAt = previous + tonumber(ARGV[2])
if readyAt > nowMs then
  return {0, readyAt - nowMs, nowMs}
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
return {1, 0, nowMs}
`;

const COMPLETE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
local now = redis.call('TIME')
local nowMs = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[2], nowMs)
return 1
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface SendSlotReservation {
  ready: boolean;
  retryAtMs: number;
  token: string | null;
}

function normalizeGapMs(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeLockTtlMs(value: number): number {
  return Number.isFinite(value) && value >= 1000 ? Math.floor(value) : 120_000;
}

export async function reserveSendSlot(
  redis: Redis,
  minGapMs: number,
  lockTtlMs = 120_000,
  namespace = "global",
): Promise<SendSlotReservation> {
  const token = randomUUID();
  const keys = gateKeys(namespace);
  const result = (await redis.eval(
    RESERVE_SCRIPT,
    2,
    keys.lockKey,
    keys.lastSendKey,
    token,
    normalizeGapMs(minGapMs),
    normalizeLockTtlMs(lockTtlMs),
  )) as Array<number | string>;
  const nowMs = Number(result[2] ?? Date.now());
  const waitMs = Math.max(0, Number(result[1] ?? 0));
  const ready = Number(result[0]) === 1;
  return {
    ready,
    retryAtMs: nowMs + waitMs,
    token: ready ? token : null,
  };
}

export async function completeSendSlot(
  redis: Redis,
  token: string,
  namespace = "global",
): Promise<boolean> {
  const keys = gateKeys(namespace);
  const result = await redis.eval(COMPLETE_SCRIPT, 2, keys.lockKey, keys.lastSendKey, token);
  return Number(result) === 1;
}

export async function releaseSendSlot(
  redis: Redis,
  token: string,
  namespace = "global",
): Promise<boolean> {
  const keys = gateKeys(namespace);
  const result = await redis.eval(RELEASE_SCRIPT, 1, keys.lockKey, token);
  return Number(result) === 1;
}

export async function clearSendGate(redis: Redis, namespace = "global"): Promise<void> {
  const keys = gateKeys(namespace);
  await redis.del(keys.lockKey, keys.lastSendKey);
}
