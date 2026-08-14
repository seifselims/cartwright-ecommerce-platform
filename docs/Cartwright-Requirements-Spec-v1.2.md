# Project Requirements Specification

## A Scalable, Self-Hosted Multi-Vendor Commerce Platform

**Stack:** Next.js (App Router) · PostgreSQL · Redis · Docker · Better Auth · BullMQ · Nodemailer · Stripe Connect · Playwright · k6

**Document version:** 1.2 · **Status:** Ready to build

*Changes since 1.1: the platform is now **multi-vendor**. Vendors were explicitly out of scope in 1.1 and are now the defining feature. Reworked: §2 (scope), §4 (architecture rules), §5 (twelve new tables, §5.4 authorization model), §6 (vendor-scoped cache keys), §7 (`/v/[vendor]`, `/vendor/*`, `/admin/vendors`, `/admin/payouts`), §8 (multi-vendor checkout, split webhook, new §8.6 fulfilment and §8.7 payouts and refunds), §9 (vendor and payout API), §10 (six new failure modes), §11 (nine new integration tests), §15 (new phase 6b), §16–§17. See `docs/adr/0001-multi-vendor-marketplace.md` for why.*

*Changes since 1.0: Auth.js replaced with Better Auth (§3.1, §5.1, §6.5, §11.3); Resend replaced with Nodemailer (§3.1, §8.3); new §3.3 explaining BullMQ, MinIO and Nginx; new §12.3 on running Postgres as a container.*

---

# 0. How to use this document

This is a build contract with yourself. Every section ends with **acceptance criteria** — a
statement that is either true or false when you look at your running system. If you cannot
demonstrate the criterion with a command, a test run, or a screenshot, the section is not done.

Do not skip Section 11 (Testing) or Section 13 (Load & Proof). Those two sections are the entire
difference between "I built a shop" and the résumé line in your screenshot. A claim like
"handles 10,000+ concurrent users" is only honest if you have a k6 report in your repository
that shows it.

---

# 1. Naming

## 1.1 What the name has to do

Your name has three jobs: be typeable as a domain and a GitHub repo, sound like infrastructure
rather than a toy, and not be a store name. This is **a platform**, not a shop — the portfolio
story is "I built the engine," so a name like "Sarah's Candles" undersells you immediately. That
argument is twice as strong now that the engine runs a marketplace of independent sellers: the
platform name must not sound like any one of them.

## 1.2 Recommended name

**Cartwright** — an old English word for a builder of carts. It is literally "one who makes
carts," which is exactly what an e-commerce engine is, and it reads as a serious engineering
product. `cartwright.dev`, `github.com/you/cartwright`.

Tagline: *An open-source commerce engine built for scale.*

## 1.3 Alternatives (pick one and never revisit it)

| Name | Reasoning | Repo slug |
|---|---|---|
| **Cartwright** | Craft metaphor, unique, professional | `cartwright` |
| **Tillpoint** | "Till" = register, "point" = point of sale | `tillpoint` |
| **Vendure-style: Coff** | Short, brandable, memorable | `coff` |
| **Bazaari** | Marketplace root, warm, still technical | `bazaari` |
| **Stockyard** | Inventory-first, evokes warehouses and throughput | `stockyard` |
| **Checkout Engine / CKO** | Descriptive; safe if you dislike abstract names | `cko` |

## 1.4 Marketplace identity inside the app

Name the *demo marketplace* separately from the *platform*. The platform is Cartwright; the
marketplace it ships with is **"Northgate Supply"** — a curated market for desk gear, coffee
equipment, and audio accessories.

Under 1.1 that was a single store. It is now a marketplace with **eight seeded vendor shops**,
each with its own slug, logo, catalogue, shipping rates, and payout account:

| Vendor | Slug | Sells |
|---|---|---|
| Nord Works | `nord-works` | Task lamps, desk risers |
| Kova Coffee | `kova-coffee` | Grinders, kettles, brewers |
| Tannery & Co | `tannery-co` | Leather desk mats, cable wraps |
| Pitch Audio | `pitch-audio` | Headphones, DACs, cables |
| Fieldnote | `fieldnote` | Notebooks, pens |
| Halden Steel | `halden-steel` | Tool trays, monitor arms |
| Ridge Supply Co | `ridge-supply` | Bags, organisers |
| Mono Ceramics | `mono-ceramics` | Mugs, pour-over drippers |

Seed at least two vendors selling **overlapping categories** and at least one pair of vendors
using the **same SKU string**, because those two facts are what break a single-tenant schema and
your seed data should prove your constraints survive them. Seed one vendor in each non-`approved`
state (`pending`, `suspended`) so the moderation and access-control paths have fixtures.

**Acceptance criteria:** repo, Docker image name, database name, Redis key prefix, and README
title all use the same platform name. Seed data uses the marketplace name and the eight vendors
above, including the overlapping-category and duplicate-SKU cases.

---

# 2. Product scope

## 2.1 In scope (must build)

1. **Catalogue** — products, variants (size/colour), categories, collections, images, stock
   levels. **Every product belongs to exactly one vendor.**
2. **Search & browse** — full-text search, faceted filters (including a vendor facet), sorting,
   pagination, plus a per-vendor storefront page.
3. **Cart** — guest carts and user carts, merge on login, live stock validation. **A single cart
   may span multiple vendors** and is presented grouped by vendor.
4. **Checkout** — address capture, **per-vendor shipping selection**, tax, one Stripe payment for
   the whole basket, order creation split into per-vendor sub-orders.
5. **Orders** — order history, order detail with per-vendor fulfilment status, status timeline,
   invoice PDF.
6. **Accounts** — registration, login, email verification, password reset, saved addresses.
7. **Inventory** — reservation on checkout start, decrement on payment success, release on
   expiry. Stock is owned by the vendor that owns the variant.
8. **Vendors** — self-serve application, platform approval, Stripe Connect onboarding, a
   `/vendor` dashboard for catalogue, inventory, orders, fulfilment, payouts and analytics.
9. **Split payments and payouts** — commission per vendor, a vendor balance ledger, Stripe
   Transfers per vendor sub-order, transfer reversals on refund.
10. **Platform admin** — vendor moderation, cross-vendor order and payout oversight, product and
    review moderation, discounts, refunds, basic analytics.
11. **Background jobs** — emails, image processing, search reindex, abandoned cart, stock
    release, **payout release and reconciliation**.
12. **Observability** — structured logs, metrics, health checks, error tracking.

## 2.2 Explicitly out of scope (write this in your README)

Subscriptions and recurring billing, a mobile app, i18n beyond a single locale, a headless CMS,
real shipping carrier integrations (simulate with per-vendor flat rate tables), and real tax
calculation (use a static tax table, not TaxJar/Avalara).

Multi-vendor specifically — now the centre of the project — is still bounded. **Out of scope
within it:** KYC/AML beyond what Stripe Connect's hosted onboarding performs for you; vendors
holding balances in currencies other than the platform currency; vendor-negotiated carrier
rates; vendor-specific tax registration and VAT/OSS reporting; vendor-to-vendor bundles or a
single shipment spanning vendors; a vendor-facing public API or webhooks; and vendor-configurable
storefront theming beyond a logo, banner and description.

Cutting scope on purpose and *saying so* reads as senior judgement. Endlessly half-finishing
features reads as the opposite. The marketplace boundaries above are the ones a reviewer will
probe — know why each line sits where it does.

**Acceptance criteria:** README contains an "Out of scope and why" section that covers the
marketplace boundaries, not just the platform ones.

---

# 3. Technology stack

## 3.1 Core

| Layer | Choice | Why this and not the alternative |
|---|---|---|
| Framework | **Next.js 15, App Router** | Server Components cut client JS; Route Handlers give you a real API; `output: 'standalone'` makes a small Docker image. |
| Language | **TypeScript, `strict: true`** | Non-negotiable. `any` is banned by ESLint rule. |
| Database | **PostgreSQL 16** | Transactions, row locks, `jsonb`, and full-text search all in one engine. |
| ORM | **Drizzle ORM** | SQL-shaped, generates readable migrations, no query engine binary to fight inside Alpine containers. Prisma is acceptable if you prefer it — but then use `binaryTargets` correctly in Docker. |
| Cache / ephemeral state | **Redis 7** | Cache, rate limiting, sessions, distributed locks, job queue backend, stock reservations. |
| Queue | **BullMQ** | Redis-backed, retries, delayed jobs, repeatable jobs, a dashboard. |
| Auth | **Better Auth** | Credentials + OAuth, and a `secondaryStorage` hook that puts sessions, rate-limit counters and OTPs in Redis instead of Postgres. Chosen over Auth.js specifically for that. |
| Payments | **Stripe Connect (test mode)**, Express accounts | Payment Intents + webhooks — the webhook idempotency problem is a great portfolio talking point. Connect adds the split-payment problem on top: one charge, N transfers, each needing its own idempotency and reversal story. Express accounts because Stripe hosts the onboarding and KYC, which is the part you neither want to build nor want to be responsible for. |
| Object storage | **MinIO** (S3-compatible) | Self-hosted in Docker, same SDK as S3, so the deploy story stays "one compose file." |
| Email | **Nodemailer** (+ **Mailpit** in dev/test) | Both speak SMTP, so dev, E2E and production share one code path and only the transport URL changes. No SaaS dependency. |
| Container | **Docker + Docker Compose** | Your stated goal. Multi-stage builds, non-root user, healthchecks. |
| Reverse proxy | **Nginx** or **Caddy** | TLS termination, static asset caching, gzip/brotli, rate limits at the edge. |

## 3.2 Supporting technologies that make this a "deep" project

| Technology | Purpose | What it proves |
|---|---|---|
| **Meilisearch** or Postgres `tsvector` + `pg_trgm` | Product search with typo tolerance and facets | You understand search is not `LIKE '%query%'` |
| **Zod** | Runtime validation at every trust boundary | You validate input, not just types |
| **OpenTelemetry + Jaeger** | Distributed tracing across web → queue → db | You can answer "why is checkout slow?" with data |
| **Prometheus + Grafana** | Metrics, dashboards, alert rules | You measure before you optimise |
| **Sentry** (self-hosted or free tier) | Error tracking with release tagging | Production thinking |
| **Testcontainers** | Real Postgres + Redis in integration tests | Your tests do not mock the database away |
| **k6** | Load testing with thresholds | The "10,000 concurrent users" claim becomes real |
| **GitHub Actions** | CI: lint, typecheck, test, build, scan, push image | You ship with a pipeline |
| **Trivy** | Container vulnerability scanning in CI | Security awareness |
| **pgBouncer** | Connection pooling in front of Postgres | You know Postgres connections are expensive |
| **Sharp** | Image resizing to WebP/AVIF in a worker | You handle media, not just JSON |
| **Umami** or a custom events table | Product analytics without a SaaS | Data modelling for events |

You do not have to use every row. Use everything in the top half; treat pgBouncer, Jaeger and
Sentry as stretch. But **Redis, Docker, Testcontainers and k6 are mandatory** for the story you
want to tell.

## 3.3 What the unfamiliar pieces actually do

Three of these solve problems Vercel was solving for you invisibly. That is precisely why they
appear the moment you move to Docker, and why building them yourself closes the gap in your
experience.

### BullMQ — a job queue

A library that pushes work into a list stored in Redis, which a **separate process** (your `worker`
container) pulls from and executes. A to-do list that survives restarts, with retries.

*The problem:* some work is too slow to do while the user waits. When a Stripe webhook arrives you
must return `200` within a couple of seconds or Stripe retries the entire event — but you also need
to send a confirmation email (2–5 s for the SMTP handshake), render an invoice PDF (1–3 s), and
reindex the product. Doing that inline means the webhook times out and fires again, and now the
customer has two emails.

Instead the webhook writes the order, enqueues four jobs, and returns in ~50 ms. If the mail relay
is down, BullMQ retries with exponential backoff and eventually parks the job in a dead-letter
queue rather than losing it.

*Runs in this project:* order emails, invoice PDFs, image resizing, Meilisearch reindexing, the
**15-minute delayed job that releases an expired stock reservation**, abandoned-cart emails, nightly
reconciliation. That delayed job is the capability worth understanding —
`queue.add('release', { orderId }, { delay: 900_000 })` schedules work for fifteen minutes from now
and survives a worker restart, because the schedule lives in Redis rather than in a `setTimeout`
inside a Node process that may not exist by then.

### MinIO — self-hosted S3

An object storage server that speaks the exact S3 API. Same AWS SDK, same calls, different endpoint.

*The problem:* product images must live somewhere, and that somewhere cannot be the container's
filesystem. Section 4 requires the web container to be stateless and horizontally scalable — if an
admin uploads a photo to container #2's disk, containers #1 and #3 return 404 for it, and a
redeploy deletes it. Binaries do not belong in Postgres either; they bloat your backups and evict
useful pages from the row cache.

*Stores:* original uploads, the five resized variants the worker generates, invoice PDFs, admin CSV
exports.

*Why MinIO over real S3:* one line in the compose file, so a reviewer gets a fully working system
with no AWS account. Because the API is identical, moving to S3 or Cloudflare R2 later is a change
to `S3_ENDPOINT` and nothing else. Say that in the README — it is a genuine architectural property,
not a workaround.

### Nginx — reverse proxy

Sits in front of your app containers. Traffic hits it on 80/443 and it decides which backend serves
the request. It solves several problems at once, all of which the Vercel edge handled invisibly:

- **TLS termination** — certificates live here, so Node only ever speaks plain HTTP on port 3000.
- **Load balancing** — this is what makes `docker compose up --scale web=3` mean anything. Without
  it, "horizontally scalable" has no mechanism behind it and your k6 run at 2,000 VUs is hammering
  a single Node process.
- **Static assets** — `/_next/static/*` is content-hashed and immutable; Nginx serves it from disk
  with a one-year `Cache-Control` and never wakes Node. That removes a large fraction of requests
  from the app tier.
- **Compression, edge rate limiting, request buffering** — drop abusive traffic before it costs you
  a database connection.
- **Graceful deploys** — health-checks backends and stops routing to one that is shutting down, so
  containers restart one at a time without dropped requests.

*Substitution worth considering:* **Caddy** does the same job and obtains and renews Let's Encrypt
certificates automatically — roughly five lines of config against Nginx's forty plus a certbot
container. Nginx has more tuning knobs and more CV recognition; Caddy gets you to HTTPS today.
Either is defensible.

**Acceptance criteria:** `docker compose up` starts the full stack with no manual steps beyond
copying `.env.example` to `.env`.

---

# 4. System architecture

```
                        ┌──────────────────────────┐
      Browser ────────► │  Nginx / Caddy (:80/:443)│
                        │  TLS, gzip, static cache │
                        └────────────┬─────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
          ┌─────────▼─────────┐            ┌──────────▼──────────┐
          │  Next.js app (x2) │            │  Next.js app (x2)   │
          │  RSC + Route      │            │  same image,        │
          │  Handlers         │            │  horizontally scaled│
          └────┬────────┬─────┘            └──────────┬──────────┘
               │        │                             │
               │        └──────────────┬──────────────┘
               │                       │
     ┌─────────▼────────┐    ┌─────────▼─────────┐    ┌──────────────────┐
     │   PostgreSQL 16  │    │     Redis 7       │    │   MinIO (S3)     │
     │   (+ pgBouncer)  │    │ cache · locks ·   │    │  product images  │
     │   source of truth│    │ sessions · queue  │    │  invoices        │
     └─────────▲────────┘    └─────────▲─────────┘    └────────▲─────────┘
               │                       │                       │
               │             ┌─────────┴─────────┐             │
               └─────────────┤  BullMQ Worker    ├─────────────┘
                             │  email · images · │
                             │  reindex · stock  │
                             │  release · reports│
                             └─────────┬─────────┘
                                       │
                             ┌─────────▼─────────┐
                             │   Meilisearch     │
                             └───────────────────┘

   Cross-cutting: OpenTelemetry traces → Jaeger · metrics → Prometheus → Grafana
```

**Key architectural rules**

1. The Next.js container is **stateless**. No local file writes, no in-memory cache that matters,
   no sticky sessions. You must be able to kill one and lose nothing.
2. Postgres is the **only** source of truth. Redis is always rebuildable from Postgres.
3. Anything slower than ~200 ms that the user does not need synchronously goes to a **job**.
4. Every write path that touches money or stock runs inside a **database transaction**.
5. **Every vendor-scoped read and write is filtered by `vendor_id` at the data-access layer**, not
   at the page. A `/vendor` handler must never build a query that *could* return another vendor's
   row. See §5.4 — this is the single most likely place for this project to produce a real
   security bug, because the storefront is happy to read across all vendors and the dashboard
   must never be.
6. **Money owed to a vendor is derived, never stored as a mutable balance column.** The vendor's
   balance is the sum of an append-only ledger, exactly as stock is reconcilable from
   `inventory_ledger`. A `balance_cents` column that drifts is worse than no column at all.
7. **Stripe is not a source of truth for what you owe; it is the mechanism for paying it.** Every
   transfer is preceded by a ledger entry and carries an idempotency key derived from the
   sub-order, so a retry can never pay a vendor twice.

**Acceptance criteria:** you can run `docker compose up --scale web=3`, kill one web container
mid-checkout, and the checkout still completes. Separately, a vendor session cannot retrieve any
row belonging to another vendor through any route in §7 or §9 — proven by test 22 in §11.3.

---

# 5. Data model

Multi-vendor changes this section more than any other. Read §5.0 before the table list — it is
the shape of the whole model in six sentences, and the table list only makes sense against it.

## 5.0 The shape of the model

A **vendor** is a selling entity. Humans get access to it through **`vendor_members`**, so a
vendor can have staff and a person can work for two vendors without duplicating accounts.

Every **product** has exactly one `vendor_id`. That single column is what makes the catalogue
multi-tenant, and it cascades: SKU uniqueness becomes per-vendor, stock belongs to a vendor,
search results carry a vendor facet, and every dashboard query gains a `WHERE vendor_id = $1`.

A basket can span vendors, so an **order splits in two levels**. `orders` is the customer's
receipt — one buyer, one address, one payment, one grand total. **`vendor_orders`** is the unit
of work — one per vendor in the basket, each with its own status, shipping, fulfilment,
commission and payout. `order_items` hang off the **sub-order**, not the order. Everything a
vendor touches after checkout is a `vendor_order`; everything the customer sees is an `order`.

Money moves in three stages, each with its own table. The customer pays **once** into the
platform account (`payments`). Payment success credits each vendor's **append-only ledger**
(`vendor_balance_entries`) with a sale and debits it a commission. Fulfilment, plus a hold
period, releases a **transfer** (`vendor_transfers`) that actually moves money to the vendor's
Connect account. Refunds run the same path backwards. The ledger is the truth; Stripe is the
plumbing.

## 5.1 Core tables

**user, session, account, verification** — **owned by Better Auth.** Do not hand-write these.
Run `npx @better-auth/cli generate` and let it emit the Drizzle schema, then commit the generated
migration. Extend `user` with your own columns via Better Auth's `additionalFields` option —
add `role (customer|admin)` and `stripe_customer_id` there rather than creating a parallel
`profiles` table. Everything below is yours and references `user.id`.

Note what `role` does **not** contain: there is no `vendor` value. Platform role and vendor
membership are different axes and collapsing them is a mistake you will not be able to undo
cheaply — see §5.4.

### New in 1.2 — the vendor tables

**vendors** — `id`, `slug (unique)`, `display_name`, `legal_name`, `support_email`,
`description`, `logo_storage_key`, `banner_storage_key`, `status (pending|approved|suspended|rejected)`,
`commission_bps (int, nullable — null means use the platform default)`,
`stripe_account_id (unique, nullable until onboarding starts)`,
`charges_enabled (bool)`, `payouts_enabled (bool)`, `payout_hold_days (int, default 3)`,
`country (iso2)`, `created_at`, `updated_at`, `approved_at`.

Commission is stored in **basis points**, not a percent float — 250 means 2.5%. Same reasoning as
`price_cents` in §5.2: a `commission_rate NUMERIC` invites `0.1 + 0.2` and a rounding argument
with a vendor you cannot win. `charges_enabled` and `payouts_enabled` are mirrors of Stripe's
account state, refreshed from the `account.updated` webhook; never read them from the API on the
request path.

**vendor_members** — `id`, `vendor_id fk`, `user_id fk`, `role (owner|manager|staff)`,
`invited_by_user_id fk nullable`, `invited_at`, `accepted_at`, unique on `(vendor_id, user_id)`.

This table, not a column on `user`, is how a human gets vendor access. It costs one join and buys
you staff accounts, ownership transfer, and a person who buys on the marketplace *and* works for
a vendor — all of which a `user.vendor_id` column makes impossible.

**vendor_applications** — `id`, `user_id fk`, `proposed_name`, `proposed_slug`, `country`,
`categories (text[])`, `message`, `status (pending|approved|rejected|withdrawn)`,
`reviewed_by_user_id fk nullable`, `review_notes`, `created_at`, `reviewed_at`. Approval creates
the `vendors` row and the `owner` `vendor_members` row in one transaction.

**vendor_shipping_rates** — `id`, `vendor_id fk`, `name (e.g. Standard, Express)`,
`country (iso2, nullable — null is the catch-all zone)`, `rate_cents`,
`free_over_cents (nullable)`, `min_delivery_days`, `max_delivery_days`, `active`, `position`,
unique on `(vendor_id, country, name)` **`NULLS NOT DISTINCT`** — without that modifier Postgres
treats every null as unique and a vendor could hold ten conflicting catch-all rates.

Per-vendor shipping is the honest model: each vendor packs and ships its own parcel, so a
three-vendor basket is three shipments and three shipping charges. It is also where the fake
rate table from §2.2 lives — no carrier API, just rows.

**vendor_orders** — the sub-order, and the most important new table.
`id`, `order_id fk`, `vendor_id fk`, `vendor_order_number (unique, e.g. NG-000412-A)`,
`status (pending|paid|fulfilled|cancelled|refunded|partially_refunded)`,
`subtotal_cents`, `shipping_cents`, `tax_cents`, `discount_cents`, `total_cents`,
`commission_bps (snapshot)`, `commission_cents`, `vendor_payout_cents`,
`shipping_rate_snapshot (jsonb)`, `fulfilled_at`, `cancelled_at`, `created_at`, `updated_at`,
unique on `(order_id, vendor_id)`, and a second unique on `(id, order_id)` — see `order_items`
below for why that redundant-looking constraint earns its place.

`commission_bps` is **snapshotted at checkout**, like `unit_price_cents`. Renegotiating a
vendor's rate must not silently restate what you owed them last month.

**shipments** — `id`, `vendor_order_id fk`, `carrier`, `tracking_number`, `tracking_url`,
`status (pending|in_transit|delivered|lost)`, `shipped_at`, `delivered_at`, `created_at`.
A sub-order may ship in more than one parcel; the customer's order detail page shows these
grouped under their vendor.

**vendor_balance_entries** — `id`, `vendor_id fk`, `entry_type (sale|commission|shipping|refund|refund_commission_reversal|transfer|transfer_reversal|adjustment|chargeback)`,
`amount_cents (signed)`, `currency`, `vendor_order_id fk nullable`, `transfer_id fk nullable`,
`reference_id`, `note`, `created_by_user_id fk nullable`, `created_at`.

**Append-only. Never UPDATE, never DELETE.** A vendor's balance is
`SELECT SUM(amount_cents) FROM vendor_balance_entries WHERE vendor_id = $1` — derived, always
reconcilable, and impossible to drift. This is `inventory_ledger` applied to money, and it is the
table a reviewer will most enjoy finding.

**vendor_transfers** — `id`, `vendor_id fk`, `vendor_order_id fk`, `amount_cents`, `currency`,
`status (pending|in_transit|paid|failed|reversed)`, `provider (stripe)`,
`provider_transfer_id (unique, nullable until Stripe accepts it)`,
`idempotency_key (unique, derived from vendor_order_id)`, `failure_reason`, `attempts`,
`available_at`, `created_at`, `completed_at`.

**The unique constraint on `idempotency_key` is your no-double-payout guarantee**, and it is the
exact counterpart of `webhook_events.provider_event_id`. Derive the key from the sub-order id, so
a retried job, a duplicated queue message and a manual re-run all collide on the same row.

**refunds** — `id`, `order_id fk`, `vendor_order_id fk`, `amount_cents`, `shipping_refunded_cents`,
`reason`, `status (pending|succeeded|failed)`, `provider_refund_id (unique)`,
`reverses_transfer (bool)`, `provider_transfer_reversal_id (nullable)`,
`created_by_user_id fk`, `created_at`.

1.1 mentioned refunds in the admin feature list but never modelled them. That was survivable when
a refund was one charge going backwards. It is not survivable now: a refund has to know which
vendor is losing the money, whether that money has already left for their Connect account, and
whether the commission goes back to the vendor with it.

### Existing tables, changed

**addresses** — unchanged. `id`, `user_id fk`, `label`, `line1`, `line2`, `city`, `region`,
`postal_code`, `country (iso2)`, `phone`, `is_default_shipping`, `is_default_billing`

**categories** — unchanged, and deliberately **platform-owned**. Vendors choose from the shared
taxonomy; they do not create categories. Per-vendor taxonomies would make the category facet
meaningless and the PLP cache unshardable.

**products** — **`vendor_id fk not null` added.** `id`, `vendor_id fk`, `slug (unique)`, `title`,
`description`, `brand`, `status (draft|active|archived)`, `category_id fk`,
`search_vector tsvector generated`, `created_at`, `updated_at`.

Keep `slug` **globally** unique rather than unique per vendor. Per-vendor slugs would force
`/p/[vendor]/[slug]` and turn every product URL into two lookups; global slugs keep `/p/[slug]`
and cost you only a collision strategy at creation time (append the vendor slug, then a counter).
Write that down — it is a genuine trade-off and the first thing a reviewer will question.

**product_variants** — **`vendor_id fk not null` added (denormalised from the parent product), and
SKU uniqueness narrowed.** `id`, `product_id fk`, `vendor_id fk`, `sku`, `title`,
`price_cents (int)`, `compare_at_price_cents`, `currency`, `weight_grams`, `option_values (jsonb)`,
`position`, **unique on `(vendor_id, sku)`** — no longer unique on `sku` alone.

Both of those are forced. Two vendors will use the SKU `BLK-01` and neither is wrong, so a global
unique index would reject a legitimate listing. And `vendor_id` is denormalised onto the variant
because the checkout transaction, the stock locks and the payout split all group by vendor from
the *variant* — without it, every one of those paths joins back through `products`. Enforce the
denormalisation rather than trusting it: a composite FK `(product_id, vendor_id)` referencing
`products (id, vendor_id)` makes a mismatched pair unrepresentable.

**product_images** — `id`, `product_id fk`, `variant_id fk nullable`, `storage_key`, `alt`,
`width`, `height`, `blurhash`, `position`

**inventory** — `variant_id pk fk`, `on_hand (int)`, `reserved (int)`, `reorder_point`,
`updated_at`. Available = `on_hand - reserved`. Add `CHECK (on_hand >= 0 AND reserved >= 0)`.

**inventory_ledger** — `id`, `variant_id fk`, `delta (int)`, `reason (enum: restock|sale|refund|adjustment|reservation_expiry)`,
`reference_id`, `created_at`. **Append-only.** Never update. This is how you audit stock bugs.

**carts** — `id (uuid)`, `user_id fk nullable`, `session_token nullable`, `currency`,
`status (active|converted|abandoned)`, `expires_at`, `created_at`, `updated_at`

**cart_items** — `id`, `cart_id fk`, `variant_id fk`, `quantity`, `unit_price_cents (snapshot)`,
unique constraint on `(cart_id, variant_id)`

**orders** — the customer's receipt. **`platform_fee_cents` added; `status` is now derived.**
`id`, `order_number (human readable, e.g. NG-2026-000412)`, `user_id fk nullable`, `email`,
`status (pending|paid|partially_fulfilled|fulfilled|cancelled|partially_refunded|refunded)`,
`subtotal_cents`, `shipping_cents`, `tax_cents`, `discount_cents`, `total_cents`,
`platform_fee_cents`, `currency`, `shipping_address (jsonb snapshot)`,
`billing_address (jsonb snapshot)`, `placed_at`, `created_at`.

The order totals are the **sum of its sub-orders** and must be asserted as such in the checkout
transaction. `status` is a **rollup** of the sub-order statuses, recomputed whenever one changes:
all `fulfilled` → `fulfilled`; some → `partially_fulfilled`; all `cancelled` → `cancelled`. Store
the rollup (the customer's order list would otherwise aggregate on every render) but never let it
be the thing you *decide* from — the sub-order is authoritative.

**order_items** — **now hangs off the sub-order.** `id`, `order_id fk`, `vendor_order_id fk`,
`variant_id fk`, `sku_snapshot`, `title_snapshot`, `vendor_name_snapshot`, `quantity`,
`unit_price_cents`, `total_cents`, with a **composite FK `(order_id, vendor_order_id)` referencing
`vendor_orders (order_id, id)`**.

Carrying both foreign keys is a deliberate denormalisation: the customer's order page wants all
items of an order without a join through sub-orders, and the vendor's picking list wants items of
one sub-order. The composite FK is what makes it safe — it is structurally impossible to attach an
item to a sub-order belonging to a different order, which is the drift you would otherwise be
writing a nightly reconciliation job to catch.

**payments** — unchanged, and note that it **stays at the order level**. `id`, `order_id fk`,
`provider`, `provider_payment_intent_id (unique)`, `amount_cents`, `status`,
`raw_payload (jsonb)`, `created_at`.

One basket is one charge on the customer's statement regardless of how many vendors it touched.
The split happens after the money lands, in `vendor_balance_entries` and `vendor_transfers`.

**webhook_events** — `id`, `provider`, `provider_event_id (unique)`, `type`, `payload (jsonb)`,
`processed_at`, `attempts`. **This table is your idempotency guarantee.**

**discount_codes** — **`vendor_id` and `funded_by` added.** `id`, `code (unique)`,
`vendor_id fk nullable`, `funded_by (platform|vendor)`, `type (percent|fixed|free_shipping)`,
`value`, `min_subtotal_cents`, `max_redemptions`, `redemptions_used`, `starts_at`, `ends_at`,
`active`.

`vendor_id IS NULL` means a platform-wide code funded out of platform commission; a non-null
`vendor_id` means the vendor is funding it and it only applies to their lines. Who pays for the
discount is not a detail — it changes `commission_cents` and therefore what you owe. The
apportionment rule for platform codes is in §8.3, step 6.

**reviews** — **`vendor_id` snapshot and a vendor reply added.** `id`, `product_id fk`,
`vendor_id fk`, `user_id fk`, `order_id fk`, `vendor_order_id fk nullable`, `rating (1-5)`,
`title`, `body`, `status (pending|published|rejected)`, `vendor_response_body (nullable)`,
`vendor_responded_at`, unique on `(user_id, product_id)`.

`vendor_id` is denormalised so the vendor rating aggregate is one indexed scan rather than a join
through `products`. Vendors may reply to a review; they may **not** edit, hide or delete one —
moderation stays with the platform, and that separation is worth stating in the README.

**audit_log** — **`vendor_id` added.** `id`, `actor_user_id`, `vendor_id fk nullable`, `action`,
`entity_type`, `entity_id`, `diff (jsonb)`, `created_at`.

Nullable because platform-admin actions have no vendor. Populated, it does double duty: the
platform sees everything, and a vendor can be shown their own history without you writing a
second table.

### The change list at a glance

Nine new tables, seven altered. If you are estimating the migration, this is the whole surface.

| Table | Change | Why it exists |
|---|---|---|
| `vendors` | **new** | The selling entity: identity, status, commission, Connect account |
| `vendor_members` | **new** | Which humans may act for which vendor, and in what role |
| `vendor_applications` | **new** | Self-serve signup queue and its moderation trail |
| `vendor_shipping_rates` | **new** | Per-vendor flat-rate table; each vendor ships its own parcel |
| `vendor_orders` | **new** | The per-vendor slice of an order — status, totals, commission, payout |
| `shipments` | **new** | Tracking per sub-order; one sub-order may ship in several parcels |
| `vendor_balance_entries` | **new** | Append-only money ledger; the vendor balance is its sum |
| `vendor_transfers` | **new** | Stripe Transfers with an idempotency key — the no-double-payout guard |
| `refunds` | **new** | Was never modelled in 1.1; now needs vendor and transfer-reversal context |
| `products` | `vendor_id` not null | Makes the catalogue multi-tenant |
| `product_variants` | `vendor_id`; SKU unique per vendor | Two vendors may share a SKU string |
| `orders` | `platform_fee_cents`; status is a rollup | Order is now a container for sub-orders |
| `order_items` | moved under `vendor_order_id` | Items belong to the unit of fulfilment |
| `discount_codes` | `vendor_id`, `funded_by` | Who pays for the discount changes what you owe |
| `reviews` | `vendor_id`, vendor reply fields | Vendor rating aggregates and right of reply |
| `audit_log` | `vendor_id` | Lets a vendor see their own trail without a second table |

Unchanged and worth noticing: `carts`, `cart_items`, `inventory`, `inventory_ledger`, `payments`,
`webhook_events`, `addresses`, `categories`, `product_images`. The cart needs no vendor column —
grouping is one hop through `product_variants.vendor_id`, which you denormalised precisely so
this stays cheap. Inventory needs none either: stock hangs off a variant, and the variant already
knows its vendor.

## 5.2 Money rule

**All money is stored as integer minor units (`price_cents`).** Never `float`. Never `double`.
If you must use a decimal type, use `NUMERIC(12,2)`, never `REAL`. Put this in your README as a
design decision — reviewers notice.

**Rates too.** Commission is `commission_bps`, an integer in basis points. A marketplace splits
every order, so rounding is not a rare edge — it happens on every line of every sub-order.
Define the rule once and test it: **commission rounds half-up to the cent, the vendor receives
the remainder**, and `SUM(vendor_payout_cents) + platform_fee_cents` must equal the captured
amount exactly, for every order, with no exceptions and no plug figure.

## 5.3 Required indexes

```sql
-- unchanged from 1.1
CREATE INDEX ON products USING GIN (search_vector);
CREATE INDEX ON products (category_id, status);
CREATE INDEX ON product_variants (product_id);
CREATE INDEX ON orders (user_id, placed_at DESC);
CREATE INDEX ON orders (status, placed_at DESC);
CREATE INDEX ON order_items (order_id);
CREATE INDEX ON cart_items (cart_id);
CREATE INDEX ON inventory_ledger (variant_id, created_at DESC);
CREATE INDEX ON carts (expires_at) WHERE status = 'active';

-- replaces the global SKU index from 1.1
CREATE UNIQUE INDEX ON product_variants (vendor_id, sku);

-- vendor catalogue: every /vendor/products query is scoped and paginated
CREATE INDEX ON products (vendor_id, status, created_at DESC);
CREATE UNIQUE INDEX ON vendors (slug);
CREATE INDEX ON vendors (status);
CREATE INDEX ON vendor_members (user_id);
CREATE INDEX ON vendor_members (vendor_id, role);

-- the vendor order list, the single hottest dashboard query
CREATE INDEX ON vendor_orders (vendor_id, created_at DESC);
CREATE INDEX ON vendor_orders (order_id);
CREATE INDEX ON vendor_orders (vendor_id, status, created_at DESC);
CREATE INDEX ON order_items (vendor_order_id);
CREATE INDEX ON shipments (vendor_order_id);

-- money: balance is a SUM over this, so the vendor_id prefix is load-bearing
CREATE INDEX ON vendor_balance_entries (vendor_id, created_at DESC);
CREATE INDEX ON vendor_balance_entries (vendor_order_id);
CREATE UNIQUE INDEX ON vendor_transfers (idempotency_key);
CREATE INDEX ON vendor_transfers (vendor_id, status);
CREATE INDEX ON refunds (vendor_order_id);

-- the payout sweeper: partial index so it stays small as history grows
CREATE INDEX ON vendor_transfers (available_at)
  WHERE status = 'pending';
CREATE INDEX ON vendor_orders (fulfilled_at)
  WHERE status = 'fulfilled';
```

Two of these deserve a sentence in your write-up. The **partial index on pending transfers** keeps
the payout sweeper's working set proportional to what is owed rather than to everything ever
paid — the same trick as the `carts (expires_at) WHERE status = 'active'` index from 1.1, which
is the point: once you see the pattern you apply it everywhere a job scans for due work. And
**`vendor_balance_entries (vendor_id, created_at DESC)`** is what stops the balance query
degrading as the ledger grows; if a vendor's balance ever needs to be faster than a summation,
add a materialised snapshot row with a `SUM` since the last snapshot — do not add a mutable
balance column (§4, rule 6).

**Acceptance criteria:** `EXPLAIN ANALYZE` shows **Index Scan**, not Seq Scan, with 50,000
products and 100,000 orders seeded, on: the product listing query, the customer order history
query, **the vendor order list for a vendor holding 20,000 sub-orders, and the vendor balance
summation over 200,000 ledger entries**.

## 5.4 The authorization model

Three access axes, and keeping them separate is what stops this becoming a permissions mess:

| Axis | Source of truth | Answers |
|---|---|---|
| Platform role | `user.role` (`customer` \| `admin`) | May they moderate vendors, see every order, issue any refund? |
| Vendor membership | `vendor_members` | Which vendors may they act for, and as `owner`, `manager` or `staff`? |
| Resource ownership | the row's own `vendor_id` / `user_id` | Is *this* sub-order theirs? |

A user can hold any combination. Someone can be a customer with three orders, the `owner` of one
vendor, `staff` at another, and none of that touches `user.role`. The one rule that must never
bend: **`role = 'admin'` is a platform employee, never a vendor.** The moment a vendor holds the
admin role to make a feature work, every cross-vendor guard in the system is void.

Enforce ownership in **one** place — a data-access layer that takes the acting vendor context and
builds the `WHERE vendor_id = $1` itself, so a handler cannot forget. Checking it in the page
component means it holds until the day someone adds a route. Postgres **row-level security** with
a per-request `SET LOCAL app.vendor_id` is the stronger version and a genuinely impressive thing
to have done; if you take that route, write the ADR, because RLS interacts with pgBouncer
transaction pooling in ways you must be able to explain.

Vendor roles: `owner` may manage members, banking and the vendor profile; `manager` may do
everything except members and banking; `staff` may manage catalogue, inventory and fulfilment but
sees no payout figures. Anything a `staff` account can reach must be safe to show a warehouse
temp — that is the test for where the line falls.

**Acceptance criteria:** every vendor-scoped query in the codebase goes through the scoped
data-access layer, verified by a lint rule or a test that greps for raw table access in
`/vendor` handlers, and by integration tests 22 and 23 in §11.3.

---

# 6. Redis: exactly what to cache and how

This is the section most portfolio projects get wrong. "I added Redis" is not a talking point.
"I have a documented cache policy with TTLs, invalidation triggers, and stampede protection" is.

## 6.1 Key namespace

Prefix everything: `cw:` (Cartwright). Version cacheable shapes so a deploy can invalidate a
whole class at once: `cw:v3:product:slug:desk-lamp-pro`.

## 6.2 Cache policy table

| Key pattern | Contents | TTL | Invalidated by |
|---|---|---|---|
| `cw:v{n}:product:{slug}` | Full product detail JSON | 1 h | Product/variant/image update |
| `cw:v{n}:plp:{catId}:{filtersHash}:{page}` | Product listing page results | 5 min | Any product in category changes → bump `cw:v{n}:cat:{id}:gen` |
| `cw:v{n}:cat:tree` | Full category tree | 24 h | Category CRUD |
| `cw:v{n}:price:{variantId}` | Price + compare-at | 10 min | Price change, discount activation |
| `cw:v{n}:stock:{variantId}` | Available quantity | 30 s | Any inventory ledger write |
| `cw:v{n}:reviews:{productId}:agg` | Avg rating + count | 1 h | Review published |
| `cw:v{n}:home:featured` | Home page blocks | 15 min | Admin publishes collection |
| `cw:session:{token}` | Session payload | 7 d sliding | Logout, password change |
| `cw:cart:{cartId}` | Guest cart snapshot | 7 d | Cart mutation (write-through) |
| `cw:v{n}:vendor:{slug}` | Vendor profile + logo + policies | 1 h | Vendor profile update, suspension |
| `cw:v{n}:vendor:{id}:gen` | Vendor generation counter | none | Any product/price change for that vendor |
| `cw:v{n}:vendor:{id}:plp:{filtersHash}:{page}` | Vendor storefront listing | 5 min | Bump `cw:v{n}:vendor:{id}:gen` |
| `cw:v{n}:vendor:{id}:rating` | Avg rating + review count | 1 h | Review published for any of their products |
| `cw:v{n}:ship:{vendorId}:{country}` | Vendor shipping rate table | 6 h | Rate table edit |
| `cw:v{n}:vendor:{id}:balance` | Available balance + pending payout | 60 s | Any ledger write for that vendor |
| `cw:memberships:{userId}` | Vendor ids + roles for this user | 5 min | Membership change, vendor suspension |

Three of these need their reasoning stated, because they are the ones that go wrong.

**The vendor generation counter is not optional.** A product edit must invalidate that product's
key, its *category* listing, and its *vendor* listing — the product now sits in two independent
collections. Without a second counter you are back to scanning for keys, and §6.3 forbids that.
Bump both generations in the same transaction that writes the product.

**`cw:memberships:{userId}` is an authorization cache, so it gets the strictest treatment.** It is
read on every `/vendor` request, which is exactly why it is cached, and it decides what a user may
see, which is exactly why a stale entry is a security bug rather than a rendering bug. Give it a
short TTL, invalidate it explicitly on membership change **and** on vendor suspension, and accept
that you are choosing the same bounded-staleness trade-off as the session cookie cache in §6.5.
Document it in the same ADR. Suspending a vendor must take effect within the TTL, and your test
must assert the bound rather than assume it.

**Never cache a vendor balance for longer than a minute, and never serve it stale after a write.**
It is a number a vendor will reconcile against their bank; a figure that is quietly two minutes
old generates a support ticket you cannot answer.

## 6.3 Non-cache Redis uses (these are the interesting ones)

1. **Rate limiting** — sliding window with `INCR` + `EXPIRE`, or a token bucket in a Lua script.
   Limits: login 5/min/IP, checkout 10/min/user, search 60/min/IP, webhook 100/min.
2. **Distributed lock** — `SET key value NX PX 5000` for "only one worker may reindex," "only one
   process may process this webhook event," and **"only one worker may create the transfer for
   this sub-order"** (`cw:lock:payout:{vendorOrderId}`). Release with a Lua compare-and-delete so
   you never delete someone else's lock. The payout lock is belt and braces — the unique
   `idempotency_key` on `vendor_transfers` is the actual guarantee, and the lock only spares you
   the constraint violation in the logs. Never let a lock be the *only* thing standing between a
   vendor and a double payment; locks expire, constraints do not.
3. **Stock reservation TTL** — when checkout starts, write `cw:reserve:{variantId}:{cartId}` with
   a 15-minute TTL and increment `inventory.reserved`. A keyspace-notification listener (or a
   BullMQ delayed job — more reliable) releases the reservation on expiry.
4. **Job queue backend** — BullMQ lives in Redis. Use a **separate Redis logical DB or instance**
   from the cache so a `FLUSHDB` on the cache never nukes your queue.
5. **Idempotency keys** — `cw:idem:{key}` with the response body, TTL 24 h, so a retried
   `POST /api/checkout` returns the original result instead of charging twice.
6. **Real-time counters** — "12 people are viewing this" via `PFADD` (HyperLogLog) per product
   per minute. Cheap, and a nice demo touch.

## 6.4 The three cache problems you must solve and demonstrate

**Cache stampede (thundering herd).** 10,000 users hit an expired hot product key at once and
all 10,000 queries hit Postgres. Solution: probabilistic early expiry (refresh when
`now > expiry - β·ln(rand())·delta`) **or** a per-key mutex — first requester takes the lock and
recomputes, others serve stale for up to 200 ms. Implement one, write a test that fires 500
concurrent requests at a cold key and asserts the DB was hit **once**.

**Cache penetration.** Requests for `/products/does-not-exist` bypass the cache every time and
hammer the DB. Solution: cache the negative result with a short TTL (60 s), plus optionally a
Bloom filter of valid slugs.

**Cache avalanche.** Everything expires at the same second because you seeded it in one batch.
Solution: jitter every TTL by ±10%.

## 6.5 Better Auth on Redis

Better Auth exposes a `secondaryStorage` interface — three methods, `get`/`set`/`delete`. Implement
it against your Redis client and Better Auth will keep **sessions, rate-limit counters, OTPs and
password-reset tokens** there instead of in Postgres. There is an official
`@better-auth/redis-storage` package, but implement the three methods yourself: it is ten lines,
you control the key prefix, and it becomes something you can explain rather than something you
installed.

```ts
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secondaryStorage: {
    get:    (key)            => redis.get(`cw:auth:${key}`),
    set:    (key, val, ttl)  => ttl
              ? redis.set(`cw:auth:${key}`, val, "EX", ttl)
              : redis.set(`cw:auth:${key}`, val),
    delete: (key)            => redis.del(`cw:auth:${key}`),
  },
  session: {
    storeSessionInDatabase: true,      // keep the row for admin + audit
    preserveSessionInDatabase: true,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  rateLimit: { enabled: true, storage: "secondary-storage", window: 60, max: 100 },
  emailAndPassword: { enabled: true, requireEmailVerification: true },
});
```

**The trade-off you must document.** `cookieCache.maxAge: 5 * 60` means the session is trusted from
a signed cookie for five minutes without any lookup — that is the performance win, and it is why
your login path costs roughly zero database queries under load. It also means **revocation is not
instant**: a revoked session can survive up to five minutes. Write the ADR. Choosing a known,
bounded staleness window on purpose is a senior answer; discovering it in an interview is not.

**Two known sharp edges to test rather than assume.** Better Auth has had issues where sessions are
not cleared from active-session listings on sign-out under secondary storage, and where updating a
user refreshes only the currently-active session while other sessions serve stale data. Keeping
`storeSessionInDatabase: true` gives you a reconcilable source of truth; tests 15 and 16 in Section
11.3 prove the behaviour on your version rather than trusting the changelog.

**Acceptance criteria:** you have a `docs/caching.md` explaining all three cache problems with your
chosen solutions, and integration tests proving stampede protection, negative caching, and session
revocation work.

---

# 7. Page map and wireframes

## 7.1 Route table

| Route | Rendering | Cache | Auth |
|---|---|---|---|
| `/` | RSC, ISR 60 s | Redis home blocks | public |
| `/c/[category]` | RSC, dynamic | Redis PLP key | public |
| `/search?q=` | RSC, dynamic | Meilisearch, no Redis | public |
| `/p/[slug]` | RSC, ISR 300 s | Redis product key | public |
| `/v/[vendor]` | RSC, ISR 300 s | Redis vendor key + vendor PLP | public |
| `/v/[vendor]/about` | RSC, ISR 1 h | Redis vendor key | public |
| `/vendors` | RSC, ISR 1 h | Redis, 1 h | public |
| `/cart` | Client + server actions | none (live stock) | public |
| `/checkout` | Dynamic, no cache | none | public (guest allowed) |
| `/checkout/confirmation/[orderId]` | Dynamic | none | token-scoped |
| `/account` | Dynamic | none | required |
| `/account/orders` | Dynamic | none | required |
| `/account/orders/[id]` | Dynamic | none | required + ownership |
| `/account/addresses` | Dynamic | none | required |
| `/login`, `/register`, `/forgot`, `/reset/[token]` | Static shell | none | anonymous |
| `/sell` | Static | CDN | public (marketing page) |
| `/sell/apply` | Dynamic | none | required |
| `/vendor` | Dynamic | none | vendor member |
| `/vendor/onboarding` | Dynamic | none | vendor member (`owner`) |
| `/vendor/products`, `/vendor/products/[id]` | Dynamic | none | vendor member |
| `/vendor/inventory` | Dynamic | none | vendor member |
| `/vendor/orders`, `/vendor/orders/[id]` | Dynamic | none | vendor member + ownership |
| `/vendor/shipping` | Dynamic | none | vendor member (`owner`\|`manager`) |
| `/vendor/payouts` | Dynamic | none | vendor member (`owner`\|`manager`) |
| `/vendor/reviews` | Dynamic | none | vendor member |
| `/vendor/settings`, `/vendor/members` | Dynamic | none | vendor member (`owner`) |
| `/admin` | Dynamic | none | role=admin |
| `/admin/vendors`, `/admin/vendors/[id]` | Dynamic | none | role=admin |
| `/admin/applications` | Dynamic | none | role=admin |
| `/admin/payouts` | Dynamic | none | role=admin |
| `/admin/products`, `/admin/products/[id]` | Dynamic | none | role=admin |
| `/admin/orders`, `/admin/orders/[id]` | Dynamic | none | role=admin |
| `/admin/inventory` | Dynamic | none | role=admin |
| `/admin/discounts` | Dynamic | none | role=admin |
| `/api/health`, `/api/ready` | Route handler | none | public |
| `/api/webhooks/stripe` | Route handler | none | signature-verified |
| `/api/webhooks/stripe/connect` | Route handler | none | signature-verified |

**Two Stripe webhook endpoints, not one.** Connect account events arrive with a different signing
secret from your platform events. Sharing one handler means one secret, which means you cannot
verify both — and a webhook endpoint that skips verification for "the other kind" of event is a
hole someone will find. Two routes, two secrets, two handlers.

Note that no `/vendor/*` route is cached at the page level, for the same reason no `/admin` route
is: the risk of serving one tenant's dashboard to another is not worth the milliseconds. Cache
*inside* the request (§6.2) where the key is explicitly vendor-scoped.

## 7.2 Wireframes

### Home `/`

```
┌───────────────────────────────────────────────────────────────┐
│ [LOGO]   Shop ▾  New  Sale        [ search…      ]  ♡  👤  🛒3│
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐  │
│  │   HERO  —  headline, subcopy, [Shop the collection]     │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  Shop by category                                             │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                  │
│  │ Desk   │ │ Coffee │ │ Audio  │ │ Light  │                  │
│  └────────┘ └────────┘ └────────┘ └────────┘                  │
│                                                               │
│  Featured                                    [ view all → ]   │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                          │
│  │ img  │ │ img  │ │ img  │ │ img  │                          │
│  │ name │ │ name │ │ name │ │ name │   ← product card:        │
│  │ $ 49 │ │ $ 89 │ │ $129 │ │ $ 25 │     image, title, price, │
│  └──────┘ └──────┘ └──────┘ └──────┘     rating, stock badge  │
│                                                               │
│  [ trust row: free shipping · 30-day returns · secure ]       │
│  FOOTER: about · support · legal · newsletter                 │
└───────────────────────────────────────────────────────────────┘
```

### Category / listing `/c/[category]`

```
┌───────────────────────────────────────────────────────────────┐
│ HEADER                                                        │
├──────────────┬────────────────────────────────────────────────┤
│ FILTERS      │  Desk gear · 128 products     Sort: [Relevance▾]│
│              │                                                │
│ Price        │  ┌──────┐ ┌──────┐ ┌──────┐                    │
│ [──●───●──]  │  │ card │ │ card │ │ card │                    │
│              │  └──────┘ └──────┘ └──────┘                    │
│ Brand        │  ┌──────┐ ┌──────┐ ┌──────┐                    │
│ ☐ Nord (24)  │  │ card │ │ card │ │ card │                    │
│ ☐ Kova (18)  │  └──────┘ └──────┘ └──────┘                    │
│              │                                                │
│ Colour       │  ← facet counts come from Meilisearch          │
│ ☐ Black (40) │                                                │
│ ☐ Walnut(12) │  [ 1 ] 2  3  …  9      or infinite scroll      │
│              │                                                │
│ ☑ In stock   │  URL holds all filter state (shareable, SSR-   │
│ [ Clear all ]│    friendly, and it is your Redis cache key)   │
└──────────────┴────────────────────────────────────────────────┘
```

### Product detail `/p/[slug]`

```
┌───────────────────────────────────────────────────────────────┐
│ HEADER                                                        │
│ Home / Desk gear / Nord Task Lamp                             │
├───────────────────────────┬───────────────────────────────────┤
│  ┌─────────────────────┐  │  Nord Task Lamp                   │
│  │                     │  │  ★★★★☆  4.4 (212 reviews)         │
│  │     MAIN IMAGE      │  │                                   │
│  │   (zoom on hover)   │  │  $89.00   ~~$109.00~~  Save 18%   │
│  │                     │  │                                   │
│  └─────────────────────┘  │  Sold by ⬡ Nord Works  ★4.6 (1.2k)│
│  ┌──┐┌──┐┌──┐┌──┐         │           [ visit shop → ]        │
│  └──┘└──┘└──┘└──┘         │  Colour:  [Black] [Walnut] [White]│
│   thumbnails              │  Size:    [Standard] [Tall]       │
│                           │  ● In stock — 7 left              │
│                           │    (live from Redis, 30 s TTL)    │
│                           │                                   │
│                           │  Qty [ − 1 + ]                    │
│                           │  ┌─────────────────────────────┐  │
│                           │  │      ADD TO CART            │  │
│                           │  └─────────────────────────────┘  │
│                           │  ♡ Save   ⇄ Compare               │
│                           │  🚚 Free delivery over $50        │
├───────────────────────────┴───────────────────────────────────┤
│ [Description] [Specs] [Shipping] [Reviews 212]                │
│  … tabbed content …                                           │
│                                                               │
│ You might also like  ┌────┐┌────┐┌────┐┌────┐                 │
└───────────────────────────────────────────────────────────────┘
```

### Cart `/cart`

```
┌───────────────────────────────────────────────────────────────┐
│ Your cart (3 items from 2 shops)                              │
├────────────────────────────────────┬──────────────────────────┤
│ ⬡ Nord Works                       │  ORDER SUMMARY           │
│ ┌────┐ Nord Task Lamp — Black      │  Nord Works              │
│ │img │ $89.00                      │    Items       $178.00   │
│ └────┘ Qty [ − 2 + ]   Remove      │    Shipping      $0.00   │
│        ⚠ Only 1 left — qty reduced │  Kova Coffee             │
│   Ships free over $50 · 3–5 days   │    Items        $25.00   │
│                                    │    Shipping      $4.99   │
│ ⬡ Kova Coffee                      │  ─────────────────────   │
│ ┌────┐ Kova Grinder                │  Subtotal      $203.00   │
│ │img │ $25.00   Qty [ − 1 + ]      │  Shipping        $4.99   │
│ └────┘                             │  Tax            $16.24   │
│   Ships $4.99 · 2–4 days           │  Discount      −$10.00   │
│                                    │  ─────────────────────   │
│ ← Continue shopping                │  Total         $214.23   │
│                                    │  [ promo code    ][Apply]│
│  Stock is re-validated on every    │  ┌────────────────────┐  │
│  render — never trust the snapshot │  │ CHECKOUT           │  │
│                                    │  └────────────────────┘  │
│  Two shops = two parcels, and the  │  🔒 Secure checkout      │
│  summary says so before checkout   │  One payment, two parcels│
└────────────────────────────────────┴──────────────────────────┘
```

**Say "two parcels" on the cart page, not at the confirmation screen.** A basket that silently
becomes three deliveries arriving on three days is the most common complaint about marketplaces,
and it is a presentation problem you can solve for free. Grouping by vendor here also makes the
per-vendor shipping arithmetic legible instead of looking like an inflated total.

### Checkout `/checkout`

```
┌───────────────────────────────────────────────────────────────┐
│  ● Contact ──── ● Delivery ──── ○ Payment                     │
├────────────────────────────────────┬──────────────────────────┤
│ 1. CONTACT                         │  ORDER SUMMARY  [edit]   │
│    Email [                       ] │  ┌──┐ Lamp ×2   $178.00  │
│    ☐ Email me about my order       │  ┌──┐ Grinder×1  $25.00  │
│                                    │                          │
│ 2. DELIVERY                        │  Subtotal      $203.00   │
│    First [        ] Last [       ] │  Shipping       $14.98   │
│    Address [                     ] │  Tax            $16.24   │
│    City [       ] Post [        ]  │  Discount      −$10.00   │
│    Country [ United Kingdom    ▾]  │  ═════════════════════   │
│    ☐ Save this address             │  Total        $224.22    │
│                                    │                          │
│    Parcel 1 of 2 — ⬡ Nord Works    │  ⏱ Items reserved        │
│    ○ Standard  3–5 days    Free    │     for 14:32            │
│    ● Express   1–2 days    $9.99   │     (Redis TTL, visible!)│
│                                    │                          │
│    Parcel 2 of 2 — ⬡ Kova Coffee   │  Arriving separately:    │
│    ● Standard  2–4 days    $4.99   │   Nord Works   Tue 18th  │
│    ○ Express   next day    $8.99   │   Kova Coffee  Thu 20th  │
│ 3. PAYMENT                         │                          │
│    ┌────────────────────────────┐  │                          │
│    │ Stripe Payment Element     │  │                          │
│    └────────────────────────────┘  │                          │
│    [ PAY $209.24 ]                 │                          │
└────────────────────────────────────┴──────────────────────────┘
```

The visible reservation countdown is a small touch that makes the Redis work *legible* to
anyone reviewing your portfolio. Do it.

### Platform admin dashboard `/admin`

```
┌──────────┬────────────────────────────────────────────────────┐
│ ▣ Overview│  Today                                            │
│ ▤ Orders  │  ┌────────┐┌────────┐┌────────┐┌────────┐         │
│ ▥ Products│  │  GMV   ││ Revenue││ Orders ││ Active │         │
│ ▦ Inventory│ │ $4,210 ││  $421  ││   38   ││vendors │         │
│ ▧ Discounts│ └────────┘└────────┘└────────┘│   26   │         │
│ ⬡ Vendors │   gross     commission          └────────┘        │
│ ⬡ Applic.3│                                                   │
│ 💸 Payouts │  GMV vs commission, last 30 days                  │
│ ▨ Customers│ ┌──────────────────────────────────────────┐     │
│ ⚙ Settings │ │        ╱╲      ╱╲                        │     │
│           │  │   ╱╲  ╱  ╲    ╱  ╲   ╱╲                  │     │
│  ─────    │  │  ╱  ╲╱    ╲╱╲╱    ╲╱╲╱ ╲                 │     │
│  System   │  └──────────────────────────────────────────┘     │
│  ● DB  ok │                                                   │
│  ● Redis  │  Needs attention        Top vendors (30d)         │
│  ● Queue 4│  3 applications         Nord Works   $12,404      │
│  ● Search │  2 payouts failed       Kova Coffee   $8,120      │
│  ● Connect│  1 vendor unverified    Pitch Audio   $6,050      │
│           │                                                   │
│  cache hit│  Pending payouts        Recent orders             │
│    94.2%  │  Held      $18,320      NG-000412  $209  paid     │
│  owed to  │  Due today  $4,110      NG-000411  $ 45  pending  │
│  vendors  │  Failed       $220 ⚠    NG-000410  $312  2 shops  │
│  $22,650  │                                                   │
└──────────┴────────────────────────────────────────────────────┘
```

Note the two headline numbers. **GMV is what customers spent; revenue is your commission** — and
a marketplace dashboard that conflates them is a marketplace dashboard nobody trusts. Show both,
always adjacent, always labelled.

Putting **cache hit rate, queue depth and total owed to vendors in the admin UI** is the single
cheapest way to make a recruiter see the infrastructure work you did.

### Vendor dashboard `/vendor`

```
┌──────────┬────────────────────────────────────────────────────┐
│ ⬡ Nord    │  Your shop                       [ view public → ]│
│   Works  │  ┌────────┐┌────────┐┌────────┐┌────────┐          │
│  ▾ switch │  │ Sales  ││ Orders ││ To ship││ Payout │         │
│           │  │ $1,240 ││   14   ││    6   ││ $1,116 │         │
│ ▣ Overview│  └────────┘└────────┘└────────┘└────────┘          │
│ ▤ Orders 6│   last 7d              ← act on   after 10% fee    │
│ ▥ Products│                          this                     │
│ ▦ Inventory│ Awaiting fulfilment                               │
│ 🚚 Shipping│ ┌──────────────────────────────────────────┐     │
│ 💸 Payouts │ │ NG-000412-A  2 items  Express  [ Ship ]  │     │
│ ★ Reviews │  │ NG-000411-C  1 item   Standard [ Ship ]  │     │
│ 👥 Members│  │ NG-000409-A  3 items  Standard [ Ship ]  │     │
│ ⚙ Settings│  └──────────────────────────────────────────┘     │
│           │                                                   │
│  ─────    │  Payouts                    Low stock (3)         │
│  Balance  │  Mar 14  $842   paid ✓      Lamp/Walnut      2    │
│  Available│  Mar 07  $1,004 paid ✓      Riser/Oak        1    │
│   $1,116  │  Mar 21  $1,116 held        Mat/Black        0    │
│  Pending  │    releases in 2 days       ⚠ hidden from sale    │
│    $310   │                                                   │
│           │  Stripe account: ● verified · payouts enabled     │
└──────────┴────────────────────────────────────────────────────┘
```

Three things this wireframe is deliberately doing. The **shop switcher** at the top left exists
because `vendor_members` allows one person to work for two vendors, and if you do not design for
it on day one you will bolt it on badly later. **"$1,116 after 10% fee"** states the commission on
the number the vendor cares about, in the place they look — hiding the fee until the payout page
is how marketplaces earn distrust. And **`held` with "releases in 2 days"** makes
`payout_hold_days` visible, which turns your escrow logic from an invisible policy into something
the vendor can plan around.

The `staff` role sees this page with the Payouts, Members and Balance panels absent — not
disabled, absent (§5.4).

**Acceptance criteria:** every route in 7.1 exists, is responsive at 375 px / 768 px / 1440 px,
and passes an axe-core accessibility scan with zero critical violations. The vendor dashboard
renders correctly for a user who belongs to two vendors, and the `staff` role sees no payout
figures anywhere in the UI.

---

# 8. Core workflows

## 8.1 Guest browses and adds to cart

```
User → GET /p/desk-lamp
  ├─ RSC checks Redis cw:v1:product:desk-lamp
  │    HIT  → render (target < 50 ms server time)
  │    MISS → acquire per-key lock → query Postgres (product + variants
  │           + images + review agg) → set key TTL 1h ±10% jitter → render
  ├─ Stock badge reads cw:v1:stock:{variantId} (30 s TTL) separately,
  │  so the product cache can be long-lived while stock stays fresh
  └─ Add to cart (server action)
       ├─ No cart cookie → create cart row, set httpOnly cookie (7 d)
       ├─ Validate variant is active and available >= requested qty
       ├─ UPSERT cart_items ON CONFLICT (cart_id, variant_id) DO UPDATE
       ├─ Write-through Redis cart snapshot
       └─ Revalidate the cart badge only (not the whole page)
```

## 8.2 Login and cart merge

```
User logs in
  ├─ Better Auth verifies credentials, writes session to Redis (secondaryStorage)
  ├─ Cart merge:
  │    guest cart exists AND user cart exists
  │      → for each guest item: sum quantities, clamp to available stock
  │      → prefer the user cart's id, mark guest cart 'converted'
  │      → run inside a single transaction, with SELECT … FOR UPDATE on both carts
  │    only guest cart → assign user_id to it
  └─ Delete guest cookie, invalidate cw:cart:{guestId}
```

## 8.3 Checkout and payment (the critical path)

```
POST /api/checkout/start        [idempotency key required]
  1. Group cart items by vendor_id (from product_variants.vendor_id).
     Reject the whole basket if any vendor is not 'approved' or has
     charges_enabled = false — with the offending shop named, so the
     customer can remove those lines rather than guess.
  2. BEGIN TRANSACTION
  3. SELECT variant rows FOR UPDATE across ALL vendors in ONE query,
     ORDER BY variant_id — a single global ordering, never per-vendor
     batches. See the warning below; this is the deadlock trap.
  4. For each item: assert on_hand - reserved >= qty, else 409 with the
     specific item so the UI can show "only 1 left"
  5. UPDATE inventory SET reserved = reserved + qty
  6. INSERT inventory_ledger rows (reason='reservation')
  7. Price the basket, per vendor:
       - subtotal      = Σ line totals for that vendor
       - shipping      = the chosen vendor_shipping_rates row
                         (free_over_cents applies to THAT vendor's
                          subtotal alone, never the basket total)
       - discount      = vendor-funded codes hit only their own lines;
                         a platform code is apportioned pro-rata by
                         vendor subtotal, largest-subtotal vendor
                         absorbs the rounding remainder
       - tax           = static table, applied to the discounted
                         vendor subtotal
       - commission    = round_half_up(discounted subtotal ×
                         commission_bps / 10000); shipping is NOT
                         commissionable
       - vendor_payout = subtotal - discount + shipping - commission
  8. INSERT orders (status='pending')
  9. INSERT vendor_orders, one per vendor, snapshotting commission_bps
     and the shipping rate
 10. INSERT order_items, carrying BOTH order_id and vendor_order_id
 11. ASSERT Σ vendor_orders.total_cents = orders.total_cents  and
            Σ vendor_payout_cents + platform_fee_cents = total_cents
     Fail the transaction on mismatch. Do not "fix up" a difference.
 12. COMMIT
 13. Redis SETEX cw:reserve:{orderId} 900 "1"
 14. Enqueue BullMQ delayed job releaseReservation(orderId) at +15 min
 15. Create ONE Stripe PaymentIntent for the grand total on the platform
     account (amount computed server-side ONLY), with
     transfer_group = order_id and metadata.order_id.
     No transfer_data, no application_fee_amount — this is "separate
     charges and transfers", so nothing is split at charge time.
 16. Return clientSecret + orderId

Browser confirms payment with Stripe.js →  Stripe redirects to
/checkout/confirmation/{orderId}  which polls order status.

POST /api/webhooks/stripe       [the source of truth for "paid"]
  1. Verify signature (raw body! Next.js: export const runtime='nodejs'
     and read req.text(), never req.json() first)
  2. INSERT INTO webhook_events (provider_event_id) ON CONFLICT DO NOTHING
     → 0 rows affected means already processed → return 200 immediately
  3. Acquire Redis lock cw:lock:webhook:{eventId} (5 s, NX)
  4. BEGIN TRANSACTION
       - order.status pending → paid
       - ALL vendor_orders for that order: pending → paid
       - inventory: reserved -= qty, on_hand -= qty
       - ledger rows reason='sale'
       - payments row (one, at order level)
       - discount_codes.redemptions_used += 1 (with a CHECK against max)
       - per vendor_order, INSERT vendor_balance_entries:
           + sale          (+ subtotal - discount)
           + shipping      (+ shipping_cents)
           + commission    (− commission_cents)
         Three signed rows, not one net row: when a vendor disputes a
         figure you want to show them the arithmetic, not a total.
     COMMIT
  5. Enqueue: sendOrderConfirmationEmail (customer, one mail covering
     all shops), sendVendorNewOrderEmail (one per vendor),
     generateInvoicePdf, reindexProduct (stock changed), trackConversion
     — Nodemailer NEVER runs in a request handler. An SMTP handshake is
       2–5 s and would land in your p99. Always a BullMQ job.
  6. Mark webhook_events.processed_at
  7. Invalidate cw:*:stock:* for affected variants and
     cw:v{n}:vendor:{id}:balance for each vendor in the order
  8. Return 200 fast — Stripe retries anything slower than 20 s
```

**Never mark an order paid from the browser redirect.** The redirect is a UX convenience; the
webhook is the truth. Say this in your README.

**Never mark a vendor as owed money outside that same transaction.** The ledger entries in step 4
are part of the atomic unit. An order that is `paid` while a vendor's ledger is missing its sale
row is an accounting bug that no later job can safely repair, because nothing downstream can tell
"never written" apart from "already paid out".

**The deadlock trap, and why multi-vendor makes it worse.** Rule 2 in §10 said to lock variants in
a deterministic order. With one vendor that was easy to get right by accident. With several, the
natural implementation — loop over vendor groups, lock each group's variants — reintroduces
exactly the deadlock the rule exists to prevent: cart A holds Nord's rows and waits for Kova's,
cart B holds Kova's and waits for Nord's. **The ordering must be global across the entire basket**,
computed before any lock is taken. Write the test in §11.3 (test 21) before you write the code.

## 8.4 Reservation expiry

```
BullMQ delayed job fires at T+15min
  ├─ Re-read order. If status != 'pending' → no-op (payment won)
  ├─ Else: transaction → reserved -= qty, ledger reason='reservation_expiry',
  │        order.status = 'cancelled', ALL vendor_orders → 'cancelled'
  └─ Invalidate stock cache, reindex, optionally email "your cart expired"
```

The `status != 'pending'` check is your defence against the race where payment lands at 14:59.9.

Note that an unpaid expiry cancels **every** sub-order together — it is one basket that was never
paid for, so there is no partial case and no ledger entry, because no money ever moved. Partial
cancellation only exists *after* payment, and that path is §8.8, not this one.

## 8.5 A vendor updates a product

```
Vendor saves product
  ├─ Authorize: acting user is a member of the vendor that OWNS this
  │  product. Load the product BY (id, vendor_id) — never load by id
  │  and then compare, which is the IDOR you will otherwise ship.
  ├─ Zod validation → transaction → update product + variants
  ├─ audit_log row with a jsonb diff AND vendor_id
  ├─ Invalidate: cw:v1:product:{slug}, bump cw:v1:cat:{catId}:gen
  │  AND bump cw:v1:vendor:{vendorId}:gen   ← new in 1.2; the product
  │  sits in two collections now, so one bump is not enough
  ├─ Enqueue reindexProduct job → Meilisearch (vendor_id is a facet)
  └─ Enqueue processImages job → Sharp → WebP/AVIF at 5 widths → MinIO
```

Platform admins can perform the same edit, bypassing the membership check but writing
`actor_user_id` with a null `vendor_id`, so the audit trail distinguishes "the vendor changed
their price" from "the platform overrode it". That distinction matters the first time a vendor
asks why their price changed.

## 8.6 Vendor onboarding

```
User submits /sell/apply
  ├─ Zod validation → INSERT vendor_applications (status='pending')
  └─ Enqueue notifyAdminsOfApplication

Admin approves in /admin/applications
  ├─ BEGIN TRANSACTION
  │    - INSERT vendors (status='approved', stripe_account_id=NULL)
  │    - INSERT vendor_members (role='owner', accepted_at=now())
  │    - UPDATE vendor_applications SET status='approved', reviewed_*
  │  COMMIT
  ├─ Invalidate cw:memberships:{userId}
  └─ Enqueue sendVendorWelcomeEmail with an onboarding link

Vendor completes Stripe Connect onboarding at /vendor/onboarding
  ├─ Create a Connect Express account, store stripe_account_id
  ├─ Redirect to a Stripe-hosted AccountLink (KYC lives with Stripe)
  └─ Stripe calls /api/webhooks/stripe/connect  account.updated
       └─ Mirror charges_enabled / payouts_enabled onto the vendor row

Until payouts_enabled:  the vendor may build a catalogue in 'draft'
                        but MAY NOT publish. Selling before you can pay
                        them creates a liability with no way to settle.
```

**Approval and Connect onboarding are separate gates on purpose.** Approval is your editorial
decision; `payouts_enabled` is Stripe's compliance decision. Conflating them means either you
publish shops you cannot pay, or Stripe's KYC queue becomes your moderation queue.

## 8.7 Fulfilment and payout release

```
Vendor clicks "Ship" on /vendor/orders/{id}
  ├─ Authorize by (vendor_order_id, vendor_id) — never by id alone
  ├─ BEGIN TRANSACTION
  │    - INSERT shipments (carrier, tracking_number)
  │    - vendor_orders.status → 'fulfilled', fulfilled_at = now()
  │    - Recompute orders.status rollup
  │        all fulfilled → 'fulfilled'
  │        some         → 'partially_fulfilled'
  │    - INSERT vendor_transfers (status='pending',
  │        amount_cents  = vendor_payout_cents,
  │        available_at  = now() + vendor.payout_hold_days,
  │        idempotency_key = 'vo_' || vendor_order_id)
  │  COMMIT
  └─ Enqueue sendShippingNotification (customer)

Repeatable BullMQ job, every 15 min: releaseVendorPayouts
  ├─ SELECT ... FROM vendor_transfers
  │    WHERE status='pending' AND available_at <= now()
  │    ORDER BY available_at
  │    FOR UPDATE SKIP LOCKED          ← lets N workers share the sweep
  │    LIMIT 100
  ├─ For each: skip if vendor.payouts_enabled = false (leave pending,
  │  it will be picked up when Stripe verifies them)
  ├─ Create the Stripe Transfer to vendor.stripe_account_id, passing
  │  BOTH the Stripe-Idempotency-Key header AND our own key, with
  │  transfer_group = order_id
  ├─ On success: status='in_transit', provider_transfer_id stored,
  │  INSERT vendor_balance_entries (entry_type='transfer', NEGATIVE
  │  amount — the money has left the balance)
  └─ On failure: attempts += 1, failure_reason, exponential backoff;
     after 5 attempts park in the DLQ and alert. NEVER auto-retry a
     transfer without the idempotency key — that is how a marketplace
     pays a vendor twice.
```

**Why the hold period, and why release on fulfilment rather than on payment.** Paying at payment
time means every refund becomes a clawback from a vendor who has already been paid, and clawbacks
either fail or make you the creditor. Releasing at fulfilment plus a short hold puts the money
movement *after* the vendor has done the thing they are being paid for, and gives the refund
window somewhere to live. `FOR UPDATE SKIP LOCKED` is what lets you scale the sweeper to several
workers without two of them grabbing the same transfer — worth a line in your write-up, since it
is the same primitive a real payments team reaches for.

## 8.8 Refunds and partial cancellation

```
Refund issued (by the vendor, or by an admin on their behalf)
  ├─ Authorize; determine the transfer state for that vendor_order
  ├─ BEGIN TRANSACTION
  │    - INSERT refunds (amount_cents, reason, status='pending')
  │    - vendor_orders.status → 'refunded' | 'partially_refunded'
  │    - Recompute orders.status rollup
  │    - Restock: inventory.on_hand += qty,
  │      inventory_ledger reason='refund'
  │    - vendor_balance_entries:
  │        − refund                      (vendor loses the sale)
  │        + refund_commission_reversal  (platform returns its cut,
  │                                       pro-rata for a partial)
  │  COMMIT
  └─ Enqueue processRefund:
       ├─ Stripe Refund against the ORIGINAL PaymentIntent
       │  (the customer is refunded by the platform, one charge)
       └─ If a transfer already went out for this sub-order:
            create a Transfer Reversal for the vendor's share, and
            INSERT vendor_balance_entries (entry_type=
            'transfer_reversal', POSITIVE — the reversal returns
            the money to the balance the refund just debited)
          Else: no reversal needed; the pending transfer is simply
            recomputed or cancelled before it ever leaves.
```

**A vendor's balance may legitimately go negative** — a refund on an already-transferred order and
no subsequent sales leaves them owing you. Model it (the ledger sums to a negative number, and
that is a valid state), show it in the dashboard, and net it against their next sale rather than
attempting to pull money back out of their bank account. Refusing to allow negative balances
sounds safer and is actually how you end up with a plug figure and an unreconcilable ledger.

**The partial case you must handle:** one vendor in a three-vendor order cancels after payment
because they oversold. The customer keeps the other two sub-orders, gets a partial refund for the
third, the order rolls up to `partially_refunded`, and only that vendor's ledger and transfer are
touched. If your refund path can only refund an entire order, you have built a shop with a vendor
column, not a marketplace.

**Acceptance criteria:** each of 8.1–8.8 has at least one integration test and one E2E test, and
for every order in a 1,000-order seeded fixture,
`SUM(vendor_balance_entries.amount_cents) + platform_fee_cents + refunded_cents` reconciles to the
net captured amount. Ship a `make reconcile` target that asserts this across the whole database
and exits non-zero on a single cent of drift.

---

# 9. API surface

Public routes are Route Handlers under `/api`. Prefer **Server Actions** for form mutations from
your own UI and Route Handlers for anything a machine calls (webhooks, health, admin scripts).

```
GET    /api/health                 → { status, version, uptime }        (liveness)
GET    /api/ready                  → checks db + redis + search         (readiness)
GET    /api/products?cursor=&limit=&category=&vendor=&sort=
GET    /api/products/{slug}
GET    /api/vendors?cursor=&limit=
GET    /api/vendors/{slug}
GET    /api/vendors/{slug}/products?cursor=&limit=
GET    /api/search?q=&facets=      → facets now include vendor
POST   /api/cart/items             { variantId, qty }
PATCH  /api/cart/items/{id}        { qty }
DELETE /api/cart/items/{id}
POST   /api/cart/discount          { code }
GET    /api/cart/shipping          → per-vendor rate options for a country
POST   /api/checkout/start         [Idempotency-Key header required]
                                   { shippingByVendor: { vendorId: rateId } }
GET    /api/orders/{id}            [owner or admin]
POST   /api/webhooks/stripe        [signature verified]
POST   /api/webhooks/stripe/connect [signature verified, separate secret]
GET    /api/metrics                → Prometheus text format [internal only]

--- vendor-scoped; every one resolves the acting vendor from the session
--- and the membership table, NEVER from a client-supplied vendor id ---
GET    /api/vendor/orders?status=&cursor=
GET    /api/vendor/orders/{id}
POST   /api/vendor/orders/{id}/ship        { carrier, trackingNumber }
POST   /api/vendor/orders/{id}/refund      { amountCents, reason }
GET    /api/vendor/payouts?cursor=
GET    /api/vendor/balance                 → available, pending, held
POST   /api/vendor/onboarding/link         → Stripe AccountLink URL
GET    /api/vendor/products?cursor=
POST   /api/vendor/products
PATCH  /api/vendor/products/{id}
PATCH  /api/vendor/inventory/{variantId}   { onHand, reason }

--- platform admin ---
GET    /api/admin/applications
POST   /api/admin/applications/{id}/approve | /reject
PATCH  /api/admin/vendors/{id}             { status, commissionBps }
GET    /api/admin/payouts?status=
POST   /api/admin/payouts/{id}/retry
```

**The one rule that matters most here: a vendor id is never an input.** Not a path segment, not a
query parameter, not a body field. Every `/api/vendor/*` handler derives it from the session's
membership, because the moment a vendor id is client-supplied, every endpoint becomes an IDOR
waiting for someone to change a number. The only exception is the shop switcher, which sends a
vendor id that is validated against the caller's memberships before anything else happens —
one validation point, not thirty.

`POST /api/vendor/orders/{id}/refund` is the interesting endpoint to get right: it is a money
mutation, initiated by a semi-trusted party, that may need to reverse a completed transfer. Rate
limit it, require re-authentication for amounts over a threshold, and log every attempt to
`audit_log` whether it succeeds or not.

**Rules for every endpoint:** Zod-validated input; a typed error envelope
`{ error: { code, message, details? } }`; correct status codes (409 for stock conflicts, 422 for
validation, 429 for rate limit with `Retry-After`, **404 rather than 403 when a vendor requests
another vendor's resource** — do not confirm that the row exists); a request-id header echoed into
logs; cursor pagination, never `OFFSET` on large tables.

---

# 10. Problems you will hit at scale (and the expected answers)

These are your interview talking points. Solve each one **and write it up** in `docs/`.

| # | Problem | Why it happens | Required solution |
|---|---|---|---|
| 1 | **Overselling** | Two users buy the last unit simultaneously; a read-then-write check has a gap | `SELECT … FOR UPDATE` on the variant row inside a transaction, or an atomic `UPDATE … WHERE on_hand - reserved >= qty` and check affected rows |
| 2 | **Deadlocks on multi-item orders** | Cart A locks variant 5 then 9, cart B locks 9 then 5 | Always lock in a deterministic order (`ORDER BY variant_id`); set `lock_timeout`; retry on `40P01` |
| 3 | **Double charging / duplicate orders** | User double-clicks Pay; Stripe retries webhooks | Idempotency keys in Redis for requests, `webhook_events` unique constraint for webhooks |
| 4 | **Cache stampede** | A hot key expires under load | Per-key lock + serve-stale, or probabilistic early recomputation |
| 5 | **Cache invalidation misses** | Price updated but PLP still shows old price | Generation counters per category + short TTLs on price keys; never `KEYS *` — it blocks Redis |
| 6 | **DB connection exhaustion** | Each of N containers opens a pool; serverless-style bursts open thousands | pgBouncer in transaction mode; cap pool at `max = (max_connections − reserve) / instances`; document the maths |
| 7 | **N+1 queries** | Rendering 48 product cards fires 48 image queries | Batch with `IN`, use joins or DataLoader; add a test that counts queries per render and fails over a threshold |
| 8 | **Slow queries as data grows** | Seq scans at 500k rows | Seed realistically (500k products, 1M order items), `EXPLAIN ANALYZE` everything, `pg_stat_statements`, index deliberately |
| 9 | **Hot key in Redis** | One viral product; a single Redis shard saturates | Local in-process LRU in front of Redis for ultra-hot keys (accepting a few seconds of staleness), or key sharding |
| 10 | **Session invalidation** | Password changed but old JWTs still valid | DB/Redis session store with a revocation list; short access token + refresh rotation |
| 11 | **Image bandwidth** | Original 4 MB JPEGs served to phones | Worker resizes to AVIF/WebP at 5 widths; `next/image` with `sizes`; long `Cache-Control` + content-hashed keys; CDN in front |
| 12 | **Search relevance and drift** | `LIKE '%x%'` cannot rank or handle typos; index falls behind DB | Meilisearch with typo tolerance + facets; reindex jobs on write; a nightly full reconcile job |
| 13 | **Queue backpressure** | Traffic spike floods the worker; jobs pile up | Concurrency limits, rate-limited queues, dead-letter queue, exponential backoff, alert on depth > 1000 |
| 14 | **Zero-downtime migrations** | `ALTER TABLE` locks a hot table during deploy | Expand/contract pattern: add nullable column → backfill in batches → dual-write → switch reads → drop old. Never rename in one step |
| 15 | **Abandoned carts holding stock** | Reservations never released | TTL + delayed job, with a nightly sweeper as a safety net for jobs lost to a Redis restart (use AOF persistence) |
| 16 | **Thundering herd on deploy** | New containers start with empty caches, all miss at once | Cache warming job on boot for top-N products; staggered rollout |
| 17 | **Race between webhook and expiry job** | Both mutate the same order at 15:00 | Row lock on the order + status guard; both paths are idempotent |
| 18 | **Timezone and money bugs** | Floats and local times | Integers for money, `timestamptz` everywhere, store UTC, format at render |
| 19 | **Bot traffic on search/login** | Credential stuffing, scraping | Redis rate limits per IP and per account, exponential lockout, CAPTCHA on the 3rd failure |
| 20 | **Observability gaps** | "Checkout is slow" with no data | OTel spans across web → queue → db, request ids in every log line, RED metrics dashboards |
| 21 | **Cross-vendor deadlock** | A basket spanning two vendors is locked vendor-group by vendor-group, so two baskets grab the same pair in opposite orders | One global `ORDER BY variant_id` across the entire basket before any lock (§8.3). The per-vendor loop is the intuitive implementation and it is wrong |
| 22 | **Double payout** | A transfer job is retried after a timeout that actually succeeded | `idempotency_key` unique on `vendor_transfers` **and** Stripe's idempotency header. The DB constraint is the guarantee; the header is the optimisation |
| 23 | **Split-payment rounding drift** | Commission on each of N sub-orders rounds independently and the parts no longer sum to the charge | One documented rounding rule (half-up, vendor keeps the remainder) and an in-transaction assertion that the split reconciles to the cent (§8.3 step 11) |
| 24 | **Cross-tenant data leak** | A `/vendor` query filters in the page instead of the query; someone adds a route and forgets | Scoped data-access layer, or Postgres RLS with `SET LOCAL app.vendor_id`; 404 not 403; a test that enumerates every vendor route as the wrong vendor (§11.3, test 22) |
| 25 | **Refund after transfer** | The vendor has already been paid when the customer is refunded | Hold period before release (§8.7), Transfer Reversals, and a ledger that tolerates a negative balance instead of failing the refund |
| 26 | **Noisy-neighbour vendor** | One vendor bulk-imports 50,000 products and starves the reindex queue for everyone | Per-vendor rate limits on write endpoints, a separate lower-priority BullMQ queue for bulk imports, and fair-share concurrency so one tenant cannot monopolise the workers |

**Acceptance criteria:** `docs/scaling-challenges.md` covers at least 15 of these, each with the
problem, your solution, and the trade-off you accepted — and **must** include 21 through 26, which
are the ones specific to running a marketplace rather than a shop. This document is arguably worth
more to your portfolio than the code.

---

# 11. Testing requirements

## 11.1 The pyramid and the targets

| Level | Tool | Count target | Runtime budget | Gate |
|---|---|---|---|---|
| Unit | Vitest | 180+ | < 30 s | 85% coverage on `lib/`, **100% on pricing/tax/discount/commission/payout** |
| Integration | Vitest + Testcontainers (real PG + Redis) | 75+ | < 5 min | all critical paths |
| Component | React Testing Library | 50+ | < 60 s | all interactive components |
| E2E | Playwright (chromium + webkit + mobile) | 30+ | < 10 min | happy paths + 6 failure paths + the vendor journey |
| Load | k6 | 5 scenarios | ~20 min | thresholds must pass |
| Accessibility | axe-core in Playwright | every page | — | zero critical |
| Visual regression | Playwright snapshots | 12 pages | — | manual approval |
| Security | Trivy + `npm audit` + ZAP baseline | every PR | — | zero critical CVEs |

## 11.2 Unit tests — what must be covered

Pricing engine: line totals, multi-quantity, percentage vs fixed discounts, discount stacking
rules, free-shipping thresholds, rounding (always test `33.33 × 3`), tax on discounted subtotal,
currency formatting. Cart quantity clamping. Slug generation and collisions. Order number
generation. Cache key builders. Rate-limit window maths (use fake timers). Zod schema edge cases:
empty strings, negative quantities, 10^9 quantities, unicode names, SQL-injection-shaped strings,
emails with `+`.

**New in 1.2, and this is where 100% coverage is non-negotiable.** The commission calculator at
every basis-point value including 0 and 10000. Payout arithmetic with and without commissionable
shipping. The pro-rata apportionment of a platform discount across two, three and seven vendors,
including the case where the remainder cannot divide evenly and one vendor must absorb it — assert
*which* vendor, so the rule is pinned rather than incidental. Per-vendor free-shipping thresholds
where the basket total clears the bar but no individual vendor's subtotal does (a customer will
find this within a week of launch and consider it a bug unless your UI explains it). Sub-order
number derivation. Vendor slug generation and collision. The order status rollup function across
every combination of sub-order states, including the empty and single-vendor cases.

## 11.3 Integration tests — non-negotiable list

Spin real Postgres and Redis with Testcontainers. **No mocking the database.**

1. Concurrent purchase of the last unit: run 50 parallel checkout starts on stock of 1 →
   exactly 1 succeeds, 49 return 409, final `on_hand` is correct, ledger sums to zero drift.
2. Cache stampede: 500 concurrent requests to a cold product key → DB queried exactly once.
3. Negative caching: request a non-existent slug twice → second request does not touch the DB.
4. Webhook idempotency: post the same Stripe event 10 times, some concurrently → one order
   transition, one email job, one ledger entry.
5. Reservation expiry: fast-forward the delayed job → stock returns, order cancelled.
6. Expiry vs payment race: fire both simultaneously → order ends `paid`, stock correct.
7. Cart merge on login with overlapping items and insufficient stock.
8. Discount code at `max_redemptions`: 20 concurrent applications → exactly N succeed.
9. Rate limiter: 6 logins in 60 s → 6th returns 429 with `Retry-After`.
10. Ownership: user A requests user B's order → 404 (not 403; do not leak existence).
11. Migration test: run all migrations up, then down, then up on an empty DB.
12. Query-count assertion: rendering a 48-card PLP issues ≤ 4 queries.
13. Redis outage: kill the Redis container mid-test → the app degrades to DB reads and still
    serves pages. **This one impresses people.**
14. Transaction rollback: force an error at step 6 of checkout → no partial order, no leaked
    reservation.
15. **Session revocation:** log in on two clients, change the password on one → the other is
    rejected on its next request after the cookie-cache window expires. Assert the exact latency
    so a regression in Better Auth shows up as a failing test, not a security incident.
16. **Cross-session staleness:** promote a user to admin while a second session is active →
    the second session sees `role=admin` within the cookie-cache TTL and not before.

New in 1.2 — the marketplace list. These nine are the ones that justify the pivot; if you write
no other new tests, write these.

17. **Multi-vendor split arithmetic:** a three-vendor basket with a platform percentage discount
    and one vendor-funded code → each `vendor_orders.total_cents` is correct, the sub-orders sum
    to `orders.total_cents`, and `Σ vendor_payout_cents + platform_fee_cents` equals the captured
    amount **exactly**. Run it over 10,000 generated baskets with awkward numbers (prices ending
    in 99, 3-way splits of odd cents, 33% discounts) and assert zero drift. This is the money
    test; property-based generation earns its keep here.
18. **Payout idempotency:** invoke the transfer job for one sub-order 10 times, some
    concurrently, with the Stripe client stubbed to be slow → exactly one `vendor_transfers` row
    reaches `in_transit`, exactly one ledger `transfer` entry exists.
19. **Refund after transfer:** fulfil, release the payout, then refund → a Transfer Reversal is
    created, the ledger nets correctly, and the vendor balance is allowed to go negative rather
    than the refund failing.
20. **Partial vendor cancellation:** a three-vendor paid order where one vendor cancels → that
    vendor's stock is restored and their sub-order is `cancelled`, the other two are untouched,
    the order rolls up to `partially_refunded`, and the customer is refunded exactly that
    vendor's share including their shipping.
21. **Cross-vendor deadlock:** 50 concurrent checkouts on two baskets that touch the same two
    vendors' variants in opposite input order → zero `40P01` deadlock errors, all reservations
    consistent. Deliberately shuffle the cart item order in the test; a fixed order passes by
    accident and proves nothing.
22. **Tenant isolation, exhaustively:** for **every** route under `/vendor` and `/api/vendor`,
    authenticate as vendor B and request vendor A's resource id → 404 every time, and no row
    from A appears in any list response. Enumerate the routes from the router rather than
    hand-listing them, so a new route added later fails this test until it is scoped.
23. **Membership cache staleness:** suspend a vendor while one of its members has an active
    session → the member loses dashboard access within the `cw:memberships` TTL and not after.
    Assert the bound, exactly as test 15 does for sessions.
24. **Vendor cannot sell before Stripe is ready:** a vendor with `payouts_enabled = false`
    cannot publish a product, and a basket containing a suspended vendor's item is rejected at
    checkout start with that vendor named.
25. **Ledger reconciliation:** across a seeded 1,000-order dataset with refunds and reversals
    mixed in, the sum of every vendor's ledger plus platform fees plus refunds equals the net
    captured amount. This is `make reconcile` from §8.8, run as a test.

## 11.4 E2E tests (Playwright)

Happy paths: guest browse → filter → PDP → add to cart → guest checkout with Stripe test card
`4242…` → confirmation → order visible via email link. Register → verify email (via Mailpit API)
→ login → add to cart → apply discount → pay → order appears in `/account/orders`. Admin login →
create product with image upload → verify it appears in search within 5 s → adjust stock → verify
the storefront badge updates.

**The marketplace journey, end to end, as one test.** Apply to sell → admin approves → complete
Stripe Connect onboarding (test mode) → publish a product → a customer adds it *alongside another
vendor's product* → one payment → both vendors see their own sub-order and neither sees the
other's → each ships → the customer's order page shows two shipments with two tracking numbers →
payouts appear as held, then released after the hold → one vendor refunds → the reversal shows in
their ledger. This single test is the clearest possible demonstration that the pivot is real and
not a `vendor_id` column, so make it the one you screenshot.

Add a vendor-scoped browse: `/v/nord-works` lists only that vendor's products, and the vendor
facet on `/search` narrows correctly.

Failure paths: card declined (`4000 0000 0000 0002`) → order stays pending, stock released;
3D Secure required (`4000 0025 0000 3155`) → challenge completes; item goes out of stock while in
cart → clear message at checkout, not a 500; network offline mid-checkout → no duplicate order on
retry; session expires mid-checkout → guest fallback, cart preserved; discount expires between
apply and pay → recalculated with an explanation.

Requirements: run against the **Docker Compose stack**, not `next dev`. Seed a deterministic
fixture DB per run. Use `data-testid` attributes. Record video and trace on failure. Run
chromium + webkit + `Pixel 5` viewport.

## 11.5 Load testing (k6) — where the "10,000 users" claim is earned

Five scenarios:

1. **Smoke** — 5 VUs, 2 min. Everything works at all.
2. **Browse-heavy (realistic mix)** — ramp 0 → 2,000 VUs over 10 min. Traffic mix: 70% PLP/PDP
   reads, 20% search, 8% cart ops, 2% checkout.
3. **Spike / flash sale** — jump 100 → 5,000 VUs in 30 s on a single hot product. This is your
   stampede and hot-key test.
4. **Soak** — 500 VUs for 2 hours. Watch for memory leaks, connection leaks, growing queue depth.
5. **Stress to failure** — ramp until error rate > 5%. **Record the breaking point.** Knowing
   your ceiling is more credible than claiming you have none.
6. **Vendor dashboard under load** — 200 vendor sessions polling their order lists and balances
   while scenario 2 runs underneath. Marketplaces have two populations, and the second one hits
   uncacheable, tenant-scoped, per-request queries. If your vendor order list degrades while the
   storefront looks fine, you want to find that here rather than from a vendor.
7. **Skewed tenants** — 80% of orders directed at 3 of the 8 vendors. Real marketplaces are
   power-law distributed, a uniform fixture hides hot-partition problems, and the vendor
   generation counter for a hot vendor is exactly the kind of key that becomes a bottleneck.

Thresholds that must pass in scenario 2:

```js
thresholds: {
  'http_req_duration{name:PDP}':    ['p(95)<300', 'p(99)<800'],
  'http_req_duration{name:PLP}':    ['p(95)<400'],
  'http_req_duration{name:search}': ['p(95)<500'],
  'http_req_duration{name:cart}':   ['p(95)<600'],
  'http_req_duration{name:vendorOrders}': ['p(95)<700'],
  'http_req_failed':                ['rate<0.01'],
  'checks':                         ['rate>0.99'],
  'oversell_detected':              ['count==0'],   // custom metric
  'split_mismatch':                 ['count==0'],   // payout arithmetic
  'cross_tenant_leak':              ['count==0'],   // must be zero, always
}
```

`cross_tenant_leak` is a check inside the vendor scenario that asserts every returned sub-order
belongs to the acting vendor. It should be structurally impossible to trip given §5.4, which is
precisely why it belongs in the load test: concurrency and connection reuse are how "impossible"
becomes "occasionally", especially if you went the RLS route with pooled connections.

Also record: cache hit ratio (target > 90% on PDP under load), Postgres connections used,
Redis ops/sec and memory, queue depth over time, CPU/memory per container, **and payout job
throughput and lag** (how long a released transfer waits before the sweeper picks it up).

**Honesty rule:** "10,000 concurrent users" means concurrent *virtual users in your test*, on
your stated hardware, with your stated traffic mix. Write the hardware, the mix, and the results
in the README, and link the k6 HTML report. Then the claim is defensible in an interview instead
of embarrassing.

## 11.6 CI gates

Every PR must pass: `tsc --noEmit`, ESLint with zero warnings, Prettier check, unit + integration
tests, Playwright E2E against a compose stack, `docker build` success, Trivy scan (zero
critical/high), a bundle-size budget check, **`make reconcile` against the seeded fixture, and the
tenant-isolation test (§11.3, test 22)**. Merge is blocked otherwise. Nightly: full k6 browse
scenario + soak on a schedule.

The last two are gates rather than nightlies on purpose. A cross-tenant leak and a ledger that
does not balance are the two defects in this system that are unacceptable to merge and expensive
to discover later — everything else can be fixed forward.

**Acceptance criteria:** a green CI badge, a coverage badge, and `docs/load-test-report.md` with
graphs, in the repository root.

---

# 12. Docker requirements

## 12.1 Multi-stage Dockerfile for Next.js

```dockerfile
# ---- deps ----
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# ---- builder ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && pnpm build      # requires output: 'standalone'

# ---- runner ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
```

Requirements: `next.config.js` sets `output: 'standalone'`; final image **under 200 MB**; runs as
**non-root**; a `.dockerignore` excluding `node_modules`, `.next`, `.git`, `*.md`, tests;
BuildKit cache mounts so rebuilds are under 60 s; build args for `NEXT_PUBLIC_*` (they are baked
at build time — know this and say it); a separate lighter `Dockerfile.worker` for BullMQ.

## 12.2 Compose services

`web` (scalable), `worker` (BullMQ, no exposed port), `postgres` (16-alpine, named volume,
`pg_isready` healthcheck), `redis` (7-alpine, AOF `appendonly yes`, `maxmemory-policy
allkeys-lru` for cache instance, separate instance/DB for queue with **no** eviction),
`meilisearch`, `minio`, `mailpit`, `nginx`, plus `prometheus` + `grafana` + `jaeger` in an
optional `observability` profile.

Requirements: `depends_on` with `condition: service_healthy` — not just `depends_on`; a one-shot
`migrate` service that runs migrations and exits before `web` starts; `.env.example` documenting
every variable; separate `docker-compose.yml`, `docker-compose.dev.yml` (bind mounts + hot
reload), and `docker-compose.prod.yml` (no mounts, replicas, resource limits); resource limits on
every service so you can demonstrate behaviour under constraint; a named network, and databases
**not** exposed to the host in the prod file.

## 12.3 Postgres as a container — the details that matter

Postgres runs as a container in **every environment except the public demo**:

| Environment | Postgres | Why |
|---|---|---|
| Local dev | Docker container + named volume | Fast, offline, full control of `postgres.conf` |
| CI integration tests | Testcontainers (throwaway per run) | Isolation; 50-way concurrency tests cannot share a DB |
| Load testing on the VPS | Docker container | Numbers measure your code, not internet latency |
| Public hosted demo | Managed (Neon) or a container | Free, always available, nothing to back up |

The application never knows the difference. It reads `DATABASE_URL`; that is the entire abstraction.

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: cartwright
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: cartwright
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cartwright -d cartwright"]
      interval: 5s
      timeout: 3s
      retries: 10
    ports:
      - "5432:5432"        # dev only — DELETE in docker-compose.prod.yml

  migrate:
    build: .
    command: pnpm drizzle-kit migrate
    depends_on:
      postgres: { condition: service_healthy }
    restart: "no"          # one-shot: runs, exits 0, then web starts

  web:
    depends_on:
      migrate:  { condition: service_completed_successfully }
      redis:    { condition: service_healthy }

volumes:
  pgdata:
```

**Three rules, each of which is a real failure if broken.**

1. **The named volume is not optional.** Without `pgdata:/var/lib/postgresql/data` the database
   lives in the container's writable layer and `docker compose down` destroys it. This — not
   containers themselves — is what people mean when they say "never run a database in Docker."
2. **Wait for `service_healthy`, not for the container to exist.** Postgres accepts TCP connections
   a second or two before it can serve queries. Plain `depends_on` will race and your app will
   crash-loop on first boot.
3. **Remove the host port mapping in production.** `web` and `worker` reach Postgres over the
   internal Docker network under the hostname `postgres`. Nothing outside the network needs 5432,
   and an exposed 5432 on a public VPS is scanned within hours.

**Hostname gotcha:** inside the Docker network the host is the *service name* — `postgres:5432`.
From your laptop it is `localhost:5432`, and only because of that dev-only port mapping. Confusing
the two is the most common first-day Compose error.

**Is a container acceptable for real production?** With a volume, backups, and a tested restore:
yes. The container adds no meaningful I/O overhead — it is the same process with namespaces around
it. The line is drawn at automated failover, point-in-time recovery, streaming replicas, and
someone else being paged at 3 a.m. Knowing where that line sits is worth a paragraph in your ADR.

## 12.4 Operational requirements

- `make up`, `make down`, `make seed`, `make test`, `make load`, `make logs`, **`make reconcile`**
  (§8.8 — asserts the money adds up and exits non-zero on any drift) — a Makefile so a reviewer
  can run your project in one command.
- Graceful shutdown: handle `SIGTERM`, stop accepting connections, finish in-flight requests,
  close pools. Worker must finish or requeue its current job.
- Backup script: `pg_dump` to a volume on a cron container, plus a documented restore procedure
  you have **actually tested once**.
- Logs to stdout as JSON. No log files in containers.
- Image tagged with git SHA and semver; pushed to GHCR by CI.

**Acceptance criteria:** a fresh clone on a machine with only Docker installed runs
`cp .env.example .env && make up && make seed` and reaches a working storefront with data in
under 5 minutes. Test this on a clean machine or VM — not the one you built it on.

---

# 13. Observability and proof

Health: `/api/health` (process alive) and `/api/ready` (dependencies reachable) — different
endpoints, different purposes; explain why in the README.

Metrics to expose: `http_request_duration_seconds` (histogram, by route and status),
`cache_hits_total` / `cache_misses_total` (by key class), `checkout_started_total`,
`checkout_completed_total`, `oversell_attempts_total`, `queue_depth`, `job_duration_seconds`,
`db_pool_active`. New in 1.2: `payout_transfers_total` (by status), `payout_release_lag_seconds`,
`vendor_balance_cents` (gauge, by vendor — the total you owe), `commission_cents_total`,
`split_mismatch_total`, and `cross_tenant_denied_total`. Grafana dashboards for RED metrics, cache
effectiveness, queue health, a business panel, and a **marketplace panel** showing GMV against
commission, payouts held versus released, and the count of vendors blocked on Connect onboarding.

Alerts (even if they only log): error rate > 1% for 5 min, p95 latency > 1 s, queue depth > 1000,
cache hit rate < 70%, DB connections > 80% of pool, any oversell attempt at all, **any split
mismatch at all, any transfer that has failed 3 times, any payout pending more than 24 hours past
its `available_at`, and any cross-tenant denial** — the last one should never fire, so if it does
you want to know within the minute rather than in a quarterly review.

Tracing: one trace spanning HTTP request → cache lookup → DB query → job enqueue → job execution.
Screenshot this in your README; it is one of the most convincing images you can put there.

---

# 14. Security requirements

Argon2id password hashing with sensible parameters. Email verification required before checkout
as a registered user. HttpOnly, Secure, SameSite=Lax cookies. CSRF protection on all mutations.
Zod validation on **every** input, including headers and webhook payloads. Parameterised queries
only — no string-built SQL anywhere. Content Security Policy with a nonce, plus HSTS,
X-Frame-Options, X-Content-Type-Options. Rate limits on auth, checkout, search, and password
reset. Secrets via environment variables and Docker secrets, never committed; `.env` in
`.gitignore`; a `git-secrets` or `gitleaks` CI check. Amounts always recomputed server-side —
never trust a price sent by the client. Signed, expiring URLs for invoice downloads. Admin routes
protected by middleware **and** re-checked in each handler (defence in depth). PII minimisation:
no full card data ever touches your server — Stripe Elements only.

**Multi-tenancy is a security requirement, not a feature.** Adding semi-trusted third parties with
their own logins changes the threat model, and these follow from it:

- **Tenant scoping is enforced at the data layer**, once, not per route (§5.4). Middleware plus a
  per-handler re-check is defence in depth for admin; for vendors it is not enough, because the
  failure is a forgotten `WHERE` clause rather than a missing guard.
- **404, never 403,** when a vendor requests another vendor's resource. A 403 confirms the row
  exists and turns an id enumeration into a census of your marketplace.
- **Vendors are untrusted content authors.** Product titles, descriptions and shop bios are
  attacker-controlled HTML from your app's own origin — sanitise on write and escape on render,
  and keep the CSP nonce discipline, because a stored XSS in a shop bio runs against logged-in
  customers on your domain.
- **Uploads are attacker-controlled files.** Validate magic bytes rather than the extension,
  re-encode every image through Sharp (which strips EXIF and neutralises polyglots), cap
  dimensions and file size, and serve user media from a separate origin so a malicious file
  cannot inherit your session cookies.
- **Banking details are the highest-value target in the system.** Never store them: the Connect
  account id is a reference, and the details live with Stripe. Require re-authentication to
  change payout settings or transfer vendor ownership, and email the previous owner on both.
- **Per-vendor rate limits** on catalogue writes and bulk import, so one tenant cannot degrade
  the platform for the others (§10, row 26).
- **Two webhook secrets**, one per Stripe endpoint (§7.1), both verified against the raw body.
- **Every money mutation initiated by a vendor is audited** with actor, vendor, amount and
  outcome — including the failures. The first serious dispute you have will be settled by this
  table or not at all.

---

# 15. Build plan

| Phase | Duration | Deliverable | Done when |
|---|---|---|---|
| 0. Foundation | 3 days | Repo, TS strict, ESLint/Prettier, Docker compose with PG + Redis, CI skeleton, health endpoints | `make up` works; CI green on an empty test |
| 1. Data & seed | 1 week | Schema **including all nine vendor tables**, migrations, Drizzle models, the scoped data-access layer from §5.4, realistic seeder (8 vendors / 500 products / 1,500 variants / 50k orders across vendors), factories | `make seed` populates a browsable multi-vendor DB; duplicate-SKU and overlapping-category fixtures exist |
| 2. Catalogue | 1 week | Home, PLP with facets **including vendor**, PDP with "sold by", `/v/[vendor]` storefronts, search, image pipeline to MinIO | Storefront browsable; PDP p95 < 300 ms locally |
| 3. Redis layer | 4 days | Cache abstraction, key registry, stampede protection, negative caching, invalidation **including the vendor generation counter**, hit-rate metric | Stampede + negative-cache integration tests pass |
| 4. Cart & auth | 1.5 weeks | Better Auth + Redis sessions, **`vendor_members` and the membership cache**, vendor-grouped cart, merge on login, addresses, rate limiting | Cart merge + session revocation + membership staleness tests pass |
| 5. Vendor onboarding | 1 week | `/sell/apply`, admin approval, Connect Express onboarding, the `account.updated` webhook, the publish gate | A vendor can go from application to a published product; test 24 passes |
| 6. Checkout | 2 weeks | Reservations with global lock ordering, per-vendor shipping, the split calculator, sub-orders, Stripe, webhooks, idempotency, expiry jobs, emails, invoices | Concurrency, idempotency, split-arithmetic and deadlock tests (17, 21) pass |
| 7. Payouts & refunds | 1.5 weeks | Balance ledger, transfer sweeper, hold periods, reversals, partial cancellation, `make reconcile` | Tests 18, 19, 20, 25 pass; reconciliation is clean over the seeded dataset |
| 8. Vendor dashboard | 1 week | Orders, fulfilment, inventory, shipping rates, payouts, members, reviews | Vendor E2E journey passes; test 22 passes across every route |
| 9. Platform admin | 1 week | Vendor moderation, applications, cross-vendor orders, payout oversight, discounts, dashboard with system health | Admin E2E passes |
| 10. Jobs & search | 4 days | BullMQ workers, reindex, image processing, abandoned cart, DLQ, board, fair-share concurrency | Queue survives a worker restart mid-job |
| 11. Observability | 4 days | OTel, Prometheus, Grafana, structured logs, Sentry, the marketplace panel | Full trace screenshot captured |
| 12. Hardening & load | 1 week | k6 suite including the vendor and skewed-tenant scenarios, tune, fix, pgBouncer, cache warming, breaking-point report | All k6 thresholds pass |
| 13. Documentation | 4 days | README, ADRs, architecture diagram, scaling doc, demo video, live demo | A stranger can run it and understand it |

Roughly **12–14 weeks part-time**, against 8–9 for the single-vendor build in 1.1. Be honest with
yourself about that number before you start: multi-vendor is not a feature you add at the end, it
is a property of the data model that phases 1, 6 and 7 exist to get right. The pivot buys you the
two hardest and most interesting problems in the project — **the split-payment ledger and tenant
isolation** — and those are what phases 7 and 8 are protecting.

Phases 3, 6, 7 and 12 are the ones that make the project valuable. Do not rush them to reach the
dashboards; a marketplace with beautiful dashboards and a ledger that does not reconcile is worth
less than a shop that does.

**If you need to cut, cut in this order:** the vendor review reply, `/vendors` directory, vendor
staff roles (keep `owner` only), and multi-parcel shipments per sub-order. **Never cut:** the
ledger, transfer idempotency, global lock ordering, or the tenant isolation test.

---

# 16. Portfolio deliverables

The code is table stakes. These are what actually get you interviews:

1. **README** with an architecture diagram, a "problems I solved" section linking to `docs/`, a
   one-command quickstart, and honest benchmark numbers with the hardware stated.
2. **`docs/adr/`** — Architecture Decision Records. At minimum: why Drizzle over Prisma; why
   Redis for reservations instead of Postgres advisory locks; why webhooks over redirect
   confirmation; why Meilisearch over Postgres FTS; why Docker over Vercel for this project;
   why Better Auth over Auth.js; why the demo runs on managed Postgres but the benchmarks do
   not; and what the 5-minute session cookie cache costs you in revocation latency.
   New in 1.2: **why multi-vendor at all** (`0001-multi-vendor-marketplace.md`); why separate
   charges and transfers rather than destination charges; why the order/sub-order split rather
   than one order per vendor; why payouts release on fulfilment plus a hold rather than on
   payment; whether you chose RLS or an application-layer scope, and what that costs with
   pgBouncer. Each ADR is context / decision / consequences, one page.
3. **`docs/load-test-report.md`** — scenarios, graphs, p95/p99 tables, the breaking point, the
   bottleneck you found, and what you changed. This is the single most differentiating file.
4. **`docs/scaling-challenges.md`** — Section 10 written up in your own words.
5. **A 3-minute demo video** — browse a multi-vendor basket, buy it with one payment, watch it
   split into two vendor dashboards, ship one, show the payout ledger and a refund reversal, then
   the Grafana dashboard under k6 load.
6. **A live demo** on a $12/month VPS (Hetzner or DigitalOcean) with Caddy for automatic TLS.
   Deploying your own Docker stack to a VPS is exactly the "something different from Vercel"
   experience you asked for, and it teaches you more in a weekend than a year of `git push`
   deploys.
7. **The résumé line, earned:** *"Built a self-hosted multi-vendor commerce platform (Next.js,
   PostgreSQL, Redis, Docker, Stripe Connect) sustaining 2,000 concurrent users at 187 ms p95 with
   a 94% cache hit rate; split every order across vendors through an append-only payout ledger
   that reconciles to the cent, and eliminated overselling under 50-way concurrency via row-level
   locking and Redis reservations."* Specific, measured, and every number traceable to a file in
   the repository.

   The marketplace framing is worth the extra weeks for exactly one reason: "I built a shop" is a
   crowded claim, while "I built a split-payment ledger that reconciles under concurrent refunds
   and reversals" is a payments-engineering claim, and far fewer candidates can make it.

---

# 17. Definition of done

The project is finished when **all** of the following are true:

1. A clean machine runs it with Docker only, in under 5 minutes, from the README alone.
2. CI is green: types, lint, unit, integration, E2E, build, security scan.
3. Coverage exceeds 80% overall and 100% on money-handling code.
4. k6 browse scenario passes every threshold, and the report is committed.
5. Zero oversells across 1,000 concurrent-purchase test iterations.
6. Killing any single container (except Postgres) degrades but does not break the site.
7. Every route is accessible (zero critical axe violations) and responsive at three breakpoints.
8. A live demo URL works, with HTTPS and seeded data.
9. `docs/` contains the ADRs, the scaling write-up, and the load report.
10. **`make reconcile` exits zero:** every vendor balance is the sum of its ledger, and every
    order's split reconciles to the captured amount, across the full seeded dataset with refunds
    and reversals in it.
11. **Zero cross-tenant leaks:** the enumerated isolation test (§11.3, test 22) covers every
    vendor route and passes, and the `cross_tenant_leak` counter is zero after every k6 scenario.
12. **No vendor is ever paid twice:** transfer idempotency holds under concurrent retries, and no
    `vendor_transfers` row exists without a matching ledger entry.
13. The full marketplace E2E journey — apply, approve, onboard, publish, sell in a mixed basket,
    ship, get paid, refund — runs green in CI against the compose stack.
14. You can explain any line of it from memory in an interview — including the trade-offs you
    chose not to make.

---

*End of specification.*
