/**
 * propose() integration — flagship golden path (GREEN as of 03-02).
 *
 * End-to-end golden test: load the real DiagnosticResult fixture, call
 * `propose(finding, diagnostic)`, and assert the produced ChangeManifest:
 *   - validates against `ChangeManifestSchema`;
 *   - deep-equals `expected-manifest-add-gate.json` EXCLUDING the non-deterministic
 *     `id` and `generated_at` fields;
 *   - is deterministic (two calls equal excluding `id`+`generated_at`);
 *   - carries status "proposed" (L0 — never applied);
 *   - rejects malformed DiagnosticResult input (threat T-03-04).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DiagnosticResultSchema } from "@lucid/diagnostic";
import { ChangeManifestSchema, propose } from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");
const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixtures, name), "utf8"));

const omitVolatile = (m: Record<string, unknown>) => {
  const { id: _id, generated_at: _gen, ...rest } = m;
  return rest;
};

describe("propose() integration — flagship golden path", () => {
  it("turns the golden DiagnosticResult into the expected add-gate ChangeManifest", () => {
    const diagnostic = DiagnosticResultSchema.parse(
      readFixture("golden-diagnostic-empty-feedback.json"),
    );
    const expected = readFixture("expected-manifest-add-gate.json") as Record<string, unknown>;

    const manifest = propose(diagnostic.findings[0], diagnostic);

    // Output must be a valid manifest.
    expect(() => ChangeManifestSchema.parse(manifest)).not.toThrow();

    // Deep-equals the golden expectation, excluding the non-deterministic fields.
    expect(omitVolatile(manifest as Record<string, unknown>)).toEqual(omitVolatile(expected));
  });

  it("emits status 'proposed' and estimator 'rule-based' (L0 — never applied)", () => {
    const diagnostic = DiagnosticResultSchema.parse(
      readFixture("golden-diagnostic-empty-feedback.json"),
    );
    const manifest = propose(diagnostic.findings[0], diagnostic);
    expect(manifest.status).toBe("proposed");
    expect(manifest.estimator).toBe("rule-based");
  });

  it("is deterministic — two calls are identical excluding id + generated_at", () => {
    const diagnostic = DiagnosticResultSchema.parse(
      readFixture("golden-diagnostic-empty-feedback.json"),
    );
    const a = propose(diagnostic.findings[0], diagnostic);
    const b = propose(diagnostic.findings[0], diagnostic);
    expect(omitVolatile(a as Record<string, unknown>)).toEqual(omitVolatile(b as Record<string, unknown>));
    // The content-derived id is also stable across calls on identical content.
    expect(a.id).toBe(b.id);
  });

  it("rejects a malformed DiagnosticResult before mapping (T-03-04)", () => {
    const diagnostic = DiagnosticResultSchema.parse(
      readFixture("golden-diagnostic-empty-feedback.json"),
    );
    const finding = diagnostic.findings[0];
    // principles must be an array of PrincipleScore; corrupt it.
    const malformed = { ...diagnostic, principles: "not-an-array" } as unknown;
    expect(() => propose(finding, malformed as never)).toThrow();
  });
});
