/**
 * `lucid evolve apply/rollback/audit` — the testable command surface (Plan 04-04, Task 2).
 *
 * Asserts (with a fake CliIO + in-memory store/registry + a capturing emit sink + a
 * real harness-v37 temp copy so the apply write/snapshot/revert are real):
 *
 *   - applyCommand on a KEEP manifest renders "kept" + emits + saves a record (exit 0).
 *   - applyCommand on an L0 config renders "rejected" + writes nothing (exit 1).
 *   - rollbackCommand with a known version reverts + records a manual-rollback (exit 0).
 *   - rollbackCommand with an unknown version returns 1 (no snapshot found).
 *   - auditCommand lists records and prints "(no apply records)" when empty.
 *
 * Imports the command functions directly from src/cli-apply.ts (the same functions the
 * collector argv wiring lazily imports from the @lucid/evolution barrel).
 */

import { readFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  applyCommand,
  rollbackCommand,
  auditCommand,
  type ApplyCliDeps,
  type CliIO,
} from "../../src/cli-apply.js";
import { AutonomyConfigSchema, type AutonomyConfig } from "../../src/apply-config.js";
import { FileVersionRegistry } from "../../src/version-registry.js";
import type { ApplyRecord, ApplyStore, ApplyRecordFilter } from "../../src/apply-store.js";
import type { EvolveApplyRecord } from "../../src/hsc-emit-apply.js";
import type { CohortTrace } from "../../src/guard.js";
import type { DiagnoseFn } from "../../src/guard.js";
import type { DiagnosticResult } from "@lucid/diagnostic";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "..", "fixtures");
const harnessFixture = join(fixturesRoot, "harness-v37");
const addGateManifestPath = join(fixturesRoot, "change-manifest-v2-add-gate.json");

function fakeIO(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

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

const cohort: CohortTrace[] = [{ statusCode: 200 }, { statusCode: 200 }];
const keepDiagnose: DiagnoseFn = (): DiagnosticResult =>
  ({
    traceId: "t",
    agentId: "my-agent",
    principles: [
      { principle: "feedback", score: 0.8, coverage: 1, hitCount: 1, relevantEventCount: 1, worstDetector: "" },
    ],
    findings: [],
    plot2x2: { cells: {}, emptyColumns: [], emptyRows: [] },
    generatedAt: "2026-06-18T00:00:00.000Z",
    llmJudgeEnabled: false,
  }) as DiagnosticResult;

describe("lucid evolve apply/rollback/audit — command surface", () => {
  let base: string;
  let registry: FileVersionRegistry;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "lucid-apply-cli-"));
    cpSync(harnessFixture, base, { recursive: true });
    registry = new FileVersionRegistry(base);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function deps(store: ApplyStore, emitted: EvolveApplyRecord[], config: AutonomyConfig): ApplyCliDeps {
    return {
      store,
      registry,
      config,
      traceQuery: { async queryTraces() { return cohort; } },
      diagnoseFn: keepDiagnose,
      emit: (r) => emitted.push(r),
      harnessRoot: base,
    };
  }

  const l1: AutonomyConfig = AutonomyConfigSchema.parse({
    autonomy: "L1",
    require_human_approval: false,
    guard: { regression_metric: "feedback", min_delta: 0, sample: 2 },
  });

  it("apply on a KEEP manifest renders 'kept', emits, and saves a record (exit 0)", async () => {
    const { io, out, err } = fakeIO();
    const { store, saved } = memStore();
    const emitted: EvolveApplyRecord[] = [];
    const code = await applyCommand(io, deps(store, emitted, l1), {
      manifest: addGateManifestPath,
      approvedBy: "alice",
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/^kept\b/);
    expect(out.join("\n")).toContain("v37->v38");
    expect(err).toHaveLength(0);
    expect(saved).toHaveLength(1);
    expect(saved[0].verdict).toBe("KEEP");
    expect(emitted).toHaveLength(1);
  });

  it("apply on an L0 config renders 'rejected' and writes nothing (exit 1)", async () => {
    const { io, out, err } = fakeIO();
    const { store, saved } = memStore();
    const emitted: EvolveApplyRecord[] = [];
    const l0 = AutonomyConfigSchema.parse({ autonomy: "L0" });
    const before = readFileSync(join(base, "config/gates.yaml"), "utf8");
    const code = await applyCommand(io, deps(store, emitted, l0), { manifest: addGateManifestPath });
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/^rejected\b/);
    expect(saved).toHaveLength(0);
    expect(emitted).toHaveLength(0);
    expect(out).toHaveLength(0);
    expect(readFileSync(join(base, "config/gates.yaml"), "utf8")).toBe(before);
  });

  it("apply returns 1 when --manifest is missing", async () => {
    const { io, err } = fakeIO();
    const { store } = memStore();
    const code = await applyCommand(io, deps(store, [], l1), {});
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("requires --manifest");
  });

  it("rollback with a known version reverts + records a manual-rollback (exit 0)", async () => {
    // Seed a snapshot for my-agent@v37 so the kill-switch can resolve it.
    await registry.snapshot("my-agent", "v37", ["context-policy/budget.yaml"]);
    const { io, out } = fakeIO();
    const { store, saved } = memStore();
    const emitted: EvolveApplyRecord[] = [];
    const code = await rollbackCommand(
      io,
      { store, registry, emit: (r) => emitted.push(r) },
      { agent: "my-agent", to: "v37" },
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/^rolled-back\b/);
    expect(saved).toHaveLength(1);
    expect(saved[0].rollbackStatus).toBe("manual-rollback");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].body["harness.apply.rollback_status"]).toBe("manual-rollback");
  });

  it("rollback with an unknown version returns 1 (no snapshot found)", async () => {
    const { io, err } = fakeIO();
    const { store, saved } = memStore();
    const code = await rollbackCommand(
      io,
      { store, registry, emit: () => {} },
      { agent: "my-agent", to: "v99" },
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("no snapshot found");
    expect(saved).toHaveLength(0);
  });

  it("audit lists records and prints '(no apply records)' when empty", async () => {
    const { io, out } = fakeIO();
    const { store, saved } = memStore();

    // Empty first.
    expect(await auditCommand(io, store, { agent: "my-agent" })).toBe(0);
    expect(out).toContain("(no apply records)");

    // Seed one record, then list it.
    const rec: ApplyRecord = {
      id: "ar-x",
      manifestId: "cm-x",
      agentId: "my-agent",
      fromVersion: "v37",
      toVersion: "v38",
      changeKind: "add-gate",
      approvedBy: "alice",
      verdict: "KEEP",
      baselineScore: 0.6,
      candidateScore: 0.8,
      delta: 0.2,
      evidence: "ok",
      affectedFiles: ["config/gates.yaml"],
      contentHash: "sha256:" + "a".repeat(64),
      rollbackStatus: "none",
      createdAt: "2026-06-18T12:00:00.000Z",
    };
    saved.push(rec);
    const { io: io2, out: out2 } = fakeIO();
    expect(await auditCommand(io2, store, { agent: "my-agent" })).toBe(0);
    expect(out2.join("\n")).toContain("cm-x");
    expect(out2.join("\n")).toContain("verdict=KEEP");
    expect(out2.join("\n")).toContain("v37->v38");
  });

  it("apply migrates a v1 manifest via the injected reproposeFn", async () => {
    // Write a v1 manifest to disk; the CLI must migrate it (never parse its prose detail).
    const v1Path = join(base, "v1.json");
    writeFileSync(
      v1Path,
      JSON.stringify({
        id: "cm-v1-1",
        schema_version: "1",
        target: "my-agent@v37",
        change: "add-gate",
        detail: "GARBAGE prose that must never be parsed",
        rationale: "x",
        evidence_ref: "lucid://findings/F1",
        expected_effect: { feedback: 0.1 },
        status: "accepted",
        estimator: "rule-based",
        generated_at: "2026-06-18T12:00:00.000Z",
      }),
    );
    const { io, out } = fakeIO();
    const { store, saved } = memStore();
    const emitted: EvolveApplyRecord[] = [];
    const d = deps(store, emitted, l1);
    d.reproposeFn = () => ({
      kind: "add-gate",
      insertAfter: "tool.call:write_file",
      gate: "verify-write",
      condition: "verify the written file before continuing",
      targetFiles: ["config/gates.yaml"],
    });
    const code = await applyCommand(io, d, { manifest: v1Path, approvedBy: "alice" });
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/^kept\b/);
    expect(saved[0].manifestId).toBe("cm-v1-1");
  });
});
