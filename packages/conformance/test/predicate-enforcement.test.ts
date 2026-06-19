import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { validateTrace } from "../src/validate.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));

/** True if any error mentions the given dotted path / message fragment. */
function errorsMention(errors: unknown[], fragment: string): boolean {
  return errors.some((e) => JSON.stringify(e).includes(fragment));
}

/**
 * BL-01: validateTrace MUST enforce the §2 principle binding and the §3.2/§6.2
 * quadrant predicate — not merely JSON-Schema enum membership. Each fixture
 * below is enum-valid (so it passes the raw schema) but violates a binding the
 * predicate pass must catch.
 */
describe("validateTrace — principle + quadrant predicate enforcement (BL-01)", () => {
  it("rejects a tool.call carrying the wrong principle (one_at_a_time, not plan_execute)", () => {
    const result = validateTrace(fixture("wrong-principle.json"));
    expect(result.valid).toBe(false);
    expect(errorsMention(result.errors, "harness.principle")).toBe(true);
    expect(errorsMention(result.errors, "plan_execute")).toBe(true);
  });

  it("rejects a context.load whose quadrant.y violates the predicate (inferential, not computational)", () => {
    const result = validateTrace(fixture("wrong-quadrant-predicate.json"));
    expect(result.valid).toBe(false);
    expect(errorsMention(result.errors, "harness.quadrant.y")).toBe(true);
  });

  it("rejects a feedback.check with no emitter-specified quadrant.y (§3.2.1)", () => {
    const result = validateTrace(fixture("feedback-check-missing-y.json"));
    expect(result.valid).toBe(false);
    expect(errorsMention(result.errors, "harness.quadrant.y")).toBe(true);
  });

  it("accepts a feedback.check WITH a valid emitter-specified quadrant.y", () => {
    const trace = {
      hsc_version: "v0",
      trace_id: "trace-fc-ok",
      turns: [
        {
          turn_id: "turn-1",
          events: [
            {
              span_id: "span-1",
              "harness.event_type": "feedback.check",
              "harness.principle": "feedback",
              "harness.quadrant.x": "feedback",
              "harness.quadrant.y": "inferential",
            },
          ],
        },
      ],
    };
    expect(validateTrace(trace).valid).toBe(true);
  });

  it("accepts verify.result with the default computational y AND the inferential override (§6.2)", () => {
    const make = (y: string) => ({
      hsc_version: "v0",
      trace_id: "trace-vr",
      turns: [
        {
          turn_id: "turn-1",
          events: [
            {
              span_id: "span-1",
              "harness.event_type": "verify.result",
              "harness.principle": "feedback",
              "harness.quadrant.x": "feedback",
              "harness.quadrant.y": y,
            },
          ],
        },
      ],
    });
    expect(validateTrace(make("computational")).valid).toBe(true);
    expect(validateTrace(make("inferential")).valid).toBe(true);
  });

  it("rejects a tool.call whose quadrant.x is non-null (must be null)", () => {
    const trace = {
      hsc_version: "v0",
      trace_id: "trace-tc",
      turns: [
        {
          turn_id: "turn-1",
          events: [
            {
              span_id: "span-1",
              "harness.event_type": "tool.call",
              "harness.principle": "plan_execute",
              "harness.quadrant.x": "feedforward",
              "harness.quadrant.y": null,
            },
          ],
        },
      ],
    };
    const result = validateTrace(trace);
    expect(result.valid).toBe(false);
    expect(errorsMention(result.errors, "harness.quadrant.x")).toBe(true);
  });

  it("treats an omitted quadrant key as null (tool.call with no quadrant keys is valid)", () => {
    const trace = {
      hsc_version: "v0",
      trace_id: "trace-tc2",
      turns: [
        {
          turn_id: "turn-1",
          events: [
            {
              span_id: "span-1",
              "harness.event_type": "tool.call",
              "harness.principle": "plan_execute",
            },
          ],
        },
      ],
    };
    expect(validateTrace(trace).valid).toBe(true);
  });
});
