/**
 * The scoped data-access layer (§5.4, rule 12).
 *
 * ── What this file is ──────────────────────────────────────────────────────
 *
 * Ordinary TypeScript. No stored procedures, nothing created inside Postgres.
 * Every function below wraps a Drizzle query of the kind you would otherwise
 * write inside a page — the only difference is where it lives and the fact that
 * the vendor filter is already applied.
 *
 * ── The problem it exists to solve ─────────────────────────────────────────
 *
 * Eight shops share one `products` table. Every row carries a `vendor_id`, so
 * every vendor-facing query needs `WHERE vendor_id = ...`. Compare:
 *
 *     db.select().from(products).where(eq(products.vendorId, id))  // correct
 *     db.select().from(products)                                   // leaks all 8
 *
 * The second does not crash, does not fail typecheck, and returns data — just
 * everyone's. It is a bug made of *missing* code, which is the hardest kind to
 * catch in review, and it passes any test whose fixture has one vendor in it.
 *
 * So the filter is written once, here, and vendor-facing code is given a handle
 * that has it baked in:
 *
 *     const shop = await forVendor(session, "harbour-roast");
 *     const rows = await shop.products.list();   // note: no arguments
 *
 * `list()` takes no vendor id, so there is no vendor id to pass wrong. That is
 * the entire design: make the mistake unrepresentable rather than forbidden.
 *
 * ── Three rules from §5.4 that this encodes ────────────────────────────────
 *
 * 1. A vendor id is NEVER an input. It is derived from the session's
 *    `vendor_members` rows. If a caller could pass one, an attacker could
 *    eventually influence it, and the guarantee would be gone.
 * 2. Another vendor's resource is 404, never 403. A 403 confirms the row
 *    exists, which leaks the id space; 404 makes it indistinguishable from
 *    nothing at all.
 * 3. Vendor role gates the methods. `owner` may touch members and banking,
 *    `manager` everything else, `staff` no payout figures. The spec's test for
 *    where that line falls: anything `staff` reaches must be safe to show a
 *    warehouse temp.
 *
 * Related: rule 15 — `user.role` is never `vendor`. Platform role and vendor
 * membership are separate axes, and this file reads membership, never role.
 */
import { and, asc, count, desc, eq, sql } from "drizzle-orm";

import { db } from "./index";
import {
  inventory,
  inventoryLedger,
  productVariants,
  products,
  reviews,
  vendorBalanceEntries,
  vendorMembers,
  vendorOrders,
  vendorShippingRates,
  vendors,
} from "./schema";

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Thrown for both "no such vendor" and "not your vendor" — deliberately the
 * same error, because §5.4 requires the two to be indistinguishable to the
 * caller. Route handlers map this to a 404.
 */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Thrown when the acting member holds a vendor role too low for the operation.
 * Distinct from NotFoundError on purpose: the resource is not being hidden
 * here. The caller is a known member of this vendor and is simply not permitted
 * this action, so telling them so leaks nothing they do not already know.
 */
export class ForbiddenError extends Error {
  constructor(message = "Insufficient vendor role") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type VendorRole = "owner" | "manager" | "staff";

/**
 * The minimum this layer needs from a session. Typed structurally rather than
 * against Better Auth's session type so unit tests can construct one without
 * standing up auth, and so a Better Auth upgrade cannot silently change what
 * authorization depends on.
 */
export type ActingUser = {
  id: string;
  /** Platform role. Never "vendor" — see rule 15. */
  role: string;
};

export type VendorContext = {
  vendorId: string;
  vendorSlug: string;
  userId: string;
  role: VendorRole;
  /** True when acting through platform admin rather than membership. */
  viaPlatformAdmin: boolean;
};

/** Ranked so comparisons are ordering, not a pile of string equality checks. */
const ROLE_RANK: Record<VendorRole, number> = {
  staff: 1,
  manager: 2,
  owner: 3,
};

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the acting vendor context, or throw NotFoundError.
 *
 * This is the only way to obtain a scoped handle, which is what makes the
 * guarantee hold: there is no constructor that takes a vendor id directly.
 *
 * `vendorSlug` comes from the URL and is untrusted — it selects *which* of the
 * caller's memberships to act under, and is then verified against
 * `vendor_members`. It is never itself the source of authority. A slug the
 * caller has no membership for is a 404, identical to a slug that does not
 * exist.
 */
export async function forVendor(
  user: ActingUser,
  vendorSlug: string,
): Promise<ScopedDb> {
  const rows = await db
    .select({
      vendorId: vendors.id,
      vendorSlug: vendors.slug,
      vendorStatus: vendors.status,
      memberRole: vendorMembers.role,
    })
    .from(vendors)
    .leftJoin(
      vendorMembers,
      and(
        eq(vendorMembers.vendorId, vendors.id),
        eq(vendorMembers.userId, user.id),
      ),
    )
    .where(eq(vendors.slug, vendorSlug))
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError();

  /**
   * A platform admin may act for any vendor — for support and moderation. It is
   * granted at `owner` level but flagged, so audit entries can record that the
   * action came from the platform rather than from the shop. Rule 15 still
   * holds: this is `user.role === "admin"`, a platform employee, never a
   * `vendor` role on the user row.
   */
  if (!row.memberRole) {
    if (user.role !== "admin") throw new NotFoundError();
    return new ScopedDb({
      vendorId: row.vendorId,
      vendorSlug: row.vendorSlug,
      userId: user.id,
      role: "owner",
      viaPlatformAdmin: true,
    });
  }

  /**
   * A suspended vendor's members lose dashboard access. Checked here rather
   * than per-method so a new method cannot forget it. Platform admins keep
   * access, since suspension is exactly when they need to look.
   */
  if (row.vendorStatus === "suspended" && user.role !== "admin") {
    throw new NotFoundError();
  }

  return new ScopedDb({
    vendorId: row.vendorId,
    vendorSlug: row.vendorSlug,
    userId: user.id,
    role: row.memberRole,
    viaPlatformAdmin: false,
  });
}

/* -------------------------------------------------------------------------- */
/* The scoped handle                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Everything reachable from here is already filtered to one vendor.
 *
 * Note what is absent: no method accepts a vendor id, and `ctx` is private.
 * Callers cannot widen the scope, so a handler physically cannot query across
 * tenants through this object.
 */
export class ScopedDb {
  readonly #ctx: VendorContext;

  constructor(ctx: VendorContext) {
    this.#ctx = ctx;
  }

  /**
   * Read-only view, for audit logging and UI affordances.
   *
   * Returns a *copy*. `Readonly<T>` is a compile-time claim only — a caller can
   * cast it away, and handing out the live object would let them rewrite the
   * `role` the gate reads and escalate `staff` to `owner`. Copying costs
   * nothing here and makes the escalation impossible rather than merely
   * discouraged, which is the same principle as keeping the vendor id out of
   * method signatures.
   */
  get context(): Readonly<VendorContext> {
    return { ...this.#ctx };
  }

  /** Throws unless the acting member is at least `minimum`. */
  #require(minimum: VendorRole): void {
    if (ROLE_RANK[this.#ctx.role] < ROLE_RANK[minimum]) {
      throw new ForbiddenError(
        `Requires vendor role '${minimum}' or higher; caller is '${this.#ctx.role}'`,
      );
    }
  }

  /* ---------------------------------------------------------------------- */

  readonly products = {
    /**
     * This vendor's products. The `where` is supplied here, not by the caller —
     * the whole point of the file.
     */
    list: async (opts: { limit?: number; offset?: number } = {}) => {
      return db
        .select({
          id: products.id,
          slug: products.slug,
          title: products.title,
          status: products.status,
          brand: products.brand,
          createdAt: products.createdAt,
        })
        .from(products)
        .where(eq(products.vendorId, this.#ctx.vendorId))
        .orderBy(desc(products.createdAt))
        .limit(opts.limit ?? 50)
        .offset(opts.offset ?? 0);
    },

    /**
     * One product by id.
     *
     * The vendor predicate sits in the same `where` as the id. Another vendor's
     * product id therefore matches zero rows and raises NotFoundError — the
     * caller cannot tell it apart from an id that was never issued, which is
     * §5.4's requirement.
     */
    byId: async (productId: string) => {
      const rows = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, productId),
            eq(products.vendorId, this.#ctx.vendorId),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) throw new NotFoundError();
      return row;
    },

    /** Catalogue work is a `staff` responsibility. */
    updateTitle: async (productId: string, title: string) => {
      this.#require("staff");

      const updated = await db
        .update(products)
        .set({ title, updatedAt: new Date() })
        .where(
          and(
            eq(products.id, productId),
            eq(products.vendorId, this.#ctx.vendorId),
          ),
        )
        .returning({ id: products.id });

      // A write matching zero rows means the row is not ours — 404, not a
      // silent no-op. Silently succeeding on someone else's id is worse than
      // failing, because nothing surfaces the attempt.
      if (updated.length === 0) throw new NotFoundError();
      return updated[0]!;
    },

    count: async () => {
      const rows = await db
        .select({ n: count() })
        .from(products)
        .where(eq(products.vendorId, this.#ctx.vendorId));
      return rows[0]?.n ?? 0;
    },
  };

  /* ---------------------------------------------------------------------- */

  readonly variants = {
    /**
     * Scoped on `product_variants.vendor_id` directly rather than by joining
     * products. The column is denormalised for exactly this reason (§5.1) —
     * one predicate, no join, and the composite FK makes a variant whose vendor
     * disagrees with its product unrepresentable.
     */
    listForProduct: async (productId: string) => {
      return db
        .select()
        .from(productVariants)
        .where(
          and(
            eq(productVariants.productId, productId),
            eq(productVariants.vendorId, this.#ctx.vendorId),
          ),
        )
        .orderBy(productVariants.position);
    },

    /**
     * Look up by SKU — the case that proves the model.
     *
     * SKUs are unique per vendor, not globally: the seed deliberately gives
     * `NG-SHARED-01` to two shops. Without the vendor predicate this returns
     * another vendor's variant; with it, each shop sees only its own.
     */
    bySku: async (sku: string) => {
      const rows = await db
        .select()
        .from(productVariants)
        .where(
          and(
            eq(productVariants.sku, sku),
            eq(productVariants.vendorId, this.#ctx.vendorId),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) throw new NotFoundError();
      return row;
    },
  };

  /* ---------------------------------------------------------------------- */

  /**
   * Stock levels for `/vendor/inventory`.
   *
   * `inventory` is the one vendor-facing table with NO `vendor_id` column — it
   * is keyed by `variant_id` alone, because stock belongs to a variant and the
   * variant already knows its vendor. Scoping therefore has to go through a
   * join on `product_variants`, and that is exactly the sort of indirection a
   * handler writing its own query gets wrong: `SELECT * FROM inventory WHERE
   * variant_id = $1` looks complete and silently accepts another vendor's
   * variant id.
   */
  readonly inventory = {
    list: async (opts: { limit?: number; offset?: number } = {}) => {
      return db
        .select({
          variantId: inventory.variantId,
          sku: productVariants.sku,
          title: productVariants.title,
          onHand: inventory.onHand,
          reserved: inventory.reserved,
          reorderPoint: inventory.reorderPoint,
          updatedAt: inventory.updatedAt,
        })
        .from(inventory)
        .innerJoin(productVariants, eq(productVariants.id, inventory.variantId))
        .where(eq(productVariants.vendorId, this.#ctx.vendorId))
        .orderBy(asc(productVariants.sku))
        .limit(opts.limit ?? 100)
        .offset(opts.offset ?? 0);
    },

    /** Variants at or below their reorder point — the restock worklist. */
    lowStock: async () => {
      return db
        .select({
          variantId: inventory.variantId,
          sku: productVariants.sku,
          title: productVariants.title,
          onHand: inventory.onHand,
          reorderPoint: inventory.reorderPoint,
        })
        .from(inventory)
        .innerJoin(productVariants, eq(productVariants.id, inventory.variantId))
        .where(
          and(
            eq(productVariants.vendorId, this.#ctx.vendorId),
            sql`${inventory.onHand} <= ${inventory.reorderPoint}`,
          ),
        )
        .orderBy(asc(inventory.onHand));
    },

    /**
     * Adjust stock by a signed delta.
     *
     * Two things make this safe rather than convenient:
     *
     * 1. It runs in a transaction and writes the `inventory_ledger` row in the
     *    same one (rule 4, rule 13). The ledger is the stock audit trail; a
     *    quantity that moved without a ledger row is unexplainable later.
     * 2. Ownership is re-checked INSIDE the transaction by looking the variant
     *    up with the vendor predicate, rather than trusting a check made before
     *    it. `on_hand` is guarded by a CHECK constraint, so an adjustment that
     *    would drive it negative aborts the whole transaction rather than
     *    clamping.
     *
     * Deliberately not the reservation path — §8.3 takes row locks in a global
     * variant order across the whole basket, and that belongs in the Phase 6
     * checkout service, not in a per-vendor helper.
     */
    adjust: async (
      variantId: string,
      delta: number,
      reason: "restock" | "adjustment",
    ) => {
      this.#require("staff");
      if (!Number.isInteger(delta) || delta === 0) {
        throw new Error("delta must be a non-zero integer");
      }

      return db.transaction(async (tx) => {
        const owned = await tx
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(
            and(
              eq(productVariants.id, variantId),
              eq(productVariants.vendorId, this.#ctx.vendorId),
            ),
          )
          .limit(1);

        if (owned.length === 0) throw new NotFoundError();

        const updated = await tx
          .update(inventory)
          .set({
            onHand: sql`${inventory.onHand} + ${delta}`,
            updatedAt: new Date(),
          })
          .where(eq(inventory.variantId, variantId))
          .returning({ onHand: inventory.onHand });

        if (updated.length === 0) throw new NotFoundError();

        await tx.insert(inventoryLedger).values({
          variantId,
          delta,
          reason,
        });

        return { variantId, onHand: updated[0]!.onHand };
      });
    },
  };

  /* ---------------------------------------------------------------------- */

  readonly orders = {
    /**
     * Sub-orders, never `orders`. A vendor sees its own slice of a basket that
     * may span several shops; the customer's order row belongs to the customer
     * and to the platform, not to any one vendor (§5.0).
     */
    list: async (opts: { limit?: number; offset?: number } = {}) => {
      return db
        .select({
          id: vendorOrders.id,
          vendorOrderNumber: vendorOrders.vendorOrderNumber,
          status: vendorOrders.status,
          totalCents: vendorOrders.totalCents,
          createdAt: vendorOrders.createdAt,
          fulfilledAt: vendorOrders.fulfilledAt,
        })
        .from(vendorOrders)
        .where(eq(vendorOrders.vendorId, this.#ctx.vendorId))
        .orderBy(desc(vendorOrders.createdAt))
        .limit(opts.limit ?? 50)
        .offset(opts.offset ?? 0);
    },

    byId: async (vendorOrderId: string) => {
      const rows = await db
        .select()
        .from(vendorOrders)
        .where(
          and(
            eq(vendorOrders.id, vendorOrderId),
            eq(vendorOrders.vendorId, this.#ctx.vendorId),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) throw new NotFoundError();
      return row;
    },

    /**
     * Fulfilment is warehouse work, so `staff` may do it.
     *
     * Deliberately NOT the full §8.7 fulfilment path: releasing a payout writes
     * ledger entries and schedules a transfer, and that belongs in a Phase 7
     * service running in one transaction. This only moves the sub-order status.
     */
    markFulfilled: async (vendorOrderId: string) => {
      this.#require("staff");
      const fulfilledAt = new Date();

      const updated = await db
        .update(vendorOrders)
        .set({ status: "fulfilled", fulfilledAt, updatedAt: fulfilledAt })
        .where(
          and(
            eq(vendorOrders.id, vendorOrderId),
            eq(vendorOrders.vendorId, this.#ctx.vendorId),
            eq(vendorOrders.status, "paid"),
          ),
        )
        .returning({ id: vendorOrders.id });

      if (updated.length === 0) throw new NotFoundError();
      return updated[0]!;
    },
  };

  /* ---------------------------------------------------------------------- */

  /**
   * Money. Gated at `manager`, so a `staff` account sees no payout figures —
   * the "safe to show a warehouse temp" line from §5.4.
   */
  readonly payouts = {
    /**
     * Balance as the SUM of the append-only ledger, never a stored column
     * (rule 13). Derived means always reconcilable, and allowed to go negative
     * after a refund on an already-transferred order.
     */
    balanceCents: async () => {
      this.#require("manager");

      const rows = await db
        .select({
          balance: sql<number>`COALESCE(SUM(${vendorBalanceEntries.amountCents}), 0)::int`,
        })
        .from(vendorBalanceEntries)
        .where(eq(vendorBalanceEntries.vendorId, this.#ctx.vendorId));

      return rows[0]?.balance ?? 0;
    },

    ledger: async (opts: { limit?: number; offset?: number } = {}) => {
      this.#require("manager");

      return db
        .select({
          id: vendorBalanceEntries.id,
          entryType: vendorBalanceEntries.entryType,
          amountCents: vendorBalanceEntries.amountCents,
          vendorOrderId: vendorBalanceEntries.vendorOrderId,
          note: vendorBalanceEntries.note,
          createdAt: vendorBalanceEntries.createdAt,
        })
        .from(vendorBalanceEntries)
        .where(eq(vendorBalanceEntries.vendorId, this.#ctx.vendorId))
        .orderBy(desc(vendorBalanceEntries.createdAt))
        .limit(opts.limit ?? 100)
        .offset(opts.offset ?? 0);
    },
  };

  /* ---------------------------------------------------------------------- */

  /**
   * Shipping rates for `/vendor/shipping` — `owner|manager` per the §7.1 route
   * table. Rates decide what a customer is charged, so they sit on the money
   * side of the staff line.
   */
  readonly shipping = {
    list: async () => {
      this.#require("manager");

      return db
        .select()
        .from(vendorShippingRates)
        .where(eq(vendorShippingRates.vendorId, this.#ctx.vendorId))
        .orderBy(asc(vendorShippingRates.position));
    },

    /**
     * The vendor id is taken from the context and spread last, so a caller
     * cannot override it by passing one in `input`. Without that ordering this
     * method would be the one hole in the file.
     */
    create: async (input: {
      name: string;
      country: string | null;
      rateCents: number;
      freeOverCents?: number | null;
      minDeliveryDays: number;
      maxDeliveryDays: number;
      position?: number;
    }) => {
      this.#require("manager");

      if (input.rateCents < 0) throw new Error("rateCents must be >= 0");
      if (input.maxDeliveryDays < input.minDeliveryDays) {
        throw new Error("maxDeliveryDays must be >= minDeliveryDays");
      }

      const rows = await db
        .insert(vendorShippingRates)
        .values({ ...input, vendorId: this.#ctx.vendorId })
        .returning({ id: vendorShippingRates.id });

      return rows[0]!;
    },

    setActive: async (rateId: string, active: boolean) => {
      this.#require("manager");

      const updated = await db
        .update(vendorShippingRates)
        .set({ active, updatedAt: new Date() })
        .where(
          and(
            eq(vendorShippingRates.id, rateId),
            eq(vendorShippingRates.vendorId, this.#ctx.vendorId),
          ),
        )
        .returning({ id: vendorShippingRates.id });

      if (updated.length === 0) throw new NotFoundError();
      return updated[0]!;
    },
  };

  /* ---------------------------------------------------------------------- */

  /**
   * Reviews for `/vendor/reviews`.
   *
   * A vendor may reply to a review; it may not moderate one. `status` stays
   * with the platform (§5.1) — a seller who can hide their own bad reviews
   * makes the whole rating system worthless — so no method here writes it.
   * Only published reviews are visible, since a pending one has not cleared
   * moderation yet.
   */
  readonly reviews = {
    list: async (opts: { limit?: number; offset?: number } = {}) => {
      return db
        .select({
          id: reviews.id,
          productId: reviews.productId,
          rating: reviews.rating,
          title: reviews.title,
          body: reviews.body,
          vendorResponseBody: reviews.vendorResponseBody,
          vendorRespondedAt: reviews.vendorRespondedAt,
          createdAt: reviews.createdAt,
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.vendorId, this.#ctx.vendorId),
            eq(reviews.status, "published"),
          ),
        )
        .orderBy(desc(reviews.createdAt))
        .limit(opts.limit ?? 50)
        .offset(opts.offset ?? 0);
    },

    /** Average rating and count, for the dashboard header. */
    summary: async () => {
      const rows = await db
        .select({
          n: count(),
          average: sql<number>`COALESCE(AVG(${reviews.rating}), 0)::float`,
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.vendorId, this.#ctx.vendorId),
            eq(reviews.status, "published"),
          ),
        );

      return { count: rows[0]?.n ?? 0, average: rows[0]?.average ?? 0 };
    },

    respond: async (reviewId: string, body: string) => {
      this.#require("manager");

      const trimmed = body.trim();
      if (trimmed.length === 0) throw new Error("response body is empty");

      const updated = await db
        .update(reviews)
        .set({
          vendorResponseBody: trimmed,
          vendorRespondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(reviews.id, reviewId),
            eq(reviews.vendorId, this.#ctx.vendorId),
            eq(reviews.status, "published"),
          ),
        )
        .returning({ id: reviews.id });

      if (updated.length === 0) throw new NotFoundError();
      return updated[0]!;
    },
  };

  /* ---------------------------------------------------------------------- */

  /**
   * The vendor's own row, for `/vendor/settings` and `/vendor/onboarding`.
   *
   * `profile.read` is intentionally ungated — the dashboard header needs the
   * shop name on every page, including for `staff`. The Stripe and commission
   * fields are split into `payoutStatus` behind a `manager` check instead.
   */
  readonly profile = {
    read: async () => {
      const rows = await db
        .select({
          id: vendors.id,
          slug: vendors.slug,
          displayName: vendors.displayName,
          supportEmail: vendors.supportEmail,
          description: vendors.description,
          status: vendors.status,
          country: vendors.country,
          createdAt: vendors.createdAt,
        })
        .from(vendors)
        .where(eq(vendors.id, this.#ctx.vendorId))
        .limit(1);

      const row = rows[0];
      if (!row) throw new NotFoundError();
      return row;
    },

    /**
     * Onboarding and payout readiness. `charges_enabled` / `payouts_enabled`
     * are mirrors of Stripe state refreshed by the `account.updated` webhook
     * (§8.6) — never written here, since Stripe is the source of truth for
     * them.
     */
    payoutStatus: async () => {
      this.#require("manager");

      const rows = await db
        .select({
          status: vendors.status,
          stripeAccountId: vendors.stripeAccountId,
          chargesEnabled: vendors.chargesEnabled,
          payoutsEnabled: vendors.payoutsEnabled,
          payoutHoldDays: vendors.payoutHoldDays,
          commissionBps: vendors.commissionBps,
        })
        .from(vendors)
        .where(eq(vendors.id, this.#ctx.vendorId))
        .limit(1);

      const row = rows[0];
      if (!row) throw new NotFoundError();
      return row;
    },

    /**
     * Settings edits are `owner` only (§7.1). The updatable set is an explicit
     * allow-list: `status`, `commission_bps` and the Stripe mirrors are
     * platform-controlled, and a vendor that could write its own commission
     * could set it to zero.
     */
    update: async (input: {
      displayName?: string;
      supportEmail?: string;
      description?: string | null;
    }) => {
      this.#require("owner");

      const updated = await db
        .update(vendors)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(vendors.id, this.#ctx.vendorId))
        .returning({ id: vendors.id });

      if (updated.length === 0) throw new NotFoundError();
      return updated[0]!;
    },
  };

  /* ---------------------------------------------------------------------- */

  /** Membership administration is `owner` only (§5.4). */
  readonly members = {
    list: async () => {
      this.#require("owner");

      return db
        .select({
          id: vendorMembers.id,
          userId: vendorMembers.userId,
          role: vendorMembers.role,
          invitedAt: vendorMembers.invitedAt,
          acceptedAt: vendorMembers.acceptedAt,
        })
        .from(vendorMembers)
        .where(eq(vendorMembers.vendorId, this.#ctx.vendorId));
    },
  };
}
