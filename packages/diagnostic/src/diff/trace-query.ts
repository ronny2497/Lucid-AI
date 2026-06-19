/**
 * @lucid/diagnostic — the abstract `TraceQuery` read contract (Plan 02-05).
 *
 * `diff()` (version & cohort diffing, REQ-04) must load each cohort's traces WITHOUT
 * importing a concrete storage backend. This file defines Phase 2's OWN minimal read
 * interface — `TraceQuery` — and `diff()` depends only on it. No `better-sqlite3`,
 * DuckDB, or any `@lucid/store` concrete class is imported by the diff engine; the
 * Phase 1 store is an ASSUMED collaborator that structurally satisfies this contract.
 *
 * ## Phase 1 reconciliation (interface_context / RESEARCH Open Question 3, Pattern 1)
 *
 * Phase 1's `@lucid/store` exposes the real read surface:
 *
 *   interface TraceStore {
 *     queryTraces(filter: TraceFilter): Promise<HarnessTrace[]>;
 *     getTrace(traceId): Promise<HarnessTrace | null>;
 *     // ...writeSpans, getMetricsInput
 *   }
 *
 * with `@lucid/store`'s `TraceFilter = { agentId?, version?, startTime?, endTime?, status? }`.
 *
 * Phase 2's `TraceQuery` below is the SUBSET of that surface `diff()` needs — just
 * `queryTraces(filter)`. The store's `TraceStore` structurally satisfies `TraceQuery`
 * (a `TraceStore` IS a `TraceQuery`), so a caller can hand the real store straight to
 * `diff()` with no adapter.
 *
 * ### Reconciliation gap surfaced for Phase 1 (OPEN QUESTION)
 *
 * Phase 2's `TraceFilter` and the real `@lucid/store` `TraceFilter` differ in two
 * fields, called out here so Phase 1 can reconcile (only THIS file changes if so):
 *
 *   | Phase 2 TraceFilter | @lucid/store TraceFilter | reconciliation                       |
 *   | ------------------- | ------------------------ | ------------------------------------ |
 *   | agentId?            | agentId?                 | identical                            |
 *   | version?            | version?                 | identical — the primary cohort key   |
 *   | since? (unix-nanos) | startTime? (unix-nanos)  | RENAME: Phase 1 uses `startTime`     |
 *   | cohort? (free tag)  | (absent)                 | Phase 1 has no arbitrary cohort tag  |
 *
 * Because `diff()` filters cohorts by `version` (which BOTH sides expose), the engine
 * works against the real store today via `version`. The optional `since`/`cohort`
 * fields are Phase 2's forward-looking superset (PRD §11 "support all cohorts via a
 * single `--cohort` selector"); they are OPTIONAL, so a store that ignores them still
 * satisfies the structural contract. **OPEN QUESTION for Phase 1:** should Phase 1's
 * `TraceFilter` adopt `since`/`cohort`, or should Phase 2 map `since -> startTime` and
 * drop `cohort` at the call boundary? Until decided, `diff()` only ever populates
 * `version`/`agentId`, which both filters share.
 *
 * `TraceQuery` returns the structured `HarnessTrace[]` (02-01 shape, which `diagnose()`
 * consumes). `diagnose()` also accepts the flat OTLP fixture shape, so an in-memory
 * test `TraceQuery` may return flat fixture traces — `diagnose()` normalizes either.
 */

import type { HarnessTrace } from "../types.js";

/**
 * Cohort selector for {@link TraceQuery.queryTraces}. A forward-looking superset of
 * the `@lucid/store` `TraceFilter`: `agentId`/`version` are shared with Phase 1; every
 * field is optional so a Phase 1 store that knows only `agentId`/`version` (plus its
 * own `startTime`) still structurally satisfies the contract.
 */
export interface TraceFilter {
  /** Restrict to a single agent/harness id. */
  agentId?: string;
  /** The primary cohort key — `harness.version` (shared with `@lucid/store`). */
  version?: string;
  /**
   * Lower time bound in unix-nanos. NOTE: `@lucid/store` names this `startTime`;
   * reconcile at the Phase 1 boundary (see file header open question).
   */
  since?: number;
  /**
   * Arbitrary cohort tag (PRD §11 "single `--cohort` selector"). Not present in the
   * Phase 1 `TraceFilter` yet — surfaced as an open question.
   */
  cohort?: string;
}

/**
 * Phase 2's abstract read contract: the single method `diff()` uses to load a cohort.
 * The Phase 1 `@lucid/store` `TraceStore` structurally satisfies this (its
 * `queryTraces` has a compatible signature). `diff()` imports ONLY this interface —
 * never a concrete store — keeping Phase 2 decoupled from the storage backend.
 */
export interface TraceQuery {
  /**
   * Return the traces matching `filter`. May return the structured `HarnessTrace`
   * shape (Phase 1 store) or the flat OTLP fixture shape (test stubs) — `diagnose()`
   * normalizes either. Pure read: implementations MUST NOT mutate any trace.
   */
  queryTraces(filter: TraceFilter): Promise<HarnessTrace[]>;
}
