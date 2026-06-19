/**
 * ChangeManifestV2Schema — the machine-parseable apply contract (Task 1, REQ-05).
 *
 * Asserts the frozen Wave-0 properties: the v2 fixture parses; a v1 prose-string
 * detail is rejected; a change ↔ detail.kind mismatch is rejected; targetFiles
 * path-traversal (a `..` segment or an absolute path) is rejected; an agentId that
 * disagrees with target is rejected; schema_version other than "2" is rejected.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, it, expect } from "vitest";

import { ChangeManifestV2Schema } from "../../src/schema-v2.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "..", "fixtures", "change-manifest-v2-add-gate.json");
const validFixture = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

/** A deep-cloned, known-valid v2 add-gate manifest the negative cases mutate. */
function baseManifest(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(validFixture)) as Record<string, unknown>;
}

describe("ChangeManifestV2Schema", () => {
  it("parses the golden v2 add-gate fixture (change and detail.kind both add-gate)", () => {
    const parsed = ChangeManifestV2Schema.parse(validFixture);
    expect(parsed.schema_version).toBe("2");
    expect(parsed.change).toBe("add-gate");
    expect(parsed.detail.kind).toBe("add-gate");
    expect(parsed.agentId).toBe("my-agent");
    expect(parsed.detail.targetFiles).toContain("config/gates.yaml");
  });

  it("REJECTS a v1 prose-string detail (the v1 shape)", () => {
    const m = baseManifest();
    m.detail = "Insert a verify gate after every write_file tool call.";
    expect(() => ChangeManifestV2Schema.parse(m)).toThrow();
  });

  it("REJECTS a manifest whose top-level change disagrees with detail.kind", () => {
    const m = baseManifest();
    m.change = "prompt-patch"; // detail.kind is still "add-gate"
    expect(() => ChangeManifestV2Schema.parse(m)).toThrow();
  });

  it("REJECTS a targetFiles entry containing a parent-directory segment", () => {
    const m = baseManifest();
    (m.detail as Record<string, unknown>).targetFiles = ["../../etc/passwd"];
    expect(() => ChangeManifestV2Schema.parse(m)).toThrow();
  });

  it("REJECTS an absolute targetFiles path", () => {
    const m = baseManifest();
    (m.detail as Record<string, unknown>).targetFiles = ["/etc/passwd"];
    expect(() => ChangeManifestV2Schema.parse(m)).toThrow();
  });

  it("REJECTS an agentId that disagrees with the agent component of target", () => {
    const m = baseManifest();
    m.agentId = "someone-else"; // target is "my-agent@v37"
    expect(() => ChangeManifestV2Schema.parse(m)).toThrow();
  });

  it("REJECTS a schema_version other than \"2\"", () => {
    const m = baseManifest();
    m.schema_version = "1";
    expect(() => ChangeManifestV2Schema.parse(m)).toThrow();
  });

  it("accepts every one of the five change kinds with a matching detail", () => {
    const target = "my-agent@v37";
    const agentId = "my-agent";
    const common = {
      target,
      agentId,
      rationale: "r",
      evidence_ref: "lucid://findings/F1",
      expected_effect: { feedback: 0.1 },
      status: "accepted" as const,
      estimator: "rule-based" as const,
      generated_at: "2026-06-18T12:00:00.000Z",
    };
    const details: Array<{ change: string; detail: Record<string, unknown> }> = [
      { change: "add-gate", detail: { kind: "add-gate", insertAfter: "t", gate: "g", condition: "c", targetFiles: ["config/gates.yaml"] } },
      { change: "trim-context", detail: { kind: "trim-context", removeSource: "stale-doc", targetFiles: ["context-policy/budget.yaml"] } },
      { change: "edit-skill", detail: { kind: "edit-skill", skillId: "search", instruction: "i", targetFiles: ["skills/search.ts"] } },
      { change: "prompt-patch", detail: { kind: "prompt-patch", promptId: "system", instruction: "i", targetFiles: ["prompts/system.txt"] } },
      { change: "delete-layer", detail: { kind: "delete-layer", layerId: "old-layer", targetFiles: ["config/gates.yaml"] } },
    ];
    for (const [i, { change, detail }] of details.entries()) {
      const m = { id: `cm-${i}`, schema_version: "2", change, detail, ...common };
      expect(() => ChangeManifestV2Schema.parse(m)).not.toThrow();
    }
  });
});
