import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { validateTrace } from "../src/validate.js";
import { quadrantFor, EMITTER_SPECIFIED_Y, EVENT_TYPES } from "@lucid/hsc-schema";

/**
 * The golden-trace test — the CODIFIED Phase 0 exit criterion.
 *
 * Loads the hermes reference-adapter capture (`examples/hermes-trace.json`),
 * validates it against the HSC v0 schema via `validateTrace`, and asserts:
 *   - valid === true (the trace conforms);
 *   - every event carries a non-null `harness.principle`;
 *   - at least one `tool.call` with `harness.mutated_state: true` exists;
 *   - the honest absence is preserved: NOT every mutating tool.call is followed
 *     by a `verify.result` (in fact none is — the empty-feedback finding);
 *   - quadrant fidelity (warning #4): each event's recorded quadrant agrees with
 *     `quadrantFor()` (the single source of truth), so prose/code/trace cannot
 *     drift.
 */

// packages/conformance/test -> repo root is three dirs up.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const goldenPath = join(repoRoot, "examples", "hermes-trace.json");

interface HarnessEvent {
  "harness.event_type": string;
  "harness.principle"?: string | null;
  "harness.quadrant.x"?: string | null;
  "harness.quadrant.y"?: string | null;
  "harness.mutated_state"?: boolean | null;
  [k: string]: unknown;
}

function loadGolden(): { turns: { events: HarnessEvent[] }[] } {
  return JSON.parse(readFileSync(goldenPath, "utf8"));
}

function allEvents(trace: { turns: { events: HarnessEvent[] }[] }): HarnessEvent[] {
  return trace.turns.flatMap((t) => t.events);
}

describe("golden trace — hermes reference adapter (Phase 0 exit criterion)", () => {
  it("examples/hermes-trace.json conforms to HSC v0", () => {
    const trace = loadGolden();
    const result = validateTrace(trace);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("every event carries a non-null harness.principle", () => {
    const events = allEvents(loadGolden());
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e["harness.principle"]).toBeTruthy();
    }
  });

  it("contains at least one tool.call with harness.mutated_state: true", () => {
    const events = allEvents(loadGolden());
    const mutating = events.filter(
      (e) =>
        e["harness.event_type"] === "tool.call" &&
        e["harness.mutated_state"] === true,
    );
    expect(mutating.length).toBeGreaterThanOrEqual(1);
  });

  it("preserves honest absence: a mutating tool.call has no following verify.result", () => {
    const trace = loadGolden();
    // Per turn, assert NOT every mutating tool.call is followed by a verify.result.
    let foundUnverifiedMutation = false;
    for (const turn of trace.turns) {
      const events = turn.events;
      events.forEach((e, i) => {
        if (
          e["harness.event_type"] === "tool.call" &&
          e["harness.mutated_state"] === true
        ) {
          const followedByVerify = events
            .slice(i + 1)
            .some((later) => later["harness.event_type"] === "verify.result");
          if (!followedByVerify) {
            foundUnverifiedMutation = true;
          }
        }
      });
    }
    // The empty-feedback seed MUST be present and preserved (D-05, spec §4).
    expect(foundUnverifiedMutation).toBe(true);

    // And the trace must not have fabricated a verify.result anywhere.
    const events = allEvents(trace);
    expect(events.some((e) => e["harness.event_type"] === "verify.result")).toBe(
      false,
    );
    expect(events.some((e) => e["harness.event_type"] === "feedback.check")).toBe(
      false,
    );
  });

  it("quadrant fidelity: recorded x/y agree with quadrantFor() (warning #4)", () => {
    const events = allEvents(loadGolden());
    for (const e of events) {
      const et = e["harness.event_type"] as (typeof EVENT_TYPES)[number];
      const { x, y } = quadrantFor(et);
      const recordedX = e["harness.quadrant.x"] ?? null;
      const recordedY = e["harness.quadrant.y"] ?? null;
      // x is always table-derived.
      expect(recordedX).toBe(x);
      // y is table-derived except for emitter-specified events (feedback.check),
      // which are not present in this hermes capture (expected absence).
      if (!EMITTER_SPECIFIED_Y.has(et)) {
        expect(recordedY).toBe(y);
      }
    }
  });
});
