/**
 * RED until Plan 02-02.
 *
 * The flagship Feedback detector: emits one hit per mutating `tool.call` that has
 * NO following `verify.result` in the same turn (eval-rubric.md §2.3; turn scoping
 * per RESEARCH Pitfall 2). The import below does not resolve until 02-02 creates
 * `src/detectors/feedback/no-verify-after-mutation.ts` — that unresolved import is
 * the expected RED state.
 */

import { describe, it, expect } from "vitest";
// @ts-expect-error — implemented in Plan 02-02 (RED scaffold).
import { noVerifyAfterMutation } from "../../src/detectors/feedback/no-verify-after-mutation.js";
import emptyFeedback from "../fixtures/golden-trace-empty-feedback.json" with { type: "json" };
import fullFeedback from "../fixtures/golden-trace-full-feedback.json" with { type: "json" };
import { emptyFeedbackExpectation, fullFeedbackExpectation } from "../fixtures/expectations.js";

describe("noVerifyAfterMutation detector", () => {
  it("emits one hit per unverified mutating tool.call (empty-feedback fixture)", () => {
    // The detector consumes a structured HarnessTrace; 02-04 owns the flat->structured
    // loader. The scaffold passes the fixture and asserts against the recorded count.
    const hits = noVerifyAfterMutation.run(emptyFeedback as never);
    expect(hits).toHaveLength(emptyFeedbackExpectation.principles.feedback!.hitCount);
    expect(hits.every((h: { detectorId: string }) => h.detectorId === "feedback.no-verify-after-mutation")).toBe(true);
  });

  it("respects turn scoping: a verify in the same turn clears the mutation (full-feedback fixture)", () => {
    const hits = noVerifyAfterMutation.run(fullFeedback as never);
    expect(hits).toHaveLength(fullFeedbackExpectation.principles.feedback!.hitCount);
  });
});
