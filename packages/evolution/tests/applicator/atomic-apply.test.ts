/**
 * Plan 04-02 Task 2 — applyManifest atomic orchestration + resolveAdapter dispatch.
 *
 * Proves the load-bearing safety property (Pitfall 1): a partial apply can never
 * persist. The fault-injection test wraps an adapter whose `apply` writes one file
 * then throws; after applyManifest returns failure the whole harness is byte-identical
 * to the pre-apply snapshot.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { applyManifest, resolveAdapter } from "../../src/applicator/index.js";
import { addGateAdapter } from "../../src/applicator/add-gate.js";
import type { StructuralAdapter } from "../../src/applicator/adapter.js";
import { atomicWriteFile, assertWithinRoot } from "../../src/applicator/adapter.js";
import { FileVersionRegistry } from "../../src/version-registry.js";
import { ChangeManifestV2Schema, type ChangeManifestV2 } from "../../src/schema-v2.js";

const here = dirname(fileURLToPath(import.meta.url));
const harnessFixture = join(here, "..", "fixtures", "harness-v37");

const GATES = "config/gates.yaml";
const BUDGET = "context-policy/budget.yaml";

function addGateManifest(targetFiles: string[] = [GATES]): ChangeManifestV2 {
  return ChangeManifestV2Schema.parse({
    id: "cm-test-1",
    schema_version: "2",
    target: "my-agent@v37",
    agentId: "my-agent",
    change: "add-gate",
    detail: {
      kind: "add-gate",
      insertAfter: "tool.call:write_file",
      gate: "verify-write",
      condition: "verify the written file before continuing",
      targetFiles,
    },
    rationale: "no verify gate after mutating tool call",
    evidence_ref: "lucid://findings/F1",
    expected_effect: { feedback: 0.15 },
    status: "accepted",
    estimator: "rule-based",
    generated_at: "2026-06-18T12:00:00.000Z",
  });
}

describe("applyManifest (atomic apply)", () => {
  let root: string;
  let registry: FileVersionRegistry;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lucid-apply-"));
    cpSync(harnessFixture, root, { recursive: true });
    registry = new FileVersionRegistry(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("happy path: snapshots, applies, returns success + candidate version v38", async () => {
    const manifest = addGateManifest();
    const result = await applyManifest(manifest, registry, addGateAdapter, root, "v37");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.candidateVersion).toBe("v38");
      expect(result.writtenFiles).toEqual([GATES]);
      expect(result.snapshot.files.map((f) => f.path)).toEqual([GATES]);
    }
    const content = readFileSync(join(root, GATES), "utf8");
    expect(content).toContain("- id: verify-write");
  });

  it("FAULT INJECTION: a mid-apply throw reverts the harness byte-identical", async () => {
    // A manifest touching TWO targets so the faulty adapter can write one, then throw.
    const manifest = addGateManifest([GATES, BUDGET]);
    const originalGates = readFileSync(join(root, GATES));
    const originalBudget = readFileSync(join(root, BUDGET));

    // Faulty adapter: writes the first target, then throws (partial apply).
    const faulty: StructuralAdapter = {
      changeKind: "add-gate",
      validate: () => ({ ok: true }),
      apply: (detail, harnessRoot) => {
        const [firstAbs] = assertWithinRoot(detail.targetFiles, harnessRoot);
        atomicWriteFile(firstAbs, "gates: [] # half-applied\n");
        throw new Error("injected mid-apply failure");
      },
    };

    const result = await applyManifest(manifest, registry, faulty, root, "v37");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.rolledBackTo).not.toBeNull();
      expect((result.error as Error).message).toMatch(/injected mid-apply failure/);
    }

    // Byte-identical restore of BOTH snapshotted files.
    expect(readFileSync(join(root, GATES)).equals(originalGates)).toBe(true);
    expect(readFileSync(join(root, BUDGET)).equals(originalBudget)).toBe(true);
  });

  it("validate-fail path: target outside harnessRoot returns failure, no write, rolledBackTo null", async () => {
    // Build a manifest with an escaping target. The schema rejects `..`, so bypass it
    // by constructing the object directly (the adapter's own guard is what we test).
    const manifest = {
      ...addGateManifest(),
      detail: {
        kind: "add-gate" as const,
        insertAfter: "x",
        gate: "g",
        condition: "c",
        targetFiles: ["../../etc/passwd"],
      },
    } as ChangeManifestV2;

    const originalGates = readFileSync(join(root, GATES));
    const result = await applyManifest(manifest, registry, addGateAdapter, root, "v37");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.rolledBackTo).toBeNull();
    }
    // Nothing in the harness changed.
    expect(readFileSync(join(root, GATES)).equals(originalGates)).toBe(true);
  });

  it("resolveAdapter dispatches per kind and throws on an unknown kind", () => {
    expect(resolveAdapter("add-gate").changeKind).toBe("add-gate");
    expect(resolveAdapter("trim-context").changeKind).toBe("trim-context");
    expect(resolveAdapter("edit-skill").changeKind).toBe("edit-skill");
    expect(resolveAdapter("prompt-patch").changeKind).toBe("prompt-patch");
    expect(resolveAdapter("delete-layer").changeKind).toBe("delete-layer");
    // @ts-expect-error — an unknown kind is rejected at the closed-taxonomy boundary.
    expect(() => resolveAdapter("retrain-weights")).toThrow(/closed taxonomy/);
  });
});
