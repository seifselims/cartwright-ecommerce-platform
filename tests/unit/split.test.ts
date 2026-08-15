/**
 * §11.2 unit coverage for the per-vendor money split.
 *
 * This is money-handling code, which §17 item 3 holds to 100% coverage. The
 * arithmetic here is shared with the Phase 6 checkout, so a regression would
 * surface as a payout that does not reconcile rather than as a failing page.
 */
import { describe, expect, it } from "vitest";

import {
  apportionPlatformDiscount,
  computeOrderSplit,
  roundHalfUp,
  type VendorSplitInput,
} from "../../src/db/seed/split";

const vendor = (over: Partial<VendorSplitInput> = {}): VendorSplitInput => ({
  vendorId: "v1",
  subtotalCents: 10000,
  shippingCents: 500,
  commissionBps: 1000,
  vendorDiscountCents: 0,
  ...over,
});

describe("roundHalfUp", () => {
  it("rounds a half up rather than to even", () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.5)).toBe(2);
    // Math.round would agree here, but Number.prototype.toFixed banker-rounds
    // in some engines; pinning the behaviour is the point of the test.
    expect(roundHalfUp(2.5)).toBe(3);
  });

  it("leaves integers alone", () => {
    expect(roundHalfUp(7)).toBe(7);
    expect(roundHalfUp(0)).toBe(0);
  });
});

describe("apportionPlatformDiscount", () => {
  it("distributes pro-rata by subtotal", () => {
    expect(apportionPlatformDiscount([10000, 10000], 1000)).toEqual([500, 500]);
  });

  it("gives the rounding remainder to the largest subtotal", () => {
    // 100 split across 3:1 cannot divide evenly; the larger vendor absorbs it.
    const shares = apportionPlatformDiscount([7500, 2500], 99);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(99);
    expect(shares[0]).toBeGreaterThan(shares[1]!);
  });

  it("always sums to exactly the discount", () => {
    // The invariant that makes the §8.3 step 11 assertion hold.
    for (const discount of [1, 3, 7, 99, 1234, 9999]) {
      for (const subtotals of [
        [100, 200, 300],
        [1, 1, 1],
        [9999, 1],
        [333, 333, 334],
      ]) {
        const shares = apportionPlatformDiscount(subtotals, discount);
        const total = subtotals.reduce((a, b) => a + b, 0);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(
          Math.min(discount, total),
        );
      }
    }
  });

  it("never discounts a vendor below zero", () => {
    const shares = apportionPlatformDiscount([100, 10000], 5000);
    expect(shares[0]).toBeLessThanOrEqual(100);
    expect(shares.every((s) => s >= 0)).toBe(true);
  });

  it("returns zeros for a zero discount", () => {
    expect(apportionPlatformDiscount([100, 200], 0)).toEqual([0, 0]);
  });

  it("returns zeros when every subtotal is zero", () => {
    expect(apportionPlatformDiscount([0, 0], 500)).toEqual([0, 0]);
  });
});

describe("computeOrderSplit", () => {
  it("does not take commission on shipping", () => {
    const split = computeOrderSplit(
      [vendor({ subtotalCents: 10000, shippingCents: 1000 })],
      { country: "US" },
    );
    // 10% of the 10000 subtotal only — not of the 11000 including shipping.
    expect(split.vendors[0]!.commissionCents).toBe(1000);
  });

  it("credits shipping to the vendor payout in full", () => {
    const split = computeOrderSplit(
      [vendor({ subtotalCents: 10000, shippingCents: 1000 })],
      { country: "US" },
    );
    // 10000 subtotal + 1000 shipping - 1000 commission.
    expect(split.vendors[0]!.vendorPayoutCents).toBe(10000);
  });

  it("applies a vendor discount only to its own lines", () => {
    const split = computeOrderSplit(
      [
        vendor({ vendorId: "a", vendorDiscountCents: 1000 }),
        vendor({ vendorId: "b" }),
      ],
      { country: "US" },
    );
    expect(split.vendors[0]!.discountCents).toBe(1000);
    expect(split.vendors[1]!.discountCents).toBe(0);
  });

  it("taxes the discounted subtotal, not the gross", () => {
    const split = computeOrderSplit(
      [
        vendor({
          subtotalCents: 10000,
          shippingCents: 0,
          vendorDiscountCents: 5000,
        }),
      ],
      { country: "US" },
    );
    // US is 700bps against the 5000 discounted subtotal.
    expect(split.vendors[0]!.taxCents).toBe(350);
  });

  it("does not tax shipping", () => {
    const withShipping = computeOrderSplit(
      [vendor({ subtotalCents: 10000, shippingCents: 5000 })],
      { country: "GB" },
    );
    const withoutShipping = computeOrderSplit(
      [vendor({ subtotalCents: 10000, shippingCents: 0 })],
      { country: "GB" },
    );
    expect(withShipping.vendors[0]!.taxCents).toBe(
      withoutShipping.vendors[0]!.taxCents,
    );
  });

  it("treats an unknown country as zero tax rather than throwing", () => {
    const split = computeOrderSplit([vendor()], { country: "ZZ" });
    expect(split.taxCents).toBe(0);
  });

  it("balances Σ sub-order totals against the order total", () => {
    const split = computeOrderSplit(
      [
        vendor({ vendorId: "a", subtotalCents: 12345, commissionBps: 1200 }),
        vendor({ vendorId: "b", subtotalCents: 6789, commissionBps: 900 }),
        vendor({ vendorId: "c", subtotalCents: 101, commissionBps: 1500 }),
      ],
      { country: "GB", platformDiscountCents: 777 },
    );
    const summed = split.vendors.reduce((a, v) => a + v.totalCents, 0);
    expect(summed).toBe(split.totalCents);
  });

  it("balances payouts + platform fee + tax against the total", () => {
    const split = computeOrderSplit(
      [
        vendor({ vendorId: "a", subtotalCents: 3333, commissionBps: 1000 }),
        vendor({ vendorId: "b", subtotalCents: 6667, commissionBps: 1234 }),
      ],
      { country: "DE", platformDiscountCents: 500 },
    );
    const payouts = split.vendors.reduce((a, v) => a + v.vendorPayoutCents, 0);
    expect(payouts + split.platformFeeCents + split.taxCents).toBe(
      split.totalCents,
    );
  });

  it("holds both invariants across a wide sweep of baskets", () => {
    // computeOrderSplit asserts internally, so reaching the end is the pass.
    for (let s = 0; s < 2000; s++) {
      const count = 1 + (s % 4);
      const inputs = Array.from({ length: count }, (_, i) => ({
        vendorId: `v${i}`,
        subtotalCents: 100 + ((s * 7919 + i * 104729) % 90000),
        shippingCents: (s * 31 + i * 17) % 1200,
        commissionBps: [800, 900, 1000, 1200, 1500][(s + i) % 5]!,
        vendorDiscountCents: s % 5 === 0 ? (s * 13) % 500 : 0,
      }));
      expect(() =>
        computeOrderSplit(inputs, {
          country: ["US", "GB", "DE", "AU", "CA"][s % 5]!,
          platformDiscountCents: s % 3 === 0 ? (s * 29) % 2500 : 0,
        }),
      ).not.toThrow();
    }
  });

  it("never lets a discount exceed the vendor subtotal", () => {
    const split = computeOrderSplit(
      [vendor({ subtotalCents: 1000, vendorDiscountCents: 5000 })],
      { country: "US" },
    );
    expect(split.vendors[0]!.discountCents).toBe(1000);
    expect(split.vendors[0]!.totalCents).toBeGreaterThanOrEqual(0);
  });
});
