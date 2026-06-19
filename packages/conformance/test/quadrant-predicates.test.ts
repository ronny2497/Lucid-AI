import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { validateTrace } from "../src/validate.js";
import { quadrantFor, EMITTER_SPECIFIED_Y, EVENT_TYPES } from "@lucid/hsc-schema";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));

/**
 * Every event type the validator imports must come from @lucid/hsc-schema
 * (no hardcoding), and the quadrant tags emitted in the valid fixture must be
 * consistent with quadrantFor() — except feedback.check whose y is
 * emitter-specified (EMITTER_SPECIFIED_Y).
 */
describe("quadrant predicate consistency", () => {
  it("valid trace passes validation", () => {
    expect(validateTrace(fixture("valid-trace.json")).valid).toBe(true);
  });

  it("each emitted event's quadrant agrees with quadrantFor() (y exempt for emitter-specified events)", () => {
    const trace = fixture("valid-trace.json");
    const events = trace.turns.flatMap((t: any) => t.events);

    for (const event of events) {
      const type = event["harness.event_type"];
      expect(EVENT_TYPES).toContain(type);

      const expected = quadrantFor(type);
      const emittedX = event["harness.quadrant.x"] ?? null;
      expect(emittedX).toBe(expected.x);

      if (!EMITTER_SPECIFIED_Y.has(type)) {
        const emittedY = event["harness.quadrant.y"] ?? null;
        expect(emittedY).toBe(expected.y);
      }
    }
  });
});
