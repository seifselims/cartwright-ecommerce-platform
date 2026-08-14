# Project Requirements Specification

## A Scalable, Self-Hosted E-Commerce Platform

**Stack:** Next.js (App Router) · PostgreSQL · Redis · Docker · Better Auth · BullMQ · Nodemailer · Stripe · Playwright · k6

**Document version:** 1.1 · **Status:** Ready to build

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
story is "I built the engine," so a name like "Sarah's Candles" undersells you immediately.

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

## 1.4 Storefront identity inside the app

Name the *demo storefront* separately from the *platform*. The platform is Cartwright; the demo
store it ships with is, for example, **"Northgate Supply"** selling desk gear, coffee equipment,
and audio accessories. This proves you understand multi-tenancy conceptually and it gives your
seed data a coherent catalogue instead of "Product 1, Product 2."

**Acceptance criteria:** repo, Docker image name, database name, Redis key prefix, and README
title all use the same platform name. Seed data uses the storefront name.

---

# 2. Product scope

## 2.1 In scope (must build)

1. **Catalogue** — products, variants (size/colour), categories, collections, images, stock levels.
2. **Search & browse** — full-text search, faceted filters, sorting, pagination.
3. **Cart** — guest carts and user carts, merge on login, live stock validation.
4. **Checkout** — address capture, shipping method selection, tax, Stripe payment, order creation.
5. **Orders** — order history, order detail, status timeline, invoice PDF.
6. **Accounts** — registration, login, email verification, password reset, saved addresses.
7. **Inventory** — reservation on checkout start, decrement on payment success, release on expiry.
8. **Admin** — product CRUD, inventory adjustments, order management, refunds, basic analytics.
9. **Background jobs** — emails, image processing, search reindex, abandoned cart, stock release.
10. **Observability** — structured logs, metrics, health checks, error tracking.

## 2.2 Explicitly out of scope (write this in your README)

Multi-vendor marketplaces, subscriptions and recurring billing, a mobile app, i18n beyond a
single locale, a headless CMS, real shipping carrier integrations (simulate with flat rates and
a fake rate table), and real tax calculation (use a static tax table, not TaxJar/Avalara).

Cutting scope on purpose and *saying so* reads as senior judgement. Endlessly half-finishing
features reads as the opposite.

**Acceptance criteria:** README contains an "Out of scope and why" section.

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
| Payments | **Stripe (test mode)** | Payment Intents + webhooks — the webhook idempotency problem is a great portfolio talking point. |
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

**Acceptance criteria:** you can run `docker compose up --scale web=3`, kill one web container
mid-checkout, and the checkout still completes.

---

# 5. Data model

## 5.1 Core tables

**user, session, account, verification** — **owned by Better Auth.** Do not hand-write these.
Run `npx @better-auth/cli generate` and let it emit the Drizzle schema, then commit the generated
migration. Extend `user` with your own columns via Better Auth's `additionalFields` option —
add `role (customer|admin)` and `stripe_customer_id` there rather than creating a parallel
`profiles` table. Everything below is yours and references `user.id`.

**addresses** — `id`, `user_id fk`, `label`, `line1`, `line2`, `city`, `region`, `postal_code`,
`country (iso2)`, `phone`, `is_default_shipping`, `is_default_billing`

**categories** — `id`, `parent_id fk self`, `name`, `slug (unique)`, `description`, `position`

**products** — `id`, `slug (unique)`, `title`, `description`, `brand`, `status (draft|active|archived)`,
`category_id fk`, `search_vector tsvector generated`, `created_at`, `updated_at`

**product_variants** — `id`, `product_id fk`, `sku (unique)`, `title`, `price_cents (int)`,
`compare_at_price_cents`, `currency`, `weight_grams`, `option_values (jsonb)`, `position`

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

**orders** — `id`, `order_number (human readable, e.g. NG-2026-000412)`, `user_id fk nullable`,
`email`, `status (pending|paid|fulfilled|cancelled|refunded)`, `subtotal_cents`, `shipping_cents`,
`tax_cents`, `discount_cents`, `total_cents`, `currency`, `shipping_address (jsonb snapshot)`,
`billing_address (jsonb snapshot)`, `placed_at`, `created_at`

**order_items** — `id`, `order_id fk`, `variant_id fk`, `sku_snapshot`, `title_snapshot`,
`quantity`, `unit_price_cents`, `total_cents`

**payments** — `id`, `order_id fk`, `provider`, `provider_payment_intent_id (unique)`,
`amount_cents`, `status`, `raw_payload (jsonb)`, `created_at`

**webhook_events** — `id`, `provider`, `provider_event_id (unique)`, `type`, `payload (jsonb)`,
`processed_at`, `attempts`. **This table is your idempotency guarantee.**

**discount_codes** — `id`, `code (unique)`, `type (percent|fixed|free_shipping)`, `value`,
`min_subtotal_cents`, `max_redemptions`, `redemptions_used`, `starts_at`, `ends_at`, `active`

**reviews** — `id`, `product_id fk`, `user_id fk`, `order_id fk`, `rating (1-5)`, `title`, `body`,
`status (pending|published|rejected)`, unique on `(user_id, product_id)`

**audit_log** — `id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `diff (jsonb)`, `created_at`

## 5.2 Money rule

**All money is stored as integer minor units (`price_cents`).** Never `float`. Never `double`.
If you must use a decimal type, use `NUMERIC(12,2)`, never `REAL`. Put this in your README as a
design decision — reviewers notice.

## 5.3 Required indexes

```sql
CREATE INDEX ON products USING GIN (search_vector);
CREATE INDEX ON products (category_id, status);
CREATE INDEX ON product_variants (product_id);
CREATE UNIQUE INDEX ON product_variants (sku);
CREATE INDEX ON orders (user_id, placed_at DESC);
CREATE INDEX ON orders (status, placed_at DESC);
CREATE INDEX ON order_items (order_id);
CREATE INDEX ON cart_items (cart_id);
CREATE INDEX ON inventory_ledger (variant_id, created_at DESC);
CREATE INDEX ON carts (expires_at) WHERE status = 'active';
```

**Acceptance criteria:** `EXPLAIN ANALYZE` on your product listing query and your order history
query shows **Index Scan**, not Seq Scan, with 50,000 products and 100,000 orders seeded.

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

## 6.3 Non-cache Redis uses (these are the interesting ones)

1. **Rate limiting** — sliding window with `INCR` + `EXPIRE`, or a token bucket in a Lua script.
   Limits: login 5/min/IP, checkout 10/min/user, search 60/min/IP, webhook 100/min.
2. **Distributed lock** — `SET key value NX PX 5000` for "only one worker may reindex" and
   "only one process may process this webhook event." Release with a Lua compare-and-delete so
   you never delete someone else's lock.
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
| `/cart` | Client + server actions | none (live stock) | public |
| `/checkout` | Dynamic, no cache | none | public (guest allowed) |
| `/checkout/confirmation/[orderId]` | Dynamic | none | token-scoped |
| `/account` | Dynamic | none | required |
| `/account/orders` | Dynamic | none | required |
| `/account/orders/[id]` | Dynamic | none | required + ownership |
| `/account/addresses` | Dynamic | none | required |
| `/login`, `/register`, `/forgot`, `/reset/[token]` | Static shell | none | anonymous |
| `/admin` | Dynamic | none | role=admin |
| `/admin/products`, `/admin/products/[id]` | Dynamic | none | role=admin |
| `/admin/orders`, `/admin/orders/[id]` | Dynamic | none | role=admin |
| `/admin/inventory` | Dynamic | none | role=admin |
| `/admin/discounts` | Dynamic | none | role=admin |
| `/api/health`, `/api/ready` | Route handler | none | public |
| `/api/webhooks/stripe` | Route handler | none | signature-verified |

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
│  └─────────────────────┘  │  Colour:  [Black] [Walnut] [White]│
│  ┌──┐┌──┐┌──┐┌──┐         │  Size:    [Standard] [Tall]       │
│  └──┘└──┘└──┘└──┘         │                                   │
│   thumbnails              │  ● In stock — 7 left              │
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
│ Your cart (3 items)                                           │
├────────────────────────────────────┬──────────────────────────┤
│ ┌────┐ Nord Task Lamp — Black      │  ORDER SUMMARY           │
│ │img │ $89.00                      │  Subtotal      $203.00   │
│ └────┘ Qty [ − 2 + ]   Remove      │  Shipping        $0.00   │
│        ⚠ Only 1 left — qty reduced │  Tax             $16.24  │
│                                    │  Discount       −$10.00  │
│ ┌────┐ Kova Grinder                │  ─────────────────────   │
│ │img │ $25.00   Qty [ − 1 + ]      │  Total         $209.24   │
│ └────┘                             │                          │
│                                    │  [ promo code    ][Apply]│
│ ← Continue shopping                │  ┌────────────────────┐  │
│                                    │  │ CHECKOUT           │  │
│  Stock is re-validated on every    │  └────────────────────┘  │
│  render — never trust the snapshot │  🔒 Secure checkout      │
└────────────────────────────────────┴──────────────────────────┘
```

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
│    First [        ] Last [       ] │  Shipping        $0.00   │
│    Address [                     ] │  Tax            $16.24   │
│    City [       ] Post [        ]  │  Discount      −$10.00   │
│    Country [ United Kingdom    ▾]  │  ═════════════════════   │
│    ☐ Save this address             │  Total        $209.24    │
│                                    │                          │
│    ○ Standard  3–5 days    Free    │  ⏱ Items reserved        │
│    ● Express   1–2 days    $9.99   │     for 14:32            │
│                                    │     (Redis TTL, visible!)│
│ 3. PAYMENT                         │                          │
│    ┌────────────────────────────┐  │                          │
│    │ Stripe Payment Element     │  │                          │
│    └────────────────────────────┘  │                          │
│    [ PAY $209.24 ]                 │                          │
└────────────────────────────────────┴──────────────────────────┘
```

The visible reservation countdown is a small touch that makes the Redis work *legible* to
anyone reviewing your portfolio. Do it.

### Admin dashboard `/admin`

```
┌──────────┬────────────────────────────────────────────────────┐
│ ▣ Overview│  Today                                            │
│ ▤ Orders  │  ┌────────┐┌────────┐┌────────┐┌────────┐         │
│ ▥ Products│  │ Revenue││ Orders ││ AOV    ││ Conv % │         │
│ ▦ Inventory│ │ $4,210 ││   38   ││ $110   ││  2.4%  │         │
│ ▧ Discounts│ └────────┘└────────┘└────────┘└────────┘         │
│ ▨ Customers│                                                  │
│ ⚙ Settings │  Revenue, last 30 days                           │
│           │  ┌──────────────────────────────────────────┐     │
│  ─────    │  │        ╱╲      ╱╲                        │     │
│  System   │  │   ╱╲  ╱  ╲    ╱  ╲   ╱╲                  │     │
│  ● DB  ok │  │  ╱  ╲╱    ╲╱╲╱    ╲╱╲╱ ╲                 │     │
│  ● Redis  │  └──────────────────────────────────────────┘     │
│  ● Queue 4│                                                   │
│  ● Search │  Low stock (5)          Recent orders             │
│           │  Lamp/Walnut     2      NG-000412  $209  paid     │
│  cache hit│  Grinder         1      NG-000411  $ 45  pending  │
│    94.2%  │  Cable/1m        0      NG-000410  $312  fulfilled│
└──────────┴────────────────────────────────────────────────────┘
```

Putting **cache hit rate and queue depth in the admin UI** is the single cheapest way to make a
recruiter see the infrastructure work you did.

**Acceptance criteria:** every route in 7.1 exists, is responsive at 375 px / 768 px / 1440 px,
and passes an axe-core accessibility scan with zero critical violations.

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
  1. BEGIN TRANSACTION
  2. SELECT variant rows FOR UPDATE  (deterministic order by variant_id
     to avoid deadlocks)
  3. For each item: assert on_hand - reserved >= qty, else 409 with the
     specific item so the UI can show "only 1 left"
  4. UPDATE inventory SET reserved = reserved + qty
  5. INSERT inventory_ledger rows (reason='reservation')
  6. INSERT order (status='pending') + order_items with price snapshots
  7. COMMIT
  8. Redis SETEX cw:reserve:{orderId} 900 "1"
  9. Enqueue BullMQ delayed job releaseReservation(orderId) at +15 min
 10. Create Stripe PaymentIntent (amount computed server-side ONLY)
 11. Return clientSecret + orderId

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
       - inventory: reserved -= qty, on_hand -= qty
       - ledger rows reason='sale'
       - payments row
       - discount_codes.redemptions_used += 1 (with a CHECK against max)
     COMMIT
  5. Enqueue: sendOrderConfirmationEmail, generateInvoicePdf,
     reindexProduct (stock changed), trackConversion
     — Nodemailer NEVER runs in a request handler. An SMTP handshake is
       2–5 s and would land in your p99. Always a BullMQ job.
  6. Mark webhook_events.processed_at
  7. Invalidate cw:*:stock:* for affected variants
  8. Return 200 fast — Stripe retries anything slower than 20 s
```

**Never mark an order paid from the browser redirect.** The redirect is a UX convenience; the
webhook is the truth. Say this in your README.

## 8.4 Reservation expiry

```
BullMQ delayed job fires at T+15min
  ├─ Re-read order. If status != 'pending' → no-op (payment won)
  ├─ Else: transaction → reserved -= qty, ledger reason='reservation_expiry',
  │        order.status = 'cancelled'
  └─ Invalidate stock cache, reindex, optionally email "your cart expired"
```

The `status != 'pending'` check is your defence against the race where payment lands at 14:59.9.

## 8.5 Admin updates a product

```
Admin saves product
  ├─ Zod validation → transaction → update product + variants
  ├─ audit_log row with a jsonb diff
  ├─ Invalidate: cw:v1:product:{slug}, bump cw:v1:cat:{catId}:gen
  │  (generation bump beats scanning for keys — never use KEYS in prod)
  ├─ Enqueue reindexProduct job → Meilisearch
  └─ Enqueue processImages job → Sharp → WebP/AVIF at 5 widths → MinIO
```

**Acceptance criteria:** each of 8.1–8.5 has at least one integration test and one E2E test.

---

# 9. API surface

Public routes are Route Handlers under `/api`. Prefer **Server Actions** for form mutations from
your own UI and Route Handlers for anything a machine calls (webhooks, health, admin scripts).

```
GET    /api/health                 → { status, version, uptime }        (liveness)
GET    /api/ready                  → checks db + redis + search         (readiness)
GET    /api/products?cursor=&limit=&category=&sort=
GET    /api/products/{slug}
GET    /api/search?q=&facets=
POST   /api/cart/items             { variantId, qty }
PATCH  /api/cart/items/{id}        { qty }
DELETE /api/cart/items/{id}
POST   /api/cart/discount          { code }
POST   /api/checkout/start         [Idempotency-Key header required]
GET    /api/orders/{id}            [owner or admin]
POST   /api/webhooks/stripe        [signature verified]
GET    /api/metrics                → Prometheus text format [internal only]
```

**Rules for every endpoint:** Zod-validated input; a typed error envelope
`{ error: { code, message, details? } }`; correct status codes (409 for stock conflicts, 422 for
validation, 429 for rate limit with `Retry-After`); a request-id header echoed into logs;
cursor pagination, never `OFFSET` on large tables.

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

**Acceptance criteria:** `docs/scaling-challenges.md` covers at least 12 of these, each with the
problem, your solution, and the trade-off you accepted. This document is arguably worth more to
your portfolio than the code.

---

# 11. Testing requirements

## 11.1 The pyramid and the targets

| Level | Tool | Count target | Runtime budget | Gate |
|---|---|---|---|---|
| Unit | Vitest | 150+ | < 30 s | 85% coverage on `lib/`, 100% on pricing/tax/discount |
| Integration | Vitest + Testcontainers (real PG + Redis) | 60+ | < 4 min | all critical paths |
| Component | React Testing Library | 40+ | < 60 s | all interactive components |
| E2E | Playwright (chromium + webkit + mobile) | 25+ | < 8 min | happy paths + 6 failure paths |
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

## 11.4 E2E tests (Playwright)

Happy paths: guest browse → filter → PDP → add to cart → guest checkout with Stripe test card
`4242…` → confirmation → order visible via email link. Register → verify email (via Mailpit API)
→ login → add to cart → apply discount → pay → order appears in `/account/orders`. Admin login →
create product with image upload → verify it appears in search within 5 s → adjust stock → verify
the storefront badge updates.

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

Thresholds that must pass in scenario 2:

```js
thresholds: {
  'http_req_duration{name:PDP}':    ['p(95)<300', 'p(99)<800'],
  'http_req_duration{name:PLP}':    ['p(95)<400'],
  'http_req_duration{name:search}': ['p(95)<500'],
  'http_req_duration{name:cart}':   ['p(95)<600'],
  'http_req_failed':                ['rate<0.01'],
  'checks':                         ['rate>0.99'],
  'oversell_detected':              ['count==0'],   // custom metric
}
```

Also record: cache hit ratio (target > 90% on PDP under load), Postgres connections used,
Redis ops/sec and memory, queue depth over time, CPU/memory per container.

**Honesty rule:** "10,000 concurrent users" means concurrent *virtual users in your test*, on
your stated hardware, with your stated traffic mix. Write the hardware, the mix, and the results
in the README, and link the k6 HTML report. Then the claim is defensible in an interview instead
of embarrassing.

## 11.6 CI gates

Every PR must pass: `tsc --noEmit`, ESLint with zero warnings, Prettier check, unit + integration
tests, Playwright E2E against a compose stack, `docker build` success, Trivy scan (zero
critical/high), and a bundle-size budget check. Merge is blocked otherwise. Nightly: full k6
browse scenario + soak on a schedule.

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

- `make up`, `make down`, `make seed`, `make test`, `make load`, `make logs` — a Makefile so a
  reviewer can run your project in one command.
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
`db_pool_active`. Grafana dashboards for RED metrics, cache effectiveness, queue health, and a
business panel.

Alerts (even if they only log): error rate > 1% for 5 min, p95 latency > 1 s, queue depth > 1000,
cache hit rate < 70%, DB connections > 80% of pool, any oversell attempt at all.

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

---

# 15. Build plan

| Phase | Duration | Deliverable | Done when |
|---|---|---|---|
| 0. Foundation | 3 days | Repo, TS strict, ESLint/Prettier, Docker compose with PG + Redis, CI skeleton, health endpoints | `make up` works; CI green on an empty test |
| 1. Data & seed | 4 days | Schema, migrations, Drizzle models, realistic seeder (500 products / 1,500 variants / 50k orders), factories | `make seed` populates a browsable DB |
| 2. Catalogue | 1 week | Home, PLP with facets, PDP, search, image pipeline to MinIO | Storefront browsable; PDP p95 < 300 ms locally |
| 3. Redis layer | 4 days | Cache abstraction, key registry, stampede protection, negative caching, invalidation, hit-rate metric | Stampede + negative-cache integration tests pass |
| 4. Cart & auth | 1 week | Better Auth + Redis sessions, cart, merge on login, addresses, rate limiting | Cart merge + session revocation tests pass |
| 5. Checkout | 1.5 weeks | Reservations, Stripe, webhooks, idempotency, expiry jobs, emails, invoices | Concurrency + idempotency tests pass |
| 6. Admin | 1 week | Product CRUD, inventory, orders, refunds, discounts, dashboard with system health | Admin E2E passes |
| 7. Jobs & search | 4 days | BullMQ workers, reindex, image processing, abandoned cart, DLQ, board | Queue survives a worker restart mid-job |
| 8. Observability | 4 days | OTel, Prometheus, Grafana, structured logs, Sentry | Full trace screenshot captured |
| 9. Hardening & load | 1 week | k6 suite, tune, fix, pgBouncer, cache warming, breaking-point report | All k6 thresholds pass |
| 10. Documentation | 3 days | README, ADRs, architecture diagram, scaling doc, demo video, live demo | A stranger can run it and understand it |

Roughly 8–9 weeks part-time. Phases 3, 5, and 9 are the ones that make the project valuable —
do not rush them to get to Phase 6.

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
   Each ADR is context / decision / consequences, one page.
3. **`docs/load-test-report.md`** — scenarios, graphs, p95/p99 tables, the breaking point, the
   bottleneck you found, and what you changed. This is the single most differentiating file.
4. **`docs/scaling-challenges.md`** — Section 10 written up in your own words.
5. **A 3-minute demo video** — browse, buy, admin, then the Grafana dashboard under k6 load.
6. **A live demo** on a $12/month VPS (Hetzner or DigitalOcean) with Caddy for automatic TLS.
   Deploying your own Docker stack to a VPS is exactly the "something different from Vercel"
   experience you asked for, and it teaches you more in a weekend than a year of `git push`
   deploys.
7. **The résumé line, earned:** *"Built a self-hosted e-commerce platform (Next.js, PostgreSQL,
   Redis, Docker) sustaining 2,000 concurrent users at 187 ms p95 with a 94% cache hit rate;
   eliminated overselling under 50-way concurrency via row-level locking and Redis reservations."*
   Specific, measured, and every number traceable to a file in the repository.

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
10. You can explain any line of it from memory in an interview — including the trade-offs you
    chose not to make.

---

*End of specification.*
