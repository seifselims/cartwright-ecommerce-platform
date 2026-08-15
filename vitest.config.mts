import { defineConfig } from "vitest/config";

/**
 * Unit tests only (§11.1, the `< 30 s` tier). Integration tests spin up real
 * Postgres and Redis via Testcontainers (rule 11) and have a minutes-long
 * budget, so they get their own project and config when Phase 1 needs them —
 * they must not be able to creep into this run and blow the budget.
 *
 * `include` is explicit rather than a bare recursive glob so that Playwright
 * specs under `e2e/`, which use a `test` export from a different runner, are
 * never collected.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    environment: "node",
    // Fail rather than silently pass when a filter matches nothing, so a typo
    // in a CI test filter cannot look like a green run.
    passWithNoTests: false,
  },
  resolve: {
    // Mirrors the `@/*` -> `./*` path alias in tsconfig.json.
    alias: { "@": new URL("./", import.meta.url).pathname },
  },
});
