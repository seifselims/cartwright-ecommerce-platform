import Redis, { type RedisOptions } from "ioredis";

/**
 * Two Redis instances, not two logical databases on one (§6.3.4): a `FLUSHDB`
 * on the cache must never be able to drop queued jobs. The cache evicts under
 * memory pressure because everything in it is rebuildable from Postgres; the
 * queue runs `noeviction` because a discarded job is lost work.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — see .env.example`);
  return value;
}

/**
 * `lazyConnect` keeps `next build` from opening sockets at import time: this
 * module is reachable from any route that touches auth, and a build should not
 * need a running Redis. The first command connects.
 */
const baseOptions: RedisOptions = {
  lazyConnect: true,
  enableAutoPipelining: true,
};

function createClient(name: string, url: string, options: RedisOptions): Redis {
  const client = new Redis(url, { ...baseOptions, ...options });
  // Without a listener, ioredis' `error` event becomes an unhandled exception
  // and takes the process down on a blip. Reconnection is automatic.
  client.on("error", (error: Error) => {
    console.error(`[redis:${name}] ${error.message}`);
  });
  return client;
}

/**
 * `next dev` re-evaluates modules on every edit, so a module-level client would
 * leak a connection per hot reload until Redis refuses new ones.
 */
const globalForRedis = globalThis as typeof globalThis & {
  cwCacheRedis?: Redis;
  cwQueueRedis?: Redis;
};

/** Cache, sessions, rate limits, locks, reservations. Safe to lose. */
export const redis: Redis =
  globalForRedis.cwCacheRedis ??
  createClient("cache", requireEnv("REDIS_URL"), {});

/**
 * BullMQ backend. `maxRetriesPerRequest: null` is required by BullMQ: its
 * blocking commands must wait indefinitely rather than fail after N retries.
 */
export const queueRedis: Redis =
  globalForRedis.cwQueueRedis ??
  createClient("queue", requireEnv("QUEUE_REDIS_URL"), {
    maxRetriesPerRequest: null,
  });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.cwCacheRedis = redis;
  globalForRedis.cwQueueRedis = queueRedis;
}
