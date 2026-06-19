/**
 * @lucid/diagnostic — Codebase-Docs rule detector: `codebase_docs.no-doc-encoding`.
 *
 * Flags a SESSION (whole trace) that did mutating work — at least one `tool.call`
 * with `harness.mutated_state=true` — yet emitted ZERO `doc.encode` events: the
 * agent changed the codebase without encoding any documentation of the change.
 * One hit per trace, attributed to the first mutating call as the anchor event.
 *
 * Matching is HSC-constant-driven (`EVENT_TYPES doc.encode` / `tool.call`,
 * `HARNESS_ATTR.mutatedState` via the shared accessor). Pure read-model: never
 * mutates `trace`.
 */

import { EVENT_TYPES, PRINCIPLES } from "@lucid/hsc-schema";
import type { Detector, DetectorHit, HarnessTrace } from "../../types.js";
import { viewTurns, type EventView } from "../event-access.js";

export const NO_DOC_ENCODING_ID = "codebase_docs.no-doc-encoding" as const;

const TOOL_CALL = EVENT_TYPES[3]; // "tool.call"
const DOC_ENCODE = EVENT_TYPES[6]; // "doc.encode"
const CODEBASE_DOCS = PRINCIPLES[4]; // "codebase_docs"

const isMutatingCall = (e: EventView): boolean => e.type === TOOL_CALL && e.mutatedState;

export const docEncodingPresence: Detector = {
  id: NO_DOC_ENCODING_ID,
  principle: CODEBASE_DOCS,
  kind: "rule",
  defaultEnabled: true,

  run(trace: HarnessTrace): DetectorHit[] {
    const turns = viewTurns(trace);
    let firstMutation: { turnId: string; event: EventView } | undefined;
    let docEncodeCount = 0;
    for (const turn of turns) {
      for (const e of turn.events) {
        if (e.type === DOC_ENCODE) docEncodeCount++;
        if (!firstMutation && isMutatingCall(e)) {
          firstMutation = { turnId: turn.id, event: e };
        }
      }
    }
    if (!firstMutation || docEncodeCount > 0) return [];
    return [
      {
        detectorId: NO_DOC_ENCODING_ID,
        principle: CODEBASE_DOCS,
        turnId: firstMutation.turnId,
        eventIds: [firstMutation.event.id],
        evidence: "mutating work occurred with zero doc.encode events in the session",
        leverage: "med",
        remediation: "emit a doc.encode event recording the documentation impact of mutations",
      },
    ];
  },
};
