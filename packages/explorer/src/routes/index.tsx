/**
 * Run-list route (`/`): one row per trace from GET /api/traces, with agent /
 * version / since / status filter controls. Clicking a row navigates to the
 * single-trace view at `/traces/$id`.
 *
 * The presentational `RunList` uses plain anchors (`/traces/<id>`) for row
 * navigation so it can be unit-tested without a RouterProvider; the live SPA's
 * TanStack browser history resolves the same paths. Read-only only — no
 * mutation controls (T-01-15).
 */

import { useMemo, useState } from "react";
import { useTraces } from "../api/hooks.js";
import type { RunListRow, TraceFilterQuery } from "../api/types.js";
import { formatCost, formatDurationNs, statusLabel } from "../lib/format.js";
import { Badge } from "../components/Badge.js";

function Filters({
  value,
  onChange,
}: {
  value: TraceFilterQuery;
  onChange: (next: TraceFilterQuery) => void;
}) {
  return (
    <form className="filters" onSubmit={(e) => e.preventDefault()}>
      <label>
        Agent
        <input
          name="agent"
          value={value.agent ?? ""}
          placeholder="all agents"
          onChange={(e) => onChange({ ...value, agent: e.target.value })}
        />
      </label>
      <label>
        Version
        <input
          name="version"
          value={value.version ?? ""}
          placeholder="any"
          onChange={(e) => onChange({ ...value, version: e.target.value })}
        />
      </label>
      <label>
        Since
        <input
          name="since"
          value={value.since ?? ""}
          placeholder="e.g. 24h"
          onChange={(e) => onChange({ ...value, since: e.target.value })}
        />
      </label>
      <label>
        Status
        <select
          name="status"
          value={value.status ?? ""}
          onChange={(e) => onChange({ ...value, status: e.target.value })}
        >
          <option value="">any</option>
          <option value="0">ok</option>
          <option value="2">error</option>
        </select>
      </label>
    </form>
  );
}

function Row({ row }: { row: RunListRow }) {
  return (
    <tr className="run-row">
      <td>
        <a className="trace-link" href={`/traces/${row.traceId}`}>
          {row.traceId}
        </a>
      </td>
      <td>{row.agentId}</td>
      <td>{row.harnessVersion}</td>
      <td>
        <Badge variant={row.statusCode === 2 ? "error" : "ok"}>
          {statusLabel(row.statusCode)}
        </Badge>
      </td>
      <td>{formatDurationNs(row.durationNs)}</td>
      <td>{formatCost(row.cost)}</td>
      <td>{row.eventCount}</td>
    </tr>
  );
}

export function RunList() {
  const [filter, setFilter] = useState<TraceFilterQuery>({});
  const query = useTraces(filter);
  const rows = useMemo(() => query.data?.traces ?? [], [query.data]);

  return (
    <div className="run-list">
      <Filters value={filter} onChange={setFilter} />

      {query.isLoading && <p className="status-line">Loading traces…</p>}
      {query.isError && (
        <p className="status-line error">
          Failed to load traces: {query.error.message}
        </p>
      )}
      {!query.isLoading && !query.isError && rows.length === 0 && (
        <p className="status-line">No traces match this filter.</p>
      )}

      {rows.length > 0 && (
        <table className="run-table">
          <thead>
            <tr>
              <th>Trace</th>
              <th>Agent</th>
              <th>Version</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Cost</th>
              <th>Events</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row key={row.traceId} row={row} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
