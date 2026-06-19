/**
 * TraceTimeline — a Gantt-style timeline, one horizontal row per event, drawn
 * with Recharts (NOT a hand-rolled SVG/canvas waterfall — RESEARCH Anti-Pattern).
 *
 * Each event becomes a horizontal BarChart bar whose left edge is its offset
 * from the trace start and whose length is its duration. We model this with a
 * stacked bar: a transparent "offset" segment plus a visible "duration" segment
 * (the standard Recharts technique for floating/Gantt bars). Open events
 * (endTime === null) render a thin zero-duration marker — the gap is shown, not
 * fabricated into a span.
 */

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HarnessTrace } from "../api/types.js";
import { formatDurationNs } from "../lib/format.js";

interface TimelineDatum {
  label: string;
  eventType: string;
  /** ms offset from trace start (transparent spacer segment). */
  offsetMs: number;
  /** ms duration (the visible bar); 0 for open events. */
  durationMs: number;
  open: boolean;
}

const TYPE_COLOR: Record<string, string> = {
  "context.load": "#6366f1",
  "plan.emit": "#8b5cf6",
  "task.slice": "#0ea5e9",
  "tool.call": "#f59e0b",
  "feedback.check": "#10b981",
  "verify.result": "#22c55e",
  "doc.encode": "#14b8a6",
  "evolve.propose": "#ec4899",
  "evolve.apply": "#d946ef",
  error: "#ef4444",
};

function buildData(trace: HarnessTrace): TimelineDatum[] {
  const start = trace.startTime;
  const data: TimelineDatum[] = [];
  let n = 0;
  for (const turn of trace.turns) {
    for (const ev of turn.events) {
      n += 1;
      const open = ev.endTime === null;
      const offsetMs = (ev.startTime - start) / 1_000_000;
      const durationMs = open ? 0 : (ev.endTime! - ev.startTime) / 1_000_000;
      data.push({
        label: `${n}. ${ev.eventType}`,
        eventType: ev.eventType,
        offsetMs: Math.max(0, offsetMs),
        durationMs: Math.max(0, durationMs),
        open,
      });
    }
  }
  return data;
}

export function TraceTimeline({ trace }: { trace: HarnessTrace }) {
  const data = buildData(trace);
  if (data.length === 0) {
    return <p className="timeline-empty">No events to plot.</p>;
  }
  // Height scales with event count so every row is readable.
  const height = Math.max(120, data.length * 28 + 40);

  return (
    <div className="trace-timeline" data-testid="trace-timeline">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 8, right: 24, bottom: 8, left: 8 }}
        >
          <XAxis
            type="number"
            unit="ms"
            tickFormatter={(v: number) => `${v}`}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={180}
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            formatter={(value: number, name: string) =>
              name === "durationMs"
                ? [formatDurationNs(value * 1_000_000), "duration"]
                : [`${value} ms`, name]
            }
          />
          {/* Transparent spacer positions the visible bar (Gantt offset). */}
          <Bar dataKey="offsetMs" stackId="t" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="durationMs" stackId="t" isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={TYPE_COLOR[d.eventType] ?? "#64748b"}
                fillOpacity={d.open ? 0.3 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
