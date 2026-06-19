/**
 * The thin OTLP/JSON receiver mounted at `POST /v1/traces`.
 *
 * Contract (RESEARCH Pattern 2 + Anti-Pattern "thin receiver"): receive →
 * validate → write. No metrics/derivation logic lives here (that is Plan 01-04).
 *
 * Guards, in order:
 *   - 415 when content-type is not application/json (Phase 1 is OTLP/JSON only;
 *     no Protobuf code path exists — T-01-09).
 *   - 413 when the body exceeds the configured byte ceiling, checked from the
 *     declared content-length BEFORE reading and again against the actual read
 *     length so a missing/lying header cannot smuggle an unbounded body
 *     (T-01-01 DoS guard).
 *   - 400 on malformed JSON, a malformed OTLP envelope, or a batch that fails
 *     HSC validation — and in the failure case NOTHING is written (T-01-03).
 *
 * Information disclosure (T-01-02): this handler logs only counts and event
 * types. It NEVER logs raw span attribute content (prompts, tool args) to
 * stdout.
 */

import type { Context } from "hono";
import type { TraceStore } from "@lucid/store";
import { extractSpans, OtlpEnvelopeError } from "./otlp.js";
import { validateHscSpans } from "./validator.js";
import { redactSpans, DEFAULT_REDACTION_POLICY, type RedactionPolicy } from "./redaction.js";

/** Default request body ceiling: 10 MB (RESEARCH Security Domain). */
export const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface ReceiverOptions {
  /** Maximum accepted request body size in bytes (default 10 MB). */
  maxBodyBytes?: number;
  /**
   * Content-field redaction policy applied between validation and persistence
   * (Layer 2 defense-in-depth, REQ-06). Defaults to DEFAULT_REDACTION_POLICY,
   * which DROPS the opt-in content fields so nothing content-bearing is
   * persisted unless an operator explicitly overrides the policy.
   */
  redactionPolicy?: RedactionPolicy;
}

/**
 * Build the `POST /v1/traces` handler bound to a TraceStore.
 *
 * The store is injected so tests can supply an in-memory `SqliteTraceStore`.
 */
export function createTracesHandler(store: TraceStore, options: ReceiverOptions = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const redactionPolicy = options.redactionPolicy ?? DEFAULT_REDACTION_POLICY;

  return async function handleTraces(c: Context): Promise<Response> {
    // (1) content-type guard — OTLP/JSON only.
    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return c.json({ message: "only OTLP/JSON (application/json) is supported" }, 415);
    }

    // (2) size guard — reject the declared-oversized body before reading.
    const declaredLength = Number(c.req.header("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      return c.json({ message: "request body too large" }, 413);
    }

    // Read the raw body, then re-check the ACTUAL byte length (defends against a
    // missing or understated content-length header).
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, "utf8") > maxBodyBytes) {
      return c.json({ message: "request body too large" }, 413);
    }

    // (3) parse — malformed JSON is a 400, never a 5xx.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ message: "malformed JSON body" }, 400);
    }

    // (4) extract OTLP spans → HscSpan[].
    let spans;
    try {
      spans = extractSpans(parsed);
    } catch (err) {
      if (err instanceof OtlpEnvelopeError) {
        return c.json({ message: "malformed OTLP/JSON envelope", errors: err.issues }, 400);
      }
      throw err;
    }

    // (5) validate (zod guard + @lucid/conformance). On failure: 400, no write.
    const result = validateHscSpans(spans);
    if (!result.valid) {
      // Log counts only — never the raw attribute content (T-01-02).
      console.warn(
        `[collector] rejected trace: ${spans.length} span(s), ${result.errors.length} validation error(s)`,
      );
      return c.json({ message: "trace failed HSC validation", errors: result.errors }, 400);
    }

    // (6) redact content-bearing fields BEFORE persistence (Layer 2, REQ-06).
    // Additive step between validation and the store write: the default policy
    // drops gen_ai.input.messages / gen_ai.tool.call.arguments so no content
    // field reaches the store (T-06-11). Returns a new span set; the input is
    // never mutated and no raw/redacted content is logged (T-01-02 / T-06-13).
    const redactedSpans = redactSpans(spans, redactionPolicy);

    // (7) persist redacted, validated spans.
    await store.writeSpans(redactedSpans);

    // Log only counts + event types (no raw attribute content — T-01-02).
    const eventTypes = Array.from(new Set(spans.map((s) => s.event.eventType)));
    console.info(
      `[collector] ingested ${spans.length} span(s); event types: ${eventTypes.join(", ")}`,
    );

    return c.json({ accepted: spans.length }, 200);
  };
}
