/**
 * HSC attribute-path maps.
 *
 * `HARNESS_ATTR` holds the HSC-owned `harness.*` extension attribute paths
 * (the concepts OTel lacks: principle, quadrant, evolve, change_manifest).
 *
 * `GEN_AI_ATTR` holds the reused OpenTelemetry GenAI semantic-convention paths
 * (D-02 / OQ-01). HSC reuses these names verbatim — it does NOT invent new
 * `gen_ai.*` values. The pinned semconv commit is recorded in Plan 02's
 * transport-profile.md.
 *
 * Invariant: `harness.*` and `gen_ai.*` live in strictly separate namespaces.
 * No `harness.*` path appears under `gen_ai.*` and vice versa.
 */

/** HSC-owned extension attribute paths (logical name -> dotted path). */
export const HARNESS_ATTR = {
  eventType: "harness.event_type",
  principle: "harness.principle",
  quadrantX: "harness.quadrant.x",
  quadrantY: "harness.quadrant.y",
  version: "harness.version",
  mutatedState: "harness.mutated_state",
  changeManifestId: "harness.change_manifest_id",
  inferred: "harness.inferred",
} as const satisfies Record<string, `harness.${string}`>;

/** Reused OTel GenAI semantic-convention attribute paths (OQ-01 list). */
export const GEN_AI_ATTR = {
  operationName: "gen_ai.operation.name",
  providerName: "gen_ai.provider.name",
  agentName: "gen_ai.agent.name",
  agentId: "gen_ai.agent.id",
  requestModel: "gen_ai.request.model",
  usageInputTokens: "gen_ai.usage.input_tokens",
  usageOutputTokens: "gen_ai.usage.output_tokens",
  toolName: "gen_ai.tool.name",
  responseFinishReasons: "gen_ai.response.finish_reasons",
} as const satisfies Record<string, `gen_ai.${string}`>;

export type HarnessAttrPath = (typeof HARNESS_ATTR)[keyof typeof HARNESS_ATTR];
export type GenAiAttrPath = (typeof GEN_AI_ATTR)[keyof typeof GEN_AI_ATTR];
