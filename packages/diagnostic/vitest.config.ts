import { defineConfig } from "vitest/config";

/**
 * Vitest config for @lucid/diagnostic.
 *
 * Runs every `*.test.ts` under `tests/` once (no watch). In Wave 0/1 only the
 * schema test (`tests/schema`) is GREEN; the detector/scorer/plotter/integration
 * scaffolds are intentionally RED until Plans 02-02 .. 02-04 land the
 * implementation modules they import.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    watch: false,
  },
});
