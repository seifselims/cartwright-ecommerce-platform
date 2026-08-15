/**
 * The per-vendor money split from §8.3 step 7.
 *
 * This lives outside the seeder proper because the seeded 50k orders have to
 * satisfy the same invariants the real checkout does — `make reconcile` (§17
 * item 10) walks the seeded dataset and asserts them, so a seeder that invents
 * its own arithmetic would either fail that check or, worse, quietly define a
 * second definition of "correct". Phase 6 should import this rather than
 * reimplement it.
 *
 * Everything is integer minor units (rule 1). No float ever enters a total.
 */

/** `Math.round` is half-up for positives but half-away-from-zero for negatives. */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export type VendorSplitInput = {
  vendorId: string;
  /** Σ line totals for this vendor, before discount. */
  subtotalCents: number;
  shippingCents: number;
  commissionBps: number;
  /** Vendor-funded discount hitting only this vendor's lines. */
  vendorDiscountCents: number;
};

export type VendorSplit = {
  vendorId: string;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  commissionBps: number;
  commissionCents: number;
  vendorPayoutCents: number;
};

export type OrderSplit = {
  vendors: VendorSplit[];
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  platformFeeCents: number;
};

/** Static tax table, standing in for the real one (§8.3 step 7: "static table"). */
const TAX_BPS_BY_COUNTRY: Record<string, number> = {
  US: 700,
  GB: 2000,
  DE: 1900,
  AU: 1000,
  CA: 1300,
};

/**
 * Apportions a platform-funded discount pro-rata by vendor subtotal, with the
 * largest-subtotal vendor absorbing the rounding remainder (§8.3 step 7).
 *
 * Distributing the remainder rather than letting each vendor round independently
 * is what keeps `Σ vendor discounts === the platform discount` exactly — the
 * assertion in step 11 fails otherwise, typically by one or two cents on baskets
 * spanning three vendors.
 */
export function apportionPlatformDiscount(
  subtotals: readonly number[],
  discountCents: number,
): number[] {
  const total = subtotals.reduce((a, b) => a + b, 0);
  if (total <= 0 || discountCents <= 0) return subtotals.map(() => 0);

  const shares = subtotals.map((s) =>
    Math.min(s, Math.floor((s * discountCents) / total)),
  );
  const distributed = shares.reduce((a, b) => a + b, 0);
  let remainder = discountCents - distributed;

  // Largest subtotal first, so the biggest vendor absorbs the remainder.
  const order = subtotals
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s || a.i - b.i);

  for (const { i } of order) {
    if (remainder <= 0) break;
    const headroom = subtotals[i]! - shares[i]!;
    const take = Math.min(headroom, remainder);
    shares[i]! += take;
    remainder -= take;
  }
  return shares;
}

/**
 * Builds the full split and asserts §8.3 step 11 before returning. The assertion
 * is deliberately fatal: the spec says to fail rather than "fix up" a
 * difference, because a seeder that silently patches a mismatch would hide the
 * exact class of bug `make reconcile` exists to catch.
 */
export function computeOrderSplit(
  inputs: readonly VendorSplitInput[],
  opts: {
    /** Platform-funded discount, apportioned across vendors. */
    platformDiscountCents?: number;
    /** Shipping country, selecting the tax rate. */
    country: string;
  },
): OrderSplit {
  const platformDiscount = opts.platformDiscountCents ?? 0;
  const taxBps = TAX_BPS_BY_COUNTRY[opts.country] ?? 0;

  const apportioned = apportionPlatformDiscount(
    inputs.map((i) => i.subtotalCents),
    platformDiscount,
  );

  const vendors: VendorSplit[] = inputs.map((input, idx) => {
    const discountCents = Math.min(
      input.subtotalCents,
      input.vendorDiscountCents + apportioned[idx]!,
    );
    const discountedSubtotal = input.subtotalCents - discountCents;

    // Tax applies to the discounted vendor subtotal, not to shipping.
    const taxCents = roundHalfUp((discountedSubtotal * taxBps) / 10000);

    // Shipping is NOT commissionable (§8.3 step 7).
    const commissionCents = roundHalfUp(
      (discountedSubtotal * input.commissionBps) / 10000,
    );

    const totalCents = discountedSubtotal + input.shippingCents + taxCents;
    const vendorPayoutCents =
      discountedSubtotal + input.shippingCents - commissionCents;

    return {
      vendorId: input.vendorId,
      subtotalCents: input.subtotalCents,
      shippingCents: input.shippingCents,
      discountCents,
      taxCents,
      totalCents,
      commissionBps: input.commissionBps,
      commissionCents,
      vendorPayoutCents,
    };
  });

  const sum = (f: (v: VendorSplit) => number) =>
    vendors.reduce((acc, v) => acc + f(v), 0);

  const order: OrderSplit = {
    vendors,
    subtotalCents: sum((v) => v.subtotalCents),
    shippingCents: sum((v) => v.shippingCents),
    discountCents: sum((v) => v.discountCents),
    taxCents: sum((v) => v.taxCents),
    totalCents: sum((v) => v.totalCents),
    platformFeeCents: sum((v) => v.commissionCents),
  };

  assertSplitBalances(order);
  return order;
}

/**
 * §8.3 step 11, both halves.
 *
 * The second identity is the one worth staring at: tax is collected from the
 * customer but is not the platform's revenue and is not the vendor's either, so
 * it has to appear on the left-hand side alongside the payouts and the
 * commission for the equation to close.
 */
export function assertSplitBalances(order: OrderSplit): void {
  const summedTotals = order.vendors.reduce((a, v) => a + v.totalCents, 0);
  if (summedTotals !== order.totalCents) {
    throw new Error(
      `Split mismatch: Σ vendor_orders.total_cents (${summedTotals}) !== orders.total_cents (${order.totalCents})`,
    );
  }

  const summedPayouts = order.vendors.reduce(
    (a, v) => a + v.vendorPayoutCents,
    0,
  );
  const lhs = summedPayouts + order.platformFeeCents + order.taxCents;
  if (lhs !== order.totalCents) {
    throw new Error(
      `Split mismatch: Σ vendor_payout (${summedPayouts}) + platform_fee (${order.platformFeeCents}) + tax (${order.taxCents}) = ${lhs} !== total (${order.totalCents})`,
    );
  }
}
