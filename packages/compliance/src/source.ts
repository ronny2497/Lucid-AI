/**
 * The audit-data read seam (Assumption A1 / A3 isolation).
 *
 * `@lucid/compliance` reads Phase 3–5 audit data ONLY through the injected
 * `AuditSource` interface (frozen in `index.ts`). It NEVER imports `@lucid/store`
 * or `@lucid/evolution` at runtime — keeping compliance a leaf package whose
 * value tracks the AVAILABILITY of upstream audit data without coupling to its
 * runtime. The concrete store binding lives in the CLI (`cli.ts`).
 *
 * This module provides two satisfiers of the seam:
 *   - {@link InMemoryAuditSource} — a test/fixture source over an in-memory list.
 *   - {@link traceStoreAuditSource} — the concrete adapter the CLI binds over a
 *     `@lucid/store` `TraceStore`. The store is referenced by a STRUCTURAL TYPE
 *     here (no import), so this file still takes no dependency on the package;
 *     the CLI passes a live store that structurally satisfies it.
 *
 * Draft records are the union of what's available:
 *   - ALWAYS the trace basics: record_id, start/end time, agent_id,
 *     harness_version, model_id (Article 12 basic logging — present even when
 *     Phases 3–5 are absent).
 *   - OPTIONALLY change_manifest_ids + human_oversight_action when Phase 3–5
 *     audit data (change_manifest / evolve.propose) exists. When absent, the
 *     adapter emits an empty `change_manifest_ids` array and omits
 *     `human_oversight_action` — it NEVER fabricates change traceability.
 */

import type { AuditQuery, AuditDraftRecord, AuditSource } from "./index.js";

export type { AuditQuery, AuditDraftRecord, AuditSource } from "./index.js";

/** ISO 8601 string from epoch nanoseconds (the store's time unit). */
function isoFromNanos(nanos: number | null | undefined, fallback: string): string {
  if (nanos === null || nanos === undefined) return fallback;
  return new Date(Math.floor(nanos / 1_000_000)).toISOString();
}

/** Is `iso` within [since, until] inclusive? Lexical ISO-8601 compare is safe. */
function inWindow(iso: string, since: string, until: string): boolean {
  return iso >= since && iso <= until;
}

/**
 * An in-memory `AuditSource` over a fixed list of draft records — for tests and
 * fixtures. Filters by agent id and the inclusive [since, until] window on each
 * record's `start_time`. Constructed with either a FULL record set (with change
 * manifests / oversight) or a Phase-3-5-ABSENT basics-only set, so both code
 * paths are exercised without a live store.
 */
export class InMemoryAuditSource implements AuditSource {
  constructor(private readonly records: readonly AuditDraftRecord[]) {}

  fetchRecords(query: AuditQuery): readonly AuditDraftRecord[] {
    return this.records
      .filter(
        (r) =>
          r.agent_id === query.agentId &&
          inWindow(r.start_time, query.since, query.until),
      )
      .slice()
      .sort((a, b) => (a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0));
  }
}

/**
 * The minimal STRUCTURAL shape of a `@lucid/store` trace the adapter reads. Kept
 * local (not imported) so compliance takes no dependency on `@lucid/store`; the
 * CLI passes a live store whose `HarnessTrace` structurally satisfies this.
 */
export interface TraceLike {
  readonly traceId: string;
  readonly agentId: string;
  readonly harnessVersion: string;
  readonly startTime: number;
  readonly endTime: number | null;
  readonly attrs: Readonly<Record<string, unknown>>;
}

/** The minimal structural shape of the store query surface the adapter uses. */
export interface TraceQuerier {
  queryTraces(filter: {
    agentId?: string;
    startTime?: number;
    endTime?: number;
  }): Promise<readonly TraceLike[]>;
}

/** Read a string attribute off a trace's attribute bag, or undefined. */
function strAttr(attrs: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const v = attrs[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Read change_manifest ids off a trace (array or single id), or empty. */
function changeManifestIds(attrs: Readonly<Record<string, unknown>>): string[] {
  const v = attrs["harness.change_manifest_id"];
  if (typeof v === "string" && v.length > 0) return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return [];
}

/**
 * Build the concrete `AuditSource` the CLI binds over a `@lucid/store`
 * `TraceStore`. The store query is filter-bounded (agent + time window) so the
 * read is never unbounded (T-06-19 DoS). For each trace it derives the Article
 * 12 BASICS (record_id, period, agent, harness/model version), and — only when
 * present — the change_manifest_ids and human_oversight_action. Absent upstream
 * data yields an empty `change_manifest_ids` and omits oversight (no fabrication).
 *
 * `@lucid/store` is referenced ONLY by the structural {@link TraceQuerier} type;
 * the CLI passes the live store. This is the single store-binding boundary.
 */
export function traceStoreAuditSource(store: TraceQuerier): AuditSource {
  return {
    async fetchRecords(query: AuditQuery): Promise<readonly AuditDraftRecord[]> {
      const sinceNanos = Date.parse(query.since) * 1_000_000;
      const untilNanos = Date.parse(query.until) * 1_000_000;
      const traces = await store.queryTraces({
        agentId: query.agentId,
        startTime: Number.isNaN(sinceNanos) ? undefined : sinceNanos,
        endTime: Number.isNaN(untilNanos) ? undefined : untilNanos,
      });
      const drafts: AuditDraftRecord[] = traces.map((t) => {
        const start = isoFromNanos(t.startTime, query.since);
        const end = isoFromNanos(t.endTime, start);
        const model =
          strAttr(t.attrs, "gen_ai.request.model") ?? "unknown";
        const oversight = strAttr(t.attrs, "harness.human_oversight_action");
        const draft: AuditDraftRecord = {
          record_id: t.traceId,
          start_time: start,
          end_time: end,
          agent_id: t.agentId,
          harness_version: t.harnessVersion || "unknown",
          model_id: model,
          // Phase 3–5 traceability — empty when absent (never fabricated).
          change_manifest_ids: changeManifestIds(t.attrs),
          ...(oversight ? { human_oversight_action: oversight } : {}),
        };
        return draft;
      });
      return drafts
        .slice()
        .sort((a, b) => (a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0));
    },
  };
}
