/**
 * @lucid/diagnostic — Plan/Execute rule detector: `plan_execute.act-before-plan`.
 *
 * Flags acting before planning: a `tool.call` that occurs with NO `plan.emit`
 * having been emitted at or before that point in the session. One hit per offending
 * turn, citing the first premature `tool.call`.
 *
 * Session-aware (not strictly per-turn): once a `plan.emit` has been seen, later
 * turns that continue executing that plan are NOT flagged — an agent that planned in
 * turn 1 and keeps acting in turn 2 has planned before acting. A turn is flagged
 * only when (a) its first `tool.call` precedes that turn's own `plan.emit`, or
 * (b) the turn has a `tool.call` and no `plan.emit` has occurred anywhere earlier in
 * the session. This reconciles the detector with the full-feedback golden fixture
 * (a "planned" trace whose later turn re-uses an earlier plan must yield no finding).
 *
 * Matching is HSC-constant-driven (`EVENT_TYPES tool.call` / `plan.emit`). Pure
 * read-model: never mutates `trace`.
 */

import { EVENT_TYPES, PRINCIPLES } from "@lucid/hsc-schema";
import type { Detector, DetectorHit, HarnessTrace } from "../../types.js";
import { viewTurns } from "../event-access.js";

export const ACT_BEFORE_PLAN_ID = "plan_execute.act-before-plan" as const;

const PLAN_EMIT = EVENT_TYPES[1]; // "plan.emit"
const TOOL_CALL = EVENT_TYPES[3]; // "tool.call"
const PLAN_EXECUTE = PRINCIPLES[1]; // "plan_execute"

export const planBeforeAct: Detector = {
  id: ACT_BEFORE_PLAN_ID,
  principle: PLAN_EXECUTE,
  kind: "rule",
  defaultEnabled: true,

  run(trace: HarnessTrace): DetectorHit[] {
    const hits: DetectorHit[] = [];
    // Session-level: has a plan.emit been seen in any earlier turn?
    let planSeenInSession = false;
    for (const turn of viewTurns(trace)) {
      const events = turn.events;
      const firstPlanIndex = events.findIndex((e) => e.type === PLAN_EMIT);
      const firstCallIndex = events.findIndex((e) => e.type === TOOL_CALL);

      if (firstCallIndex !== -1) {
        // The turn acts before planning when its first call precedes this turn's own
        // plan, OR there is no plan in this turn AND none seen earlier in the session.
        const callBeforeTurnPlan = firstPlanIndex !== -1 && firstCallIndex < firstPlanIndex;
        const noPlanAnywhereYet = firstPlanIndex === -1 && !planSeenInSession;
        if (callBeforeTurnPlan || noPlanAnywhereYet) {
          const offending = events[firstCallIndex]!;
          hits.push({
            detectorId: ACT_BEFORE_PLAN_ID,
            principle: PLAN_EXECUTE,
            turnId: turn.id,
            eventIds: [offending.id],
            evidence: callBeforeTurnPlan
              ? `tool.call (${offending.toolName ?? "unknown tool"}) precedes the turn's plan.emit`
              : `tool.call (${offending.toolName ?? "unknown tool"}) with no plan.emit before it`,
            leverage: "med",
            remediation: "emit a plan.emit before issuing tool.call actions",
          });
        }
      }

      if (firstPlanIndex !== -1) planSeenInSession = true;
    }
    return hits;
  },
};
