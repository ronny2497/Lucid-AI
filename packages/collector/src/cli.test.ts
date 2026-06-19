/**
 * Unit tests for the `lucid` CLI command functions.
 *
 * These drive the command functions directly against an in-memory store with a
 * capturing IO sink (no process spawn, no argv parser), asserting:
 *   - `metrics` prints the summary and shows `unknown` for an unpriced model.
 *   - `traces` lists runs; `traces open <missing>` exits non-zero.
 *   - `init` renders a config referencing the collector endpoint + agent id.
 *   - `diagnose` is an INERT Phase-2 stub.
 *   - `evolve` with no subcommand prints the Phase 3 usage (the real propose/
 *     review/list work is unit-tested in @lucid/evolution).
 */

import { describe, it, expect } from "vitest";
import { SqliteTraceStore } from "@lucid/store";
import type { HscSpan } from "@lucid/store";
import type { CliIO } from "./cli.js";
import { GenAiAttrMap } from "@lucid/hsc-map";
import { HARNESS_ATTR } from "@lucid/hsc-schema";
import {
  metricsCommand,
  tracesListCommand,
  tracesOpenCommand,
  diagnoseCommand,
  evolveUsage,
  renderInitConfig,
  DEFAULT_CONFIG_ENDPOINT,
  evolveTrainCommand,
  evolveShowCommand,
  evolvePromoteCommand,
  evolveRollbackCommand,
  L2_NOT_CONFIGURED,
  type EvolveL2Deps,
  type L2RunRecord,
} from "./cli.js";

const OK = 1;
const ERROR = 2;

function capture(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

function spans(
  traceId: string,
  agentId: string,
  events: Array<{
    eventId: string;
    eventType: string;
    statusCode?: number | null;
    attrs?: Record<string, unknown>;
  }>,
  statusCode = OK,
): HscSpan[] {
  return events.map((ev, i) => ({
    traceId,
    agentId,
    harnessVersion: "1.0.0",
    traceStartTime: 1000,
    traceEndTime: 1500,
    traceStatusCode: statusCode,
    traceAttrs: {},
    turnId: "turn-1",
    event: {
      eventId: ev.eventId,
      traceId,
      parentId: null,
      eventType: ev.eventType as never,
      principle: null,
      quadrantX: null,
      quadrantY: null,
      startTime: 1000 + i,
      endTime: 1001 + i,
      statusCode: ev.statusCode ?? null,
      attrs: (ev.attrs ?? {}) as never,
    },
  }));
}

async function pricedStore(): Promise<SqliteTraceStore> {
  const store = new SqliteTraceStore(":memory:");
  await store.writeSpans(
    spans("trace-a", "my-agent", [
      {
        eventId: "a-plan",
        eventType: "plan.emit",
        attrs: {
          [GenAiAttrMap.model]: "gpt-4o",
          [GenAiAttrMap.inputTokens]: 1000,
          [GenAiAttrMap.outputTokens]: 1000,
        },
      },
      {
        eventId: "a-tool",
        eventType: "tool.call",
        statusCode: ERROR,
        attrs: { [HARNESS_ATTR.mutatedState]: true },
      },
    ]),
  );
  return store;
}

describe("lucid metrics", () => {
  it("prints the base-metrics summary", async () => {
    const store = await pricedStore();
    const { io, out } = capture();
    const code = await metricsCommand(store, { agent: "my-agent" }, io);
    expect(code).toBe(0);
    const line = out.join("\n");
    expect(line).toContain("success=");
    expect(line).toContain("cost/run=$");
    expect(line).toContain("tokens=2000");
    expect(line).toContain("tool-error=100.0%");
  });

  it("prints cost as 'unknown' when the model is unpriced", async () => {
    const store = new SqliteTraceStore(":memory:");
    await store.writeSpans(
      spans("trace-x", "my-agent", [
        {
          eventId: "x-plan",
          eventType: "plan.emit",
          attrs: {
            [GenAiAttrMap.model]: "unpriced-model",
            [GenAiAttrMap.inputTokens]: 100,
            [GenAiAttrMap.outputTokens]: 100,
          },
        },
      ]),
    );
    const { io, out } = capture();
    await metricsCommand(store, { agent: "my-agent" }, io);
    expect(out.join("\n")).toContain("cost/run=unknown");
  });
});

describe("lucid traces", () => {
  it("lists the runs for an agent", async () => {
    const store = await pricedStore();
    const { io, out } = capture();
    const code = await tracesListCommand(store, { agent: "my-agent" }, io);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("trace-a");
  });

  it("open <id> prints the turn/event tree", async () => {
    const store = await pricedStore();
    const { io, out } = capture();
    const code = await tracesOpenCommand(store, "trace-a", io);
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("trace-a");
    expect(text).toContain("plan.emit");
    expect(text).toContain("tool.call");
  });

  it("open <missing> exits non-zero", async () => {
    const store = await pricedStore();
    const { io, err } = capture();
    const code = await tracesOpenCommand(store, "nope", io);
    expect(code).not.toBe(0);
    expect(err.join("\n")).toContain("not found");
  });
});

describe("lucid init", () => {
  it("renders a config with the collector endpoint and agent id", () => {
    const yaml = renderInitConfig("my-agent");
    expect(yaml).toContain(DEFAULT_CONFIG_ENDPOINT);
    expect(yaml).toContain("my-agent");
  });
});

describe("lucid diagnose (inert stub) / evolve (Phase 3 usage)", () => {
  it("diagnose is inert and points to a later phase", () => {
    const { io, out } = capture();
    const code = diagnoseCommand(io);
    expect(code).toBe(0);
    expect(out.join("\n").toLowerCase()).toContain("phase");
  });

  it("evolve with no subcommand prints the propose/review/list usage", () => {
    const { io, out } = capture();
    const code = evolveUsage(io);
    expect(code).toBe(0);
    const text = out.join("\n").toLowerCase();
    expect(text).toContain("propose");
    expect(text).toContain("review");
    expect(text).toContain("list");
    expect(text).toContain("advisory only");
    // L2 surface is documented in the usage too.
    expect(text).toContain("train");
    expect(text).toContain("promote");
  });
});

// ----------------------------------------------------------------------------
// Phase 5 (L2) — evolve train/show/promote/rollback-model + L0/L1 degradation.
// No path requires Python (MockTrainerPlugin-backed deps are injected).
// ----------------------------------------------------------------------------

const PASSED_RUN: L2RunRecord = {
  candidate_id: "cand-001",
  job_id: "job-001",
  base_model_ref: "Qwen/Qwen2.5-0.5B",
  promoted: true,
  gate: { passed: true, metric: "success", delta: 0.05, min_improvement: 0.02 },
  metrics: { reward_mean: 0.6, reward_std: 0.1, steps: 10, epochs: 1 },
  principle_deltas: { feedback: 0.2 },
};

const FAILED_RUN: L2RunRecord = {
  candidate_id: "cand-002",
  job_id: "job-002",
  base_model_ref: "Qwen/Qwen2.5-0.5B",
  promoted: false,
  gate: { passed: false, metric: "success", delta: 0.01, min_improvement: 0.02 },
};

/** L0 deps: autonomy L0, no trainer → every L2 command routes to the notice. */
function l0Deps(): EvolveL2Deps {
  return {
    config: { autonomy: "L0", trainer: null },
    runTrain: async () => {
      throw new Error("runTrain must NOT be called at L0");
    },
    runStore: { getRun: () => null, setIncumbent: () => {} },
    promote: async () => {
      throw new Error("promote must NOT be called at L0");
    },
  };
}

/** L2 deps with a MockTrainerPlugin-style injected loop (no Python). */
function l2Deps(overrides: Partial<EvolveL2Deps> = {}): EvolveL2Deps {
  return {
    config: { autonomy: "L2", trainer: { plugin: "mock", base_model: "Qwen/Qwen2.5-0.5B" } },
    runTrain: async () => PASSED_RUN,
    runStore: {
      getRun: (id) => (id === "cand-001" ? PASSED_RUN : id === "cand-002" ? FAILED_RUN : null),
      setIncumbent: () => {},
    },
    promote: async () => {},
    ...overrides,
  };
}

describe("lucid evolve (L2) — graceful L0/L1 degradation", () => {
  it("train at L0 prints the not-configured notice and does NOT call runTrain", async () => {
    const { io, out } = capture();
    const code = await evolveTrainCommand(l0Deps(), { agent: "a" }, io);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain(L2_NOT_CONFIGURED);
  });

  it("show/promote/rollback at L0 all print the notice and exit cleanly", async () => {
    for (const run of [
      () => evolveShowCommand(l0Deps(), "cand-001", capture().io),
      () => evolvePromoteCommand(l0Deps(), "cand-001", capture().io),
      () => evolveRollbackCommand(l0Deps(), { model: "m", to: "v1" }, capture().io),
    ]) {
      expect(await run()).toBe(0);
    }
  });
});

describe("lucid evolve (L2) — active loop", () => {
  it("train at L2 calls runTrain and prints the candidate id + gate verdict", async () => {
    const { io, out } = capture();
    const code = await evolveTrainCommand(l2Deps(), { agent: "a" }, io);
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("cand-001");
    expect(text).toContain("PROMOTED");
  });

  it("show prints a candidate run summary; missing → non-zero", async () => {
    const ok = capture();
    expect(await evolveShowCommand(l2Deps(), "cand-001", ok.io)).toBe(0);
    expect(ok.out.join("\n")).toContain("cand-001");

    const missing = capture();
    expect(await evolveShowCommand(l2Deps(), "nope", missing.io)).toBe(1);
    expect(missing.err.join("\n")).toContain("not found");
  });

  it("promote on a passed-gate run promotes; on a failed-gate run refuses (non-zero)", async () => {
    let promoted = false;
    const okDeps = l2Deps({ promote: async () => { promoted = true; } });
    const ok = capture();
    expect(await evolvePromoteCommand(okDeps, "cand-001", ok.io)).toBe(0);
    expect(promoted).toBe(true);

    // The CLI cannot bypass the gate: a failed-gate run is refused, promote uncalled.
    let promoted2 = false;
    const failDeps = l2Deps({ promote: async () => { promoted2 = true; } });
    const fail = capture();
    expect(await evolvePromoteCommand(failDeps, "cand-002", fail.io)).not.toBe(0);
    expect(promoted2).toBe(false);
    expect(fail.err.join("\n").toLowerCase()).toContain("refusing to promote");
  });

  it("rollback-model resets the incumbent pointer (pointer reset)", async () => {
    let reset: { model: string; version: string } | null = null;
    const deps = l2Deps({
      runStore: {
        getRun: () => null,
        setIncumbent: (model, version) => {
          reset = { model, version };
        },
      },
    });
    const { io, out } = capture();
    expect(await evolveRollbackCommand(deps, { model: "agent-1", to: "v36" }, io)).toBe(0);
    expect(reset).toEqual({ model: "agent-1", version: "v36" });
    expect(out.join("\n").toLowerCase()).toContain("pointer reset");
  });
});
