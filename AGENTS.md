<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Cartwright

A self-hosted, horizontally scalable **multi-vendor commerce engine** (not a shop). The demo
marketplace it ships with is **Northgate Supply** — desk gear, coffee equipment, audio
accessories — populated by eight independent vendor shops.

The full build contract is `docs/Cartwright-Requirements-Spec-v1.2.md`. **Read the relevant
section of that spec before implementing a feature**; it defines the data model (§5, including
§5.0 for the shape of it and §5.4 for the authorization model), the Redis cache policy (§6), the
route map (§7), the exact checkout/webhook/payout algorithms (§8), the API surface (§9), the
testing requirements (§11), and the Docker requirements (§12). Every section of the spec ends
with acceptance criteria — treat those as the definition of done.

Version 1.2 turned this from a single-tenant shop into a marketplace. If something you read
elsewhere assumes one seller, it is stale — `docs/adr/0001-multi-vendor-marketplace.md` records
the pivot and the five sub-decisions (sub-orders, separate charges and transfers, payout release
on fulfilment, per-vendor shipping, membership separate from role).

This is a portfolio project whose value is in the infrastructure work: caching policy,
concurrency correctness, the split-payment ledger, tenant isolation, background jobs, load-test
evidence. Shortcuts that make a feature "work" while skipping the transaction, the cache
invalidation, or the test defeat the point.

## Current status

Phase 0 (Foundation) of the §15 build plan is **complete** — `make up` works and the CI workflow
runs typecheck, lint, format, unit tests and build, verified green from a clean checkout on Linux.
Phase 1 (Data & seed) is next. What exists today:

- Next.js 16 App Router scaffold (`app/`) — still just the starter page, no route groups yet.
  TypeScript `strict: true`, Tailwind v4, ESLint flat config, Prettier.
- Drizzle wired to Postgres (`src/db/index.ts`, `drizzle.config.ts`).
- **`src/db/schema.ts` is complete against §5.1 of the v1.2 spec** — 29 tables covering the four
  Better Auth tables, the full catalogue/cart/order model, all nine vendor tables, and the payout
  ledger. It typechecks, lints, and renders to valid SQL via `drizzle-kit generate`.
- Better Auth in `src/auth.ts`, with §6.5 wired: `secondaryStorage` against the cache Redis under
  an unversioned `cw:auth:` prefix (including the optional `getAndDelete` and `increment` hooks),
  `cookieCache` at 5 minutes, `storeSessionInDatabase` + `preserveSessionInDatabase`, and
  `rateLimit` on secondary storage at 100/60s. Still missing:
  `emailVerification.sendVerificationEmail`, so `requireEmailVerification: true` means **nobody
  can complete a sign-up yet** — that needs Nodemailer behind a BullMQ job (rule 6).
- `src/redis.ts` — two lazily-connected ioredis singletons, `redis` (cache) and `queueRedis`
  (BullMQ, `maxRetriesPerRequest: null`), guarded against hot-reload connection leaks.
- The full backing stack in `docker-compose.yml` + `docker-compose.dev.yml`: Postgres, two Redis
  instances, Meilisearch, MinIO (with a one-shot bucket init), Mailpit. `make up` brings it up
  healthy.
- **The first migration exists and has been applied.** `drizzle/0000_neat_firedrake.sql` is
  recorded in `drizzle.__drizzle_migrations`. Schema changes are no longer free: use
  `drizzle-kit generate` + `migrate` and follow the expand/contract rule in §10, row 14.
  **Do not use `db:push` any more** — a push the migration files do not know about is drift.
- **The §9 health endpoints exist.** `app/api/health/route.ts` is liveness — it returns
  `{ status, version, uptime }` and deliberately touches **no** dependency, because Docker restarts
  what fails it and a probe that pinged Postgres would turn one database blip into a restart loop
  across every web container. `app/api/ready/route.ts` is readiness: Postgres, both Redis
  instances and Meilisearch, checked in parallel, each racing a 2 s timeout, returning 503 and a
  per-dependency breakdown if any is down. A stopped container hangs rather than refuses, so the
  timeout is what keeps the probe answering inside its poll interval. Both are
  `export const dynamic = "force-dynamic"` — without it Next prerenders them at build and `uptime`
  freezes at whatever the builder saw. Verified against the live stack: stopping the cache Redis
  gives 503 from `/api/ready` naming `redis` while `/api/health` stays 200, and it recovers on its
  own when Redis returns.
- **Vitest is configured** in `vitest.config.mts` (`.mts` because a `.ts` Vite config trips the
  native config-loader warning). `include` is scoped to `src/**` and `tests/unit/**` so Playwright
  specs under a future `e2e/` can never be collected by the wrong runner, and `passWithNoTests` is
  `false` so a bad filter cannot look like a green run. `tests/unit/health.test.ts` asserts the §9
  liveness contract.
- **CI exists** at `.github/workflows/ci.yml`: typecheck → lint → format → test → build, on push
  to `main` and every PR. The build step runs with placeholder env vars — if it ever starts needing
  a live service, something is connecting at import time and the `lazyConnect` guard in
  `src/redis.ts` has been broken. Two traps already caught here, both invisible locally:
  the lockfile is npm 11's and **npm 10 rejects it** with 27 `Missing: @esbuild/*` errors, so CI
  installs `npm@11` before `npm ci` (Node 22 still ships npm 10); and `tsc` alone fails on a clean
  checkout with `Cannot find name 'LayoutProps'` because that type lives in `.next/types`, so
  `typecheck` runs `next typegen` first.
- All the runtime dependencies from §3 already installed (BullMQ, ioredis, Stripe, Nodemailer,
  Meilisearch, Sharp, AWS S3 SDK, Zod). Of the test tooling, **Vitest is configured**; Playwright,
  Testcontainers and axe-core are installed but not yet configured or used.

- **`make seed` works** (`src/db/seed/`). It rebuilds the demo dataset in ~23 s: 8 vendors, 500
  products, ~1,500 variants, 50k orders, ~76k sub-orders and ~206k ledger entries. Deterministic —
  every draw comes from a seeded mulberry32 in `random.ts`, so a given `SEED` always rebuilds the
  identical database and a bug one machine sees reproduces on another. It **truncates and
  rebuilds** rather than upserting, deliberately: an upserting seeder drifts from what a fresh
  `make up` produces. Four things in it are load-bearing rather than decorative:
  - `split.ts` implements the §8.3 step 7 per-vendor money split and asserts step 11 before
    returning. **Phase 6 checkout should import it, not reimplement it** — two definitions of the
    split is how a ledger stops reconciling. Commission excludes shipping; a platform discount is
    apportioned pro-rata with the largest-subtotal vendor absorbing the remainder.
  - Every paid sub-order writes the **three signed ledger rows** §8.3 requires (sale, shipping,
    negative commission), never one net row, so `make reconcile` has real arithmetic to check.
  - The two fixtures the phase-1 bar names are planted, not hoped for: SKU `NG-SHARED-01` is
    carried by two vendors (proving `product_variants` is unique on `(vendor_id, sku)`, not on
    `sku`), and four categories span multiple vendors.
  - Status fixtures: one vendor is `pending` and one `suspended`, both with `charges_enabled =
    false` and zero orders, which is the data §11.3 test 24 needs. One person is a member of two
    vendors — the row that is unrepresentable if membership ever collapses onto `user`.
  - Seeded accounts are loggable-in: passwords go through Better Auth's own `hashPassword`, so
    `owner@<vendor-slug>.test` / `admin@northgatesupply.test` work with `SEED_PASSWORD`
    (`password123` by default).

- **The §5.4 scoped data-access layer exists** in `src/db/scoped.ts`, with `src/vendor-context.ts`
  as its Next.js entry point. `forVendor(user, slug)` resolves the acting vendor from
  `vendor_members` and returns a `ScopedDb` whose every method closes over that vendor id — **no
  method takes a vendor id, so no call site can pass the wrong one**, which is the whole design.
  Covers products, variants, inventory, orders, payouts, shipping, reviews, profile and members.
  Points worth knowing before extending it:
  - **The URL slug is not authority.** It selects which of the caller's own memberships to act
    under and is then verified; a slug you have no membership for is a 404, identical to one that
    does not exist. Cross-vendor reads *and writes* return `NotFoundError`, never 403 — a write
    matching zero rows throws rather than silently no-opping.
  - **`inventory` has no `vendor_id` column**, so it is scoped by joining `product_variants`. This
    is exactly the indirection a hand-written handler gets wrong: `WHERE variant_id = $1` looks
    complete and silently accepts another vendor's variant.
  - **Roles are ranked** (`staff` 1, `manager` 2, `owner` 3) and checked by `#require`. Money and
    shipping are `manager`+, members and settings are `owner`-only, per the §7.1 route table.
  - `context` returns a **copy** of the acting context. It used to hand back the live object, which
    let a caller cast away `Readonly` and rewrite `role` — a unit test caught it; do not
    "simplify" it back.
  - Platform admins may act for any vendor at `owner` level, flagged `viaPlatformAdmin` for the
    audit trail, and keep access to suspended vendors (whose own members lose it). Rule 15 still
    holds: that is `user.role === "admin"`, never a `vendor` role.
  - `requireVendor(slug)` in `src/vendor-context.ts` is what a page calls — it reads the session
    and converts `NotFoundError` to Next's `notFound()`. There is no `ForbiddenError` helper on
    purpose: Next's `forbidden()` needs `experimental.authInterrupts`, and an experimental flag is
    a poor trade for a try/catch. Prefer not rendering what the role cannot reach.

Not yet started: the cache abstraction and key registry from §6, and every route beyond the
scaffold page and the two health endpoints.

**Phase 1 is functionally complete, minus its integration tests.** Both halves of the acceptance
bar are met — `make seed`, and the scoped layer. What remains before Phase 2 is the §5.4
acceptance *criterion*: §11.3 tests 22 and 23 on Testcontainers, plus the lint rule or test that
greps for raw table access in `/vendor` handlers. Test 22 enumerates routes from the router so a
new unscoped route fails until it goes through `forVendor`; it needs the integration config that
does not exist yet, and there are no `/vendor` routes to enumerate until Phase 2 adds them. Write
it as Phase 2's first move, not its last.

## Stack and why

Next.js 16 App Router · PostgreSQL 16 · Redis 7 · Drizzle ORM · Better Auth · BullMQ ·
**Stripe Connect (Express)** · Meilisearch · MinIO · Nodemailer + Mailpit · Docker Compose ·
Nginx or Caddy · Vitest + Testcontainers + Playwright + k6. Rationale for each choice is in §3.1
of the spec; do not substitute one of these without writing an ADR.

## Non-negotiable rules

These come from the spec and apply to every change:

1. **Money is integer minor units** (`price_cents`). Never `float`, never `double`. If a decimal
   is unavoidable, `NUMERIC(12,2)`.
2. **Postgres is the only source of truth.** Redis must always be rebuildable from Postgres.
3. **The web container is stateless.** No local file writes, no in-memory state that matters, no
   sticky sessions. Uploads go to MinIO/S3.
4. **Every write path touching money or stock runs in a transaction**, with row locks taken in a
   deterministic order (`ORDER BY variant_id`) to avoid deadlocks. The ordering is **global across
   the whole basket**, never per-vendor batches — see §8.3, this is the multi-vendor deadlock trap.
5. **Never mark an order paid from the browser redirect.** The Stripe webhook is the truth.
6. **Anything slower than ~200 ms that the user does not need synchronously becomes a BullMQ job.**
   In particular, Nodemailer never runs inside a request handler.
7. **Zod-validate every input** at every trust boundary, including headers and webhook payloads.
   Recompute prices server-side; never trust a client-sent amount.
8. **`any` is banned.** ESLint enforces it.
9. **Never use `KEYS` against Redis.** Invalidate with generation counters or explicit keys.
10. **Redis keys are namespaced and versioned:** `cw:v{n}:...` (see the policy table in §6.2).
    Jitter every TTL by ±10%.
11. **Tests do not mock the database.** Integration tests use Testcontainers with real Postgres
    and Redis.
12. **Every vendor-scoped query goes through the scoped data-access layer**, which supplies
    `WHERE vendor_id = $1` itself. A handler must never be able to forget it. A vendor id is
    never an input — derive it from the session's `vendor_members`, never from the request.
    Return **404, not 403**, for another vendor's resource (§5.4).
13. **A vendor's balance is the sum of `vendor_balance_entries`, never a stored column.** The
    ledger is append-only, like `inventory_ledger`. Write the ledger entries in the same
    transaction as the state change they describe.
14. **No transfer without an idempotency key** derived from the sub-order id, and a unique
    constraint behind it. Locks expire; constraints do not. Paying a vendor twice is the worst
    bug this system can have.
15. **`user.role` is never `vendor`.** Platform role and vendor membership are separate axes, and
    an admin is always a platform employee (§5.4).

## Repo layout

```
app/                 Next.js App Router routes (the scaffold page plus /api/health, /api/ready)
  api/health/        Liveness — no dependencies, never fails on a dependency outage
  api/ready/         Readiness — db + both Redis + search, 503 when any is down
  (storefront)/      planned — customer-facing: /, /c, /p, /v/[vendor], cart, checkout, account
  (vendor)/vendor/   planned — seller dashboard
  (admin)/admin/     planned — platform back office
src/                 All cross-cutting app code — auth.ts, redis.ts, vendor-context.ts
                     (requireVendor: the one call a /vendor page makes)
src/db/              Drizzle client (index.ts), schema (schema.ts), scoped.ts (§5.4 —
                     every vendor-scoped query goes through it; see rule 12)
src/db/seed/         `make seed` — index.ts orchestrates; split.ts is the §8.3 money split
                     (shared with Phase 6 checkout), factories.ts and data.ts build rows,
                     random.ts is the seeded PRNG that makes the dataset reproducible
tests/unit/          Vitest unit tests (§11.1). Integration tests get their own config in Phase 1
docs/                The requirements spec and caching.md / scaling-challenges.md
docs/adr/            Architecture Decision Records — 0001 multi-vendor, 0002 session staleness
drizzle/             Generated migrations — 0000 is applied; never hand-edit an applied file
.github/workflows/   CI
```

`src/` is the single home for shared code; `lib/` existed briefly and is gone. Do not reintroduce
it.

## Commands

```bash
npm run dev                          # next dev
npm run build                        # next build
npm run lint                         # eslint --max-warnings 0 (§11.6 gates on zero warnings)
npm run typecheck                    # tsc --noEmit
npm run format                       # prettier --write .
npm run format:check                 # prettier --check . — the CI gate
npm test                             # vitest run (unit only)
npm run test:watch                   # vitest
npm run db:seed                      # rebuild the demo dataset (make seed wraps this)
npm run db:push                      # drizzle-kit push — DO NOT USE; migrations exist, this causes drift
npx drizzle-kit generate             # emit a migration from schema.ts
npx drizzle-kit migrate              # apply migrations to DATABASE_URL
npx @better-auth/cli generate        # regenerate the Better Auth tables — do not hand-edit them
```

Prettier ignores `docs/` and `*.md` (the spec and the ADRs are hand-wrapped prose that Prettier
would reflow) and `drizzle/` (reformatting an applied migration changes its bytes).

The `Makefile` has `up`, `down`, `logs`, `ps`, `restart`, `nuke`, `seed`, `test`, and `check` —
where `make check` runs the whole CI sequence locally, in CI's order. §12.4 still wants `make load`
and `make reconcile`; add them as the phases that make them meaningful arrive. `make reconcile`
asserts that every vendor balance equals its ledger sum and every order's split reconciles to the
captured amount — it is a definition-of-done item (§17). The seeder already checks the second half
of that in-process and fails loudly on a mismatch, so `make reconcile` mostly needs the balance
half plus refunds and reversals in the dataset.

## Environment

`.env` is gitignored; `.env.example` must document **every** variable — extend both files together
whenever a new service is wired in. Defined today: Postgres (`POSTGRES_*`, `DATABASE_URL`), Redis
(`REDIS_URL`, `QUEUE_REDIS_URL`), Better Auth (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`),
Meilisearch (`MEILI_MASTER_KEY`, `MEILI_HOST`), object storage (`S3_*`) and email (`SMTP_*`,
`EMAIL_FROM`). Nothing for Stripe yet.

Stripe needs **two** webhook signing secrets, not one: `STRIPE_WEBHOOK_SECRET` for platform
events and `STRIPE_CONNECT_WEBHOOK_SECRET` for `account.updated` on connected accounts. They are
different endpoints with different secrets (§7.1). Also expect `PLATFORM_COMMISSION_BPS` as the
default commission, overridable per vendor on the `vendors` row.

Hostname gotcha: inside the Docker network Postgres is `postgres:5432`; from the host it is
`localhost:5432` and only because of a dev-only port mapping that must be removed in the prod
compose file.

## Working style

- Consult the spec section before writing code, and satisfy its acceptance criteria before
  calling the work done.
- Prefer Server Actions for form mutations from our own UI, Route Handlers for anything a
  machine calls (webhooks, health, admin scripts).
- The three audiences are one app split by path, using App Router route groups so the folder name
  stays out of the URL: `app/(storefront)/`, `app/(vendor)/vendor/`, `app/(admin)/admin/`. Each
  group owns its layout. Note that separate root layouts require deleting `app/layout.tsx`, and
  navigation between groups then becomes a full page load.
- **Next.js 16 renamed `middleware.ts` to `proxy.ts`.** Use it only for the optimistic redirect
  (no session cookie on a `/vendor` path → bounce to login). Next's own docs say it "should not be
  used as a full session management or authorization solution", which is the same conclusion §5.4
  reaches from the other direction: putting a route under `/vendor` organizes code, it does not
  protect anything. The real check is the scoped data-access layer.
- **A green local run is not evidence CI will pass.** `make check` reuses an installed
  `node_modules` and a warm `.next/`; CI starts from `npm ci` on a bare Linux checkout, which is
  what exposed both of the traps above. Before claiming CI is green, either push and read the run,
  or reproduce it properly:
  `docker run --rm -v "$PWD":/app -w /app node:22-slim sh -c "npm i -g npm@11 && npm ci && npm run typecheck"`.
- **Liveness and readiness answer different questions and must not be merged.** Failing liveness
  restarts a container; failing readiness pulls it out of the load balancer. Never add a dependency
  check to `/api/health` — that is how a single Redis blip becomes a fleet-wide restart loop. New
  dependencies go in `/api/ready`, each with its own timeout.
- Decisions that a reviewer would question belong in `docs/adr/` as one-page
  context / decision / consequences records — not in code comments.
