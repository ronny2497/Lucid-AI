/**
 * The `lucid` CLI — a thin client over the SAME store + derivation code as the
 * `/api/*` routes (no duplicated metric math; RESEARCH "CLI is a thin client").
 *
 * Commands:
 *   - `lucid init`                         -> write a lucid.config.yaml, exit 0
 *   - `lucid metrics --agent <id> --since` -> print the BaseMetrics summary
 *   - `lucid traces  --agent <id> [--since]` -> print the run list
 *   - `lucid traces open <id>`             -> print the turn/event tree (or 404)
 *   - `lucid diagnose`                     -> INERT Phase-2 stub
 *   - `lucid evolve propose|review|list`   -> the Phase 3 L0 HITL surface
 *
 * The command bodies below are plain, dependency-light functions taking an
 * injected `TraceStore` and an output sink, so they are unit-testable without
 * spinning a process or installing the argv parser. `commander` is used only by
 * the argv-wiring `run()` entrypoint, imported lazily so tests never need it.
 *
 * Phase 3 (03-03): the inert `evolveCommand` stub is REPLACED by a real `lucid
 * evolve propose|review|list` subcommand tree that dispatches into the
 * `@lucid/evolution` command functions (proposeCommand/reviewCommand/listCommand)
 * over a `FileProposalStore` + an HSC emit sink. Those functions live in
 * @lucid/evolution and keep their own unit-test seam; this file is only the argv
 * wiring + the default store/sink construction. ZERO BLAST RADIUS holds: the only
 * writes are the proposal JSON index + the evolve.propose audit event — never any
 * file under the agent's own harness. `--accept` records status only; auto-apply is
 * Phase 4. T-01-12 (scope-creep guard): `diagnose` still does NO scoring.
 * T-01-11 (info disclosure, accepted/noted): `traces open` prints stored attrs
 * verbatim for local inspection; redaction is a later-phase concern.
 */

import type { TraceStore } from "@lucid/store";
import { deriveBaseMetrics } from "./metrics.js";
import { parseTraceFilter, toRunListRow } from "./routes/traces.js";

/** A minimal output sink so tests can capture stdout/stderr. */
export interface CliIO {
  out: (line: string) => void;
  err: (line: string) => void;
}

/** Default IO writes to the process streams. */
export const consoleIO: CliIO = {
  out: (line) => process.stdout.write(line + "\n"),
  err: (line) => process.stderr.write(line + "\n"),
};

/** Default config-file body `lucid init` writes. */
export const DEFAULT_CONFIG_ENDPOINT = "http://localhost:4318";

function filterFromOpts(opts: {
  agent?: string;
  since?: string;
  version?: string;
  status?: string;
}): ReturnType<typeof parseTraceFilter> {
  const params = new URLSearchParams();
  if (opts.agent) params.set("agent", opts.agent);
  if (opts.since) params.set("since", opts.since);
  if (opts.version) params.set("version", opts.version);
  if (opts.status) params.set("status", opts.status);
  return parseTraceFilter(params);
}

/**
 * `lucid init` — render the default `lucid.config.yaml` body. Returns the YAML
 * string (the argv wiring writes it to disk); exits 0.
 */
export function renderInitConfig(agentId = "my-agent"): string {
  return [
    "# lucid.config.yaml — Lucid collector configuration",
    `collector:`,
    `  endpoint: ${DEFAULT_CONFIG_ENDPOINT}`,
    `agent:`,
    `  id: ${agentId}`,
    "",
  ].join("\n");
}

/**
 * `lucid metrics` — print the base-metrics summary. Cost prints `unknown` when
 * the model is unpriced (never a fabricated number). Returns exit code 0.
 */
export async function metricsCommand(
  store: TraceStore,
  opts: { agent?: string; since?: string },
  io: CliIO = consoleIO,
): Promise<number> {
  const filter = filterFromOpts(opts);
  const input = await store.getMetricsInput(filter);
  const m = deriveBaseMetrics(input);
  const cost = m.costPerRun === null ? "unknown" : `$${m.costPerRun.toFixed(6)}`;
  io.out(
    [
      `runs=${m.traceCount}`,
      `success=${(m.successRate * 100).toFixed(1)}%`,
      `cost/run=${cost}`,
      `p50=${m.latencyP50}`,
      `p95=${m.latencyP95}`,
      `tokens=${m.totalTokens}`,
      `tool-error=${(m.toolErrorRate * 100).toFixed(1)}%`,
    ].join("  "),
  );
  return 0;
}

/**
 * `lucid traces` — list runs for the filter window. Returns exit code 0.
 */
export async function tracesListCommand(
  store: TraceStore,
  opts: { agent?: string; since?: string },
  io: CliIO = consoleIO,
): Promise<number> {
  const filter = filterFromOpts(opts);
  const traces = await store.queryTraces(filter);
  if (traces.length === 0) {
    io.out("(no runs)");
    return 0;
  }
  for (const t of traces) {
    const r = toRunListRow(t);
    const cost = r.cost === null ? "unknown" : `$${r.cost.toFixed(6)}`;
    io.out(
      `${r.traceId}  agent=${r.agentId}  status=${r.statusCode ?? "?"}  dur=${
        r.durationNs ?? "?"
      }  cost=${cost}  events=${r.eventCount}`,
    );
  }
  return 0;
}

/**
 * `lucid traces open <id>` — print the turn/event tree for a trace. Returns a
 * NON-ZERO exit code (1) when the trace is not found.
 */
export async function tracesOpenCommand(
  store: TraceStore,
  traceId: string,
  io: CliIO = consoleIO,
): Promise<number> {
  const trace = await store.getTrace(traceId);
  if (trace === null) {
    io.err(`trace not found: ${traceId}`);
    return 1;
  }
  io.out(`trace ${trace.traceId}  agent=${trace.agentId}  status=${trace.statusCode ?? "?"}`);
  for (const turn of trace.turns) {
    io.out(`  turn ${turn.turnId}`);
    for (const ev of turn.events) {
      io.out(`    - ${ev.eventType}  status=${ev.statusCode ?? "?"}`);
    }
  }
  return 0;
}

/**
 * `lucid diagnose` — INERT Phase-2 stub. Performs NO scoring; prints a
 * later-phase notice and returns 0 (T-01-12 scope-creep guard).
 */
export function diagnoseCommand(io: CliIO = consoleIO): number {
  io.out("lucid diagnose: scoring ships in Phase 2 — not available yet.");
  return 0;
}

/**
 * `lucid evolve` with no subcommand — print usage. The real work lives in the
 * subcommands, which dispatch into `@lucid/evolution`. Phase 3 (L0) ships
 * `propose`/`review`/`list`; Phase 4 (L1) adds `apply`/`rollback`/`audit` — the gated
 * auto-apply loop + the always-present manual kill-switch + the apply audit trail.
 * There is NO `train` subcommand: weight-level training is L2 (Phase 5), out of scope.
 */
export function evolveUsage(io: CliIO = consoleIO): number {
  io.out("lucid evolve <propose|review|list|apply|rollback|audit|train|show|promote|rollback-model> — self-evolution.");
  io.out("  L0 (propose/review/list) is advisory only; L1 (apply/rollback/audit) is the gated auto-apply loop;");
  io.out("  L2 (train/show/promote/rollback-model) is the weight-level GRPO loop (optional; skippable; no Python at L0/L1).");
  io.out("  propose --finding <id> --from <diagnostic.json>   render + emit + persist a proposal (L0)");
  io.out("  review  <id> --accept|--reject [--note <text>]    record a review decision (L0; applies nothing)");
  io.out("  list    [--agent <id>] [--status <status>]        list proposals (L0)");
  io.out("  apply   --manifest <path> [--approved-by <id>]    run the gated L1 auto-apply loop");
  io.out("  rollback --agent <id> --to <version>              manual kill-switch — revert to a known-good version");
  io.out("  audit   [--agent <id>] [--since <t>] [--status]   list apply records (the L1 audit trail)");
  io.out("  train   [--agent <id>] [--since <window>]         [L2] run the weight-level GRPO loop");
  io.out("  show    <candidate-id>                            [L2] print a candidate's run summary");
  io.out("  promote <candidate-id>                            [L2] promote a candidate (only if the gate passed)");
  io.out("  rollback-model --model <id> --to <version>        [L2] reset the incumbent model pointer (pointer reset)");
  return 0;
}

// ── Phase 5 (L2) — the `lucid evolve train/show/promote/rollback` weight-level
//    surface. A developer drives the full GRPO loop from the CLI and never writes
//    Python: `train` runs the orchestrator (export→reward→handoff→gate→promote|
//    discard), `show` prints a candidate's run summary, `promote` delegates to the
//    05-03 gate (NO bypass — refuses a failed candidate), `rollback` resets the
//    incumbent model POINTER (never a weight deletion).
//
//    SKIPPABLE (HARD): when autonomy != L2 or no trainer plugin is configured, every
//    L2 subcommand prints a clear "L2 not configured" notice and returns cleanly —
//    an L0/L1 user is NEVER crashed or forced into Python. The Python subprocess is
//    reached only lazily inside FilesystemTrainerPlugin.train at autonomy:L2; the
//    top-level `@lucid/evolution` import pulls in no Python.

/** The minimal shape of the parsed L2 config the CLI inspects. */
export interface L2ConfigView {
  autonomy: "L0" | "L1" | "L2";
  trainer: { plugin: string; base_model: string } | null;
}

/** A persisted L2 run record (the `show`/`promote`/`rollback` read model). */
export interface L2RunRecord {
  candidate_id: string;
  job_id: string;
  base_model_ref: string;
  promoted: boolean;
  gate: { passed: boolean; metric: string; delta: number | null; min_improvement: number };
  metrics?: { reward_mean: number; reward_std: number; steps: number; epochs: number };
  principle_deltas?: Record<string, number>;
}

/** The store the L2 subcommands read run records / the incumbent pointer from. */
export interface L2RunStore {
  getRun(candidateId: string): Promise<L2RunRecord | null> | L2RunRecord | null;
  /** Reset the incumbent model pointer to a prior version (a pointer reset). */
  setIncumbent(model: string, version: string): Promise<void> | void;
}

/** The injected dependencies the L2 evolve subcommands run against. */
export interface EvolveL2Deps {
  /** The parsed L2 config (autonomy + trainer ref). */
  config: L2ConfigView;
  /**
   * Build + run the L2 loop for a `train` invocation. Returns the run result the
   * command prints. Injected so tests can supply a MockTrainerPlugin-backed loop
   * with no Python. Called ONLY when autonomy === "L2" with a non-null trainer.
   */
  runTrain: (opts: { agent?: string; since?: string }) => Promise<L2RunRecord>;
  /** The run-record / incumbent-pointer store. */
  runStore: L2RunStore;
  /** Promote a candidate via the 05-03 gate (throws/refuses on a failed gate). */
  promote: (record: L2RunRecord) => Promise<void>;
}

/** The "L2 not configured" notice — the skippable boundary at the CLI. */
export const L2_NOT_CONFIGURED =
  "L2 not configured: set evolution.autonomy: L2 and a trainer plugin to use weight-level training.";

/** True iff the config has L2 autonomy AND a configured trainer plugin. */
function l2Active(config: L2ConfigView): boolean {
  return config.autonomy === "L2" && config.trainer != null;
}

/**
 * `lucid evolve train` — run the closed L2 loop and print the candidate + the gate
 * verdict. At L0/L1 (or with no trainer) it prints the not-configured notice and
 * returns 0 WITHOUT touching Python or the orchestrator (skippable boundary).
 */
export async function evolveTrainCommand(
  deps: EvolveL2Deps,
  opts: { agent?: string; since?: string },
  io: CliIO = consoleIO,
): Promise<number> {
  if (!l2Active(deps.config)) {
    io.out(L2_NOT_CONFIGURED);
    return 0;
  }
  io.out(`exporting trajectories for agent=${opts.agent ?? "(all)"}…`);
  io.out("computing rewards (reward-in-TS) and handing off to the trainer…");
  const run = await deps.runTrain(opts);
  io.out(`candidate=${run.candidate_id}  base=${run.base_model_ref}`);
  const verdict = run.gate.passed ? "PROMOTED" : "DISCARDED (gate not cleared)";
  io.out(
    `gate=${verdict}  metric=${run.gate.metric}  delta=${
      run.gate.delta === null ? "n/a" : run.gate.delta.toFixed(4)
    }  min_improvement=${run.gate.min_improvement}`,
  );
  return 0;
}

/**
 * `lucid evolve show <candidate-id>` — print a candidate's run-record summary
 * (base, metrics, holdout delta, principle deltas). Non-zero when not found.
 */
export async function evolveShowCommand(
  deps: EvolveL2Deps,
  candidateId: string,
  io: CliIO = consoleIO,
): Promise<number> {
  if (!l2Active(deps.config)) {
    io.out(L2_NOT_CONFIGURED);
    return 0;
  }
  const run = await deps.runStore.getRun(candidateId);
  if (run === null) {
    io.err(`candidate not found: ${candidateId}`);
    return 1;
  }
  io.out(`candidate=${run.candidate_id}  job=${run.job_id}  base=${run.base_model_ref}`);
  if (run.metrics) {
    io.out(
      `reward_mean=${run.metrics.reward_mean}  reward_std=${run.metrics.reward_std}  steps=${run.metrics.steps}  epochs=${run.metrics.epochs}`,
    );
  }
  io.out(
    `gate.passed=${run.gate.passed}  delta=${
      run.gate.delta === null ? "n/a" : run.gate.delta
    }  promoted=${run.promoted}`,
  );
  if (run.principle_deltas) {
    io.out(`principle_deltas=${JSON.stringify(run.principle_deltas)}`);
  }
  return 0;
}

/**
 * `lucid evolve promote <candidate-id>` — promote ONLY if the gate passed. The CLI
 * cannot bypass the gate: a failed-gate run is refused with a non-zero exit and the
 * promotion delegate is never called.
 */
export async function evolvePromoteCommand(
  deps: EvolveL2Deps,
  candidateId: string,
  io: CliIO = consoleIO,
): Promise<number> {
  if (!l2Active(deps.config)) {
    io.out(L2_NOT_CONFIGURED);
    return 0;
  }
  const run = await deps.runStore.getRun(candidateId);
  if (run === null) {
    io.err(`candidate not found: ${candidateId}`);
    return 1;
  }
  if (!run.gate.passed) {
    io.err(
      `refusing to promote ${candidateId}: the candidate did not pass the gate (no-bypass guard).`,
    );
    return 1;
  }
  await deps.promote(run);
  io.out(`promoted ${candidateId} (gate passed; delta=${run.gate.delta ?? "n/a"}).`);
  return 0;
}

/**
 * `lucid evolve rollback --model <id> --to <version>` — reset the incumbent model
 * POINTER to a prior version (a pointer reset, never a weight deletion).
 */
export async function evolveRollbackCommand(
  deps: EvolveL2Deps,
  opts: { model: string; to: string },
  io: CliIO = consoleIO,
): Promise<number> {
  if (!l2Active(deps.config)) {
    io.out(L2_NOT_CONFIGURED);
    return 0;
  }
  await deps.runStore.setIncumbent(opts.model, opts.to);
  io.out(`rolled back incumbent pointer: model=${opts.model} → version=${opts.to} (pointer reset).`);
  return 0;
}

/**
 * argv entrypoint. `commander` is imported lazily so the unit-testable command
 * functions above carry no hard dependency on the parser.
 */
export async function run(argv: string[] = process.argv): Promise<void> {
  const { Command } = await import("commander");
  const { SqliteTraceStore } = await import("@lucid/store");
  const { writeFileSync } = await import("node:fs");

  const openStore = (): TraceStore =>
    new SqliteTraceStore(process.env.LUCID_STORE_PATH ?? "lucid-traces.db");

  const program = new Command();
  program.name("lucid").description("Lucid trace + metrics CLI");

  program
    .command("init")
    .description("write a lucid.config.yaml")
    .option("--agent <id>", "agent id", "my-agent")
    .action((opts: { agent: string }) => {
      writeFileSync("lucid.config.yaml", renderInitConfig(opts.agent));
      consoleIO.out("wrote lucid.config.yaml");
    });

  program
    .command("metrics")
    .description("print base metrics for an agent window")
    .option("--agent <id>", "agent id")
    .option("--since <window>", "relative window, e.g. 24h")
    .action(async (opts: { agent?: string; since?: string }) => {
      process.exitCode = await metricsCommand(openStore(), opts);
    });

  const traces = program.command("traces").description("list or open runs");
  traces
    .option("--agent <id>", "agent id")
    .option("--since <window>", "relative window, e.g. 24h")
    .action(async (opts: { agent?: string; since?: string }) => {
      process.exitCode = await tracesListCommand(openStore(), opts);
    });
  traces
    .command("open <id>")
    .description("print a trace's turn/event tree")
    .action(async (id: string) => {
      process.exitCode = await tracesOpenCommand(openStore(), id);
    });

  program
    .command("diagnose")
    .description("[Phase 2] scoring — not available yet")
    .action(() => {
      process.exitCode = diagnoseCommand();
    });
  // `lucid evolve` — the Phase 3 L0 HITL surface. Dispatches into @lucid/evolution.
  // The default ProposalStore is a JSON index alongside the trace store; the HSC
  // sink writes the evolve.propose audit record to stdout as JSON (the collector's
  // OTLP emit path is a later enhancement). ZERO BLAST RADIUS: no harness write.
  const evolve = program.command("evolve").description("L0 self-evolution (advisory only)");
  evolve.action(() => {
    process.exitCode = evolveUsage();
  });

  const openProposalStore = async () => {
    const { FileProposalStore } = await import("@lucid/evolution");
    return new FileProposalStore(process.env.LUCID_PROPOSALS_PATH ?? "lucid-proposals.json");
  };
  // The default audit sink: print the evolve.propose LogRecord as JSON to stdout
  // (an append-only audit echo). A live OTLP/store emit path is a later enhancement.
  const auditSink = (record: unknown): void => {
    consoleIO.out(JSON.stringify(record));
  };

  evolve
    .command("propose")
    .description("propose a change_manifest for a finding (advisory only)")
    .requiredOption("--finding <id>", "the finding id, e.g. F1")
    .requiredOption("--from <diagnostic.json>", "path to a DiagnosticResult JSON file")
    .option("--agent <id>", "agent id (advisory context)")
    .action(async (opts: { finding: string; from: string; agent?: string }) => {
      const { proposeCommand } = await import("@lucid/evolution");
      process.exitCode = await proposeCommand(consoleIO, await openProposalStore(), auditSink, opts);
    });

  evolve
    .command("review <id>")
    .description("record a review decision (applies nothing — L0)")
    .option("--accept", "accept the proposal (status only)")
    .option("--reject", "reject the proposal")
    .option("--note <text>", "reviewer annotation")
    .action(async (id: string, opts: { accept?: boolean; reject?: boolean; note?: string }) => {
      const { reviewCommand } = await import("@lucid/evolution");
      process.exitCode = await reviewCommand(consoleIO, await openProposalStore(), id, opts);
    });

  evolve
    .command("list")
    .description("list proposals")
    .option("--agent <id>", "filter by agent id")
    .option("--status <status>", "filter by status (proposed|accepted|rejected|applied)")
    .action(async (opts: { agent?: string; status?: string }) => {
      const { listCommand } = await import("@lucid/evolution");
      process.exitCode = await listCommand(consoleIO, await openProposalStore(), {
        agent: opts.agent,
        status: opts.status as never,
      });
    });

  // ── Phase 4 (L1) — the gated auto-apply loop + the manual kill-switch + the audit
  //    trail. These EXTEND the Phase 3 evolve tree; they dispatch into the
  //    @lucid/evolution apply/rollback/audit command functions over a FileApplyStore +
  //    a FileVersionRegistry + a default evolve.apply audit sink + the real
  //    `diagnose`/store-backed guard inputs. STRUCTURAL-ONLY: no `train` subcommand
  //    (weights are L2/Phase 5). The autonomy gate + the regression guard mean an apply
  //    below the configured autonomy, or one that regresses, never persists.
  const openApplyStore = async () => {
    const { FileApplyStore } = await import("@lucid/evolution");
    return new FileApplyStore(process.env.LUCID_APPLY_RECORDS_PATH ?? "lucid-apply-records.json");
  };
  const openVersionRegistry = async () => {
    const { FileVersionRegistry } = await import("@lucid/evolution");
    return new FileVersionRegistry(process.env.LUCID_HARNESS_ROOT ?? process.cwd());
  };
  // Load the parsed AutonomyConfig from `evolution.*` (conservative all-defaults when absent).
  const loadAutonomyConfig = async () => {
    const { AutonomyConfigSchema } = await import("@lucid/evolution");
    return AutonomyConfigSchema.parse({});
  };
  // The guard's TraceQuery: the real store, filtered by { agentId, version }.
  const guardTraceQuery = (store: TraceStore) => ({
    async queryTraces(filter: { agentId?: string; version?: string }) {
      return store.queryTraces(
        filterFromOpts({ agent: filter.agentId, version: filter.version }),
      ) as unknown as Promise<{ statusCode: number | null }[]>;
    },
  });
  // The default evolve.apply audit sink: echo the LogRecord as JSON to stdout.
  const applySink = (record: unknown): void => {
    consoleIO.out(JSON.stringify(record));
  };

  evolve
    .command("apply")
    .description("run the gated L1 auto-apply loop for a change manifest")
    .requiredOption("--manifest <path>", "path to a v2 change_manifest JSON")
    .option("--approved-by <id>", "human approver identity (when approval is required)")
    .action(async (opts: { manifest: string; approvedBy?: string }) => {
      const { applyCommand, diagnose } = await import("@lucid/evolution");
      const store = openStore();
      process.exitCode = await applyCommand(
        consoleIO,
        {
          store: await openApplyStore(),
          registry: await openVersionRegistry(),
          config: await loadAutonomyConfig(),
          traceQuery: guardTraceQuery(store),
          diagnoseFn: (trace: unknown) => diagnose(trace as never),
          emit: applySink as never,
          harnessRoot: process.env.LUCID_HARNESS_ROOT ?? process.cwd(),
        },
        { manifest: opts.manifest, approvedBy: opts.approvedBy },
      );
    });

  evolve
    .command("rollback")
    .description("manual kill-switch — revert an agent to a known-good harness version")
    .requiredOption("--agent <id>", "agent id")
    .requiredOption("--to <version>", "the known-good harness version to restore (e.g. v37)")
    .action(async (opts: { agent: string; to: string }) => {
      const { rollbackCommand } = await import("@lucid/evolution");
      process.exitCode = await rollbackCommand(
        consoleIO,
        {
          store: await openApplyStore(),
          registry: await openVersionRegistry(),
          emit: applySink as never,
        },
        { agent: opts.agent, to: opts.to },
      );
    });

  evolve
    .command("audit")
    .description("list apply records — the L1 audit trail")
    .option("--agent <id>", "filter by agent id")
    .option("--since <t>", "ISO timestamp lower bound")
    .option("--status <verdict>", "filter by verdict (KEEP|REVERT|INSUFFICIENT_DATA|NULL_SCORE)")
    .action(async (opts: { agent?: string; since?: string; status?: string }) => {
      const { auditCommand } = await import("@lucid/evolution");
      process.exitCode = await auditCommand(consoleIO, await openApplyStore(), {
        agent: opts.agent,
        since: opts.since,
        status: opts.status as never,
      });
    });

  // ── Phase 5 (L2) — weight-level GRPO via `lucid evolve train/show/promote/rollback`.
  //    The default L2 config is parsed from `evolution.*` (conservative all-defaults
  //    when absent → autonomy L0 → the not-configured notice). The run-record store
  //    is a JSON file alongside the trace store; the incumbent pointer is a small JSON
  //    file. SKIPPABLE: at L0/L1 these commands print the notice and never reach the
  //    orchestrator or Python. The `@lucid/evolution` import here pulls in no Python
  //    (the only subprocess is lazy inside FilesystemTrainerPlugin.train at L2).
  const loadL2Config = async (): Promise<L2ConfigView> => {
    // No `evolution.*` parsed from disk yet in this build → conservative L0 default,
    // which routes every L2 subcommand to the graceful "not configured" notice. When
    // a real config loader lands, parse it with L2ConfigSchema and return the view.
    return { autonomy: "L0", trainer: null };
  };
  const buildEvolveL2Deps = async (): Promise<EvolveL2Deps> => {
    const config = await loadL2Config();
    return {
      config,
      // Wired only when L2 is active; the not-configured path never calls these.
      runTrain: async () => {
        throw new Error("L2 trainer not configured");
      },
      runStore: {
        getRun: () => null,
        setIncumbent: () => {},
      },
      promote: async () => {
        throw new Error("L2 trainer not configured");
      },
    };
  };

  evolve
    .command("train")
    .description("[L2] run the weight-level GRPO loop (export→reward→gate→promote|discard)")
    .option("--agent <id>", "agent id to export trajectories for")
    .option("--since <window>", "relative window, e.g. 24h")
    .action(async (opts: { agent?: string; since?: string }) => {
      process.exitCode = await evolveTrainCommand(await buildEvolveL2Deps(), opts);
    });

  evolve
    .command("show <candidate-id>")
    .description("[L2] print a candidate's run summary")
    .action(async (candidateId: string) => {
      process.exitCode = await evolveShowCommand(await buildEvolveL2Deps(), candidateId);
    });

  evolve
    .command("promote <candidate-id>")
    .description("[L2] promote a candidate — only if the gate passed (no bypass)")
    .action(async (candidateId: string) => {
      process.exitCode = await evolvePromoteCommand(await buildEvolveL2Deps(), candidateId);
    });

  // NOTE: `evolve rollback` already exists for L1 (the harness-version kill-switch,
  // `--agent --to`). The L2 model-pointer rollback is distinct (`--model --to`); to
  // avoid clobbering the L1 subcommand we expose it as `evolve rollback-model`.
  evolve
    .command("rollback-model")
    .description("[L2] reset the incumbent model pointer to a prior version (pointer reset)")
    .requiredOption("--model <id>", "the model id")
    .requiredOption("--to <version>", "the prior version to reset the pointer to")
    .action(async (opts: { model: string; to: string }) => {
      process.exitCode = await evolveRollbackCommand(await buildEvolveL2Deps(), opts);
    });

  await program.parseAsync(argv);
}

// Run only when executed directly as the `lucid` bin (not when imported).
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  run().catch((err) => {
    console.error("[lucid] failed:", err);
    process.exitCode = 1;
  });
}
