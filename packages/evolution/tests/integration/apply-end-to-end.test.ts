/**
 * apply() end-to-end — the EC-1/EC-2/EC-3 phase exit gate (Plan 04-04, Task 3, REQ-05).
 *
 * This was the RED Wave-0 scaffold from 04-01; 04-04 turns it GREEN by driving the
 * real `apply()` against the `harness-v37` fixture copied to a temp dir, with a REAL
 * `FileVersionRegistry` + `FileApplyStore` + a capturing emit sink. The ONLY mocked
 * collaborator is the guard's `diagnoseFn`/`traceQuery` (so a regression can be
 * injected deterministically); the harness writes and the snapshot/revert are real.
 *
 *   EC-1 (KEEP)   — a KEEP add-gate v2 manifest (mock diagnose returns candidate >=
 *                   baseline) with an L1 config + approver applies the gate, advances
 *                   the manifest status to "applied", saves an ApplyRecord (verdict
 *                   KEEP, non-empty contentHash, the golden change/verdict/rollback
 *                   fields), and emits an evolve.apply(KEEP) event.
 *   EC-2 (REVERT) — a trim-context v2 manifest with an INJECTED regression (mock
 *                   diagnose returns a low candidate score) auto-rolls-back: the
 *                   affected file is byte-identical to the pre-apply snapshot, the
 *                   ApplyRecord verdict is REVERT with rollback_status "auto-rollback"
 *                   (matching the golden's change/verdict/rollback fields), and an
 *                   evolve.apply event records the rollback (NOT an evolve.rollback
 *                   event — that member does not exist).
 *   EC-3 (AUDIT)  — after EC-1 + EC-2, listApplyRecords({ agentId }) returns 2 records
 *                   (one KEEP, one REVERT), each with a non-empty contentHash and the
 *                   full audit field set.
 *   + the INSUFFICIENT_DATA path rolls back (a manifest whose mock traceQuery returns
 *     fewer than `sample` candidate traces) — never a silent keep.
 *
 * The golden fixtures encode the load-bearing shape (changeKind / verdict /
 * rollbackStatus / affectedFiles); the runtime-derived fields (id/createdAt/contentHash,
 * and the input-dependent from/to/approver/scores/evidence) are asserted structurally
 * rather than byte-for-byte against the golden, since they depend on the apply inputs.
 */

import { readFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { apply } from "../../src/index.js";
import { ChangeManifestV2Schema, type ChangeManifestV2 } from "../../src/schema-v2.js";
import { ApplyRecordSchema } from "../../src/apply-store.js";
import { AutonomyConfigSchema, type AutonomyConfig } from "../../src/apply-config.js";
import { FileVersionRegistry } from "../../src/version-registry.js";
import { FileApplyStore } from "../../src/apply-store.js";
import type { ApplyDeps } from "../../src/apply.js";
import type { EvolveApplyRecord } from "../../src/hsc-emit-apply.js";
import type { CohortTrace, DiagnoseFn, GuardTraceFilter } from "../../src/guard.js";
import type { DiagnosticResult } from "@lucid/diagnostic";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "..", "fixtures");
const harnessFixture = join(fixturesRoot, "harness-v37");

const addGateManifest: ChangeManifestV2 = ChangeManifestV2Schema.parse(
  JSON.parse(readFileSync(join(fixturesRoot, "change-manifest-v2-add-gate.json"), "utf8")),
);
const goldenKeep = ApplyRecordSchema.parse(
  JSON.parse(readFileSync(join(fixturesRoot, "golden-apply-add-gate.json"), "utf8")),
);
const goldenRevert = ApplyRecordSchema.parse(
  JSON.parse(readFileSync(join(fixturesRoot, "golden-apply-rollback.json"), "utf8")),
);

const trimManifest: ChangeManifestV2 = ChangeManifestV2Schema.parse({
  id: "cm-trim-22",
  schema_version: "2",
  target: "my-agent@v37",
  agentId: "my-agent",
  change: "trim-context",
  detail: {
    kind: "trim-context",
    removeSource: "stale-design-notes",
    targetFiles: ["context-policy/budget.yaml"],
  },
  rationale: "Drop the stale design-notes source to tighten the context budget.",
  evidence_ref: "lucid://findings/F2",
  expected_effect: { context: 0.1 },
  status: "accepted",
  estimator: "rule-based",
  generated_at: "2026-06-18T12:00:00.000Z",
});

const insufficientManifest: ChangeManifestV2 = ChangeManifestV2Schema.parse({
  ...trimManifest,
  id: "cm-trim-insufficient",
});

/** A fixed cohort of N successful traces. */
function cohortOf(n: number): CohortTrace[] {
  return Array.from({ length: n }, () => ({ statusCode: 200 }));
}

/** A mock diagnose returning a fixed principle score for every trace. */
function diagnoseReturning(score: number | null): DiagnoseFn {
  return (): DiagnosticResult =>
    ({
      traceId: "t",
      agentId: "my-agent",
      principles: [
        { principle: "feedback", score, coverage: 1, hitCount: 1, relevantEventCount: 1, worstDetector: "" },
        { principle: "context", score, coverage: 1, hitCount: 1, relevantEventCount: 1, worstDetector: "" },
      ],
      findings: [],
      plot2x2: { cells: {}, emptyColumns: [], emptyRows: [] },
      generatedAt: "2026-06-18T00:00:00.000Z",
      llmJudgeEnabled: false,
    }) as DiagnosticResult;
}

/** A traceQuery that returns `baselineN` for the baseline version and `candidateN` else. */
function traceQueryFor(baselineVersion: string, baselineN: number, candidateN: number) {
  return {
    async queryTraces(filter: GuardTraceFilter): Promise<CohortTrace[]> {
      return cohortOf(filter.version === baselineVersion ? baselineN : candidateN);
    },
  };
}

const L1_FEEDBACK: AutonomyConfig = AutonomyConfigSchema.parse({
  autonomy: "L1",
  require_human_approval: true,
  guard: { regression_metric: "feedback", min_delta: 0, sample: 3 },
});
const L1_CONTEXT: AutonomyConfig = AutonomyConfigSchema.parse({
  autonomy: "L1",
  require_human_approval: true,
  guard: { regression_metric: "context", min_delta: 0, sample: 3 },
});

describe("apply() end-to-end — EC-1 / EC-2 / EC-3 (phase exit gate)", () => {
  let base: string;
  let registry: FileVersionRegistry;
  let store: FileApplyStore;
  let emitted: EvolveApplyRecord[];

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "lucid-apply-e2e-"));
    cpSync(harnessFixture, base, { recursive: true });
    registry = new FileVersionRegistry(base);
    store = new FileApplyStore(join(base, "apply-records.json"));
    emitted = [];
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function deps(diag: DiagnoseFn, baselineN: number, candidateN: number): ApplyDeps {
    return {
      registry,
      store,
      traceQuery: traceQueryFor("v37", baselineN, candidateN),
      diagnoseFn: diag,
      emit: (r) => emitted.push(r),
      harnessRoot: base,
      approvedBy: "auto-approver:guard",
    };
  }

  it("EC-1: a KEEP add-gate apply -> status 'applied' + KEEP ApplyRecord(contentHash) + evolve.apply(KEEP)", async () => {
    const gatesBefore = readFileSync(join(base, "config/gates.yaml"), "utf8");
    // candidate >= baseline -> KEEP (every trace scores 0.8).
    const out = await apply(addGateManifest, L1_FEEDBACK, deps(diagnoseReturning(0.8), 3, 3));

    expect(out.outcome).toBe("kept");
    if (out.outcome !== "kept") return;

    // The gate file actually changed.
    const gatesAfter = readFileSync(join(base, "config/gates.yaml"), "utf8");
    expect(gatesAfter).not.toBe(gatesBefore);
    expect(gatesAfter).toContain("verify-write");

    // The manifest status advanced to "applied" (returned, not mutated).
    expect(out.manifest.status).toBe("applied");
    expect(addGateManifest.status).toBe("accepted");

    // A KEEP ApplyRecord with a non-empty contentHash was saved.
    const records = await store.listApplyRecords({ agentId: "my-agent" });
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec.verdict).toBe("KEEP");
    expect(rec.changeKind).toBe(goldenKeep.changeKind); // add-gate
    expect(rec.rollbackStatus).toBe(goldenKeep.rollbackStatus); // none
    expect(rec.affectedFiles).toEqual(goldenKeep.affectedFiles); // ["config/gates.yaml"]
    expect(rec.toVersion).toBe("v38");
    expect(rec.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Exactly one evolve.apply(KEEP) event.
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event.name).toBe("evolve.apply");
    expect(emitted[0].body["harness.apply.verdict"]).toBe("KEEP");
    expect(emitted[0].body["harness.apply.rollback_status"]).toBe("none");
  });

  it("EC-2: a regressed trim-context apply auto-rolls-back byte-identical + REVERT record + rollback event", async () => {
    const budgetBefore = readFileSync(join(base, "context-policy/budget.yaml"), "utf8");
    // baseline 0.9, candidate 0.3 -> REVERT. Baseline cohort scores first, candidate after.
    let call = 0;
    const diag: DiagnoseFn = (() => {
      const baseline = diagnoseReturning(0.9);
      const candidate = diagnoseReturning(0.3);
      return (trace: unknown) => (++call <= 3 ? baseline(trace) : candidate(trace));
    })();
    const out = await apply(trimManifest, L1_CONTEXT, deps(diag, 3, 3));

    expect(out.outcome).toBe("rolled-back");
    if (out.outcome !== "rolled-back") return;
    expect(out.verdict.verdict).toBe("REVERT");

    // The affected file is byte-identical to the pre-apply content (auto-rollback restored it).
    const budgetAfter = readFileSync(join(base, "context-policy/budget.yaml"), "utf8");
    expect(budgetAfter).toBe(budgetBefore);

    // A REVERT ApplyRecord with rollback_status "auto-rollback".
    const records = await store.listApplyRecords({ agentId: "my-agent", status: "REVERT" });
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec.verdict).toBe(goldenRevert.verdict); // REVERT
    expect(rec.rollbackStatus).toBe(goldenRevert.rollbackStatus); // auto-rollback
    expect(rec.changeKind).toBe(goldenRevert.changeKind); // trim-context
    expect(rec.affectedFiles).toEqual(goldenRevert.affectedFiles); // ["context-policy/budget.yaml"]
    expect(rec.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // An evolve.apply event recorded the rollback (NOT an evolve.rollback event).
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event.name).toBe("evolve.apply");
    expect(emitted[0].body["harness.apply.rollback_status"]).toBe("auto-rollback");
  });

  it("EC-3: after a KEEP + a REVERT, listApplyRecords returns 2 records each with a contentHash", async () => {
    // EC-1 KEEP.
    await apply(addGateManifest, L1_FEEDBACK, deps(diagnoseReturning(0.8), 3, 3));
    // EC-2 REVERT.
    let call = 0;
    const diag: DiagnoseFn = (() => {
      const baseline = diagnoseReturning(0.9);
      const candidate = diagnoseReturning(0.3);
      return (trace: unknown) => (++call <= 3 ? baseline(trace) : candidate(trace));
    })();
    await apply(trimManifest, L1_CONTEXT, deps(diag, 3, 3));

    const records = await store.listApplyRecords({ agentId: "my-agent" });
    expect(records).toHaveLength(2);
    const verdicts = records.map((r) => r.verdict).sort();
    expect(verdicts).toEqual(["KEEP", "REVERT"]);
    for (const r of records) {
      expect(r.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      // Full audit field set present.
      expect(r.manifestId).toBeTruthy();
      expect(r.agentId).toBe("my-agent");
      expect(r.fromVersion).toBeTruthy();
      expect(r.toVersion).toBeTruthy();
      expect(r.approvedBy).toBeTruthy();
      expect(r.createdAt).toBeTruthy();
    }
  });

  it("INSUFFICIENT_DATA: an under-sampled candidate cohort rolls back (never a silent keep)", async () => {
    const budgetBefore = readFileSync(join(base, "context-policy/budget.yaml"), "utf8");
    // candidate cohort 1 < sample 3 -> INSUFFICIENT_DATA -> rollback.
    const out = await apply(insufficientManifest, L1_CONTEXT, deps(diagnoseReturning(0.9), 3, 1));
    expect(out.outcome).toBe("rolled-back");
    if (out.outcome !== "rolled-back") return;
    expect(out.verdict.verdict).toBe("INSUFFICIENT_DATA");
    // Files restored byte-identical.
    expect(readFileSync(join(base, "context-policy/budget.yaml"), "utf8")).toBe(budgetBefore);
    const records = await store.listApplyRecords({ agentId: "my-agent", status: "REVERT" });
    expect(records).toHaveLength(1);
  });
});
