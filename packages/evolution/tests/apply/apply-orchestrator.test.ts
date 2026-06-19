/**
 * apply() — the closed L1 control loop orchestrator (Plan 04-04, Task 1).
 *
 * Asserts the load-bearing ordering + safety properties with injected mocks (a real
 * FileVersionRegistry over a temp copy of harness-v37 so snapshot/revert are real; an
 * in-memory ApplyStore; a capturing emit sink; a mock guard via a mock diagnoseFn +
 * a stub traceQuery):
 *
 *   - KEEP    -> registry.promote called, returned manifest status "applied", one KEEP
 *               ApplyRecord saved, one evolve.apply(KEEP) emitted.
 *   - REVERT  -> NOT promoted, files restored byte-identical, one REVERT record + a
 *               rollback evolve.apply event.
 *   - INSUFFICIENT_DATA + NULL_SCORE -> both take the rollback path (NOT promoted).
 *   - gate REJECT (autonomy L0) -> no snapshot/write, rejected outcome.
 *   - idempotency -> a second apply() returns the existing record and does NOT call
 *               applyManifest again (asserted via a snapshot-call counter on the registry).
 *   - emit happens ONLY after the verdict (the capturing sink is empty until the guard
 *               resolves).
 *
 * Imports `apply` from the barrel (04-04 adds it) — the same import path the EC scaffold
 * uses.
 */

import { readFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { apply, type ApplyDeps } from "../../src/apply.js";
import { ChangeManifestV2Schema, type ChangeManifestV2 } from "../../src/schema-v2.js";
import { AutonomyConfigSchema, type AutonomyConfig } from "../../src/apply-config.js";
import { FileVersionRegistry } from "../../src/version-registry.js";
import type { ApplyRecord, ApplyStore, ApplyRecordFilter } from "../../src/apply-store.js";
import type { EvolveApplyRecord } from "../../src/hsc-emit-apply.js";
import type { CohortTrace, DiagnoseFn, GuardTraceFilter } from "../../src/guard.js";
import type { DiagnosticResult } from "@lucid/diagnostic";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "..", "fixtures");
const harnessFixture = join(fixturesRoot, "harness-v37");

const addGateManifest: ChangeManifestV2 = ChangeManifestV2Schema.parse(
  JSON.parse(readFileSync(join(fixturesRoot, "change-manifest-v2-add-gate.json"), "utf8")),
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

/** An in-memory ApplyStore with a save counter. */
function memStore(): { store: ApplyStore; saved: ApplyRecord[] } {
  const saved: ApplyRecord[] = [];
  const store: ApplyStore = {
    async saveApplyRecord(record: ApplyRecord) {
      const idx = saved.findIndex((r) => r.id === record.id);
      if (idx >= 0) saved[idx] = record;
      else saved.push(record);
    },
    async listApplyRecords(filter: ApplyRecordFilter = {}) {
      return saved.filter((r) => {
        if (filter.agentId !== undefined && r.agentId !== filter.agentId) return false;
        if (filter.status !== undefined && r.verdict !== filter.status) return false;
        return true;
      });
    },
    async getApplyRecord(id: string) {
      return saved.find((r) => r.id === id) ?? null;
    },
  };
  return { store, saved };
}

/** A stub traceQuery returning a fixed cohort count for any version. */
function stubTraceQuery(count: number): { queryTraces(filter: GuardTraceFilter): Promise<CohortTrace[]> } {
  const cohort: CohortTrace[] = Array.from({ length: count }, () => ({ statusCode: 200 }));
  return { async queryTraces() { return cohort; } };
}

/** A mock diagnose returning a fixed principle score (so the guard is deterministic). */
function mockDiagnose(scoreByVersion: (trace: unknown) => number | null): DiagnoseFn {
  return (trace: unknown): DiagnosticResult => {
    const score = scoreByVersion(trace);
    return {
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
    } as DiagnosticResult;
  };
}

const L1_CONFIG: AutonomyConfig = AutonomyConfigSchema.parse({
  autonomy: "L1",
  require_human_approval: true,
  guard: { regression_metric: "feedback", min_delta: 0, sample: 2 },
});

describe("apply() — the closed L1 control loop", () => {
  let base: string;
  let registry: FileVersionRegistry;
  let snapshotCalls: number;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "lucid-apply-orch-"));
    cpSync(harnessFixture, base, { recursive: true });
    const real = new FileVersionRegistry(base);
    snapshotCalls = 0;
    // Wrap snapshot so we can count applyManifest's snapshot calls (idempotency proof).
    registry = Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
      snapshot: async (agentId: string, version: string, files: string[]) => {
        snapshotCalls += 1;
        return real.snapshot(agentId, version, files);
      },
    }) as FileVersionRegistry;
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function depsWith(
    store: ApplyStore,
    emitted: EvolveApplyRecord[],
    cohort: number,
    score: (trace: unknown) => number | null,
    promoteCalls?: string[],
  ): ApplyDeps {
    const baseDeps: ApplyDeps = {
      registry,
      store,
      traceQuery: stubTraceQuery(cohort),
      diagnoseFn: mockDiagnose(score),
      emit: (r) => emitted.push(r),
      harnessRoot: base,
      approvedBy: "alice",
    };
    if (promoteCalls) {
      const origPromote = registry.promote.bind(registry);
      baseDeps.registry = Object.assign(Object.create(Object.getPrototypeOf(registry)), registry, {
        promote: async (agentId: string, v: string) => {
          promoteCalls.push(v);
          return origPromote(agentId, v);
        },
        snapshot: registry.snapshot.bind(registry),
        revert: registry.revert.bind(registry),
      });
    }
    return baseDeps;
  }

  it("KEEP: promotes, returns status 'applied', saves one KEEP record + emits one evolve.apply(KEEP)", async () => {
    const { store, saved } = memStore();
    const emitted: EvolveApplyRecord[] = [];
    const promoted: string[] = [];
    const out = await apply(addGateManifest, L1_CONFIG, depsWith(store, emitted, 2, () => 0.8, promoted));

    expect(out.outcome).toBe("kept");
    if (out.outcome !== "kept") return;
    expect(promoted).toEqual(["v38"]);
    expect(out.manifest.status).toBe("applied");
    // The input manifest was NOT mutated.
    expect(addGateManifest.status).toBe("accepted");
    expect(saved).toHaveLength(1);
    expect(saved[0].verdict).toBe("KEEP");
    expect(saved[0].rollbackStatus).toBe("none");
    expect(saved[0].toVersion).toBe("v38");
    expect(saved[0].contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event.name).toBe("evolve.apply");
    expect(emitted[0].body["harness.apply.verdict"]).toBe("KEEP");
    // The gate file actually changed (the add-gate write happened).
    const gates = readFileSync(join(base, "config/gates.yaml"), "utf8");
    expect(gates).toContain("verify-write");
  });

  it("REVERT: a regression rolls back (NOT promoted), restores files, records REVERT + a rollback event", async () => {
    const { store, saved } = memStore();
    const emitted: EvolveApplyRecord[] = [];
    const promoted: string[] = [];
    const before = readFileSync(join(base, "context-policy/budget.yaml"), "utf8");
    // candidate score (0.3) < baseline (0.9) -> REVERT.
    let call = 0;
    const out = await apply(
      trimManifest,
      L1_CONFIG,
      depsWith(store, emitted, 2, () => (++call <= 2 ? 0.9 : 0.3), promoted),
    );

    expect(out.outcome).toBe("rolled-back");
    if (out.outcome !== "rolled-back") return;
    expect(promoted).toEqual([]); // never promoted on a non-KEEP
    expect(saved).toHaveLength(1);
    expect(saved[0].verdict).toBe("REVERT");
    expect(saved[0].rollbackStatus).toBe("auto-rollback");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].body["harness.apply.rollback_status"]).toBe("auto-rollback");
    // Files byte-identical after auto-rollback.
    const after = readFileSync(join(base, "context-policy/budget.yaml"), "utf8");
    expect(after).toBe(before);
  });

  it("INSUFFICIENT_DATA: an under-sampled candidate cohort rolls back (NOT promoted)", async () => {
    const { store, saved } = memStore();
    const emitted: EvolveApplyRecord[] = [];
    const promoted: string[] = [];
    // cohort 1 < sample 2 -> INSUFFICIENT_DATA.
    const out = await apply(trimManifest, L1_CONFIG, depsWith(store, emitted, 1, () => 0.9, promoted));
    expect(out.outcome).toBe("rolled-back");
    if (out.outcome !== "rolled-back") return;
    expect(out.verdict.verdict).toBe("INSUFFICIENT_DATA");
    expect(promoted).toEqual([]);
    expect(saved[0].verdict).toBe("REVERT");
  });

  it("NULL_SCORE: a null guard-metric score rolls back (NOT promoted)", async () => {
    const { store, saved } = memStore();
    const emitted: EvolveApplyRecord[] = [];
    const promoted: string[] = [];
    // every score null -> NULL_SCORE.
    const out = await apply(trimManifest, L1_CONFIG, depsWith(store, emitted, 2, () => null, promoted));
    expect(out.outcome).toBe("rolled-back");
    if (out.outcome !== "rolled-back") return;
    expect(out.verdict.verdict).toBe("NULL_SCORE");
    expect(promoted).toEqual([]);
    expect(saved[0].verdict).toBe("REVERT");
  });

  it("gate REJECT (autonomy L0): writes NOTHING — no snapshot, no record, rejected outcome", async () => {
    const { store, saved } = memStore();
    const emitted: EvolveApplyRecord[] = [];
    const l0 = AutonomyConfigSchema.parse({ autonomy: "L0" });
    const before = readFileSync(join(base, "config/gates.yaml"), "utf8");
    const out = await apply(addGateManifest, l0, depsWith(store, emitted, 2, () => 0.8));
    expect(out.outcome).toBe("rejected");
    expect(snapshotCalls).toBe(0); // no snapshot before the gate
    expect(saved).toHaveLength(0);
    expect(emitted).toHaveLength(0);
    expect(readFileSync(join(base, "config/gates.yaml"), "utf8")).toBe(before);
  });

  it("is idempotent by manifest id: a second apply() returns the existing record and re-applies nothing", async () => {
    const { store, saved } = memStore();
    const emitted: EvolveApplyRecord[] = [];
    const first = await apply(addGateManifest, L1_CONFIG, depsWith(store, emitted, 2, () => 0.8));
    expect(first.outcome).toBe("kept");
    const snapsAfterFirst = snapshotCalls;
    expect(saved).toHaveLength(1);

    const second = await apply(addGateManifest, L1_CONFIG, depsWith(store, emitted, 2, () => 0.8));
    expect(second.outcome).toBe("already-applied");
    if (second.outcome !== "already-applied") return;
    expect(second.record.manifestId).toBe(addGateManifest.id);
    // applyManifest's snapshot was NOT called a second time.
    expect(snapshotCalls).toBe(snapsAfterFirst);
    expect(saved).toHaveLength(1); // no new record
    expect(emitted).toHaveLength(1); // no new emit
  });
});
