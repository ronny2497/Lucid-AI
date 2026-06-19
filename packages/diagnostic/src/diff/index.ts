/**
 * @lucid/diagnostic — version & cohort diffing (Plan 02-05, REQ-04).
 *
 * `diff(query, { from, to, agentId? })` answers the Build-to-Delete question: "did
 * this harness change (or model upgrade) help or hurt, and on which principle?" It:
 *
 *   1. loads the `from` and `to` cohorts via the abstract `TraceQuery` (NEVER a
 *      concrete Phase 1 store — `diff` imports only the `TraceQuery` interface);
 *   2. aggregates each cohort's traces into one synthetic trace and runs `diagnose()`
 *      once per cohort to get a comparable per-principle scorecard;
 *   3. computes a NULL-SAFE per-principle delta (`to - from`, or `null` when either
 *      side's score is null — a missing principle never masquerades as a 0 delta);
 *   4. emits a warning when the two cohorts carry different HSC schema versions
 *      (RESEARCH Pitfall 6 — comparing across incompatible schemas is flagged);
 *   5. builds a DETERMINISTIC verdict string (no LLM — Phase 2 prohibition) naming
 *      the principle that moved most.
 *
 * ## Aggregation strategy (recorded per the plan's output contract)
 *
 * Each cohort is reduced to ONE synthetic `HarnessTrace` by concatenating every
 * member trace's turns (event ids namespaced by source trace id to avoid collisions),
 * then `diagnose()` runs ONCE over that aggregate. The coverage-weighted scorer
 * (`score = 1 - hits/relevant`) combines naturally across the pooled relevant-event
 * set, so a cohort's score reflects its whole population rather than a single
 * representative trace. The alternative — averaging per-trace scores — would have to
 * decide how to average a `null` (absent principle) against a number; pooling sidesteps
 * that by keeping the scorer's own null-when-zero-relevant guard authoritative.
 *
 * PURE: reads traces only through `query`; never mutates a trace or the store.
 */

import { PRINCIPLES } from "@lucid/hsc-schema";
import type { HscPrinciple } from "@lucid/hsc-schema";
import { diagnose } from "../diagnose.js";
import type { DiagnosticResult } from "../schema.js";
import type { TraceFilter, TraceQuery } from "./trace-query.js";

export type { TraceFilter, TraceQuery } from "./trace-query.js";

/** One principle's before/after scores and their null-safe delta. */
export interface PrincipleDelta {
  /** Score in the `from` cohort (null = no relevant events for the principle). */
  from: number | null;
  /** Score in the `to` cohort (null = no relevant events for the principle). */
  to: number | null;
  /**
   * `to - from`, or `null` when EITHER side is null. Never a coerced 0 — a principle
   * absent on one side is incomparable, not "unchanged" (threat T-02-12).
   */
  delta: number | null;
}

/**
 * The version-diff read model (RESEARCH Pattern 6). `principles` is keyed by the
 * canonical `PRINCIPLES` names so Phase 3's `expected_effect` aligns to the same keys.
 */
export interface VersionDiff {
  /** The `from` cohort label (e.g. the harness version). */
  from: string;
  /** The `to` cohort label. */
  to: string;
  /** Per-principle before/after/delta, keyed by the canonical principle names. */
  principles: Record<HscPrinciple, PrincipleDelta>;
  /** Deterministic, non-LLM summary naming the principle that moved most. */
  verdict: string;
  /** Non-fatal warnings (e.g. cross-schema comparison). Omitted when empty. */
  warnings?: string[];
}

/** Options for {@link diff}: the two cohort labels (and an optional agent scope). */
export interface DiffOptions {
  /** `from` cohort — matched against `TraceFilter.version`. */
  from: string;
  /** `to` cohort — matched against `TraceFilter.version`. */
  to: string;
  /** Optional agent/harness id to scope both cohorts. */
  agentId?: string;
}

/** Minimum absolute delta to call a principle "moved" in the verdict. */
const MOVE_EPSILON = 1e-9;

/** Loose view of a raw trace so we can read its HSC schema version pre-normalization. */
interface RawTraceView {
  hsc_version?: unknown;
  hscVersion?: unknown;
  turns?: unknown;
  trace_id?: unknown;
  traceId?: unknown;
}

/** Read the HSC schema version a raw trace declares, if any. */
function hscVersionOf(trace: unknown): string | undefined {
  if (!trace || typeof trace !== "object") return undefined;
  const t = trace as RawTraceView;
  const v = t.hsc_version ?? t.hscVersion;
  return typeof v === "string" ? v : undefined;
}

/** Stable source-trace id for namespacing aggregated event ids. */
function traceIdOf(trace: unknown, index: number): string {
  if (trace && typeof trace === "object") {
    const t = trace as RawTraceView;
    const id = t.traceId ?? t.trace_id;
    if (typeof id === "string" && id) return id;
  }
  return `trace-${index}`;
}

/**
 * Concatenate a cohort's member traces into ONE synthetic flat trace. Turns from
 * every member are appended; each turn id and event id is namespaced by its source
 * trace id so events from different traces never collide. `diagnose()` normalizes the
 * flat shape, so we keep the dotted-key layout the fixtures/store emit.
 */
function aggregateCohort(
  label: string,
  traces: readonly unknown[],
  hscVersion: string,
): Record<string, unknown> {
  const turns: unknown[] = [];
  for (let i = 0; i < traces.length; i++) {
    const raw = traces[i];
    const srcId = traceIdOf(raw, i);
    const memberTurns = (raw && typeof raw === "object" ? (raw as RawTraceView).turns : undefined) as
      | unknown[]
      | undefined;
    if (!Array.isArray(memberTurns)) continue;
    for (let j = 0; j < memberTurns.length; j++) {
      const turn = memberTurns[j];
      if (!turn || typeof turn !== "object") continue;
      const t = turn as Record<string, unknown>;
      const turnId = `${srcId}:${(t["turn_id"] ?? t["turnId"] ?? t["id"] ?? `t${j}`) as string}`;
      const events = Array.isArray(t["events"]) ? (t["events"] as unknown[]) : [];
      const namespacedEvents = events.map((ev) => {
        if (!ev || typeof ev !== "object") return ev;
        const e = ev as Record<string, unknown>;
        const evId = (e["span_id"] ?? e["eventId"] ?? "") as string;
        return { ...e, span_id: `${srcId}:${evId}` };
      });
      turns.push({ turn_id: turnId, events: namespacedEvents });
    }
  }
  // Emit the STRUCTURED trace shape (`traceId` + `turns`) so `diagnose()` routes it
  // through its light structural guard rather than the strict flat HSC JSON-schema
  // validator — the aggregate is a synthetic in-memory pooling of already-validated
  // member traces, not an on-the-wire flat trace. Event records keep their original
  // (flat dotted or structured) keys; `loadTrace` normalizes either. `hscVersion` is
  // carried through for completeness even though the structured path does not require
  // it.
  return {
    traceId: `cohort-${label}`,
    agentId: "cohort",
    harnessVersion: label,
    hscVersion,
    turns,
  };
}

/** Index a DiagnosticResult's principle scores by principle name. */
function scoresByPrinciple(result: DiagnosticResult): Record<HscPrinciple, number | null> {
  const out = Object.fromEntries(PRINCIPLES.map((p) => [p, null])) as Record<
    HscPrinciple,
    number | null
  >;
  for (const ps of result.principles) {
    out[ps.principle] = ps.score;
  }
  return out;
}

/** Build the deterministic verdict from the computed per-principle deltas. */
function buildVerdict(
  from: string,
  to: string,
  principles: Record<HscPrinciple, PrincipleDelta>,
): string {
  let topPrinciple: HscPrinciple | null = null;
  let topDelta = 0;
  for (const principle of PRINCIPLES) {
    const d = principles[principle].delta;
    if (d === null) continue;
    if (Math.abs(d) > Math.abs(topDelta) || (topPrinciple === null && d !== 0)) {
      topDelta = d;
      topPrinciple = principle;
    }
  }

  if (topPrinciple === null || Math.abs(topDelta) <= MOVE_EPSILON) {
    return `${to} vs ${from}: no measurable per-principle change.`;
  }

  const direction = topDelta > 0 ? "improves" : "regresses";
  const magnitude = (topDelta > 0 ? "+" : "") + topDelta.toFixed(2);
  return `${to} ${direction} ${topPrinciple} by ${magnitude} vs ${from}.`;
}

/**
 * Diff two cohorts of traces on the convergence principles.
 *
 * @param query the abstract read interface (a Phase 1 store, or a test stub) — NEVER a
 *   concrete store import.
 * @param opts the `from`/`to` cohort labels (matched on `TraceFilter.version`) and an
 *   optional `agentId` scope.
 * @returns a {@link VersionDiff} with null-safe per-principle deltas, a deterministic
 *   verdict, and an optional cross-schema warning.
 */
export async function diff(query: TraceQuery, opts: DiffOptions): Promise<VersionDiff> {
  const baseFilter: TraceFilter = opts.agentId ? { agentId: opts.agentId } : {};

  const [fromTraces, toTraces] = await Promise.all([
    query.queryTraces({ ...baseFilter, version: opts.from }),
    query.queryTraces({ ...baseFilter, version: opts.to }),
  ]);

  const warnings: string[] = [];

  // Cross-schema guard (RESEARCH Pitfall 6 / threat T-02-11): if the cohorts declare
  // different HSC schema versions, the comparison may be across incompatible schemas.
  const fromSchemas = new Set(
    fromTraces.map((t) => hscVersionOf(t)).filter((v): v is string => v !== undefined),
  );
  const toSchemas = new Set(
    toTraces.map((t) => hscVersionOf(t)).filter((v): v is string => v !== undefined),
  );
  const allSchemas = new Set([...fromSchemas, ...toSchemas]);
  if (allSchemas.size > 1) {
    warnings.push(
      `Cross-schema comparison: '${opts.from}' cohort uses HSC schema [${[...fromSchemas].join(
        ", ",
      )}] but '${opts.to}' cohort uses [${[...toSchemas].join(
        ", ",
      )}] — deltas may be incomparable across HSC schema versions.`,
    );
  }

  // Aggregate + diagnose each cohort once (see aggregation strategy in the file header).
  const fromSchema = [...fromSchemas][0] ?? "v0";
  const toSchema = [...toSchemas][0] ?? "v0";
  const fromResult = diagnose(aggregateCohort(opts.from, fromTraces, fromSchema));
  const toResult = diagnose(aggregateCohort(opts.to, toTraces, toSchema));
  const fromScores = scoresByPrinciple(fromResult);
  const toScores = scoresByPrinciple(toResult);

  // Null-safe per-principle delta (threat T-02-12): a null on EITHER side -> null delta.
  const principles = Object.fromEntries(
    PRINCIPLES.map((principle) => {
      const f = fromScores[principle];
      const t = toScores[principle];
      const delta = f === null || t === null ? null : t - f;
      return [principle, { from: f, to: t, delta } satisfies PrincipleDelta];
    }),
  ) as Record<HscPrinciple, PrincipleDelta>;

  const verdict = buildVerdict(opts.from, opts.to, principles);

  return {
    from: opts.from,
    to: opts.to,
    principles,
    verdict,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
