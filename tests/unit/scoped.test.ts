/**
 * §11.2 unit coverage for the scoped data-access layer.
 *
 * These tests cover what can be asserted without a database: the role ordering,
 * the shape of the errors, and the structural guarantees that make the layer
 * hard to misuse. They deliberately do NOT mock the database (rule 11) — the
 * cross-tenant behaviour that §11.3 tests 22 and 23 demand is integration work
 * against real Postgres via Testcontainers, because the guarantee being tested
 * is that a SQL predicate filters rows, and a mock would only prove the mock
 * returns what it was told to.
 */
import { describe, expect, it } from "vitest";

import {
  ForbiddenError,
  NotFoundError,
  ScopedDb,
  type VendorContext,
  type VendorRole,
} from "../../src/db/scoped";

const ctx = (role: VendorRole): VendorContext => ({
  vendorId: "11111111-1111-1111-1111-111111111111",
  vendorSlug: "harbour-roast",
  userId: "user-1",
  role,
  viaPlatformAdmin: false,
});

/**
 * Role gating is asserted by calling methods and inspecting which throw
 * synchronously. Every gated method calls `#require` before it touches the
 * database, so a ForbiddenError is raised without a connection ever being
 * opened — which is what lets these run as unit tests.
 */
async function rejectsAsForbidden(
  fn: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (error) {
    return error instanceof ForbiddenError;
  }
}

describe("errors", () => {
  it("NotFoundError and ForbiddenError are distinguishable", () => {
    // Route handlers branch on these, so instanceof has to be reliable across
    // the transpile: a class extending Error needs its prototype intact.
    expect(new NotFoundError()).toBeInstanceOf(NotFoundError);
    expect(new NotFoundError()).toBeInstanceOf(Error);
    expect(new ForbiddenError()).toBeInstanceOf(ForbiddenError);
    expect(new NotFoundError()).not.toBeInstanceOf(ForbiddenError);
  });

  it("carries names for logging", () => {
    expect(new NotFoundError().name).toBe("NotFoundError");
    expect(new ForbiddenError().name).toBe("ForbiddenError");
  });
});

describe("role gating", () => {
  it("staff cannot read payout figures", async () => {
    const shop = new ScopedDb(ctx("staff"));
    expect(await rejectsAsForbidden(() => shop.payouts.balanceCents())).toBe(
      true,
    );
    expect(await rejectsAsForbidden(() => shop.payouts.ledger())).toBe(true);
  });

  it("staff cannot read or write shipping rates", async () => {
    const shop = new ScopedDb(ctx("staff"));
    expect(await rejectsAsForbidden(() => shop.shipping.list())).toBe(true);
    expect(
      await rejectsAsForbidden(() =>
        shop.shipping.create({
          name: "Standard",
          country: null,
          rateCents: 500,
          minDeliveryDays: 1,
          maxDeliveryDays: 3,
        }),
      ),
    ).toBe(true);
  });

  it("staff cannot list members or edit settings", async () => {
    const shop = new ScopedDb(ctx("staff"));
    expect(await rejectsAsForbidden(() => shop.members.list())).toBe(true);
    expect(
      await rejectsAsForbidden(() => shop.profile.update({ displayName: "x" })),
    ).toBe(true);
  });

  it("manager reaches money but not membership", async () => {
    const shop = new ScopedDb(ctx("manager"));
    // Not forbidden — these fail later, on the absent database connection.
    expect(await rejectsAsForbidden(() => shop.payouts.balanceCents())).toBe(
      false,
    );
    // Still forbidden: members and settings are owner-only (§5.4).
    expect(await rejectsAsForbidden(() => shop.members.list())).toBe(true);
    expect(
      await rejectsAsForbidden(() => shop.profile.update({ displayName: "x" })),
    ).toBe(true);
  });

  it("owner passes every gate", async () => {
    const shop = new ScopedDb(ctx("owner"));
    expect(await rejectsAsForbidden(() => shop.members.list())).toBe(false);
    expect(await rejectsAsForbidden(() => shop.payouts.balanceCents())).toBe(
      false,
    );
    expect(
      await rejectsAsForbidden(() => shop.profile.update({ displayName: "x" })),
    ).toBe(false);
  });

  it("staff may do warehouse work", async () => {
    // The §5.4 line: anything staff reaches must be safe to show a warehouse
    // temp. Fulfilment and stock counts qualify; payout figures do not.
    const shop = new ScopedDb(ctx("staff"));
    expect(
      await rejectsAsForbidden(() => shop.orders.markFulfilled("some-id")),
    ).toBe(false);
    expect(
      await rejectsAsForbidden(() =>
        shop.inventory.adjust("some-id", 1, "restock"),
      ),
    ).toBe(false);
  });

  it("profile.read is open to staff so the dashboard header renders", async () => {
    const shop = new ScopedDb(ctx("staff"));
    expect(await rejectsAsForbidden(() => shop.profile.read())).toBe(false);
  });
});

describe("structural guarantees", () => {
  it("exposes the acting context read-only", () => {
    const shop = new ScopedDb(ctx("manager"));
    expect(shop.context.vendorSlug).toBe("harbour-roast");
    expect(shop.context.role).toBe("manager");
  });

  it("keeps the vendor id out of every method signature", () => {
    // The core invariant: if no method accepts a vendor id, no call site can
    // pass the wrong one. Asserted on arity, since a vendor id would have to
    // arrive as a parameter.
    const shop = new ScopedDb(ctx("owner"));
    expect(shop.products.list.length).toBeLessThanOrEqual(1); // opts only
    expect(shop.products.count.length).toBe(0);
    expect(shop.orders.list.length).toBeLessThanOrEqual(1);
    expect(shop.members.list.length).toBe(0);
    expect(shop.payouts.balanceCents.length).toBe(0);
    expect(shop.inventory.list.length).toBeLessThanOrEqual(1);
    expect(shop.reviews.summary.length).toBe(0);
    expect(shop.profile.read.length).toBe(0);
  });

  it("cannot be escalated by mutating the context it hands out", async () => {
    // Regression: `context` used to return the live #ctx object, so a caller
    // could cast away Readonly, set role to "owner", and walk through every
    // gate. It returns a copy now — privilege escalation from inside the
    // process, which is exactly what a compromised dependency would try.
    const shop = new ScopedDb(ctx("staff"));
    const seen = shop.context;
    (seen as { role: VendorRole }).role = "owner";
    (seen as { vendorId: string }).vendorId = "someone-elses-vendor";

    expect(await rejectsAsForbidden(() => shop.members.list())).toBe(true);
    // And the real context is untouched by the tampering.
    expect(shop.context.role).toBe("staff");
    expect(shop.context.vendorId).toBe(ctx("staff").vendorId);
  });

  it("rejects a zero or fractional stock delta before touching the database", async () => {
    const shop = new ScopedDb(ctx("staff"));
    await expect(shop.inventory.adjust("v", 0, "restock")).rejects.toThrow(
      /non-zero integer/,
    );
    await expect(shop.inventory.adjust("v", 1.5, "restock")).rejects.toThrow(
      /non-zero integer/,
    );
  });

  it("validates shipping rate inputs before insert", async () => {
    const shop = new ScopedDb(ctx("owner"));
    await expect(
      shop.shipping.create({
        name: "Bad",
        country: null,
        rateCents: -1,
        minDeliveryDays: 1,
        maxDeliveryDays: 2,
      }),
    ).rejects.toThrow(/rateCents/);

    await expect(
      shop.shipping.create({
        name: "Bad",
        country: null,
        rateCents: 100,
        minDeliveryDays: 5,
        maxDeliveryDays: 2,
      }),
    ).rejects.toThrow(/maxDeliveryDays/);
  });

  it("rejects an empty review response", async () => {
    const shop = new ScopedDb(ctx("manager"));
    await expect(shop.reviews.respond("r", "   ")).rejects.toThrow(/empty/);
  });
});
