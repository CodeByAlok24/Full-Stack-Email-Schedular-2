import IORedis from "ioredis";
import { env } from "./env";

export function createRedisConnection(): IORedis {
  const r = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  r.on("error", (err) => {
    console.error("[redis] error:", (err as Error)?.message ?? err);
  });
  return r;
}
