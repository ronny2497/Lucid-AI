import { defineConfig } from "vitest/config";

/**
 * Vitest config for @lucid/evolution.
 *
 * Runs every `*.test.ts` under `tests/` once (no watch). In Wave 0 (plan 03-01)
 * only the schema test (`tests/schema`) is GREEN; the mapper and integration
 * scaffolds (`tests/mapper`, `tests/integration`) are intentionally RED until
 * Plan 03-02 lands the `findingToChangeSets` mapper, the rule-based estimator,
 * and the `propose()` orchestrator they import.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    watch: false,
  },
});
