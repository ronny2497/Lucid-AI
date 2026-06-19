/**
 * MetricsPanel — renders the server-derived `BaseMetrics` (GET /api/metrics).
 *
 * Metrics are NEVER computed client-side (RESEARCH Anti-Pattern): this panel
 * only displays what the collector returned. `costPerRun: null` renders as
 * "unknown" (an unpriced model is not $0). The Recharts bar gives a small visual
 * for latency p50/p95; the rest render as labeled stat cells.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BaseMetrics } from "../api/types.js";
import { formatCost, formatDurationNs, formatPct } from "../lib/format.js";

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export function MetricsPanel({ metrics }: { metrics: BaseMetrics }) {
  const latencyData = [
    { name: "p50", ms: metrics.latencyP50 / 1_000_000 },
    { name: "p95", ms: metrics.latencyP95 / 1_000_000 },
  ];

  return (
    <section className="metrics-panel" data-testid="metrics-panel">
      <h2>Base metrics</h2>
      <div className="stat-grid">
        <Stat label="Traces" value={String(metrics.traceCount)} />
        <Stat
          label="Success rate"
          value={formatPct(metrics.successRate)}
          title={`declared ${metrics.successSourceBreakdown.declared} / inferred ${metrics.successSourceBreakdown.inferred}`}
        />
        <Stat
          label="Cost / run"
          value={metrics.costUnknown ? "unknown" : formatCost(metrics.costPerRun)}
          title={metrics.costUnknown ? "an unpriced model is present — cost is not fabricated" : undefined}
        />
        <Stat label="Latency p50" value={formatDurationNs(metrics.latencyP50)} />
        <Stat label="Latency p95" value={formatDurationNs(metrics.latencyP95)} />
        <Stat label="Total tokens" value={String(metrics.totalTokens)} />
        <Stat label="Tool-error rate" value={formatPct(metrics.toolErrorRate)} />
      </div>
      <div className="metrics-chart">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={latencyData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis unit="ms" />
            <Tooltip
              formatter={(value: number) => [
                formatDurationNs(value * 1_000_000),
                "latency",
              ]}
            />
            <Bar dataKey="ms" fill="#6366f1" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
