/**
 * Liveness (§9, §13). Answers one question: is this process alive and able to
 * serve? It deliberately touches no dependency — Docker restarts a container
 * that fails this check, and a probe that pinged Postgres would turn a database
 * blip into a restart loop across every web container at once. Dependency
 * health is `/api/ready`.
 */

// Without this the handler is prerenderable — it reads no request data, so
// Next would bake the response at build time and `uptime` would be frozen at
// whatever the builder saw.
export const dynamic = "force-dynamic";

const startedAt = Date.now();

export async function GET() {
  return Response.json({
    status: "ok",
    version: process.env.npm_package_version ?? "0.0.0",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  });
}
