/**
 * Trajectory exporter — stored traces → prompts-only training dataset (05-02, REQ-05).
 *
 * This is the read half of the L2 training-signal pipeline. It turns the harness's
 * stored traces into a `PromptRecord[]` that the GRPO sidecar (05-04) will generate
 * FRESH completions for. Two disciplines are enforced here at the export boundary:
 *
 *   1. ON-POLICY, PROMPTS ONLY (HARD, RESEARCH Pitfall 1, threat T-05-06):
 *      a `PromptRecord` carries NO `completion`/`response`/`output` field, and the
 *      prompt-reconstruction step EXPLICITLY skips any attr whose key looks like a
 *      model output (see `isModelOutputAttr`). Stored production completions are
 *      NEVER serialized — feeding them to the trainer would be off-policy and poison
 *      the gradient. A test asserts the model-output value never appears in the
 *      serialized prompt.
 *
 *   2. ABSTRACT READ SEAM (HARD, no store coupling): the exporter reads ONLY through
 *      the abstract `TraceQuery` interface (`@lucid/diagnostic`, the same seam Phase
 *      2's `diff()` uses), NEVER `@lucid/store`'s concrete SQLite implementation. A
 *      `TraceStore` structurally satisfies `TraceQuery`, so a caller may hand the
 *      real store straight in with no adapter.
 *
 * ## Prompt-reconstruction rule (recorded per the plan's output contract)
 *
 * GRANULARITY: one `PromptRecord` PER TRACE (a trace is one agent run; its prompt is
 * the context the agent was given). For each trace we scan its turns→events for
 * `context.load` events (the feedforward context-load step the 2×2 plotter bins) and
 * concatenate their non-output context attrs into a deterministic prompt string:
 *
 *   - we collect every `context.load` event's `attrs` entries whose key is NOT a
 *     model-output key (`isModelOutputAttr`) and whose value is a string/number/bool;
 *   - entries are sorted by `key` for determinism, then rendered `key=value` and
 *     joined by `\n`; events are processed in turn/event order.
 *   - if a trace has no `context.load` event (or none with a usable context attr) we
 *     fall back to the trace-level `attrs` (same non-output, sorted-by-key rule), and
 *     if THAT is empty too we use a stable synthetic `"<trace:{traceId}>"` so the
 *     prompt is never empty (the schema requires a non-empty prompt downstream).
 *
 * The chosen context attr key is whatever the trace carries (commonly `context.text`
 * / `context.payload`); the rule is key-agnostic so it survives an attr rename, and
 * the model-output skip-list is what enforces on-policy regardless of attr naming.
 *
 * `prompt_hash` is the W3 cross-language contract (matches 05-01's schema header and
 * 05-04's Python `reward_bridge`):
 *
 *     prompt_hash = "sha256:" + hex(sha256(utf8_bytes(prompt)))
 *
 * NO-PYTHON-CORE-DEP: imports only `node:crypto` + `@lucid/diagnostic` TYPES. No
 * Python dependency, no subprocess spawn, and no model-weight artifact reference.
 */

import { createHash } from "node:crypto";
import type { TraceFilter, TraceQuery } from "@lucid/diagnostic";

/** The literal prefix every `prompt_hash` carries (W3 cross-language contract). */
export const PROMPT_HASH_PREFIX = "sha256:" as const;

/** The HSC event type the prompt context is reconstructed from. */
const CONTEXT_LOAD_EVENT = "context.load" as const;

/**
 * A single exported training prompt. PROMPTS ONLY — there is intentionally NO
 * `completion`/`response`/`output` field on this shape (on-policy, T-05-06). The
 * sidecar generates completions fresh; this record only carries the prompt + the
 * provenance needed to attach a reward and trace lineage back to its source trace.
 */
export interface PromptRecord {
  /** "sha256:" + hex(sha256(utf8(prompt))) — the W3 key the reward attaches by. */
  prompt_hash: string;
  /** The reconstructed context/prompt string (context.load attrs, no model output). */
  prompt: string;
  /** The source trace's `harnessVersion` — lineage for the trained checkpoint. */
  harness_version: string;
  /** Provenance: the source trace id. */
  trace_id: string;
  /** Provenance: the source agent/harness id. */
  agent_id: string;
}

/** Cohort selector for {@link exportTrajectories} (a subset of the store filter). */
export interface ExportOptions {
  agentId?: string;
  version?: string;
  startTime?: number;
  endTime?: number;
}

/** A permissive view of the trace shape the exporter reads (structural, read-only). */
interface RawEventView {
  eventType?: unknown;
  attrs?: unknown;
}
interface RawTurnView {
  events?: unknown;
}
interface RawTraceView {
  traceId?: unknown;
  agentId?: unknown;
  harnessVersion?: unknown;
  attrs?: unknown;
  turns?: unknown;
}

/** Substrings in an attr key that mark it as a MODEL OUTPUT — never put in a prompt. */
const MODEL_OUTPUT_KEY_MARKERS = [
  "completion",
  "response",
  "output",
  "generated",
  "assistant",
  "answer",
] as const;

/**
 * True when an attr key denotes the model's own output (a completion/response). Such
 * attrs are EXCLUDED from the reconstructed prompt to keep the dataset on-policy
 * (T-05-06) — the trainer must never see a stored completion as input.
 */
function isModelOutputAttr(key: string): boolean {
  const k = key.toLowerCase();
  return MODEL_OUTPUT_KEY_MARKERS.some((marker) => k.includes(marker));
}

/** Render an attr bag's non-output scalar entries as deterministic `key=value` lines. */
function renderContextAttrs(attrs: unknown): string[] {
  if (!attrs || typeof attrs !== "object") return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(attrs as Record<string, unknown>)) {
    if (isModelOutputAttr(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out.push(`${key}=${String(value)}`);
    }
  }
  // Sort by key for a stable, reconstruction-order-independent prompt string.
  return out.sort();
}

/** Reconstruct the prompt string for one trace from its context.load events. */
function reconstructPrompt(trace: RawTraceView): string {
  const lines: string[] = [];
  const turns = Array.isArray(trace.turns) ? (trace.turns as RawTurnView[]) : [];
  for (const turn of turns) {
    const events = Array.isArray(turn?.events) ? (turn.events as RawEventView[]) : [];
    for (const event of events) {
      if (event?.eventType !== CONTEXT_LOAD_EVENT) continue;
      lines.push(...renderContextAttrs(event.attrs));
    }
  }
  if (lines.length > 0) return lines.join("\n");

  // Fallback 1: trace-level attrs (still non-output, still sorted).
  const traceAttrLines = renderContextAttrs(trace.attrs);
  if (traceAttrLines.length > 0) return traceAttrLines.join("\n");

  // Fallback 2: a stable synthetic marker so the prompt is never empty.
  const id = typeof trace.traceId === "string" && trace.traceId ? trace.traceId : "unknown";
  return `<trace:${id}>`;
}

/** Compute the W3 `prompt_hash` for a prompt string. */
function hashPrompt(prompt: string): string {
  return PROMPT_HASH_PREFIX + createHash("sha256").update(prompt, "utf8").digest("hex");
}

/** Read a string field off a raw trace, with a fallback. */
function strField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * Export stored traces into a prompts-only training dataset.
 *
 * @param query the abstract read seam (a Phase 1 `TraceStore`, or a test stub) — NEVER
 *   a concrete store import.
 * @param opts cohort selector (agent/version/time window).
 * @returns one {@link PromptRecord} per matching trace; `[]` when none match.
 */
export async function exportTrajectories(
  query: TraceQuery,
  opts: ExportOptions = {},
): Promise<PromptRecord[]> {
  const filter: TraceFilter = {};
  if (opts.agentId !== undefined) filter.agentId = opts.agentId;
  if (opts.version !== undefined) filter.version = opts.version;
  // `TraceQuery.TraceFilter` names the lower bound `since`; the concrete store uses
  // `startTime`. Populate the abstract field; a store that knows `startTime` ignores
  // the extra optional key (structural superset, see trace-query.ts header).
  if (opts.startTime !== undefined) filter.since = opts.startTime;

  const traces = await query.queryTraces(filter);
  if (!Array.isArray(traces) || traces.length === 0) return [];

  const records: PromptRecord[] = [];
  for (const raw of traces) {
    const trace = (raw ?? {}) as RawTraceView;
    const prompt = reconstructPrompt(trace);
    records.push({
      prompt_hash: hashPrompt(prompt),
      prompt,
      harness_version: strField(trace.harnessVersion, "unknown"),
      trace_id: strField(trace.traceId, "unknown"),
      agent_id: strField(trace.agentId, "unknown"),
    });
  }
  return records;
}

/**
 * Serialize prompt records to JSONL — one JSON object per line, no trailing newline.
 * Every line is prompts-only (it stringifies a {@link PromptRecord}, which has no
 * completion field). An empty input yields the empty string.
 */
export function serializeToJsonl(records: PromptRecord[]): string {
  return records.map((rec) => JSON.stringify(rec)).join("\n");
}
