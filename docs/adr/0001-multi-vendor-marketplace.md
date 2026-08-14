# ADR 0001: Cartwright is a multi-vendor marketplace

- **Status:** Accepted
- **Date:** 2026-08-14
- **Supersedes:** the "multi-vendor marketplaces" exclusion in §2.2 of spec v1.1
- **Spec:** `docs/Cartwright-Requirements-Spec-v1.2.md`

## Context

Spec v1.1 built a single-tenant shop and listed multi-vendor marketplaces first among the things
explicitly out of scope. That was a defensible cut: the marketplace surface is large, and the
project's stated value is infrastructure work — caching policy, concurrency correctness,
background jobs, load-test evidence — not product breadth.

Revisiting it, the cut removes the two most interesting problems the domain has to offer:

1. **Split payments.** One customer payment that must be divided among several independent
   recipients, tracked in a ledger that reconciles to the cent, and unwound correctly when a
   refund arrives after the money has already left. This is payments engineering, and it is
   materially harder and more distinctive than "charge a card and mark the order paid".
2. **Tenant isolation.** Semi-trusted third parties with their own logins reading and writing
   the same tables as everyone else. This turns authorization from a role check into a data-layer
   invariant, and it is a class of problem that generalises to most B2B systems.

Neither is a feature bolted onto a shop. Both are consequences of the data model, which is why
this decision has to be made before Phase 1 rather than discovered during Phase 6.

The counter-argument is real and was weighed: the build goes from roughly 8–9 weeks to 12–14
part-time, and an unfinished marketplace is worth less than a finished shop. The judgement is that
the incremental weeks buy disproportionate signal, and that the scope inside multi-vendor can be
bounded aggressively (§2.2) to keep the finish line reachable.

## Decision

Cartwright becomes a multi-vendor marketplace. Five sub-decisions define what that means; each is
recorded here rather than as five separate ADRs because they only make sense together.

### 1. Vendors are a first-class entity, membership is separate from role

`vendors` holds the selling entity. `vendor_members` maps humans to vendors with a role
(`owner` / `manager` / `staff`). `user.role` stays `customer | admin` and gains no `vendor` value.

Platform role and vendor membership are orthogonal axes. A person can be a customer, own one
vendor, and work for another. Collapsing these into a single enum, or hanging a `vendor_id` off
`user`, makes staff accounts and ownership transfer impossible to add later without a migration
that touches every authorization path.

### 2. Orders split into sub-orders

`orders` is the customer's receipt: one buyer, one address, one payment, one grand total.
`vendor_orders` is the unit of work: one per vendor, with its own status, shipping, fulfilment,
commission and payout. `order_items` hang off the sub-order, carrying both keys with a composite
foreign key so an item cannot be attached to a sub-order from a different order.

The alternative — one `orders` row per vendor grouped by an `order_group_id` — is nearly
isomorphic, but it makes the customer's own order the derived concept. Every "show me my order"
query becomes an aggregation, and the invoice has no single row to hang off. Putting the
customer-facing entity at the top and the operational entity underneath matches how both
audiences actually think about it.

Rejected outright: keeping one flat order with `vendor_id` on `order_items`. Per-vendor status,
fulfilment and payout all need somewhere to live, and that somewhere is a row.

### 3. Separate charges and transfers, not destination charges

The customer pays **once** into the platform's Stripe account. After the payment webhook
confirms, each vendor's ledger is credited. Transfers to vendors' Connect accounts are created
later, per sub-order.

Destination charges were the alternative: Stripe splits at charge time via `transfer_data`. It is
less code and the accounting is Stripe's problem. It was rejected because a destination charge has
exactly one destination, so a basket spanning three vendors becomes three PaymentIntents — three
authorizations, three entries on the customer's statement, and three ways for a basket to end up
partially paid. Recovering from "two of three charges succeeded" is a worse problem than the one
separate transfers create.

Rejected also: simulating payouts with a ledger and no real money movement. It is much less work
and demonstrates the accounting, but it skips the failure modes — retries, reversals, accounts
that cannot receive funds — which are the parts worth having built.

Connect **Express** accounts specifically, so Stripe hosts onboarding and owns KYC. Building
identity verification is neither interesting here nor something to be responsible for.

### 4. Payouts release on fulfilment plus a hold period

A transfer is created when a vendor marks their sub-order fulfilled, with
`available_at = now() + payout_hold_days`. A repeatable sweeper picks up due transfers using
`FOR UPDATE SKIP LOCKED` and creates the Stripe Transfer with an idempotency key derived from the
sub-order id.

Paying at payment time would mean every refund is a clawback from a vendor who already has the
money — and clawbacks either fail or make the platform the creditor. Releasing after the vendor
has done the work, with a hold window for refunds to land in, keeps the common case clean.

**Money owed is derived, never stored.** `vendor_balance_entries` is append-only and a balance is
its sum, mirroring how `inventory_ledger` relates to `inventory`. A mutable `balance_cents` column
would drift, and a drifting money column is worse than no column.

### 5. Per-vendor shipping

Each vendor has a flat-rate table and ships its own parcel. A three-vendor basket is three
shipments and three shipping charges, shown as such on the cart page before checkout.

A single platform rate apportioned across vendors is simpler and dishonest: the parcels are
genuinely separate, arriving on different days from different places, and hiding that until the
confirmation email is the most common complaint about marketplaces.

## Consequences

**What this buys.** A split-payment ledger that reconciles under concurrent refunds and reversals;
a tenant-isolation story enforced at the data layer; six new failure modes in §10 that are
genuinely hard (cross-vendor deadlock, double payout, rounding drift, cross-tenant leak, refund
after transfer, noisy neighbour); and a résumé claim in payments engineering rather than
storefront construction.

**What it costs.**

- Roughly four to five additional weeks part-time, concentrated in Phases 1, 6 and 7.
- Nine new tables and seven altered ones; the migration is not incremental, which is why it lands
  before any domain data exists.
- SKU uniqueness narrows from global to per-vendor — the correct constraint, but one that will
  surprise anyone reading the schema with a single-tenant model in their head.
- Every vendor-scoped query must go through the scoped data-access layer. This is the project's
  most likely source of a real security bug, and §11.3 test 22 exists specifically to fail when
  someone adds a route and forgets.
- Two Stripe webhook endpoints with two signing secrets.
- An accounting obligation: `make reconcile` must exit zero, and it becomes a definition-of-done
  item rather than a nice-to-have.

**Accepted risks.** Vendor balances may go negative after a refund on an already-transferred
order; this is modelled and netted against future sales rather than prevented. The membership
cache (`cw:memberships:{userId}`) introduces a bounded staleness window on authorization data, the
same trade-off as the session cookie cache — suspension takes effect within the TTL, and the test
asserts the bound rather than assuming it.

**Deferred.** Whether tenant scoping is enforced by application-layer query building or by
Postgres row-level security is left open, and gets its own ADR once the pgBouncer transaction-
pooling interaction has been measured. The application layer is the default until then.
