/**
 * GREEN as of plan 03-02 (was a Wave-0 RED scaffold).
 *
 * Contract being pinned: the flagship `feedback.no-verify-after-mutation` finding
 * maps to exactly ONE `add-gate` candidate whose `detail` names the offending
 * tools (db.write, api.post) and contains no raw trace content (tool NAMES only).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DiagnosticResultSchema, NO_VERIFY_AFTER_MUTATION_ID } from "@lucid/diagnostic";
import { findingToChangeSets } from "../../src/mapper/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const loadDiagnostic = () =>
  DiagnosticResultSchema.parse(
    JSON.parse(
      readFileSync(
        join(here, "..", "fixtures", "golden-diagnostic-empty-feedback.json"),
        "utf8",
      ),
    ),
  );

describe("findingToChangeSets — flagship feedback.no-verify-after-mutation", () => {
  it("maps the flagship finding to a single add-gate candidate naming the offending tools", () => {
    const diagnostic = loadDiagnostic();
    const finding = diagnostic.findings.find(
      (f) => f.detectorId === NO_VERIFY_AFTER_MUTATION_ID,
    )!;

    const candidates = findingToChangeSets(finding, diagnostic);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].change).toBe("add-gate");
    expect(candidates[0].detail).toContain("db.write");
    expect(candidates[0].detail).toContain("api.post");
    // No raw trace content / arguments — tool NAMES only (T-03-01).
    expect(candidates[0].rationale).toContain("F1");
  });
});
