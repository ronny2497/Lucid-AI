/**
 * Pure formatting helpers shared by the views. None of these fabricate values:
 * a null/absent input renders an explicit "unknown" / "absent" marker so the UI
 * never invents a number the server did not provide (D-05).
 */

/** Format a nanosecond duration as a human string, or "unknown" when null. */
export function formatDurationNs(durationNs: number | null): string {
  if (durationNs === null || !Number.isFinite(durationNs)) return "unknown";
  const ms = durationNs / 1_000_000;
  if (ms < 1) return `${(durationNs / 1000).toFixed(0)} us`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Format a USD cost, or "unknown" when null (unpriced model — never $0). */
export function formatCost(cost: number | null): string {
  if (cost === null || !Number.isFinite(cost)) return "unknown";
  return `$${cost.toFixed(4)}`;
}

/** Format a 0..1 rate as a percentage. */
export function formatPct(rate: number): string {
  if (!Number.isFinite(rate)) return "unknown";
  return `${(rate * 100).toFixed(1)}%`;
}

/** Map an OTel status code to a short label (0 = ok, 2 = error). */
export function statusLabel(statusCode: number | null): string {
  if (statusCode === null) return "open";
  if (statusCode === 2) return "error";
  if (statusCode === 0 || statusCode === 1) return "ok";
  return `status ${statusCode}`;
}

/** Render an absolute ns epoch timestamp as an ISO string. */
export function formatTimestamp(ns: number): string {
  const ms = ns / 1_000_000;
  if (!Number.isFinite(ms)) return "unknown";
  return new Date(ms).toISOString();
}

/** Stringify an attribute value for escaped display (arrays joined). */
export function attrToText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return value.map(attrToText).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
