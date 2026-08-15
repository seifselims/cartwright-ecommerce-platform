import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  char,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    /**
     * Platform role only — there is no `vendor` value. Vendor access comes from
     * `vendor_members` (spec §5.4); an admin is always a platform employee.
     *
     * `text` with a check rather than a pgEnum: this column is written by Better
     * Auth's adapter as a plain string, and keeping the generated block free of
     * symbols the CLI does not know about means a regeneration cannot break it.
     */
    role: text("role").default("customer").notNull(),
    stripeCustomerId: text("stripe_customer_id").unique(),
  },
  (table) => [
    check("user_role_allowed", sql`${table.role} IN ('customer', 'admin')`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/* -------------------------------------------------------------------------- */
/* Shared column types and helpers                                            */
/* -------------------------------------------------------------------------- */

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

/** Every timestamp is `timestamptz` and stored in UTC; format at render time. */
const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** ISO 4217 code. All amounts alongside it are integer minor units. */
const currency = (name = "currency") =>
  char(name, { length: 3 }).notNull().default("USD");

export type AddressSnapshot = {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode: string;
  country: string;
  phone?: string | null;
};

/** Frozen onto a vendor order so a later rate-table edit cannot restate history. */
export type ShippingRateSnapshot = {
  rateId: string;
  name: string;
  rateCents: number;
  minDeliveryDays: number;
  maxDeliveryDays: number;
};

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const vendorStatus = pgEnum("vendor_status", [
  "pending",
  "approved",
  "suspended",
  "rejected",
]);

export const vendorMemberRole = pgEnum("vendor_member_role", [
  "owner",
  "manager",
  "staff",
]);

export const vendorApplicationStatus = pgEnum("vendor_application_status", [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
]);

export const productStatus = pgEnum("product_status", [
  "draft",
  "active",
  "archived",
]);

export const inventoryReason = pgEnum("inventory_reason", [
  "restock",
  "sale",
  "refund",
  "adjustment",
  "reservation",
  "reservation_expiry",
]);

export const cartStatus = pgEnum("cart_status", [
  "active",
  "converted",
  "abandoned",
]);

export const orderStatus = pgEnum("order_status", [
  "pending",
  "paid",
  "partially_fulfilled",
  "fulfilled",
  "cancelled",
  "partially_refunded",
  "refunded",
]);

export const vendorOrderStatus = pgEnum("vendor_order_status", [
  "pending",
  "paid",
  "fulfilled",
  "cancelled",
  "partially_refunded",
  "refunded",
]);

export const shipmentStatus = pgEnum("shipment_status", [
  "pending",
  "in_transit",
  "delivered",
  "lost",
]);

export const paymentStatus = pgEnum("payment_status", [
  "requires_payment",
  "processing",
  "succeeded",
  "failed",
  "refunded",
]);

export const balanceEntryType = pgEnum("balance_entry_type", [
  "sale",
  "commission",
  "shipping",
  "refund",
  "refund_commission_reversal",
  "transfer",
  "transfer_reversal",
  "adjustment",
  "chargeback",
]);

export const transferStatus = pgEnum("transfer_status", [
  "pending",
  "in_transit",
  "paid",
  "failed",
  "reversed",
]);

export const refundStatus = pgEnum("refund_status", [
  "pending",
  "succeeded",
  "failed",
]);

export const discountType = pgEnum("discount_type", [
  "percent",
  "fixed",
  "free_shipping",
]);

export const discountFundedBy = pgEnum("discount_funded_by", [
  "platform",
  "vendor",
]);

export const reviewStatus = pgEnum("review_status", [
  "pending",
  "published",
  "rejected",
]);

/* -------------------------------------------------------------------------- */
/* Vendors                                                                    */
/* -------------------------------------------------------------------------- */

export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    displayName: text("display_name").notNull(),
    legalName: text("legal_name"),
    supportEmail: text("support_email").notNull(),
    description: text("description"),
    logoStorageKey: text("logo_storage_key"),
    bannerStorageKey: text("banner_storage_key"),
    status: vendorStatus("status").default("pending").notNull(),
    /** Basis points. Null means fall back to PLATFORM_COMMISSION_BPS. */
    commissionBps: integer("commission_bps"),
    stripeAccountId: text("stripe_account_id").unique(),
    /** Mirrors of Stripe account state, refreshed from `account.updated`. */
    chargesEnabled: boolean("charges_enabled").default(false).notNull(),
    payoutsEnabled: boolean("payouts_enabled").default(false).notNull(),
    payoutHoldDays: integer("payout_hold_days").default(3).notNull(),
    country: char("country", { length: 2 }).notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    approvedAt: tstz("approved_at"),
  },
  (table) => [
    index("vendors_status_idx").on(table.status),
    check(
      "vendors_commission_bps_range",
      sql`${table.commissionBps} IS NULL OR (${table.commissionBps} >= 0 AND ${table.commissionBps} <= 10000)`,
    ),
    check(
      "vendors_payout_hold_days_non_negative",
      sql`${table.payoutHoldDays} >= 0`,
    ),
  ],
);

/**
 * How a human gets vendor access. Deliberately not a column on `user`: platform
 * role and vendor membership are separate axes (spec §5.4).
 */
export const vendorMembers = pgTable(
  "vendor_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: vendorMemberRole("role").default("staff").notNull(),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    invitedAt: tstz("invited_at").defaultNow().notNull(),
    acceptedAt: tstz("accepted_at"),
  },
  (table) => [
    unique("vendor_members_vendor_id_user_id_unique").on(
      table.vendorId,
      table.userId,
    ),
    index("vendor_members_user_id_idx").on(table.userId),
    index("vendor_members_vendor_id_role_idx").on(table.vendorId, table.role),
  ],
);

export const vendorApplications = pgTable(
  "vendor_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    proposedName: text("proposed_name").notNull(),
    proposedSlug: text("proposed_slug").notNull(),
    country: char("country", { length: 2 }).notNull(),
    categories: text("categories")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    message: text("message"),
    status: vendorApplicationStatus("status").default("pending").notNull(),
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewNotes: text("review_notes"),
    createdAt: tstz("created_at").defaultNow().notNull(),
    reviewedAt: tstz("reviewed_at"),
  },
  (table) => [
    index("vendor_applications_status_created_at_idx").on(
      table.status,
      table.createdAt.desc(),
    ),
    index("vendor_applications_user_id_idx").on(table.userId),
  ],
);

/** Flat rate table per vendor. A null `country` is the catch-all zone. */
export const vendorShippingRates = pgTable(
  "vendor_shipping_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    country: char("country", { length: 2 }),
    rateCents: integer("rate_cents").notNull(),
    freeOverCents: integer("free_over_cents"),
    minDeliveryDays: integer("min_delivery_days").notNull(),
    maxDeliveryDays: integer("max_delivery_days").notNull(),
    active: boolean("active").default(true).notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    /**
     * `nullsNotDistinct` so the catch-all zone (null country) cannot be
     * duplicated — Postgres would otherwise treat every null as unique.
     */
    unique("vendor_shipping_rates_vendor_country_name_unique")
      .on(table.vendorId, table.country, table.name)
      .nullsNotDistinct(),
    index("vendor_shipping_rates_vendor_id_idx").on(table.vendorId),
    check(
      "vendor_shipping_rates_rate_non_negative",
      sql`${table.rateCents} >= 0`,
    ),
    check(
      "vendor_shipping_rates_delivery_days_ordered",
      sql`${table.minDeliveryDays} >= 0 AND ${table.maxDeliveryDays} >= ${table.minDeliveryDays}`,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Customers                                                                  */
/* -------------------------------------------------------------------------- */

export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text("label"),
    name: text("name").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    region: text("region"),
    postalCode: text("postal_code").notNull(),
    country: char("country", { length: 2 }).notNull(),
    phone: text("phone"),
    isDefaultShipping: boolean("is_default_shipping").default(false).notNull(),
    isDefaultBilling: boolean("is_default_billing").default(false).notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("addresses_user_id_idx").on(table.userId)],
);

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

/** Platform-owned taxonomy. Vendors choose from it; they do not extend it. */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    position: integer("position").default(0).notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("categories_parent_id_position_idx").on(
      table.parentId,
      table.position,
    ),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    /** Globally unique, not per-vendor: keeps the URL `/p/[slug]` a single lookup. */
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    brand: text("brand"),
    status: productStatus("status").default("draft").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(description, ''))`,
    ),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("products_search_vector_idx").using("gin", table.searchVector),
    index("products_category_id_status_idx").on(table.categoryId, table.status),
    index("products_vendor_id_status_created_at_idx").on(
      table.vendorId,
      table.status,
      table.createdAt.desc(),
    ),
    /** Referenced by the composite FK on `product_variants`. */
    unique("products_id_vendor_id_unique").on(table.id, table.vendorId),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /**
     * Denormalised from the parent product: checkout, stock locking and the
     * payout split all group by vendor starting from the variant.
     */
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    priceCents: integer("price_cents").notNull(),
    compareAtPriceCents: integer("compare_at_price_cents"),
    currency: currency(),
    weightGrams: integer("weight_grams"),
    optionValues: jsonb("option_values")
      .$type<Record<string, string>>()
      .default({})
      .notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("product_variants_product_id_idx").on(table.productId),
    /** Two vendors may legitimately use the same SKU string. */
    uniqueIndex("product_variants_vendor_id_sku_idx").on(
      table.vendorId,
      table.sku,
    ),
    /** Makes a variant whose vendor differs from its product unrepresentable. */
    foreignKey({
      columns: [table.productId, table.vendorId],
      foreignColumns: [products.id, products.vendorId],
      name: "product_variants_product_id_vendor_id_fk",
    }).onDelete("cascade"),
    check("product_variants_price_non_negative", sql`${table.priceCents} >= 0`),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),
    storageKey: text("storage_key").notNull(),
    alt: text("alt"),
    width: integer("width"),
    height: integer("height"),
    blurhash: text("blurhash"),
    position: integer("position").default(0).notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("product_images_product_id_position_idx").on(
      table.productId,
      table.position,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Inventory                                                                  */
/* -------------------------------------------------------------------------- */

export const inventory = pgTable(
  "inventory",
  {
    variantId: uuid("variant_id")
      .primaryKey()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    onHand: integer("on_hand").default(0).notNull(),
    reserved: integer("reserved").default(0).notNull(),
    reorderPoint: integer("reorder_point").default(0).notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "inventory_non_negative",
      sql`${table.onHand} >= 0 AND ${table.reserved} >= 0`,
    ),
  ],
);

/** Append-only. Never UPDATE or DELETE a row here — it is the stock audit trail. */
export const inventoryLedger = pgTable(
  "inventory_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    delta: integer("delta").notNull(),
    reason: inventoryReason("reason").notNull(),
    referenceId: uuid("reference_id"),
    createdAt: tstz("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("inventory_ledger_variant_id_created_at_idx").on(
      table.variantId,
      table.createdAt.desc(),
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Carts                                                                      */
/* -------------------------------------------------------------------------- */

export const carts = pgTable(
  "carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    sessionToken: text("session_token"),
    currency: currency(),
    status: cartStatus("status").default("active").notNull(),
    expiresAt: tstz("expires_at"),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("carts_user_id_idx").on(table.userId),
    index("carts_session_token_idx").on(table.sessionToken),
    index("carts_expires_at_active_idx")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'active'`),
  ],
);

/**
 * No vendor column: grouping a cart by vendor is one hop through
 * `product_variants.vendor_id`, which is why that column is denormalised.
 */
export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("cart_items_cart_id_idx").on(table.cartId),
    unique("cart_items_cart_id_variant_id_unique").on(
      table.cartId,
      table.variantId,
    ),
    check("cart_items_quantity_positive", sql`${table.quantity} > 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Orders and payments                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The customer's receipt: one buyer, one address, one payment, one grand total.
 * Totals are the sum of the vendor orders below, asserted inside the checkout
 * transaction. `status` is a rollup of the sub-orders, never the thing you
 * decide from.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderNumber: text("order_number").notNull().unique(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    status: orderStatus("status").default("pending").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").default(0).notNull(),
    taxCents: integer("tax_cents").default(0).notNull(),
    discountCents: integer("discount_cents").default(0).notNull(),
    totalCents: integer("total_cents").notNull(),
    platformFeeCents: integer("platform_fee_cents").default(0).notNull(),
    currency: currency(),
    shippingAddress: jsonb("shipping_address").$type<AddressSnapshot>(),
    billingAddress: jsonb("billing_address").$type<AddressSnapshot>(),
    discountCodeId: uuid("discount_code_id").references(
      (): AnyPgColumn => discountCodes.id,
      { onDelete: "set null" },
    ),
    placedAt: tstz("placed_at"),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("orders_user_id_placed_at_idx").on(
      table.userId,
      table.placedAt.desc(),
    ),
    index("orders_status_placed_at_idx").on(
      table.status,
      table.placedAt.desc(),
    ),
  ],
);

/**
 * The unit of work: one per vendor in the basket, with its own status,
 * shipping, fulfilment, commission and payout. `commission_bps` is snapshotted
 * so renegotiating a rate cannot restate what was already owed.
 */
export const vendorOrders = pgTable(
  "vendor_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    vendorOrderNumber: text("vendor_order_number").notNull().unique(),
    status: vendorOrderStatus("status").default("pending").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").default(0).notNull(),
    taxCents: integer("tax_cents").default(0).notNull(),
    discountCents: integer("discount_cents").default(0).notNull(),
    totalCents: integer("total_cents").notNull(),
    commissionBps: integer("commission_bps").notNull(),
    commissionCents: integer("commission_cents").notNull(),
    vendorPayoutCents: integer("vendor_payout_cents").notNull(),
    shippingRateSnapshot: jsonb(
      "shipping_rate_snapshot",
    ).$type<ShippingRateSnapshot>(),
    fulfilledAt: tstz("fulfilled_at"),
    cancelledAt: tstz("cancelled_at"),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("vendor_orders_order_id_vendor_id_unique").on(
      table.orderId,
      table.vendorId,
    ),
    /** Referenced by the composite FK on `order_items`. */
    unique("vendor_orders_id_order_id_unique").on(table.id, table.orderId),
    index("vendor_orders_vendor_id_created_at_idx").on(
      table.vendorId,
      table.createdAt.desc(),
    ),
    index("vendor_orders_order_id_idx").on(table.orderId),
    index("vendor_orders_vendor_id_status_created_at_idx").on(
      table.vendorId,
      table.status,
      table.createdAt.desc(),
    ),
    index("vendor_orders_fulfilled_at_idx")
      .on(table.fulfilledAt)
      .where(sql`${table.status} = 'fulfilled'`),
    check(
      "vendor_orders_commission_bps_range",
      sql`${table.commissionBps} >= 0 AND ${table.commissionBps} <= 10000`,
    ),
  ],
);

/**
 * Carries both keys: the customer's order page wants every item of an order,
 * the vendor's picking list wants one sub-order. The composite FK is what makes
 * the denormalisation safe.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    vendorOrderId: uuid("vendor_order_id").notNull(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    skuSnapshot: text("sku_snapshot").notNull(),
    titleSnapshot: text("title_snapshot").notNull(),
    vendorNameSnapshot: text("vendor_name_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
  },
  (table) => [
    index("order_items_order_id_idx").on(table.orderId),
    index("order_items_vendor_order_id_idx").on(table.vendorOrderId),
    foreignKey({
      columns: [table.vendorOrderId, table.orderId],
      foreignColumns: [vendorOrders.id, vendorOrders.orderId],
      name: "order_items_vendor_order_id_order_id_fk",
    }).onDelete("cascade"),
    check("order_items_quantity_positive", sql`${table.quantity} > 0`),
  ],
);

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorOrderId: uuid("vendor_order_id")
      .notNull()
      .references(() => vendorOrders.id, { onDelete: "cascade" }),
    carrier: text("carrier").notNull(),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    status: shipmentStatus("status").default("pending").notNull(),
    shippedAt: tstz("shipped_at"),
    deliveredAt: tstz("delivered_at"),
    createdAt: tstz("created_at").defaultNow().notNull(),
  },
  (table) => [index("shipments_vendor_order_id_idx").on(table.vendorOrderId)],
);

/** One charge per basket, on the platform account, however many vendors it spans. */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    provider: text("provider").default("stripe").notNull(),
    providerPaymentIntentId: text("provider_payment_intent_id")
      .notNull()
      .unique(),
    amountCents: integer("amount_cents").notNull(),
    status: paymentStatus("status").notNull(),
    rawPayload: jsonb("raw_payload"),
    createdAt: tstz("created_at").defaultNow().notNull(),
  },
  (table) => [index("payments_order_id_idx").on(table.orderId)],
);

/** The unique constraint on `provider_event_id` is the webhook idempotency guarantee. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").default("stripe").notNull(),
    providerEventId: text("provider_event_id").notNull().unique(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: tstz("processed_at"),
    attempts: integer("attempts").default(0).notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("webhook_events_processed_at_idx")
      .on(table.createdAt)
      .where(sql`${table.processedAt} IS NULL`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Payouts                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The unique constraint on `idempotency_key` is the no-double-payout guarantee,
 * and it is the counterpart of `webhook_events.provider_event_id`. Derive the
 * key from the sub-order id so a retried job, a duplicated queue message and a
 * manual re-run all collide on the same row.
 */
export const vendorTransfers = pgTable(
  "vendor_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    vendorOrderId: uuid("vendor_order_id")
      .notNull()
      .references(() => vendorOrders.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    currency: currency(),
    status: transferStatus("status").default("pending").notNull(),
    provider: text("provider").default("stripe").notNull(),
    providerTransferId: text("provider_transfer_id").unique(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    failureReason: text("failure_reason"),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: tstz("available_at").notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
    completedAt: tstz("completed_at"),
  },
  (table) => [
    index("vendor_transfers_vendor_id_status_idx").on(
      table.vendorId,
      table.status,
    ),
    /** Keeps the payout sweeper's working set proportional to what is owed. */
    index("vendor_transfers_available_at_pending_idx")
      .on(table.availableAt)
      .where(sql`${table.status} = 'pending'`),
    check("vendor_transfers_amount_positive", sql`${table.amountCents} > 0`),
  ],
);

/**
 * Append-only money ledger. Never UPDATE, never DELETE. A vendor's balance is
 * `SUM(amount_cents)` — derived, always reconcilable, and allowed to go
 * negative after a refund on an already-transferred order.
 */
export const vendorBalanceEntries = pgTable(
  "vendor_balance_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    entryType: balanceEntryType("entry_type").notNull(),
    /** Signed: credits are positive, commission and transfers are negative. */
    amountCents: integer("amount_cents").notNull(),
    currency: currency(),
    vendorOrderId: uuid("vendor_order_id").references(() => vendorOrders.id, {
      onDelete: "restrict",
    }),
    transferId: uuid("transfer_id").references(() => vendorTransfers.id, {
      onDelete: "restrict",
    }),
    referenceId: uuid("reference_id"),
    note: text("note"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: tstz("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("vendor_balance_entries_vendor_id_created_at_idx").on(
      table.vendorId,
      table.createdAt.desc(),
    ),
    index("vendor_balance_entries_vendor_order_id_idx").on(table.vendorOrderId),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    vendorOrderId: uuid("vendor_order_id")
      .notNull()
      .references(() => vendorOrders.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    shippingRefundedCents: integer("shipping_refunded_cents")
      .default(0)
      .notNull(),
    reason: text("reason"),
    status: refundStatus("status").default("pending").notNull(),
    providerRefundId: text("provider_refund_id").unique(),
    reversesTransfer: boolean("reverses_transfer").default(false).notNull(),
    providerTransferReversalId: text("provider_transfer_reversal_id"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: tstz("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("refunds_vendor_order_id_idx").on(table.vendorOrderId),
    index("refunds_order_id_idx").on(table.orderId),
    check("refunds_amount_positive", sql`${table.amountCents} > 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Discounts, reviews, audit                                                  */
/* -------------------------------------------------------------------------- */

export const discountCodes = pgTable(
  "discount_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    /** Null means a platform-wide code funded out of commission. */
    vendorId: uuid("vendor_id").references(() => vendors.id, {
      onDelete: "cascade",
    }),
    fundedBy: discountFundedBy("funded_by").default("platform").notNull(),
    type: discountType("type").notNull(),
    /** `percent` → basis points (1000 = 10%); `fixed` → minor units; `free_shipping` → 0. */
    value: integer("value").default(0).notNull(),
    minSubtotalCents: integer("min_subtotal_cents").default(0).notNull(),
    maxRedemptions: integer("max_redemptions"),
    redemptionsUsed: integer("redemptions_used").default(0).notNull(),
    startsAt: tstz("starts_at"),
    endsAt: tstz("ends_at"),
    active: boolean("active").default(true).notNull(),
    createdAt: tstz("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("discount_codes_vendor_id_idx").on(table.vendorId),
    check(
      "discount_codes_redemptions_within_max",
      sql`${table.maxRedemptions} IS NULL OR ${table.redemptionsUsed} <= ${table.maxRedemptions}`,
    ),
    /** A vendor-funded code must name the vendor paying for it. */
    check(
      "discount_codes_vendor_funded_has_vendor",
      sql`(${table.fundedBy} = 'vendor') = (${table.vendorId} IS NOT NULL)`,
    ),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Denormalised so the vendor rating aggregate is one indexed scan. */
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    vendorOrderId: uuid("vendor_order_id").references(() => vendorOrders.id, {
      onDelete: "set null",
    }),
    rating: smallint("rating").notNull(),
    title: text("title"),
    body: text("body"),
    status: reviewStatus("status").default("pending").notNull(),
    /** Vendors may reply. Moderation — status — stays with the platform. */
    vendorResponseBody: text("vendor_response_body"),
    vendorRespondedAt: tstz("vendor_responded_at"),
    createdAt: tstz("created_at").defaultNow().notNull(),
    updatedAt: tstz("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("reviews_user_id_product_id_unique").on(
      table.userId,
      table.productId,
    ),
    index("reviews_product_id_status_idx").on(table.productId, table.status),
    index("reviews_vendor_id_status_idx").on(table.vendorId, table.status),
    check("reviews_rating_range", sql`${table.rating} BETWEEN 1 AND 5`),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** Null for platform-admin actions; set for anything done as a vendor. */
    vendorId: uuid("vendor_id").references(() => vendors.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    diff: jsonb("diff"),
    createdAt: tstz("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt.desc(),
    ),
    index("audit_log_vendor_id_created_at_idx").on(
      table.vendorId,
      table.createdAt.desc(),
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  addresses: many(addresses),
  orders: many(orders),
  vendorMemberships: many(vendorMembers),
  reviews: many(reviews),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const vendorRelations = relations(vendors, ({ many }) => ({
  members: many(vendorMembers),
  products: many(products),
  shippingRates: many(vendorShippingRates),
  vendorOrders: many(vendorOrders),
  balanceEntries: many(vendorBalanceEntries),
  transfers: many(vendorTransfers),
  reviews: many(reviews),
}));

export const vendorMemberRelations = relations(vendorMembers, ({ one }) => ({
  vendor: one(vendors, {
    fields: [vendorMembers.vendorId],
    references: [vendors.id],
  }),
  user: one(user, { fields: [vendorMembers.userId], references: [user.id] }),
}));

export const vendorApplicationRelations = relations(
  vendorApplications,
  ({ one }) => ({
    user: one(user, {
      fields: [vendorApplications.userId],
      references: [user.id],
    }),
  }),
);

export const vendorShippingRateRelations = relations(
  vendorShippingRates,
  ({ one }) => ({
    vendor: one(vendors, {
      fields: [vendorShippingRates.vendorId],
      references: [vendors.id],
    }),
  }),
);

export const addressRelations = relations(addresses, ({ one }) => ({
  user: one(user, { fields: [addresses.userId], references: [user.id] }),
}));

export const categoryRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_parent",
  }),
  children: many(categories, { relationName: "category_parent" }),
  products: many(products),
}));

export const productRelations = relations(products, ({ one, many }) => ({
  vendor: one(vendors, {
    fields: [products.vendorId],
    references: [vendors.id],
  }),
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  variants: many(productVariants),
  images: many(productImages),
  reviews: many(reviews),
}));

export const productVariantRelations = relations(
  productVariants,
  ({ one, many }) => ({
    product: one(products, {
      fields: [productVariants.productId],
      references: [products.id],
    }),
    vendor: one(vendors, {
      fields: [productVariants.vendorId],
      references: [vendors.id],
    }),
    inventory: one(inventory, {
      fields: [productVariants.id],
      references: [inventory.variantId],
    }),
    images: many(productImages),
    ledgerEntries: many(inventoryLedger),
  }),
);

export const productImageRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [productImages.variantId],
    references: [productVariants.id],
  }),
}));

export const inventoryRelations = relations(inventory, ({ one }) => ({
  variant: one(productVariants, {
    fields: [inventory.variantId],
    references: [productVariants.id],
  }),
}));

export const inventoryLedgerRelations = relations(
  inventoryLedger,
  ({ one }) => ({
    variant: one(productVariants, {
      fields: [inventoryLedger.variantId],
      references: [productVariants.id],
    }),
  }),
);

export const cartRelations = relations(carts, ({ one, many }) => ({
  user: one(user, { fields: [carts.userId], references: [user.id] }),
  items: many(cartItems),
}));

export const cartItemRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  variant: one(productVariants, {
    fields: [cartItems.variantId],
    references: [productVariants.id],
  }),
}));

export const orderRelations = relations(orders, ({ one, many }) => ({
  user: one(user, { fields: [orders.userId], references: [user.id] }),
  discountCode: one(discountCodes, {
    fields: [orders.discountCodeId],
    references: [discountCodes.id],
  }),
  vendorOrders: many(vendorOrders),
  items: many(orderItems),
  payments: many(payments),
  refunds: many(refunds),
}));

export const vendorOrderRelations = relations(
  vendorOrders,
  ({ one, many }) => ({
    order: one(orders, {
      fields: [vendorOrders.orderId],
      references: [orders.id],
    }),
    vendor: one(vendors, {
      fields: [vendorOrders.vendorId],
      references: [vendors.id],
    }),
    items: many(orderItems),
    shipments: many(shipments),
    transfers: many(vendorTransfers),
    balanceEntries: many(vendorBalanceEntries),
    refunds: many(refunds),
  }),
);

export const orderItemRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  vendorOrder: one(vendorOrders, {
    fields: [orderItems.vendorOrderId],
    references: [vendorOrders.id],
  }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

export const shipmentRelations = relations(shipments, ({ one }) => ({
  vendorOrder: one(vendorOrders, {
    fields: [shipments.vendorOrderId],
    references: [vendorOrders.id],
  }),
}));

export const paymentRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));

export const vendorTransferRelations = relations(
  vendorTransfers,
  ({ one, many }) => ({
    vendor: one(vendors, {
      fields: [vendorTransfers.vendorId],
      references: [vendors.id],
    }),
    vendorOrder: one(vendorOrders, {
      fields: [vendorTransfers.vendorOrderId],
      references: [vendorOrders.id],
    }),
    balanceEntries: many(vendorBalanceEntries),
  }),
);

export const vendorBalanceEntryRelations = relations(
  vendorBalanceEntries,
  ({ one }) => ({
    vendor: one(vendors, {
      fields: [vendorBalanceEntries.vendorId],
      references: [vendors.id],
    }),
    vendorOrder: one(vendorOrders, {
      fields: [vendorBalanceEntries.vendorOrderId],
      references: [vendorOrders.id],
    }),
    transfer: one(vendorTransfers, {
      fields: [vendorBalanceEntries.transferId],
      references: [vendorTransfers.id],
    }),
  }),
);

export const refundRelations = relations(refunds, ({ one }) => ({
  order: one(orders, { fields: [refunds.orderId], references: [orders.id] }),
  vendorOrder: one(vendorOrders, {
    fields: [refunds.vendorOrderId],
    references: [vendorOrders.id],
  }),
}));

export const discountCodeRelations = relations(discountCodes, ({ one }) => ({
  vendor: one(vendors, {
    fields: [discountCodes.vendorId],
    references: [vendors.id],
  }),
}));

export const reviewRelations = relations(reviews, ({ one }) => ({
  product: one(products, {
    fields: [reviews.productId],
    references: [products.id],
  }),
  vendor: one(vendors, {
    fields: [reviews.vendorId],
    references: [vendors.id],
  }),
  user: one(user, { fields: [reviews.userId], references: [user.id] }),
  order: one(orders, { fields: [reviews.orderId], references: [orders.id] }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  actor: one(user, { fields: [auditLog.actorUserId], references: [user.id] }),
  vendor: one(vendors, {
    fields: [auditLog.vendorId],
    references: [vendors.id],
  }),
}));
