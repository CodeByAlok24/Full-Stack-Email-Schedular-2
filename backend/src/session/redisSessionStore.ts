import session from "express-session";
import type { Redis } from "ioredis";
import { createRedisConnection } from "../config/redis";

const SESSION_PREFIX = "auth:session:";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ttlSeconds(data: session.SessionData): number {
  const maxAge = typeof data.cookie?.maxAge === "number" ? data.cookie.maxAge : DEFAULT_TTL_MS;
  return Math.max(1, Math.ceil(maxAge / 1000));
}

export class RedisSessionStore extends session.Store {
  private readonly redis: Redis;
  private closed = false;

  constructor(redis: Redis = createRedisConnection()) {
    super();
    this.redis = redis;
  }

  private key(sid: string): string {
    return `${SESSION_PREFIX}${sid}`;
  }

  override get(sid: string, callback: (err: unknown, value?: session.SessionData | null) => void): void {
    this.redis
      .get(this.key(sid))
      .then((raw) => {
        if (!raw) {
          callback(null, null);
          return;
        }
        try {
          callback(null, JSON.parse(raw) as session.SessionData);
        } catch (error) {
          callback(error);
        }
      })
      .catch((error: unknown) => callback(error));
  }

  override set(sid: string, data: session.SessionData, callback?: (err?: unknown) => void): void {
    let serialized: string;
    try {
      serialized = JSON.stringify(data);
    } catch (error) {
      callback?.(error);
      return;
    }
    this.redis
      .set(this.key(sid), serialized, "EX", ttlSeconds(data))
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  override destroy(sid: string, callback: (err?: unknown) => void): void {
    this.redis
      .del(this.key(sid))
      .then(() => callback())
      .catch((error: unknown) => callback(error));
  }

  override touch(sid: string, data: session.SessionData, callback?: (err?: unknown) => void): void {
    this.redis
      .expire(this.key(sid), ttlSeconds(data))
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.redis.quit();
  }
}
