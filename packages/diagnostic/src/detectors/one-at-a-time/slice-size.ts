/**
 * @lucid/diagnostic — One-at-a-Time rule detector: `one_at_a_time.oversized-slice`.
 *
 * Flags a `task.slice` whose turn bundles more than {@link DEFAULT_SLICE_CALL_LIMIT}
 * `tool.call` actions — the slice took on more concurrent work than the
 * one-at-a-time principle allows. Slice "size" is measured by the count of action
 * events scoped to the slice's turn, so no producer-controlled scope attribute is
 * trusted and no bare attribute literal is needed (Pitfall 4 / prohibition).
 *
 * Matching is HSC-constant-driven (`EVENT_TYPES task.slice` / `tool.call`). Pure
 * read-model: never mutates `trace`.
 */

import { EVENT_TYPES, PRINCIPLES } from "@lucid/hsc-schema";
import type { Detector, DetectorHit, HarnessTrace } from "../../types.js";
import { viewTurns } from "../event-access.js";

export const OVERSIZED_SLICE_ID = "one_at_a_time.oversized-slice" as const;

/** Max `tool.call` actions a single slice/turn may bundle before it is flagged. */
export const DEFAULT_SLICE_CALL_LIMIT = 3;

const TASK_SLICE = EVENT_TYPES[2]; // "task.slice"
const TOOL_CALL = EVENT_TYPES[3]; // "tool.call"
const ONE_AT_A_TIME = PRINCIPLES[3]; // "one_at_a_time"

export const sliceSize: Detector = {
  id: OVERSIZED_SLICE_ID,
  principle: ONE_AT_A_TIME,
  kind: "rule",
  defaultEnabled: true,

  run(trace: HarnessTrace): DetectorHit[] {
    const hits: DetectorHit[] = [];
    for (const turn of viewTurns(trace)) {
      const slice = turn.events.find((e) => e.type === TASK_SLICE);
      if (!slice) continue;
      const callCount = turn.events.filter((e) => e.type === TOOL_CALL).length;
      if (callCount <= DEFAULT_SLICE_CALL_LIMIT) continue;
      hits.push({
        detectorId: OVERSIZED_SLICE_ID,
        principle: ONE_AT_A_TIME,
        turnId: turn.id,
        eventIds: [slice.id],
        evidence: `task.slice bundles ${callCount} tool.call actions (limit ${DEFAULT_SLICE_CALL_LIMIT})`,
        leverage: "med",
        remediation: `split the slice so each carries at most ${DEFAULT_SLICE_CALL_LIMIT} tool.call actions`,
      });
    }
    return hits;
  },
};
