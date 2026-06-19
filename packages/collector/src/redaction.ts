/**
 * Collector-side redaction processor — Layer 2 of the redaction
 * defense-in-depth (REQ-06).
 *
 * This is the AUTHORITATIVE redaction plane: it runs over every extracted span
 * before persistence, so it catches the content-bearing fields on EVERY ingest
 * path regardless of which emitter sent them (the SDK guard in Layer 1 is only
 * defense-in-depth). The HSC attribute registry
 * (docs/standard/attribute-registry.md §"Content-bearing fields") marks exactly
 * two reused OTel fields as opt-in / off-by-default:
 *
 *   - gen_ai.input.messages       — raw prompt / message content
 *   - gen_ai.tool.call.arguments  — raw tool-call arguments (may hold secrets/PII)
 *
 * Per-field policy actions:
 *   - "drop" — remove the key entirely (the safe default; nothing persisted).
 *   - "hash" — replace the value with a SHA-256 hex digest (node:crypto, no
 *              external dependency — RESEARCH Don't-Hand-Roll). Deterministic
 *              (same input → same digest) and irreversible; NOT keyed (see
 *              threat T-06-14: operators choose "drop" for high-sensitivity
 *              fields; keyed masking is the OTel Collector OTTL processor's job).
 *   - "keep" — preserve the value verbatim (explicit operator override).
 *
 * SCOPE: this processor is intentionally scoped to the two HSC-defined content
 * fields. It does NOT scan for arbitrary PII regexes — that broad scrubbing is
 * the OTel Collector OTTL/transform processor's job, documented as an external
 * deployment concern (RESEARCH Layer 3). Information disclosure (T-01-02 /
 * T-06-13): this module logs only counts, never raw or redacted content; it
 * returns a NEW span array and never mutates its input.
 */

import { createHash } from "node:crypto";
import type { HscSpan, AttrValue } from "@lucid/store";

/** The per-field redaction action. */
export type RedactionAction = "drop" | "hash" | "keep";

/**
 * Redaction policy. `contentFields` maps a content-bearing attribute key to its
 * action; `defaultAction` applies to any opt-in content key not explicitly
 * listed. The safest posture (the default policy below) drops both content
 * fields so nothing content-bearing is ever persisted without an explicit
 * override.
 */
export interface RedactionPolicy {
  readonly contentFields: Readonly<Record<string, RedactionAction>>;
  /** Action for content keys not explicitly listed in `contentFields`. */
  readonly defaultAction: RedactionAction;
}

/**
 * The opt-in content-bearing keys from the HSC attribute registry. These are NOT
 * part of `@lucid/hsc-schema`'s GEN_AI_ATTR (that map holds only always-on
 * identifiers); the registry documents them as the opt-in list, pinned here as a
 * named constant so a future registry change has a single edit site.
 */
export const CONTENT_FIELD_KEYS = [
  "gen_ai.input.messages",
  "gen_ai.tool.call.arguments",
] as const;

/**
 * The default redaction policy: DROP every content-bearing field (data
 * minimization — content fields are NOT persisted unless an operator explicitly
 * configures otherwise). This is the safest posture (threat T-06-11).
 */
export const DEFAULT_REDACTION_POLICY: RedactionPolicy = {
  contentFields: {
    "gen_ai.input.messages": "drop",
    "gen_ai.tool.call.arguments": "drop",
  },
  defaultAction: "drop",
};

/** SHA-256 hex digest of a content value's JSON encoding (deterministic). */
function hashValue(value: AttrValue): string {
  // Stable JSON encoding so the same logical value always hashes identically.
  const encoded = JSON.stringify(value);
  return createHash("sha256").update(encoded).digest("hex");
}

/** Resolve the action for a content key from the policy (list → default). */
function actionFor(policy: RedactionPolicy, key: string): RedactionAction {
  return policy.contentFields[key] ?? policy.defaultAction;
}

/**
 * Apply the redaction policy to a single attribute bag, returning a NEW bag.
 * Only the opt-in content keys are touched; every other attribute survives
 * verbatim.
 */
function redactAttrs(
  attrs: Record<string, AttrValue> | undefined,
  policy: RedactionPolicy,
): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = { ...(attrs ?? {}) };
  for (const key of CONTENT_FIELD_KEYS) {
    if (!(key in out)) continue;
    const action = actionFor(policy, key);
    if (action === "drop") {
      delete out[key];
    } else if (action === "hash") {
      out[key] = hashValue(out[key]!);
    }
    // "keep" leaves the value verbatim (operator override).
  }
  return out;
}

/**
 * Return a NEW span array with the redaction policy applied to each span's event
 * attributes. Never mutates the input array or any span/attribute object. Only
 * the opt-in content fields are affected; all harness.* / gen_ai.* identifiers
 * survive verbatim.
 *
 * @param spans  Extracted, already-validated spans.
 * @param policy Redaction policy (defaults to {@link DEFAULT_REDACTION_POLICY}).
 */
export function redactSpans(
  spans: readonly HscSpan[],
  policy: RedactionPolicy = DEFAULT_REDACTION_POLICY,
): HscSpan[] {
  return spans.map((span) => ({
    ...span,
    event: {
      ...span.event,
      attrs: redactAttrs(span.event.attrs, policy),
    },
  }));
}
