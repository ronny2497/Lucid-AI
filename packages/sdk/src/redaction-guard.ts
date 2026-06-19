/**
 * SDK-side opt-in content-field guard — Layer 1 of the redaction
 * defense-in-depth (REQ-06).
 *
 * The HSC attribute registry (docs/standard/attribute-registry.md §"Content-bearing
 * fields") marks exactly two reused OTel fields as opt-in / off-by-default because
 * they carry raw prompt and tool-argument payloads (an information-disclosure
 * surface, threat T-00-04 / T-01-07):
 *
 *   - gen_ai.input.messages       — raw prompt / message content
 *   - gen_ai.tool.call.arguments  — raw tool-call arguments (may hold secrets/PII)
 *
 * These names are NOT part of `@lucid/hsc-schema`'s `GEN_AI_ATTR` map — that map
 * holds only the always-on identifiers (model, tool name, token counts). The two
 * content fields are documented as the opt-in list in the registry, so we pin
 * them here as named constants referencing that registry rather than inventing a
 * broad regex scanner.
 *
 * `guardContentFields` is a small, deterministic emit-or-omit gate: unless the
 * caller explicitly consents, the content keys are stripped from the attribute
 * bag before it ever reaches a span. This is DEFENSE-IN-DEPTH only — the
 * authoritative redaction lives collector-side (`@lucid/collector` redaction.ts,
 * Layer 2) which catches every persistence path regardless of emitter. This guard
 * is the first gate; it never deep-scans for arbitrary PII (that is the OTel
 * Collector OTTL processor's job, RESEARCH Don't-Hand-Roll).
 */

/**
 * The opt-in content-bearing attribute keys (attribute-registry.md). Off by
 * default; forwarded only on explicit operator consent. Kept as a named constant
 * so a future registry change has a single edit site.
 */
export const CONTENT_FIELD_KEYS = [
  "gen_ai.input.messages",
  "gen_ai.tool.call.arguments",
] as const;

export type ContentFieldKey = (typeof CONTENT_FIELD_KEYS)[number];

/** Options for {@link guardContentFields}. */
export interface GuardContentFieldsOptions {
  /**
   * When truthy, the operator has explicitly opted in to forwarding the
   * content-bearing fields; they are preserved. When falsy (the default), the
   * content fields are stripped. Data minimization is the default posture.
   */
  allowContent?: boolean;
}

/**
 * Return a shallow copy of `attrs` with the opt-in content fields stripped unless
 * the caller explicitly opts in via `opts.allowContent`.
 *
 * Invariants:
 *   - Never mutates the input bag (always returns a new object).
 *   - Non-content identifiers (gen_ai.tool.name, gen_ai.request.model, the
 *     harness.* keys, etc.) are ALWAYS preserved, regardless of consent.
 *   - With `allowContent` falsy (default) the two content keys are removed.
 *   - With `allowContent` truthy the bag is returned unchanged (operator opted in).
 *
 * @param attrs A flat attribute bag keyed by dotted attribute path.
 * @param opts  `{ allowContent }` — defaults to content OFF.
 */
export function guardContentFields<T extends Record<string, unknown>>(
  attrs: T,
  opts: GuardContentFieldsOptions = {},
): T {
  // Always return a new object so the caller's bag is never mutated.
  const out = { ...attrs } as T;
  if (opts.allowContent) {
    // Operator opted in: preserve the content fields verbatim.
    return out;
  }
  // Default posture: strip the opt-in content keys.
  for (const key of CONTENT_FIELD_KEYS) {
    if (key in out) delete (out as Record<string, unknown>)[key];
  }
  return out;
}
