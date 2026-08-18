/**
 * The one call a `/vendor` page or Server Action makes to get a scoped handle.
 *
 * `forVendor` in `src/db/scoped.ts` deliberately takes an already-resolved user
 * rather than reading the session itself, so it can be unit-tested without
 * standing up auth. That leaves two steps a page would otherwise repeat: fetch
 * the session, and turn this layer's errors into HTTP outcomes. Repeated setup
 * is how a route ends up unprotected, so it lives here instead:
 *
 *     const shop = await requireVendor(vendorSlug);
 *     const products = await shop.products.list();
 *
 * Anything that goes wrong — no session, no membership, wrong vendor, suspended
 * shop — ends as Next's `notFound()`, which renders the 404 page. §5.4 requires
 * 404 rather than 403 so another vendor's resources are indistinguishable from
 * ones that never existed.
 *
 * This is a convenience, not the security boundary. The boundary is the vendor
 * predicate inside `ScopedDb`; a page that somehow skipped this helper and
 * called `forVendor` directly would be exactly as isolated. That is the point of
 * putting enforcement in the data layer rather than in a route guard.
 */
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { auth } from "./auth";
import {
  NotFoundError,
  forVendor,
  type ActingUser,
  type ScopedDb,
} from "./db/scoped";

/**
 * Resolve the acting user from the Better Auth session, or null when signed
 * out.
 *
 * Note this reads the session on every call rather than caching it: §6.5 puts
 * sessions in Redis behind a 5-minute `cookieCache`, so the cost is already
 * bounded and usually zero network hops. Caching it again here would add a
 * second staleness window on top of the one ADR 0002 already reasons about.
 */
export async function getActingUser(): Promise<ActingUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  return {
    id: session.user.id,
    // Better Auth types this as an optional additional field; the column has a
    // NOT NULL default of 'customer', so the fallback is belt-and-braces.
    role: (session.user as { role?: string }).role ?? "customer",
  };
}

/**
 * Scoped handle for `vendorSlug`, or a 404.
 *
 * Signed-out callers also get 404 rather than a redirect: whether a vendor slug
 * exists is not something an anonymous visitor should be able to probe. The
 * optimistic login redirect belongs in `proxy.ts`, which bounces `/vendor` paths
 * with no session cookie before a request ever reaches here — that is a UX
 * affordance, and this is the check that actually holds.
 */
export async function requireVendor(vendorSlug: string): Promise<ScopedDb> {
  const user = await getActingUser();
  if (!user) notFound();

  try {
    return await forVendor(user, vendorSlug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/**
 * On `ForbiddenError`, and why there is no helper for it here.
 *
 * Next ships `forbidden()` for rendering a 403, but it is experimental and
 * gated behind `experimental.authInterrupts` in `next.config.ts`. Turning on an
 * experimental flag to save a try/catch is a poor trade — it would apply to the
 * whole app, and the flag can change shape between releases.
 *
 * So `ForbiddenError` propagates. Two ways to handle it, both better than a
 * global interrupt:
 *
 * 1. Preferred — do not render what the role cannot reach. `ScopedDb.context`
 *    exposes the acting role, so a `staff` dashboard can simply omit the payout
 *    panel. An error page is a poor substitute for a UI that never offered the
 *    action.
 * 2. Backstop — catch it in `app/(vendor)/vendor/error.tsx`, which is where an
 *    unexpected throw from a page body should surface anyway.
 *
 * Revisit if `authInterrupts` stabilises; a 403 page is the better outcome for
 * a deep-linked URL than a generic error boundary.
 */
