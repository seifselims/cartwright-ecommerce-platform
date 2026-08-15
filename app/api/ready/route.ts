import { sql } from "drizzle-orm";

import { db } from "@/src/db";
import { queueRedis, redis } from "@/src/redis";

/**
 * Readiness (§9, §13). Answers a different question from `/api/health`: can
 * this process actually serve traffic right now? A load balancer uses this to
 * decide whether to route requests, so a failure here pulls one container out
 * of rotation rather than restarting it.
 *
 * §9 specifies db + redis + search. Both Redis instances are checked, not just
 * the cache: a dead queue Redis means checkout emails and payout sweeps silently
 * stop, which is not a state to serve traffic in.
 */

export const dynamic = "force-dynamic";

/**
 * A probe is only useful if it answers faster than the interval it is polled
 * on. A dependency that has stopped responding usually hangs rather than
 * refusing, so every check races a timer instead of trusting the client.
 */
const CHECK_TIMEOUT_MS = 2000;

type CheckResult = { ok: true } | { ok: false; error: string };

async function withTimeout(
  name: string,
  check: () => Promise<unknown>,
): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)),
          CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : `${name} check failed`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const checks = {
    // `SELECT 1` proves the pool can hand out a live connection, which a
    // TCP-level check would not.
    database: () => db.execute(sql`select 1`),
    redis: () => redis.ping(),
    queueRedis: () => queueRedis.ping(),
    search: async () => {
      const response = await fetch(
        `${process.env.MEILI_HOST ?? "http://localhost:7700"}/health`,
        { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(`meilisearch returned ${response.status}`);
      }
    },
  } as const;

  // Sequential checks would add up to 8s of timeout in the worst case; these
  // are independent, so they race together.
  const results = await Promise.all(
    Object.entries(checks).map(
      async ([name, check]) => [name, await withTimeout(name, check)] as const,
    ),
  );

  const dependencies = Object.fromEntries(
    results.map(([name, result]) => [
      name,
      result.ok ? { status: "ok" } : { status: "error", error: result.error },
    ]),
  );
  const ready = results.every(([, result]) => result.ok);

  return Response.json(
    { status: ready ? "ready" : "not_ready", dependencies },
    { status: ready ? 200 : 503 },
  );
}
