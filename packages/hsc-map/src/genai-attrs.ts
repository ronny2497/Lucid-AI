/**
 * GenAiAttrMap — the SINGLE place the provisional OTel GenAI attribute names
 * are pinned (RESEARCH "Assumptions Pending Phase 0", A2/A6; Pitfall 2).
 *
 * The `gen_ai.*` semantic conventions are in experimental/development status
 * and can still be renamed. By concentrating every logical->dotted mapping in
 * this one const, a Phase 0 HSC reconcile (or an upstream semconv bump) is a
 * single-file edit instead of a codebase-wide find/replace. The dotted strings
 * are sourced from `@lucid/hsc-schema` (GEN_AI_ATTR) — they are NOT re-typed
 * here — so the schema package remains the source of truth.
 *
 * A2 [PROVISIONAL — revisit after Phase 0 locks HSC]:
 *   gen_ai.usage.input_tokens / gen_ai.usage.output_tokens / gen_ai.request.model
 */

import { GEN_AI_ATTR } from "@lucid/hsc-schema";

/** Logical attribute name -> versioned `gen_ai.*` dotted path. */
export const GenAiAttrMap = {
  inputTokens: GEN_AI_ATTR.usageInputTokens,
  outputTokens: GEN_AI_ATTR.usageOutputTokens,
  model: GEN_AI_ATTR.requestModel,
  provider: GEN_AI_ATTR.providerName,
  toolName: GEN_AI_ATTR.toolName,
  finishReasons: GEN_AI_ATTR.responseFinishReasons,
} as const;

export type GenAiLogicalName = keyof typeof GenAiAttrMap;
