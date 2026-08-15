/**
 * Factories: pure functions from an `Rng` to a row object.
 *
 * Nothing here touches the database. Keeping generation separate from insertion
 * means the same factories can build fixtures for the integration tests in
 * §11.3 — a test that needs "a vendor with two products" should not have to
 * re-derive what a plausible product looks like, and should never need the
 * 50k-order seeder to run first.
 */
import { randomUUID } from "node:crypto";

import type { AddressSnapshot } from "../schema";
import {
  CARRIERS,
  CITIES,
  FIRST_NAMES,
  LAST_NAMES,
  OPTION_AXES,
  PRODUCT_WORDS,
  STREETS,
} from "./data";
import type { Rng } from "./random";

/** Better Auth's user ids are `text`, not uuid — it generates its own. */
export const newUserId = (): string => randomUUID();

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function personName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

/**
 * Emails must be unique across the seed (the `user.email` unique constraint),
 * so the caller passes an ordinal rather than trusting a collision not to
 * happen across 2,000 customers.
 */
export function emailFor(name: string, ordinal: number): string {
  return `${slugify(name)}.${ordinal}@example.test`;
}

export function makeAddress(
  rng: Rng,
  name: string,
  country?: string,
): AddressSnapshot {
  const place = country
    ? (CITIES.filter((c) => c.country === country)[0] ?? rng.pick(CITIES))
    : rng.pick(CITIES);
  return {
    name,
    line1: `${rng.int(1, 240)} ${rng.pick(STREETS)}`,
    line2: rng.chance(0.2) ? `Unit ${rng.int(1, 40)}` : null,
    city: place.city,
    region: place.region,
    postalCode: place.postal(),
    country: place.country,
    phone: rng.chance(0.6) ? `+1-555-${String(rng.int(1000, 9999))}` : null,
  };
}

export function makeProductTitle(rng: Rng, categorySlug: string): string {
  const words =
    PRODUCT_WORDS[categorySlug] ?? PRODUCT_WORDS["desk-accessories"]!;
  return `${rng.pick(words.adjectives)} ${rng.pick(words.nouns)}`;
}

export function makeDescription(rng: Rng, title: string): string {
  const openers = [
    `The ${title.toLowerCase()} was designed for people who use one every day.`,
    `We built the ${title.toLowerCase()} after three prototypes that were not good enough.`,
    `A ${title.toLowerCase()} that does the job without asking for attention.`,
  ];
  const details = [
    "Machined from a single billet, then bead-blasted and anodised.",
    "Rated for daily use and backed by a two-year warranty.",
    "Packed flat in recycled board with no plastic in the box.",
    "Tested to 20,000 cycles before it left the bench.",
    "Finished by hand, so no two are exactly alike.",
  ];
  return `${rng.pick(openers)} ${rng.pick(details)} ${rng.pick(details)}`;
}

/**
 * SKUs are `VND-XXXX-NN`. Uniqueness is per vendor (§5.1), which the seeder
 * exploits deliberately to plant the duplicate-SKU fixture.
 */
export function makeSku(
  rng: Rng,
  vendorSlug: string,
  position: number,
): string {
  const prefix = vendorSlug.slice(0, 3).toUpperCase();
  const body = String(rng.int(1000, 9999));
  return `${prefix}-${body}-${String(position).padStart(2, "0")}`;
}

/**
 * Prices cluster on the .99/.50 boundaries real shops use, because a uniform
 * spread of arbitrary cents makes the storefront screenshots look synthetic.
 */
export function makePriceCents(rng: Rng, categorySlug: string): number {
  const bands: Record<string, [number, number]> = {
    coffee: [1200, 2800],
    drinkware: [1800, 4500],
    "brewing-equipment": [2400, 12000],
    grinders: [4500, 32000],
    headphones: [8900, 79900],
    "audio-interfaces": [12900, 89900],
    desks: [24900, 129900],
    "desk-accessories": [1900, 14900],
    lighting: [4900, 24900],
    storage: [3900, 29900],
    keyboards: [7900, 34900],
    keycaps: [4500, 16900],
    cables: [900, 4900],
    adapters: [1900, 12900],
  };
  const [lo, hi] = bands[categorySlug] ?? [1900, 9900];
  const raw = rng.int(lo, hi);
  // Round to the nearest 100 then drop a cent: 4999, 12999, and so on.
  return Math.max(99, Math.round(raw / 100) * 100 - 1);
}

export function makeOptionValues(
  rng: Rng,
  axis: (typeof OPTION_AXES)[number],
  value: string,
): Record<string, string> {
  return { [axis.name]: value };
}

export function pickOptionAxis(
  rng: Rng,
  categorySlug: string,
): (typeof OPTION_AXES)[number] {
  const preferred: Record<string, string> = {
    cables: "Length",
    coffee: "Grind",
    keyboards: "Switch",
    drinkware: "Colour",
    "desk-accessories": "Colour",
  };
  const wanted = preferred[categorySlug];
  if (wanted) {
    const axis = OPTION_AXES.find((a) => a.name === wanted);
    if (axis) return axis;
  }
  return rng.pick(OPTION_AXES);
}

export function makeTrackingNumber(rng: Rng): string {
  return `${rng.pick(CARRIERS).slice(0, 2).toUpperCase()}${rng.int(
    100000000,
    999999999,
  )}`;
}

/**
 * Order numbers are human-facing and appear on invoices, so they are sequential
 * per year rather than random: `NG-2026-000123`. Uniqueness comes from the
 * ordinal, not from luck.
 */
export function makeOrderNumber(placedAt: Date, ordinal: number): string {
  return `NG-${placedAt.getUTCFullYear()}-${String(ordinal).padStart(6, "0")}`;
}

export function makeVendorOrderNumber(
  orderNumber: string,
  vendorSlug: string,
): string {
  return `${orderNumber}-${vendorSlug.slice(0, 3).toUpperCase()}`;
}
