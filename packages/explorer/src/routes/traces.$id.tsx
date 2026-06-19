/**
 * Single-trace route (`/traces/$id`): renders the full HarnessTrace from
 * GET /api/traces/:id as turns -> events.
 *
 * Layout:
 *   - a Recharts Gantt timeline (TraceTimeline), one bar per event;
 *   - the turns -> events list, each event an EventRow (principle + quadrant
 *     badges, honest-absence safe, escaped attrs);
 *   - the server-derived MetricsPanel scoped to this trace's agent.
 *
 * Read-only only — no mutation controls (T-01-15). Metrics are fetched, not
 * computed here (RESEARCH Anti-Pattern).
 */

import { useMetrics, useTrace } from "../api/hooks.js";
import { EventRow } from "../components/EventRow.js";
import { MetricsPanel } from "../components/MetricsPanel.js";
import { TraceTimeline } from "../components/TraceTimeline.js";
import { formatDurationNs, formatTimestamp, statusLabel } from "../lib/format.js";
import { Badge } from "../components/Badge.js";

export function TraceView({ traceId }: { traceId: string }) {
  const traceQuery = useTrace(traceId);
  const trace = traceQuery.data;
  // Scope the metrics panel to this trace's agent once the trace is loaded.
  const metricsQuery = useMetrics(
    trace ? { agent: trace.agentId } : {},
  );

  if (traceQuery.isLoading) {
    return <p className="status-line">Loading trace…</p>;
  }
  if (traceQuery.isError) {
    return (
      <p className="status-line error">
        Failed to load trace: {traceQuery.error.message}
      </p>
    );
  }
  if (!trace) {
    return <p className="status-line">Trace not found.</p>;
  }

  const durationNs =
    trace.endTime !== null ? trace.endTime - trace.startTime : null;

  return (
    <div className="trace-view">
      <a className="back-link" href="/">
        ← back to run list
      </a>

      <header className="trace-header">
        <h2 className="trace-id">{trace.traceId}</h2>
        <div className="trace-meta">
          <Badge variant="principle">{trace.agentId}</Badge>
          <Badge variant="muted">v{trace.harnessVersion}</Badge>
          <Badge variant={trace.statusCode === 2 ? "error" : "ok"}>
            {statusLabel(trace.statusCode)}
          </Badge>
          <span className="trace-duration">{formatDurationNs(durationNs)}</span>
          <span className="trace-started">{formatTimestamp(trace.startTime)}</span>
        </div>
      </header>

      <section className="trace-timeline-section">
        <h3>Timeline</h3>
        <TraceTimeline trace={trace} />
      </section>

      <section className="trace-turns">
        <h3>Turns &amp; events</h3>
        {trace.turns.length === 0 && (
          <p className="status-line">This trace has no recorded events.</p>
        )}
        {trace.turns.map((turn, ti) => (
          <div key={turn.turnId} className="turn">
            <div className="turn-head">turn {ti + 1}</div>
            <ul className="event-list">
              {turn.events.map((event) => (
                <EventRow key={event.eventId} event={event} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="trace-metrics-section">
        {metricsQuery.isLoading && <p className="status-line">Loading metrics…</p>}
        {metricsQuery.isError && (
          <p className="status-line error">
            Failed to load metrics: {metricsQuery.error.message}
          </p>
        )}
        {metricsQuery.data && <MetricsPanel metrics={metricsQuery.data} />}
      </section>
    </div>
  );
}
