import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import * as schema from "./db/schema";
import { redis } from "./redis";

/**
 * Sessions, rate-limit counters, OTPs and password-reset tokens live in Redis
 * rather than Postgres (§6.5). The prefix is deliberately unversioned, unlike
 * the `cw:v{n}:` cacheable shapes in §6.2: bumping a cache version on deploy
 * must not sign every user out.
 */
const authKey = (key: string) => `cw:auth:${key}`;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  secondaryStorage: {
    get: (key) => redis.get(authKey(key)),
    set: (key, value, ttl) =>
      ttl
        ? redis.set(authKey(key), value, "EX", ttl)
        : redis.set(authKey(key), value),
    delete: async (key) => {
      await redis.del(authKey(key));
    },
    /**
     * Single-use credentials (OTPs, reset tokens) are consumed with `GETDEL`
     * so two concurrent requests cannot both read the same token before either
     * deletes it.
     */
    getAndDelete: (key) => redis.getdel(authKey(key)),
    /**
     * Better Auth falls back to a non-atomic get-then-set when this is absent,
     * which lets N concurrent requests all pass a stale read before any
     * increment lands — a rate limit that does not limit under exactly the
     * load it exists for. `EXPIRE ... NX` sets the TTL only when the key is
     * created, so the window is fixed from the first request rather than
     * sliding forward on every hit.
     */
    increment: async (key, ttl) => {
      const results = await redis
        .multi()
        .incr(authKey(key))
        .expire(authKey(key), ttl, "NX")
        .exec();
      const count = results?.[0]?.[1];
      if (typeof count !== "number") {
        throw new Error(`Rate-limit increment failed for ${key}`);
      }
      return count;
    },
  },
  session: {
    /**
     * The Postgres row is kept as a reconcilable source of truth for the admin
     * session list and the audit trail; Redis is where the read path goes.
     */
    storeSessionInDatabase: true,
    preserveSessionInDatabase: true,
    /**
     * Five minutes of trusting a signed cookie without any lookup — the reason
     * the authenticated path costs no database queries under load, and the
     * reason revocation is not instant. See docs/adr/0002.
     */
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  rateLimit: {
    enabled: true,
    storage: "secondary-storage",
    window: 60,
    max: 100,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  user: {
    additionalFields: {
      /**
       * `input: false` is load-bearing, not tidiness: additional fields are
       * writable at sign-up by default, so without it anyone can register with
       * `role: "admin"` and walk through every cross-vendor guard in §5.4.
       * Role changes go through an admin path, never through user input.
       */
      role: {
        type: "string",
        required: false,
        defaultValue: "customer",
        input: false,
      },
      stripeCustomerId: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
});
