/**
 * Plan 04-02 Task 1 — the flagship `add-gate` StructuralAdapter.
 *
 * Copies the synthetic harness-v37 tree into a writable temp dir, applies an
 * add-gate detail, and asserts: the gate is inserted; re-applying is idempotent (no
 * duplicate); the returned file list is exactly ["config/gates.yaml"]; and
 * validate/apply reject a target that resolves outside the temp harnessRoot (T-04-06).
 */

import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { addGateAdapter } from "../../src/applicator/add-gate.js";
import type { AddGateDetail } from "../../src/schema-v2.js";

const here = dirname(fileURLToPath(import.meta.url));
const harnessFixture = join(here, "..", "fixtures", "harness-v37");

const GATES = "config/gates.yaml";

function makeDetail(overrides: Partial<AddGateDetail> = {}): AddGateDetail {
  return {
    kind: "add-gate",
    insertAfter: "tool.call:write_file",
    gate: "verify-write",
    condition: "verify the written file before continuing",
    targetFiles: [GATES],
    ...overrides,
  };
}

describe("addGateAdapter", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lucid-addgate-"));
    cpSync(harnessFixture, root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("inserts the verify gate and returns the written file list", () => {
    const detail = makeDetail();
    expect(addGateAdapter.validate(detail, root)).toEqual({ ok: true });

    const written = addGateAdapter.apply(detail, root);
    expect(written).toEqual([GATES]);

    const content = readFileSync(join(root, GATES), "utf8");
    expect(content).toContain("- id: verify-write");
    expect(content).toContain("after: tool.call:write_file");
    expect(content).toContain("requires: verify the written file before continuing");
  });

  it("is idempotent — re-applying does not duplicate the gate", () => {
    const detail = makeDetail();
    addGateAdapter.apply(detail, root);
    const afterFirst = readFileSync(join(root, GATES), "utf8");

    const written = addGateAdapter.apply(detail, root);
    expect(written).toEqual([GATES]);
    const afterSecond = readFileSync(join(root, GATES), "utf8");

    // Byte-identical re-apply, and exactly one gate entry.
    expect(afterSecond).toBe(afterFirst);
    const occurrences = afterSecond.split("- id: verify-write").length - 1;
    expect(occurrences).toBe(1);
  });

  it("validate rejects a target that resolves outside harnessRoot (T-04-06)", () => {
    const escape = makeDetail({ targetFiles: ["../../etc/passwd"] });
    const result = addGateAdapter.validate(escape, root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/outside harnessRoot|absolute/);
  });

  it("apply throws on a target that resolves outside harnessRoot (T-04-06)", () => {
    const escape = makeDetail({ targetFiles: ["../../../tmp/evil.yaml"] });
    expect(() => addGateAdapter.apply(escape, root)).toThrow(/outside harnessRoot|absolute/);
  });
});
