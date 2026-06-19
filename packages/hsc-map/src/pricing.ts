/**
 * PRICING_USD_PER_1K + costOf — the SINGLE place model pricing is encoded
 * (RESEARCH Code Examples > cost derivation; A2-adjacent provisional data).
 *
 * [PROVISIONAL — update from provider docs during Wave 0/Phase 0 reconcile.]
 * Prices are USD per 1,000 tokens, keyed on `gen_ai.request.model`.
 *
 * costOf() returns `null` (NEVER a fabricated number) when the model is not in
 * the table, so an unknown model is surfaced as "pricing unknown" rather than
 * silently costed at zero. The metrics layer MUST treat null as "unknown".
 */

export interface ModelPrice {
  /** USD per 1k input (prompt) tokens. */
  input: number;
  /** USD per 1k output (completion) tokens. */
  output: number;
}

export const PRICING_USD_PER_1K: Record<string, ModelPrice> = {
  "claude-opus-4-5": { input: 0.015, output: 0.075 },
  "claude-sonnet-4-5": { input: 0.003, output: 0.015 },
  "gpt-4o": { input: 0.0025, output: 0.01 },
};

/**
 * Returns the USD cost for a token count under a model's price, or `null` when
 * the model is absent from the table (flag-as-unknown — never fabricate).
 */
export function costOf(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number | null {
  const pricing = PRICING_USD_PER_1K[model];
  if (!pricing) return null;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1000;
}
