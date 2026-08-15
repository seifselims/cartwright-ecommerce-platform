import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/route";

/**
 * The §15 Phase 0 bar is "CI green on an empty test". This is deliberately
 * thin, but it asserts the liveness contract from §9 rather than asserting
 * nothing, so the wiring it proves (config, alias resolution, CI) is proven
 * against something real.
 */
describe("GET /api/health", () => {
  it("reports the liveness shape from §9", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      version: expect.any(String),
      uptime: expect.any(Number),
    });
  });

  it("stays up without any dependency reachable", async () => {
    // Liveness must not consult Postgres, Redis or Meilisearch — none are
    // running in a unit test, so a green result here is the assertion.
    await expect(GET()).resolves.toBeDefined();
  });
});
