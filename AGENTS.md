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

Phase 0 (Foundation) of the §15 build plan, partially complete. What exists today:

- Next.js 16 App Router scaffold (`app/`) — still just the starter page, no route groups yet.
  TypeScript `strict: true`, Tailwind v4, ESLint flat config.
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
- All the runtime dependencies from §3 already installed (BullMQ, ioredis, Stripe, Nodemailer,
  Meilisearch, Sharp, AWS S3 SDK, Zod) plus the test tooling (Vitest, Playwright, Testcontainers,
  axe-core) — installed but **not yet configured or used**.

Not yet started: the cache abstraction and key registry from §6, the scoped data-access layer from
§5.4, `/api/health` and `/api/ready`, CI, seed data, and every route beyond the scaffold page.
Closing out Phase 0 needs the health endpoints, a Vitest config with one passing test, and a CI
workflow ("CI green on an empty test" is the §15 acceptance bar).

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
app/                 Next.js App Router routes (currently just the scaffold page)
  (storefront)/      planned — customer-facing: /, /c, /p, /v/[vendor], cart, checkout, account
  (vendor)/vendor/   planned — seller dashboard
  (admin)/admin/     planned — platform back office
src/                 All cross-cutting app code — auth.ts, redis.ts
src/db/              Drizzle client (index.ts) and schema (schema.ts)
docs/                The requirements spec and caching.md / scaling-challenges.md
docs/adr/            Architecture Decision Records — 0001 multi-vendor, 0002 session staleness
drizzle/             Generated migrations — 0000 is applied; never hand-edit an applied file
```

`src/` is the single home for shared code; `lib/` existed briefly and is gone. Do not reintroduce
it.

## Commands

```bash
npm run dev                          # next dev
npm run build                        # next build
npm run lint                         # eslint
npm run db:push                      # drizzle-kit push — DO NOT USE; migrations exist, this causes drift
npx drizzle-kit generate             # emit a migration from schema.ts
npx drizzle-kit migrate              # apply migrations to DATABASE_URL
npx @better-auth/cli generate        # regenerate the Better Auth tables — do not hand-edit them
```

A `Makefile` (`make up`, `make down`, `make seed`, `make test`, `make load`, `make logs`,
`make reconcile`) is required by §12.4 and does not exist yet; add targets there as the stack
comes together. `make reconcile` asserts that every vendor balance equals its ledger sum and
every order's split reconciles to the captured amount — it is a definition-of-done item (§17).

## Environment

`.env` is gitignored; `.env.example` must document **every** variable. Currently only
`DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` are defined — extend both files
together whenever a new service is wired in.

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
- Decisions that a reviewer would question belong in `docs/adr/` as one-page
  context / decision / consequences records — not in code comments.
