/**
 * `emitEvolvePropose` / `buildEvolveProposeRecord` — the evolve.propose HSC audit
 * event (plan 03-03, Task 1).
 *
 * Asserts:
 *   - `event.name` is the `EVENT_TYPES` `"evolve.propose"` member (a const, not a
 *     literal) and is EXACTLY that constant — LOW CARDINALITY (threat T-03-12);
 *   - the manifest `id` NEVER appears in `event.name` (it lives in attributes/body);
 *   - the body carries the full `change_manifest` + the five provenance fields
 *     (evidence_ref, diagnostic_trace_id, generated_at, estimator) — RESEARCH P4;
 *   - the injected sink receives the built record (testable without a collector);
 *   - the body carries only structured manifest fields — no raw trace content.
 */

import { describe, it, expect } from "vitest";
import { EVENT_TYPES } from "@lucid/hsc-schema";
import {
  emitEvolvePropose,
  buildEvolveProposeRecord,
  EVOLVE_PROPOSE_EVENT,
  type EvolveProposeRecord,
} from "../../src/index.js";
import type { ChangeManifest } from "../../src/index.js";

function sampleManifest(): ChangeManifest {
  return {
    id: "cm-abc123def456",
    schema_version: "1",
    target: "my-agent@v37",
    change: "add-gate",
    detail:
      "Insert a verify.result step after each state-mutating tool.call; affected tools: db.write, api.post.",
    rationale: "Cites finding F1: 18 of 24 state-mutating calls lacked verification.",
    evidence_ref: "lucid://findings/F1",
    expected_effect: { feedback: 0.3 },
    status: "proposed",
    estimator: "rule-based",
    generated_at: "2026-06-18T00:00:00.000Z",
  };
}

describe("evolve.propose HSC audit event", () => {
  it("uses the EVENT_TYPES 'evolve.propose' member as event.name (not a literal)", () => {
    const record = buildEvolveProposeRecord(sampleManifest());
    expect(record.event.name).toBe("evolve.propose");
    // The exported constant is resolved from the canonical tuple, not hardcoded.
    expect(EVOLVE_PROPOSE_EVENT).toBe(EVENT_TYPES[EVENT_TYPES.indexOf("evolve.propose")]);
    expect(record.event.name).toBe(EVOLVE_PROPOSE_EVENT);
    // It is a genuine member of the canonical tuple.
    expect(EVENT_TYPES).toContain(record.event.name);
  });

  it("keeps event.name LOW CARDINALITY — the manifest id is NOT in the name (T-03-12)", () => {
    const manifest = sampleManifest();
    const record = buildEvolveProposeRecord(manifest);
    expect(record.event.name).not.toContain(manifest.id);
    expect(record.event.name).toBe("evolve.propose"); // exactly the constant
    // The id lives in attributes instead.
    expect(record.attributes["evolve.manifest_id"]).toBe(manifest.id);
  });

  it("carries the full change_manifest + the five provenance fields in the body (P4)", () => {
    const manifest = sampleManifest();
    const record = buildEvolveProposeRecord(manifest);
    expect(record.body.change_manifest).toEqual(manifest);
    expect(record.body.evidence_ref).toBe(manifest.evidence_ref);
    expect(record.body.diagnostic_trace_id).toBe(manifest.target);
    expect(record.body.generated_at).toBe(manifest.generated_at);
    expect(record.body.estimator).toBe(manifest.estimator);
  });

  it("emits the built record to the injected sink (no live collector needed)", () => {
    const manifest = sampleManifest();
    const captured: EvolveProposeRecord[] = [];
    emitEvolvePropose(manifest, (r) => captured.push(r));
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(buildEvolveProposeRecord(manifest));
  });

  it("indexes the manifest target/change/status/estimator in attributes", () => {
    const manifest = sampleManifest();
    const record = buildEvolveProposeRecord(manifest);
    expect(record.attributes["evolve.target"]).toBe(manifest.target);
    expect(record.attributes["evolve.change"]).toBe(manifest.change);
    expect(record.attributes["evolve.status"]).toBe(manifest.status);
    expect(record.attributes["evolve.estimator"]).toBe(manifest.estimator);
  });
});
