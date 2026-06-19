/**
 * SQLite DDL for the Lucid trace store.
 *
 * D-05 / T-01-06 INVARIANT: optional event columns have NO DEFAULT clauses.
 * Absence of an HSC event (e.g. no `verify.result` after a mutating
 * `tool.call`) is represented STRUCTURALLY by the ABSENCE of a row — never a
 * NULL/zero backfilled row that would mask the feedback gap.
 *
 * The column names mirror the `harness.*` logical concepts but are local
 * storage identifiers; the canonical attribute PATHS are owned by
 * `@lucid/hsc-schema` (HARNESS_ATTR / GEN_AI_ATTR) and reconstructed from
 * `attrs_json` on read, so a Phase 0 rename does not require a schema migration
 * of the dotted strings.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS harness_traces (
  trace_id        TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  harness_version TEXT,
  start_time      INTEGER NOT NULL,
  end_time        INTEGER,
  status_code     INTEGER,
  attrs_json      TEXT
);

CREATE TABLE IF NOT EXISTS harness_events (
  event_id     TEXT PRIMARY KEY,
  trace_id     TEXT NOT NULL REFERENCES harness_traces(trace_id),
  turn_id      TEXT,
  parent_id    TEXT,
  event_type   TEXT NOT NULL,
  principle    TEXT,
  quadrant_x   TEXT,
  quadrant_y   TEXT,
  start_time   INTEGER NOT NULL,
  end_time     INTEGER,
  status_code  INTEGER,
  attrs_json   TEXT
);

CREATE INDEX IF NOT EXISTS idx_traces_agent ON harness_traces(agent_id, start_time);
CREATE INDEX IF NOT EXISTS idx_events_type  ON harness_events(event_type, trace_id);
CREATE INDEX IF NOT EXISTS idx_events_trace ON harness_events(trace_id);
`;
