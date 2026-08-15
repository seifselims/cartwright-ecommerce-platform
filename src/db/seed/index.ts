/**
 * `make seed` — populates a browsable multi-vendor database (§15, phase 1).
 *
 * Targets: 8 vendors, 500 products, 1,500 variants, 50k orders. Two fixtures
 * are required by the phase-1 acceptance bar and are planted deliberately
 * rather than left to chance: a SKU shared by two vendors, and categories
 * carried by more than one vendor. Both exist to prove the constraints are
 * per-vendor rather than global; see FIXTURES below.
 *
 * Deterministic: every random draw comes from `Rng`, so a given SEED always
 * produces the same database. Pass SEED=n to vary it.
 *
 * Idempotent by truncation, not by upsert. Re-running rebuilds from scratch,
 * which is the honest thing for a dev seeder — an upserting seeder drifts from
 * what a fresh `make up` produces and eventually only works on the machine it
 * was written on.
 */
import "dotenv/config";

import { hashPassword } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";

import * as schema from "../schema";
import { BRANDS, CATEGORY_TREE, VENDORS } from "./data";
import {
  emailFor,
  makeAddress,
  makeDescription,
  makeOrderNumber,
  makePriceCents,
  makeProductTitle,
  makeSku,
  makeTrackingNumber,
  makeVendorOrderNumber,
  newUserId,
  personName,
  pickOptionAxis,
  slugify,
} from "./factories";
import { Rng } from "./random";
import { computeOrderSplit, type VendorSplitInput } from "./split";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const SEED = Number(process.env.SEED ?? 20260815);
const TARGET_PRODUCTS = Number(process.env.SEED_PRODUCTS ?? 500);
/**
 * Variants are a consequence of the per-product draw below, not a dial: the
 * count emerges from `VARIANT_COUNT_WEIGHTS` and lands near 3× the product
 * count. Recorded here as the §15 target so the summary can be read against it.
 */
const EXPECTED_VARIANTS = TARGET_PRODUCTS * 3;
const TARGET_ORDERS = Number(process.env.SEED_ORDERS ?? 50000);
const TARGET_CUSTOMERS = Number(process.env.SEED_CUSTOMERS ?? 2000);

/** Default commission when a vendor does not override it (§ env). */
const PLATFORM_COMMISSION_BPS = Number(
  process.env.PLATFORM_COMMISSION_BPS ?? 1000,
);

/** Every seeded account shares this password so the demo is actually usable. */
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "password123";

/** Postgres caps a statement at 65535 bind parameters; stay well under it. */
const CHUNK = 1000;

/**
 * Weighted variants-per-product. Sampling from this rather than a uniform range
 * keeps the long tail realistic while averaging the 1,500/500 target ratio.
 */
const VARIANT_COUNT_WEIGHTS = [
  1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6, 6,
] as const;

const now = new Date();
const CATALOGUE_START = new Date(
  Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), 1),
);
const ORDER_START = new Date(
  Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1),
);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const rng = new Rng(SEED);

function log(step: string, detail = ""): void {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  process.stdout.write(
    `  ${elapsed.padStart(6)}s  ${step}${detail ? ` ${detail}` : ""}\n`,
  );
}

const startedAt = Date.now();

/**
 * Chunked insert. Drizzle sends one statement per call, so a 50k-row array
 * would blow past the bind-parameter ceiling; this also keeps memory flat.
 */
async function insertChunked<T extends PgTable>(
  db: NodePgDatabase<typeof schema>,
  table: T,
  rows: T["$inferInsert"][],
  chunk = CHUNK,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    if (slice.length === 0) continue;
    await db.insert(table).values(slice);
  }
}

/* -------------------------------------------------------------------------- */
/* Seed                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env");
  }

  const pool = new Pool({ connectionString, max: 4 });
  const db = drizzle(pool, { schema });

  process.stdout.write(
    `\nSeeding Northgate Supply (seed=${SEED})\n` +
      `  ${TARGET_PRODUCTS} products · ~${EXPECTED_VARIANTS} variants · ${TARGET_ORDERS} orders\n\n`,
  );

  try {
    await truncateAll(db);

    const categoryIds = await seedCategories(db);
    const { vendorRows, memberUserIds } = await seedVendors(db);
    await seedShippingRates(db, vendorRows);
    const customers = await seedCustomers(db, memberUserIds);
    const { variants } = await seedCatalogue(db, vendorRows, categoryIds);
    await seedOrders(db, vendorRows, customers, variants);

    await summarise(db);
  } finally {
    await pool.end();
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Truncate in one statement so Postgres resolves the FK ordering itself.
 * `drizzle.__drizzle_migrations` is deliberately excluded — wiping it would
 * make the next `drizzle-kit migrate` replay applied migrations.
 */
async function truncateAll(db: NodePgDatabase<typeof schema>): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      "audit_log", "reviews", "discount_codes", "refunds",
      "vendor_balance_entries", "vendor_transfers", "webhook_events",
      "payments", "shipments", "order_items", "vendor_orders", "orders",
      "cart_items", "carts", "inventory_ledger", "inventory",
      "product_images", "product_variants", "products", "categories",
      "addresses", "vendor_shipping_rates", "vendor_applications",
      "vendor_members", "vendors", "verification", "account", "session", "user"
    RESTART IDENTITY CASCADE
  `);
  log("truncated", "all seeded tables");
}

/* -------------------------------------------------------------------------- */

/** Two-level taxonomy. Returns leaf slug → id for the product seeder. */
async function seedCategories(
  db: NodePgDatabase<typeof schema>,
): Promise<Map<string, string>> {
  const bySlug = new Map<string, string>();
  const roots = CATEGORY_TREE.map((root, i) => ({
    id: crypto.randomUUID(),
    parentId: null,
    name: root.name,
    slug: root.slug,
    description: `${root.name} from every shop on Northgate Supply.`,
    position: i,
  }));
  await insertChunked(db, schema.categories, roots);
  roots.forEach((r) => bySlug.set(r.slug, r.id));

  const children = CATEGORY_TREE.flatMap((root, ri) =>
    root.children.map((child, ci) => ({
      id: crypto.randomUUID(),
      parentId: roots[ri]!.id,
      name: child.name,
      slug: child.slug,
      description: null,
      position: ci,
    })),
  );
  await insertChunked(db, schema.categories, children);
  children.forEach((c) => bySlug.set(c.slug, c.id));

  log("categories", `${roots.length} roots, ${children.length} leaves`);
  return bySlug;
}

/* -------------------------------------------------------------------------- */

type VendorRow = {
  id: string;
  slug: string;
  displayName: string;
  commissionBps: number;
  status: "approved" | "pending" | "suspended";
  country: string;
  weight: number;
  payoutHoldDays: number;
};

/**
 * Vendors, their owners, and a second member for a couple of shops so the
 * `vendor_members` role axis (§5.4) has real data behind it — including one
 * person who works for two vendors, which is the case a naive "user has a
 * vendor_id column" model cannot represent.
 */
async function seedVendors(db: NodePgDatabase<typeof schema>): Promise<{
  vendorRows: VendorRow[];
  memberUserIds: Set<string>;
}> {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const vendorRows: VendorRow[] = [];
  const vendorInserts: (typeof schema.vendors.$inferInsert)[] = [];

  VENDORS.forEach((v, i) => {
    /**
     * FIXTURE: not every vendor is `approved`. One is suspended and one is
     * pending, so the §11.3 test 24 case (a basket containing a suspended
     * vendor's item must be rejected) has data to run against, and so the
     * storefront has to actually filter rather than showing everything.
     */
    const status: VendorRow["status"] =
      i === VENDORS.length - 1
        ? "suspended"
        : i === VENDORS.length - 2
          ? "pending"
          : "approved";

    const id = crypto.randomUUID();
    const approved = status === "approved";
    vendorRows.push({
      id,
      slug: v.slug,
      displayName: v.displayName,
      commissionBps: v.commissionBps ?? PLATFORM_COMMISSION_BPS,
      status,
      country: v.country,
      weight: v.weight,
      payoutHoldDays: rng.pick([2, 3, 3, 5, 7]),
    });

    vendorInserts.push({
      id,
      slug: v.slug,
      displayName: v.displayName,
      legalName: v.legalName,
      supportEmail: `support@${v.slug}.test`,
      description: v.description,
      status,
      commissionBps: v.commissionBps,
      stripeAccountId: approved
        ? `acct_seed_${v.slug.replace(/-/g, "")}`
        : null,
      chargesEnabled: approved,
      payoutsEnabled: approved,
      payoutHoldDays: vendorRows[i]!.payoutHoldDays,
      country: v.country,
      createdAt: rng.date(CATALOGUE_START, ORDER_START),
      approvedAt: approved ? rng.date(CATALOGUE_START, ORDER_START) : null,
    });
  });

  await insertChunked(db, schema.vendors, vendorInserts);

  // Owners: one per vendor.
  const users: (typeof schema.user.$inferInsert)[] = [];
  const accounts: (typeof schema.account.$inferInsert)[] = [];
  const members: (typeof schema.vendorMembers.$inferInsert)[] = [];
  const memberUserIds = new Set<string>();

  const addUser = (
    name: string,
    email: string,
    role: "customer" | "admin" = "customer",
  ): string => {
    const id = newUserId();
    users.push({
      id,
      name,
      email,
      emailVerified: true,
      role,
      createdAt: rng.date(CATALOGUE_START, ORDER_START),
      updatedAt: now,
    });
    accounts.push({
      id: crypto.randomUUID(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  };

  vendorRows.forEach((vendor, i) => {
    const ownerName = personName(rng);
    const ownerId = addUser(ownerName, `owner@${vendor.slug}.test`);
    memberUserIds.add(ownerId);
    members.push({
      vendorId: vendor.id,
      userId: ownerId,
      role: "owner",
      invitedAt: rng.date(CATALOGUE_START, ORDER_START),
      acceptedAt: rng.date(CATALOGUE_START, ORDER_START),
    });

    // A manager and a staff member for the first few shops.
    if (i < 3) {
      const managerId = addUser(personName(rng), `manager@${vendor.slug}.test`);
      memberUserIds.add(managerId);
      members.push({
        vendorId: vendor.id,
        userId: managerId,
        role: "manager",
        invitedByUserId: ownerId,
        invitedAt: rng.date(ORDER_START, now),
        acceptedAt: rng.date(ORDER_START, now),
      });

      const staffId = addUser(personName(rng), `staff@${vendor.slug}.test`);
      memberUserIds.add(staffId);
      members.push({
        vendorId: vendor.id,
        userId: staffId,
        role: "staff",
        invitedByUserId: ownerId,
        invitedAt: rng.date(ORDER_START, now),
        acceptedAt: rng.date(ORDER_START, now),
      });
    }
  });

  /**
   * FIXTURE: one person is staff at a second vendor. This is the row that makes
   * "which vendor am I acting as?" a real question the scoped DAL has to answer
   * from the session rather than assume, and it is unrepresentable if vendor
   * membership ever collapses onto the user row (§5.4).
   */
  const dualRoleUserId = addUser(personName(rng), "dual.role@example.test");
  memberUserIds.add(dualRoleUserId);
  members.push({
    vendorId: vendorRows[0]!.id,
    userId: dualRoleUserId,
    role: "manager",
    invitedAt: rng.date(ORDER_START, now),
    acceptedAt: rng.date(ORDER_START, now),
  });
  members.push({
    vendorId: vendorRows[1]!.id,
    userId: dualRoleUserId,
    role: "staff",
    invitedAt: rng.date(ORDER_START, now),
    acceptedAt: rng.date(ORDER_START, now),
  });

  // Platform admin. Never a vendor member — rule 15.
  addUser("Platform Admin", "admin@northgatesupply.test", "admin");

  await insertChunked(db, schema.user, users);
  await insertChunked(db, schema.account, accounts);
  await insertChunked(db, schema.vendorMembers, members);

  log(
    "vendors",
    `${vendorRows.length} shops, ${members.length} memberships (1 person in 2 shops)`,
  );
  return { vendorRows, memberUserIds };
}

/* -------------------------------------------------------------------------- */

async function seedShippingRates(
  db: NodePgDatabase<typeof schema>,
  vendors: VendorRow[],
): Promise<void> {
  const rates: (typeof schema.vendorShippingRates.$inferInsert)[] = [];

  for (const vendor of vendors) {
    // Catch-all zone (null country) — the row `nullsNotDistinct` protects.
    rates.push({
      vendorId: vendor.id,
      name: "Standard",
      country: null,
      rateCents: rng.pick([495, 595, 795]),
      freeOverCents: rng.pick([5000, 7500, 10000, null]),
      minDeliveryDays: 3,
      maxDeliveryDays: 7,
      position: 0,
    });
    rates.push({
      vendorId: vendor.id,
      name: "Express",
      country: null,
      rateCents: rng.pick([1295, 1495, 1895]),
      freeOverCents: null,
      minDeliveryDays: 1,
      maxDeliveryDays: 2,
      position: 1,
    });
    // A domestic rate for the vendor's own country.
    rates.push({
      vendorId: vendor.id,
      name: "Domestic",
      country: vendor.country,
      rateCents: rng.pick([295, 395, 495]),
      freeOverCents: rng.pick([3500, 5000]),
      minDeliveryDays: 2,
      maxDeliveryDays: 4,
      position: 2,
    });
  }

  await insertChunked(db, schema.vendorShippingRates, rates);
  log("shipping rates", `${rates.length} across ${vendors.length} vendors`);
}

/* -------------------------------------------------------------------------- */

type Customer = { id: string; email: string; name: string; country: string };

async function seedCustomers(
  db: NodePgDatabase<typeof schema>,
  memberUserIds: Set<string>,
): Promise<Customer[]> {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const users: (typeof schema.user.$inferInsert)[] = [];
  const accounts: (typeof schema.account.$inferInsert)[] = [];
  const addresses: (typeof schema.addresses.$inferInsert)[] = [];
  const customers: Customer[] = [];

  for (let i = 0; i < TARGET_CUSTOMERS; i++) {
    const name = personName(rng);
    const id = newUserId();
    const email = emailFor(name, i);
    const createdAt = rng.date(CATALOGUE_START, now);

    users.push({
      id,
      name,
      email,
      // A slice stay unverified — the storefront has to cope with both.
      emailVerified: !rng.chance(0.08),
      role: "customer",
      createdAt,
      updatedAt: now,
      stripeCustomerId: rng.chance(0.7) ? `cus_seed_${i}` : null,
    });
    accounts.push({
      id: crypto.randomUUID(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: passwordHash,
      createdAt,
      updatedAt: now,
    });

    const snapshot = makeAddress(rng, name);
    addresses.push({
      userId: id,
      label: rng.pick(["Home", "Work", null]),
      name: snapshot.name,
      line1: snapshot.line1,
      line2: snapshot.line2 ?? null,
      city: snapshot.city,
      region: snapshot.region ?? null,
      postalCode: snapshot.postalCode,
      country: snapshot.country,
      phone: snapshot.phone ?? null,
      isDefaultShipping: true,
      isDefaultBilling: true,
      createdAt,
    });

    customers.push({ id, email, name, country: snapshot.country });
  }

  await insertChunked(db, schema.user, users);
  await insertChunked(db, schema.account, accounts);
  await insertChunked(db, schema.addresses, addresses);

  log(
    "customers",
    `${customers.length} with addresses (+${memberUserIds.size} vendor staff)`,
  );
  return customers;
}

/* -------------------------------------------------------------------------- */

type VariantRow = {
  id: string;
  vendorId: string;
  sku: string;
  title: string;
  priceCents: number;
  productTitle: string;
};

/**
 * Products, variants, inventory and images.
 *
 * Product count is distributed by vendor weight rather than evenly, so two
 * shops carry roughly half the catalogue. That skew is what makes the §11.5
 * hot-tenant load scenario and the vendor generation-counter cache work
 * meaningful; an even split would make every vendor look identical under load.
 */
async function seedCatalogue(
  db: NodePgDatabase<typeof schema>,
  vendors: VendorRow[],
  categoryIds: Map<string, string>,
): Promise<{ variants: VariantRow[] }> {
  const products: (typeof schema.products.$inferInsert)[] = [];
  const variants: (typeof schema.productVariants.$inferInsert)[] = [];
  const images: (typeof schema.productImages.$inferInsert)[] = [];
  const inventoryRows: (typeof schema.inventory.$inferInsert)[] = [];
  const ledgerRows: (typeof schema.inventoryLedger.$inferInsert)[] = [];
  const variantIndex: VariantRow[] = [];

  const totalWeight = vendors.reduce((a, v) => a + v.weight, 0);
  const usedSlugs = new Set<string>();
  const usedSkusByVendor = new Map<string, Set<string>>();
  vendors.forEach((v) => usedSkusByVendor.set(v.id, new Set()));

  /** Unique global slug — `products.slug` is globally unique for `/p/[slug]`. */
  const uniqueSlug = (title: string): string => {
    const base = slugify(title);
    let candidate = base;
    let n = 2;
    while (usedSlugs.has(candidate)) candidate = `${base}-${n++}`;
    usedSlugs.add(candidate);
    return candidate;
  };

  const uniqueSku = (vendorId: string, vendorSlug: string, pos: number) => {
    const used = usedSkusByVendor.get(vendorId)!;
    let candidate = makeSku(rng, vendorSlug, pos);
    while (used.has(candidate)) candidate = makeSku(rng, vendorSlug, pos);
    used.add(candidate);
    return candidate;
  };

  // Allocate product counts proportionally, giving the remainder to the largest.
  const allocations = vendors.map((v) =>
    Math.max(1, Math.floor((TARGET_PRODUCTS * v.weight) / totalWeight)),
  );
  let allocated = allocations.reduce((a, b) => a + b, 0);
  for (let i = 0; allocated < TARGET_PRODUCTS; i = (i + 1) % vendors.length) {
    allocations[i]!++;
    allocated++;
  }

  vendors.forEach((vendor, vi) => {
    const vendorSeed = VENDORS.find((v) => v.slug === vendor.slug)!;
    const count = allocations[vi]!;

    for (let p = 0; p < count; p++) {
      const categorySlug = rng.pick(vendorSeed.categories);
      const categoryId = categoryIds.get(categorySlug) ?? null;
      const title = makeProductTitle(rng, categorySlug);
      const productId = crypto.randomUUID();
      const createdAt = rng.date(CATALOGUE_START, now);

      /**
       * Most products are live, but a real catalogue has drafts and archived
       * lines. The PLP must filter on status, and `products_vendor_id_status_
       * created_at_idx` exists precisely for that query.
       */
      const status = rng.chance(0.85)
        ? "active"
        : rng.chance(0.6)
          ? "draft"
          : "archived";

      products.push({
        id: productId,
        vendorId: vendor.id,
        slug: uniqueSlug(title),
        title,
        description: makeDescription(rng, title),
        /**
         * Mostly the vendor's own label, sometimes a third-party brand they
         * resell and sometimes unbranded. The brand facet on the PLP (§7.2) is
         * only worth building if brand does not simply restate the vendor.
         */
        brand: rng.chance(0.6)
          ? vendor.displayName.split(" ")[0]!
          : rng.chance(0.6)
            ? rng.pick(BRANDS)
            : null,
        status,
        categoryId,
        createdAt,
        updatedAt: createdAt,
      });

      /**
       * Variant count, drawn from a weighted table rather than a range: most
       * products have one to three variants and a minority have a full option
       * set, which is what a real catalogue looks like. The table averages
       * ~3.06 against the 1,500/500 target ratio, the small surplus covering
       * products whose chosen axis is shorter than the draw.
       */
      const nVariants = rng.pick(VARIANT_COUNT_WEIGHTS);
      const axis = pickOptionAxis(rng, categorySlug);
      const values = rng.sample(axis.values, nVariants);
      const basePrice = makePriceCents(rng, categorySlug);

      values.forEach((value, idx) => {
        const variantId = crypto.randomUUID();
        const sku = uniqueSku(vendor.id, vendor.slug, idx);
        // Variants drift around the base price rather than repeating it.
        const priceCents = Math.max(
          99,
          basePrice + (idx === 0 ? 0 : rng.int(-1500, 3000)),
        );
        const variantTitle = `${title} — ${value}`;

        variants.push({
          id: variantId,
          productId,
          vendorId: vendor.id,
          sku,
          title: variantTitle,
          priceCents,
          compareAtPriceCents: rng.chance(0.25)
            ? priceCents + rng.int(500, 4000)
            : null,
          currency: "USD",
          weightGrams: rng.int(50, 4000),
          optionValues: { [axis.name]: value },
          position: idx,
          createdAt,
          updatedAt: createdAt,
        });

        /**
         * Stock, with a deliberate tail of zero and near-zero rows: the
         * oversell tests (§17 item 5) and the "only 1 left" 409 path in §8.3
         * need variants that are actually scarce.
         */
        const onHand = rng.chance(0.06)
          ? 0
          : rng.chance(0.1)
            ? rng.int(1, 3)
            : rng.int(10, 400);

        inventoryRows.push({
          variantId,
          onHand,
          reserved: 0,
          reorderPoint: rng.int(0, 10),
        });

        if (onHand > 0) {
          ledgerRows.push({
            variantId,
            delta: onHand,
            reason: "restock",
            createdAt,
          });
        }

        if (status === "active" && idx === 0) {
          images.push({
            productId,
            variantId,
            storageKey: `seed/products/${slugify(title)}-${idx}.jpg`,
            alt: title,
            width: 1200,
            height: 1200,
            position: 0,
          });
        }

        variantIndex.push({
          id: variantId,
          vendorId: vendor.id,
          sku,
          title: variantTitle,
          priceCents,
          productTitle: title,
        });
      });
    }
  });

  /**
   * FIXTURE (required by the phase-1 acceptance bar): the same SKU string used
   * by two different vendors.
   *
   * `product_variants` is unique on (vendor_id, sku), NOT on sku alone — two
   * shops both selling "USB-C-2M" is normal marketplace behaviour, and a
   * global unique index would be a data-model bug that only shows up in
   * production. This row makes any such regression fail the seed immediately.
   */
  const DUPLICATE_SKU = "NG-SHARED-01";
  const [vendorA, vendorB] = [vendors[0]!, vendors[1]!];
  for (const vendor of [vendorA, vendorB]) {
    const target = variants.find((v) => v.vendorId === vendor.id);
    if (!target) throw new Error(`no variant to retag for ${vendor.slug}`);
    const used = usedSkusByVendor.get(vendor.id)!;
    used.delete(target.sku);
    const indexed = variantIndex.find((v) => v.id === target.id);
    target.sku = DUPLICATE_SKU;
    if (indexed) indexed.sku = DUPLICATE_SKU;
    used.add(DUPLICATE_SKU);
  }

  await insertChunked(db, schema.products, products);
  await insertChunked(db, schema.productVariants, variants);
  await insertChunked(db, schema.inventory, inventoryRows);
  await insertChunked(db, schema.inventoryLedger, ledgerRows);
  await insertChunked(db, schema.productImages, images);

  log(
    "catalogue",
    `${products.length} products, ${variants.length} variants, ${images.length} images`,
  );
  log("fixtures", `SKU "${DUPLICATE_SKU}" shared by 2 vendors`);

  return { variants: variantIndex };
}

/* -------------------------------------------------------------------------- */

/**
 * Orders, sub-orders, items, payments and the balance ledger.
 *
 * Roughly a third of baskets deliberately span more than one vendor — that is
 * the case the whole two-level order model exists for, and a seed where every
 * basket is single-vendor would let a broken split pass unnoticed.
 *
 * Every paid order writes the three signed ledger rows §8.3 step 4 requires
 * (sale, shipping, commission) rather than one net row, so `make reconcile`
 * has real arithmetic to check.
 */
async function seedOrders(
  db: NodePgDatabase<typeof schema>,
  vendors: VendorRow[],
  customers: Customer[],
  variants: VariantRow[],
): Promise<void> {
  // Only sellable vendors get orders: approved, charges enabled.
  const sellable = vendors.filter((v) => v.status === "approved");
  const byVendor = new Map<string, VariantRow[]>();
  for (const v of sellable) byVendor.set(v.id, []);
  for (const variant of variants) {
    byVendor.get(variant.vendorId)?.push(variant);
  }
  const vendorPool = sellable.filter(
    (v) => (byVendor.get(v.id)?.length ?? 0) > 0,
  );
  const vendorById = new Map(vendors.map((v) => [v.id, v]));

  let orderOrdinal = 0;
  let ledgerCount = 0;
  let subOrderCount = 0;
  let multiVendorCount = 0;

  const BATCH = 2000;

  for (let batchStart = 0; batchStart < TARGET_ORDERS; batchStart += BATCH) {
    const orders: (typeof schema.orders.$inferInsert)[] = [];
    const vendorOrders: (typeof schema.vendorOrders.$inferInsert)[] = [];
    const orderItems: (typeof schema.orderItems.$inferInsert)[] = [];
    const payments: (typeof schema.payments.$inferInsert)[] = [];
    const balanceEntries: (typeof schema.vendorBalanceEntries.$inferInsert)[] =
      [];
    const shipments: (typeof schema.shipments.$inferInsert)[] = [];

    const batchEnd = Math.min(batchStart + BATCH, TARGET_ORDERS);

    for (let i = batchStart; i < batchEnd; i++) {
      const customer = rng.pick(customers);
      const placedAt = rng.date(ORDER_START, now);
      const orderId = crypto.randomUUID();
      orderOrdinal++;
      const orderNumber = makeOrderNumber(placedAt, orderOrdinal);

      // ~35% of baskets span 2–3 vendors.
      const vendorCount = rng.chance(0.35) ? rng.int(2, 3) : 1;
      const chosenVendors = rng.sample(
        vendorPool,
        Math.min(vendorCount, vendorPool.length),
      );
      if (chosenVendors.length > 1) multiVendorCount++;

      const shippingAddress = makeAddress(rng, customer.name, customer.country);

      const splitInputs: VendorSplitInput[] = [];
      const perVendorLines = new Map<
        string,
        { variant: VariantRow; qty: number }[]
      >();

      for (const vendor of chosenVendors) {
        const pool = byVendor.get(vendor.id)!;
        const lineCount = rng.skewed(1, 4);
        const picks = rng.sample(pool, lineCount);
        const lines = picks.map((variant) => ({
          variant,
          qty: rng.skewed(1, 4),
        }));
        perVendorLines.set(vendor.id, lines);

        const subtotal = lines.reduce(
          (a, l) => a + l.variant.priceCents * l.qty,
          0,
        );

        // Free over threshold applies to THIS vendor's subtotal alone (§8.3).
        const freeOver = 7500;
        const shippingCents =
          subtotal >= freeOver ? 0 : rng.pick([495, 595, 795]);

        splitInputs.push({
          vendorId: vendor.id,
          subtotalCents: subtotal,
          shippingCents,
          commissionBps: vendor.commissionBps,
          // A vendor-funded discount on a small slice of orders.
          vendorDiscountCents: rng.chance(0.08)
            ? Math.floor(subtotal * 0.1)
            : 0,
        });
      }

      const split = computeOrderSplit(splitInputs, {
        country: shippingAddress.country,
        // A platform-funded code on ~5% of orders, apportioned pro-rata.
        platformDiscountCents: rng.chance(0.05)
          ? rng.pick([500, 1000, 1500])
          : 0,
      });

      /**
       * Order lifecycle. Most seeded orders are settled; a tail sits in
       * pending/cancelled so the dashboards and the reservation-expiry job
       * have something to act on.
       */
      const roll = rng.next();
      const lifecycle =
        roll < 0.72
          ? "fulfilled"
          : roll < 0.9
            ? "paid"
            : roll < 0.96
              ? "pending"
              : "cancelled";

      const isPaid = lifecycle === "paid" || lifecycle === "fulfilled";

      orders.push({
        id: orderId,
        orderNumber,
        userId: customer.id,
        email: customer.email,
        status:
          lifecycle === "fulfilled"
            ? "fulfilled"
            : lifecycle === "paid"
              ? "paid"
              : lifecycle === "pending"
                ? "pending"
                : "cancelled",
        subtotalCents: split.subtotalCents,
        shippingCents: split.shippingCents,
        taxCents: split.taxCents,
        discountCents: split.discountCents,
        totalCents: split.totalCents,
        platformFeeCents: split.platformFeeCents,
        currency: "USD",
        shippingAddress,
        billingAddress: shippingAddress,
        placedAt,
        createdAt: placedAt,
        updatedAt: placedAt,
      });

      if (isPaid) {
        payments.push({
          orderId,
          provider: "stripe",
          providerPaymentIntentId: `pi_seed_${orderOrdinal}`,
          amountCents: split.totalCents,
          status: "succeeded",
          createdAt: placedAt,
        });
      }

      for (const vendorSplit of split.vendors) {
        const vendor = vendorById.get(vendorSplit.vendorId)!;
        const vendorOrderId = crypto.randomUUID();
        subOrderCount++;

        const fulfilledAt =
          lifecycle === "fulfilled"
            ? new Date(placedAt.getTime() + rng.int(1, 5) * 86400000)
            : null;

        vendorOrders.push({
          id: vendorOrderId,
          orderId,
          vendorId: vendor.id,
          vendorOrderNumber: makeVendorOrderNumber(orderNumber, vendor.slug),
          status:
            lifecycle === "fulfilled"
              ? "fulfilled"
              : lifecycle === "paid"
                ? "paid"
                : lifecycle === "pending"
                  ? "pending"
                  : "cancelled",
          subtotalCents: vendorSplit.subtotalCents,
          shippingCents: vendorSplit.shippingCents,
          taxCents: vendorSplit.taxCents,
          discountCents: vendorSplit.discountCents,
          totalCents: vendorSplit.totalCents,
          commissionBps: vendorSplit.commissionBps,
          commissionCents: vendorSplit.commissionCents,
          vendorPayoutCents: vendorSplit.vendorPayoutCents,
          shippingRateSnapshot: {
            rateId: crypto.randomUUID(),
            name:
              vendorSplit.shippingCents === 0
                ? "Free over threshold"
                : "Standard",
            rateCents: vendorSplit.shippingCents,
            minDeliveryDays: 3,
            maxDeliveryDays: 7,
          },
          fulfilledAt,
          cancelledAt: lifecycle === "cancelled" ? placedAt : null,
          createdAt: placedAt,
          updatedAt: fulfilledAt ?? placedAt,
        });

        for (const line of perVendorLines.get(vendor.id)!) {
          orderItems.push({
            orderId,
            vendorOrderId,
            variantId: line.variant.id,
            skuSnapshot: line.variant.sku,
            titleSnapshot: line.variant.title,
            vendorNameSnapshot: vendor.displayName,
            quantity: line.qty,
            unitPriceCents: line.variant.priceCents,
            totalCents: line.variant.priceCents * line.qty,
          });
        }

        if (fulfilledAt) {
          shipments.push({
            vendorOrderId,
            carrier: rng.pick(["Royal Mail", "UPS", "DHL", "FedEx"]),
            trackingNumber: makeTrackingNumber(rng),
            status: rng.chance(0.85) ? "delivered" : "in_transit",
            shippedAt: fulfilledAt,
            deliveredAt: rng.chance(0.85)
              ? new Date(fulfilledAt.getTime() + rng.int(1, 6) * 86400000)
              : null,
            createdAt: fulfilledAt,
          });
        }

        /**
         * Three signed rows, never one net row (§8.3 step 4). The vendor's
         * balance is SUM(amount_cents) over these — rule 13 — so the sale is
         * the discounted subtotal, shipping is credited in full, and the
         * commission is a negative entry.
         */
        if (isPaid) {
          balanceEntries.push({
            vendorId: vendor.id,
            entryType: "sale",
            amountCents: vendorSplit.subtotalCents - vendorSplit.discountCents,
            currency: "USD",
            vendorOrderId,
            createdAt: placedAt,
          });
          balanceEntries.push({
            vendorId: vendor.id,
            entryType: "shipping",
            amountCents: vendorSplit.shippingCents,
            currency: "USD",
            vendorOrderId,
            createdAt: placedAt,
          });
          balanceEntries.push({
            vendorId: vendor.id,
            entryType: "commission",
            amountCents: -vendorSplit.commissionCents,
            currency: "USD",
            vendorOrderId,
            createdAt: placedAt,
          });
          ledgerCount += 3;
        }
      }
    }

    await insertChunked(db, schema.orders, orders);
    await insertChunked(db, schema.vendorOrders, vendorOrders);
    await insertChunked(db, schema.orderItems, orderItems);
    await insertChunked(db, schema.payments, payments);
    await insertChunked(db, schema.shipments, shipments);
    await insertChunked(db, schema.vendorBalanceEntries, balanceEntries);

    if (batchEnd % 10000 === 0 || batchEnd === TARGET_ORDERS) {
      log("orders", `${batchEnd}/${TARGET_ORDERS}`);
    }
  }

  log(
    "orders done",
    `${subOrderCount} sub-orders, ${multiVendorCount} multi-vendor baskets, ${ledgerCount} ledger entries`,
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Reports what landed and asserts the ledger identity from rule 13 — a vendor's
 * balance is the sum of its entries. This is a cheap in-process stand-in for
 * `make reconcile`, which arrives with phase 7; catching a broken split here
 * beats discovering it three phases later.
 */
async function summarise(db: NodePgDatabase<typeof schema>): Promise<void> {
  const counts = await db.execute<{ table_name: string; n: number }>(sql`
    SELECT 'vendors' AS table_name, count(*)::int AS n FROM vendors
    UNION ALL SELECT 'vendor_members', count(*)::int FROM vendor_members
    UNION ALL SELECT 'users', count(*)::int FROM "user"
    UNION ALL SELECT 'categories', count(*)::int FROM categories
    UNION ALL SELECT 'products', count(*)::int FROM products
    UNION ALL SELECT 'variants', count(*)::int FROM product_variants
    UNION ALL SELECT 'orders', count(*)::int FROM orders
    UNION ALL SELECT 'vendor_orders', count(*)::int FROM vendor_orders
    UNION ALL SELECT 'order_items', count(*)::int FROM order_items
    UNION ALL SELECT 'balance_entries', count(*)::int FROM vendor_balance_entries
    ORDER BY 1
  `);

  process.stdout.write("\n  Seeded:\n");
  for (const row of counts.rows) {
    process.stdout.write(
      `    ${String(row.table_name).padEnd(18)} ${String(row.n).padStart(7)}\n`,
    );
  }

  // Every order's sub-orders must sum to its total (§8.3 step 11).
  const mismatch = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM (
      SELECT o.id
      FROM orders o
      JOIN vendor_orders vo ON vo.order_id = o.id
      GROUP BY o.id, o.total_cents
      HAVING sum(vo.total_cents) <> o.total_cents
    ) AS bad
  `);
  const badOrders = mismatch.rows[0]?.n ?? 0;

  // Vendor balances, derived — never a stored column (rule 13).
  const balances = await db.execute<{
    display_name: string;
    balance_cents: number;
  }>(sql`
    SELECT v.display_name, COALESCE(sum(e.amount_cents), 0)::int AS balance_cents
    FROM vendors v
    LEFT JOIN vendor_balance_entries e ON e.vendor_id = v.id
    GROUP BY v.id, v.display_name
    ORDER BY balance_cents DESC
  `);

  process.stdout.write("\n  Vendor balances (Σ ledger entries):\n");
  for (const row of balances.rows) {
    const dollars = (Number(row.balance_cents) / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
    process.stdout.write(
      `    ${String(row.display_name).padEnd(24)} ${dollars.padStart(14)}\n`,
    );
  }

  if (badOrders > 0) {
    throw new Error(
      `${badOrders} orders where Σ vendor_orders.total_cents <> orders.total_cents`,
    );
  }
  process.stdout.write(
    `\n  ✓ split reconciles on every order (Σ sub-orders = order total)\n`,
  );

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  process.stdout.write(`\nDone in ${seconds}s.\n\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`\nSeed failed: ${String(error)}\n`);
  process.exitCode = 1;
});
