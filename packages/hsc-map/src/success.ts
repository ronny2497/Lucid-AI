/**
 * successOf — the SINGLE place the success-derivation policy lives
 * (RESEARCH Pitfall 4 "three success interpretations"; A3).
 *
 * Policy (declared-then-inferred):
 *   1. If the harness DECLARED success via the provisional declared-success
 *      attribute, use it verbatim and tag `successSource:"declared"`.
 *   2. Otherwise INFER from the trace's terminal OTel status code and tag
 *      `successSource:"inferred"` (lower confidence, still functional).
 *
 * A3 [PROVISIONAL — revisit after Phase 0 locks HSC]: the harness-declared
 * success attribute name. It is NOT in `@lucid/hsc-schema`'s HARNESS_ATTR yet,
 * so it is pinned HERE; when Phase 0 adds it to HARNESS_ATTR this becomes a
 * one-line re-point.
 */

/** PROVISIONAL declared-success attribute path (A3). */
export const HARNESS_DECLARED_SUCCESS_ATTR = "harness.success";

/** OTel SpanStatusCode values used for terminal-state inference. */
const OTEL_STATUS_OK = 1;
const OTEL_STATUS_ERROR = 2;

export type SuccessSource = "declared" | "inferred";

export interface SuccessResult {
  success: boolean;
  successSource: SuccessSource;
}

/** Minimal trace shape successOf reads — kept structural to avoid a hard dep. */
export interface SuccessInput {
  statusCode?: number | null;
  attrs?: Record<string, unknown>;
  turns?: unknown[];
}

/**
 * Derive whether a trace succeeded plus the provenance of that judgement.
 */
export function successOf(trace: SuccessInput): SuccessResult {
  const declared = trace.attrs?.[HARNESS_DECLARED_SUCCESS_ATTR];
  if (typeof declared === "boolean") {
    return { success: declared, successSource: "declared" };
  }

  // Inference fallback: ERROR terminal status => failure; anything else
  // (OK or UNSET, with no recorded error) => success.
  const status = trace.statusCode ?? null;
  const success = status !== OTEL_STATUS_ERROR;
  void OTEL_STATUS_OK; // documented sentinel; OK and UNSET both count as success
  return { success, successSource: "inferred" };
}
