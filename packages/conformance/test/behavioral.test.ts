import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  checkBehavioralHonesty,
  PERMITTED_INFERENCE,
  UNSUBSTANTIATED_MARKER,
} from "../src/behavioral.js";

/**
 * Layer 3 (behavioral honesty) RED → GREEN coverage.
 *
 * The load-bearing assertion is absence-is-signal: an honest absence (a mutating
 * tool.call with NO following verification) is NEVER a violation. Only active
 * dishonesty — a fabricated verification or a prohibited inference — fails.
 */

const here = dirname(fileURLToPath(import.meta.url));
const goldenBehavioral = (name: string) =>
  JSON.parse(
    readFileSync(join(here, "..", "src", "golden", "behavioral", name), "utf8"),
  );

function codes(violations: { code: string }[]): string[] {
  return violations.map((v) => v.code);
}

describe("checkBehavioralHonesty — absence is signal (PASS)", () => {
  it("a mutating tool.call with NO following verify.result PASSES (honest absence)", () => {
    const trace = goldenBehavioral("absence-preserved.json");
    const result = checkBehavioralHonesty(trace);
    expect(result.violations).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it("evolve.propose/evolve.apply emitted WITHOUT inferred=true PASSES (honest)", () => {
    const trace = goldenBehavioral("no-inferred-evolve.json");
    const result = checkBehavioralHonesty(trace);
    expect(result.pass).toBe(true);
  });
});

describe("checkBehavioralHonesty — fabricated event (FAIL)", () => {
  it("the fabricated-verify-after-mutation fixture FAILS with a fabricated-event violation", () => {
    const trace = goldenBehavioral("fabricated-verify-after-mutation.json");
    const result = checkBehavioralHonesty(trace);
    expect(result.pass).toBe(false);
    expect(codes(result.violations)).toContain("fabricated-event");
  });

  it("a verify.result WITHOUT the unsubstantiated marker is treated as substantiated (PASS)", () => {
    const trace = {
      turns: [
        {
          events: [
            { "harness.event_type": "tool.call", "harness.mutated_state": true },
            { "harness.event_type": "verify.result" },
          ],
        },
      ],
    };
    expect(checkBehavioralHonesty(trace).pass).toBe(true);
  });
});

describe("checkBehavioralHonesty — prohibited inference (FAIL) / permitted (PASS)", () => {
  it("verify.result / feedback.check / evolve.propose / evolve.apply with inferred=true FAIL", () => {
    for (const eventType of [
      "verify.result",
      "feedback.check",
      "evolve.propose",
      "evolve.apply",
    ]) {
      const trace = {
        turns: [{ events: [{ "harness.event_type": eventType, [`harness.inferred`]: true }] }],
      };
      const result = checkBehavioralHonesty(trace);
      expect(result.pass).toBe(false);
      expect(codes(result.violations)).toContain("prohibited-inference");
    }
  });

  it("context.load / plan.emit with inferred=true do NOT fail (§5.1 permitted)", () => {
    for (const eventType of PERMITTED_INFERENCE) {
      const trace = {
        turns: [{ events: [{ "harness.event_type": eventType, "harness.inferred": true }] }],
      };
      expect(checkBehavioralHonesty(trace).pass).toBe(true);
    }
  });

  it("tool.call with inferred=true is a prohibited-inference violation", () => {
    const trace = {
      turns: [{ events: [{ "harness.event_type": "tool.call", "harness.inferred": true }] }],
    };
    expect(codes(checkBehavioralHonesty(trace).violations)).toContain(
      "prohibited-inference",
    );
  });
});

describe("checkBehavioralHonesty — never mutates input", () => {
  it("leaves the input trace deeply unchanged (deep-equality before/after)", () => {
    const trace = goldenBehavioral("fabricated-verify-after-mutation.json");
    const before = JSON.stringify(trace);
    checkBehavioralHonesty(trace);
    expect(JSON.stringify(trace)).toBe(before);
  });

  it("the unsubstantiated marker lives in a reserved harness.x.lucid.test.* namespace", () => {
    expect(UNSUBSTANTIATED_MARKER.startsWith("harness.x.lucid.test.")).toBe(true);
  });
});
