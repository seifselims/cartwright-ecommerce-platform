# ADR 0002: Bounded staleness on session and membership reads

- **Status:** Accepted
- **Date:** 2026-08-15
- **Spec:** §6.2, §6.5 of `docs/Cartwright-Requirements-Spec-v1.2.md`
- **Related:** ADR 0001, which accepted the membership-cache half of this trade-off in passing

## Context

Every authenticated request needs to know two things: who the user is, and which vendors they may
act for. Both answers live in Postgres, and both are needed on essentially every request under
`/vendor` — the busiest authenticated path in the system.

Read naively, that is two queries per request before any page-specific work happens, on a path
that k6 will hammer in Phase 12. Better Auth offers two independent mitigations, and they have
different risk profiles:

1. **`secondaryStorage`** moves the session record itself out of Postgres and into Redis. This is
   a pure win: Redis is still a real lookup against a shared store, so revocation remains
   immediate. It trades a Postgres query for a Redis `GET`.
2. **`cookieCache`** goes further and skips the lookup entirely. The session payload is written
   into a signed cookie and trusted for `maxAge` seconds without consulting any store at all. The
   authenticated read path then costs zero network round-trips.

The second one is where the trade-off lives. A signed cookie cannot be un-issued. Once a session
payload is in the browser and trusted for five minutes, deleting the Redis key and the Postgres
row does not stop it from being accepted until it expires.

The `cw:memberships:{userId}` cache in §6.2 has the same shape for a different reason: it is a
short-TTL cache of authorization data, so a stale entry means a suspended vendor keeps working, or
a removed staff member keeps their access, for up to the TTL.

## Decision

Accept a bounded staleness window on both, sized explicitly, and treat the bound as something
tests assert rather than something the implementation happens to produce.

**Sessions.** `secondaryStorage` backed by the cache Redis, with `cookieCache` enabled at
`maxAge: 5 * 60`. Keys are prefixed `cw:auth:` and deliberately **not** versioned like the
`cw:v{n}:` cacheable shapes in §6.2 — a cache-version bump on deploy is a routine invalidation,
and it must not sign every user out.

**The Postgres row stays.** `storeSessionInDatabase: true` and `preserveSessionInDatabase: true`.
Redis is the read path; the row is a reconcilable source of truth for the admin session list and
the audit trail, and it is what makes the two known Better Auth sharp edges in §6.5 diagnosable
rather than mysterious.

**Memberships.** 5-minute TTL, invalidated explicitly on membership change and on vendor
suspension, so the TTL is the worst case rather than the normal case.

**Where the window is not acceptable, do not rely on it.** Any action whose blast radius is money
or another tenant's data re-reads authoritatively rather than trusting the cookie: payout and
banking changes, member management, and anything an admin does to suspend a vendor. The cookie
cache makes browsing cheap; it does not get to decide who may move money.

**Rate limiting shares the same storage** (`storage: "secondary-storage"`), and the
`SecondaryStorage.increment` hook is implemented rather than left to Better Auth's fallback. The
fallback is a non-atomic get-then-set, which lets N concurrent requests all pass a stale read
before any increment lands — a rate limiter that fails open under precisely the burst it exists to
stop. The implementation is `INCR` plus `EXPIRE ... NX` in a `MULTI`, which gives a fixed window
from the first request rather than one that slides forward on every hit.

## Consequences

**What this buys.** The authenticated read path costs zero database queries and, for up to five
minutes at a time, zero Redis queries. This is a large part of why the Phase 12 numbers will be
defensible, and it is measurable: the cache hit-rate metric in §13 will show it.

**What it costs.**

- **Revocation is not instant.** A signed-out or revoked session can be honoured for up to five
  minutes. Password change, sign-out and admin-forced revocation all inherit this.
- **Vendor suspension is not instant.** Up to five minutes, unless the explicit invalidation
  fires — which it should, making the TTL a backstop.
- **A stale membership entry is a security bug, not a rendering bug**, which is why it gets the
  strictest treatment of anything in the §6.2 table despite being one of the smallest values.
- Two mechanisms now answer "who is this?", and a bug in either looks like a bug in authorization.
  The Postgres row is what lets you tell them apart.

**Accepted risks.** Five minutes of post-revocation access is tolerable for this system: the worst
case is a customer's other browser session staying live briefly, or a removed staff member seeing
catalogue data for a few more minutes. It would not be tolerable if sessions carried entitlements
that could be spent, which is the reason money paths re-read.

**Tests that hold this honest.** §11.3 tests 15 and 16 assert the bound rather than assuming it —
that a revoked session stops working *within* the window rather than immediately, and that
updating a user does not leave other sessions serving stale data indefinitely. Test 16 exists
because Better Auth has had bugs in exactly this area under secondary storage; the tests prove the
behaviour on the installed version instead of trusting the changelog.

**Revisit if** the admin surface ever grows an action that must take effect immediately across all
sessions. The fix then is not to disable the cookie cache globally but to add a revocation
generation counter that the cookie carries and the cache checks — which reintroduces a lookup, and
should be scoped to the paths that need it.
