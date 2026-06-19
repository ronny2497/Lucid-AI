/**
 * `SqliteTraceStore` — the better-sqlite3 implementation of `TraceStore`.
 *
 * T-01-04 (SQL injection): EVERY read and write uses prepared statements with
 * `?` placeholders. No agent/version/attribute value is ever interpolated into
 * a SQL string.
 *
 * Encapsulation (RESEARCH Anti-Pattern): the better-sqlite3 `Database` handle
 * is PRIVATE to this module — it is never exported and there is no getter, so
 * swapping to DuckDB/ClickHouse is a swap, not a rewrite.
 *
 * D-05 (absence preservation): `writeSpans` inserts exactly one row per emitted
 * event. It never synthesises a row for an event type that was not emitted.
 */

import Database from "better-sqlite3";
import type { Database as BetterSqlite3Database, Statement } from "better-sqlite3";
import {
  HARNESS_ATTR,
  GEN_AI_ATTR,
  type HscEventType,
  type HscPrinciple,
} from "@lucid/hsc-schema";
import type { TraceStore } from "./interface.js";
import type {
  HscSpan,
  HarnessTrace,
  HarnessEvent,
  Turn,
  Attrs,
  TraceFilter,
  MetricsFilter,
  MetricsInput,
  MetricsInputRow,
} from "./types.js";
import { SCHEMA } from "./schema.js";

/** OTel SpanStatusCode.ERROR — the single error sentinel used for tool errors. */
const OTEL_STATUS_ERROR = 2;

interface TraceRow {
  trace_id: string;
  agent_id: string;
  harness_version: string | null;
  start_time: number;
  end_time: number | null;
  status_code: number | null;
  attrs_json: string | null;
}

interface EventRow {
  event_id: string;
  trace_id: string;
  turn_id: string | null;
  parent_id: string | null;
  event_type: string;
  principle: string | null;
  quadrant_x: string | null;
  quadrant_y: string | null;
  start_time: number;
  end_time: number | null;
  status_code: number | null;
  attrs_json: string | null;
}

export class SqliteTraceStore implements TraceStore {
  // PRIVATE — never exported, no getter. The raw handle stays in this module.
  readonly #db: BetterSqlite3Database;

  readonly #insertTrace: Statement;
  readonly #insertEvent: Statement;

  constructor(path = ":memory:") {
    this.#db = new Database(path);
    this.#db.pragma("journal_mode = WAL");
    this.#db.pragma("foreign_keys = ON");
    this.#db.exec(SCHEMA);

    // INSERT OR REPLACE on the trace row makes writeSpans idempotent per trace
    // without ever fabricating an event row.
    this.#insertTrace = this.#db.prepare(
      `INSERT INTO harness_traces
         (trace_id, agent_id, harness_version, start_time, end_time, status_code, attrs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(trace_id) DO UPDATE SET
         agent_id = excluded.agent_id,
         harness_version = excluded.harness_version,
         start_time = excluded.start_time,
         end_time = excluded.end_time,
         status_code = excluded.status_code,
         attrs_json = excluded.attrs_json`,
    );

    this.#insertEvent = this.#db.prepare(
      `INSERT INTO harness_events
         (event_id, trace_id, turn_id, parent_id, event_type, principle,
          quadrant_x, quadrant_y, start_time, end_time, status_code, attrs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         trace_id = excluded.trace_id,
         turn_id = excluded.turn_id,
         parent_id = excluded.parent_id,
         event_type = excluded.event_type,
         principle = excluded.principle,
         quadrant_x = excluded.quadrant_x,
         quadrant_y = excluded.quadrant_y,
         start_time = excluded.start_time,
         end_time = excluded.end_time,
         status_code = excluded.status_code,
         attrs_json = excluded.attrs_json`,
    );
  }

  async writeSpans(spans: HscSpan[]): Promise<void> {
    const tx = this.#db.transaction((batch: HscSpan[]) => {
      for (const span of batch) {
        this.#insertTrace.run(
          span.traceId,
          span.agentId,
          span.harnessVersion ?? null,
          span.traceStartTime,
          span.traceEndTime,
          span.traceStatusCode,
          span.traceAttrs ? JSON.stringify(span.traceAttrs) : null,
        );
        const e = span.event;
        this.#insertEvent.run(
          e.eventId,
          span.traceId,
          span.turnId ?? null,
          e.parentId,
          e.eventType,
          e.principle,
          e.quadrantX,
          e.quadrantY,
          e.startTime,
          e.endTime,
          e.statusCode,
          e.attrs ? JSON.stringify(e.attrs) : null,
        );
      }
    });
    tx(spans);
  }

  async queryTraces(filter: TraceFilter): Promise<HarnessTrace[]> {
    const { sql, params } = this.#buildTraceWhere(filter);
    const rows = this.#db
      .prepare(
        `SELECT trace_id, agent_id, harness_version, start_time, end_time, status_code, attrs_json
           FROM harness_traces
           ${sql}
           ORDER BY start_time ASC`,
      )
      .all(...params) as TraceRow[];
    return rows.map((row) => this.#assembleTrace(row));
  }

  async getTrace(traceId: string): Promise<HarnessTrace | null> {
    const row = this.#db
      .prepare(
        `SELECT trace_id, agent_id, harness_version, start_time, end_time, status_code, attrs_json
           FROM harness_traces WHERE trace_id = ?`,
      )
      .get(traceId) as TraceRow | undefined;
    if (!row) return null;
    return this.#assembleTrace(row);
  }

  async getMetricsInput(filter: MetricsFilter): Promise<MetricsInput> {
    const { sql, params } = this.#buildTraceWhere(filter);
    const traceRows = this.#db
      .prepare(
        `SELECT trace_id, agent_id, harness_version, start_time, end_time, status_code, attrs_json
           FROM harness_traces
           ${sql}
           ORDER BY start_time ASC`,
      )
      .all(...params) as TraceRow[];

    const rows: MetricsInputRow[] = traceRows.map((t) => {
      const events = this.#eventRowsFor(t.trace_id);
      let inputTokens = 0;
      let outputTokens = 0;
      let model: string | null = null;
      let mutatingToolCallCount = 0;
      let toolErrorCount = 0;

      for (const ev of events) {
        const attrs = parseAttrs(ev.attrs_json);
        const inTok = attrs[GEN_AI_ATTR.usageInputTokens];
        const outTok = attrs[GEN_AI_ATTR.usageOutputTokens];
        if (typeof inTok === "number") inputTokens += inTok;
        if (typeof outTok === "number") outputTokens += outTok;
        const m = attrs[GEN_AI_ATTR.requestModel];
        if (model === null && typeof m === "string") model = m;

        if (ev.event_type === ("tool.call" satisfies HscEventType)) {
          if (attrs[HARNESS_ATTR.mutatedState] === true) mutatingToolCallCount += 1;
          if (ev.status_code === OTEL_STATUS_ERROR) toolErrorCount += 1;
        }
      }

      const durationNs =
        t.end_time !== null && t.end_time !== undefined
          ? t.end_time - t.start_time
          : null;

      return {
        traceId: t.trace_id,
        agentId: t.agent_id,
        statusCode: t.status_code,
        durationNs,
        inputTokens,
        outputTokens,
        model,
        mutatingToolCallCount,
        toolErrorCount,
      };
    });

    return { traces: rows };
  }

  // --- private helpers -------------------------------------------------------

  #buildTraceWhere(filter: TraceFilter): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.agentId !== undefined) {
      clauses.push("agent_id = ?");
      params.push(filter.agentId);
    }
    if (filter.version !== undefined) {
      clauses.push("harness_version = ?");
      params.push(filter.version);
    }
    if (filter.status !== undefined) {
      clauses.push("status_code = ?");
      params.push(filter.status);
    }
    if (filter.startTime !== undefined) {
      clauses.push("start_time >= ?");
      params.push(filter.startTime);
    }
    if (filter.endTime !== undefined) {
      clauses.push("start_time <= ?");
      params.push(filter.endTime);
    }
    const sql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return { sql, params };
  }

  #eventRowsFor(traceId: string): EventRow[] {
    return this.#db
      .prepare(
        `SELECT event_id, trace_id, turn_id, parent_id, event_type, principle,
                quadrant_x, quadrant_y, start_time, end_time, status_code, attrs_json
           FROM harness_events
           WHERE trace_id = ?
           ORDER BY start_time ASC`,
      )
      .all(traceId) as EventRow[];
  }

  #assembleTrace(row: TraceRow): HarnessTrace {
    const eventRows = this.#eventRowsFor(row.trace_id);
    const turnsById = new Map<string, Turn>();
    const turnOrder: string[] = [];

    for (const ev of eventRows) {
      const turnId = ev.turn_id ?? "__default__";
      if (!turnsById.has(turnId)) {
        turnsById.set(turnId, { turnId, events: [] });
        turnOrder.push(turnId);
      }
      turnsById.get(turnId)!.events.push(toHarnessEvent(ev));
    }

    return {
      traceId: row.trace_id,
      agentId: row.agent_id,
      harnessVersion: row.harness_version ?? "",
      startTime: row.start_time,
      endTime: row.end_time,
      statusCode: row.status_code,
      attrs: parseAttrs(row.attrs_json),
      turns: turnOrder.map((id) => turnsById.get(id)!),
    };
  }
}

function parseAttrs(json: string | null): Attrs {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Attrs) : {};
  } catch {
    return {};
  }
}

function toHarnessEvent(ev: EventRow): HarnessEvent {
  return {
    eventId: ev.event_id,
    traceId: ev.trace_id,
    parentId: ev.parent_id,
    eventType: ev.event_type as HscEventType,
    principle: (ev.principle as HscPrinciple | null) ?? null,
    quadrantX: ev.quadrant_x,
    quadrantY: ev.quadrant_y,
    startTime: ev.start_time,
    endTime: ev.end_time,
    statusCode: ev.status_code,
    attrs: parseAttrs(ev.attrs_json),
  };
}
