/**
 * Redaction-completeness gate primitive — Layer 4 of the redaction
 * defense-in-depth (REQ-06), the export-path gate.
 *
 * The 06-04 exporter calls this BEFORE writing an evidence package: it proves no
 * enabled content-bearing field escaped to the export without a configured
 * redaction action (RESEARCH Pitfall 4). The result flips
 * `EvidencePackage.redaction_applied` and lets the exporter refuse export when
 * redaction is incomplete (threat T-06-12).
 *
 * This is a CONFIGURATION / APPLICATION check, NOT a deep content inspection: it
 * asks "is a content field present in the export, and if so was an action
 * configured for it?" — it never scans free text for arbitrary PII (that is the
 * collector/OTTL layer's job). The two content-bearing keys are the opt-in list
 * from the HSC attribute registry (docs/standard/attribute-registry.md):
 *
 *   - gen_ai.input.messages       — raw prompt / message content
 *   - gen_ai.tool.call.arguments  — raw tool-call arguments
 */

/**
 * The opt-in content-bearing keys from the HSC attribute registry. Pinned here
 * (not in `@lucid/hsc-schema`'s GEN_AI_ATTR, which holds only always-on
 * identifiers) so the gate matches the same fields the collector processor and
 * SDK guard scope to.
 */
export const CONTENT_FIELD_KEYS = [
  "gen_ai.input.messages",
  "gen_ai.tool.call.arguments",
] as const;

/** Per-field redaction action (matches the collector policy shape). */
export type RedactionAction = "drop" | "hash" | "keep";

/**
 * The redaction configuration the export path was assembled under. Mirrors the
 * collector policy: a content key is "covered" when it has a configured action.
 */
export interface RedactionConfig {
  readonly contentFields: Readonly<Record<string, RedactionAction>>;
  /** When set, every content key is considered covered (a blanket action). */
  readonly defaultAction?: RedactionAction;
}

/** The completeness verdict for a record set under a redaction config. */
export interface RedactionCompleteness {
  /**
   * True when every content field PRESENT in the records had a configured
   * redaction action (or none were present). False means at least one present
   * content field had no configured action — the exporter MUST refuse export.
   */
  readonly complete: boolean;
  /**
   * True when at least one content field was present AND all present content
   * fields had a configured action. This is the value the exporter writes to
   * `EvidencePackage.redaction_applied`. False when nothing content-bearing was
   * present (nothing to redact) or when redaction was incomplete.
   */
  readonly redactionApplied: boolean;
  /**
   * The content fields present in the records that had NO configured redaction
   * action — actionable output for the operator. Empty when `complete` is true.
   */
  readonly offendingFields: string[];
}

/** Does the config declare an action for `key`? */
function isCovered(config: RedactionConfig, key: string): boolean {
  if (config.defaultAction !== undefined) return true;
  return config.contentFields[key] !== undefined;
}

/**
 * Check whether redaction is complete for a set of export records under a
 * redaction config.
 *
 * Logic (config/application check, not deep inspection):
 *   - Find which opt-in content fields are PRESENT across the record set.
 *   - For each present field, require the config declares an action (a listed
 *     `contentFields[key]` or a blanket `defaultAction`). A present field with
 *     no configured action is OFFENDING and makes `complete` false.
 *   - `redactionApplied` is true only when ≥1 content field was present and ALL
 *     present fields were covered; it is false when nothing was present
 *     (nothing to redact) or when any field was offending.
 *
 * @param records A set of export records (flat attribute bags).
 * @param config  The redaction config the export was assembled under.
 */
export function checkRedactionCompleteness(
  records: ReadonlyArray<Record<string, unknown>>,
  config: RedactionConfig,
): RedactionCompleteness {
  const presentFields = new Set<string>();
  for (const record of records) {
    for (const key of CONTENT_FIELD_KEYS) {
      if (key in record) presentFields.add(key);
    }
  }

  if (presentFields.size === 0) {
    // Nothing content-bearing in the export → nothing to redact.
    return { complete: true, redactionApplied: false, offendingFields: [] };
  }

  const offendingFields: string[] = [];
  for (const key of presentFields) {
    if (!isCovered(config, key)) offendingFields.push(key);
  }
  // Keep offending order deterministic (registry order).
  offendingFields.sort(
    (a, b) => CONTENT_FIELD_KEYS.indexOf(a as never) - CONTENT_FIELD_KEYS.indexOf(b as never),
  );

  const complete = offendingFields.length === 0;
  return {
    complete,
    // Applied only when at least one field was present AND all were covered.
    redactionApplied: complete,
    offendingFields,
  };
}
