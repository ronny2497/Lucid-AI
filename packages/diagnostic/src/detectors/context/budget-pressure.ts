/**
 * @lucid/diagnostic — Context rule detector: `context.budget-pressure`.
 *
 * Flags `context.load` events whose input-token usage exceeds a configurable
 * absolute budget (default {@link DEFAULT_TOKEN_BUDGET}). High input-token loads
 * are the Context-principle failure mode: the agent front-loaded more context than
 * its working budget can usefully attend to.
 *
 * Matching is HSC-constant-driven (`EVENT_TYPES context.load`, token usage via
 * `GEN_AI_ATTR.usageInputTokens`). Pure read-model: never mutates `trace`.
 */

import { EVENT_TYPES, PRINCIPLES, GEN_AI_ATTR } from "@lucid/hsc-schema";
import type { Detector, DetectorHit, HarnessTrace } from "../../types.js";
import { viewTurns } from "../event-access.js";

export const BUDGET_PRESSURE_ID = "context.budget-pressure" as const;

/** Default input-token ceiling for a single `context.load` before it is flagged. */
export const DEFAULT_TOKEN_BUDGET = 4000;

const CONTEXT_LOAD = EVENT_TYPES[0]; // "context.load"
const CONTEXT = PRINCIPLES[0]; // "context"

export const budgetPressure: Detector = {
  id: BUDGET_PRESSURE_ID,
  principle: CONTEXT,
  kind: "rule",
  defaultEnabled: true,

  run(trace: HarnessTrace): DetectorHit[] {
    const hits: DetectorHit[] = [];
    for (const turn of viewTurns(trace)) {
      for (const e of turn.events) {
        if (e.type !== CONTEXT_LOAD) continue;
        const raw = e.attr(GEN_AI_ATTR.usageInputTokens);
        const tokens = typeof raw === "number" ? raw : 0;
        if (tokens <= DEFAULT_TOKEN_BUDGET) continue;
        hits.push({
          detectorId: BUDGET_PRESSURE_ID,
          principle: CONTEXT,
          turnId: turn.id,
          eventIds: [e.id],
          evidence: `context.load of ${tokens} input tokens exceeds budget ${DEFAULT_TOKEN_BUDGET}`,
          leverage: e.inferred ? "med" : "med",
          remediation: `trim or chunk context to stay under ${DEFAULT_TOKEN_BUDGET} input tokens`,
        });
      }
    }
    return hits;
  },
};
