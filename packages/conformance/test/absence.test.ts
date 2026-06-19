import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { validateTrace } from "../src/validate.js";
import { HARNESS_ATTR } from "@lucid/hsc-schema";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));

/**
 * D-05: absence is signal. A `tool.call` that mutated state with NO following
 * `verify.result` is a VALID trace — the missing verification is an honest
 * absence the validator MUST preserve. The validator MUST NOT fabricate a
 * verify.result to make the trace "pass".
 */
describe("validateTrace — honest absence (D-05)", () => {
  it("accepts a mutating tool.call with no following verify.result", () => {
    const trace = fixture("valid-trace.json");

    const events = trace.turns.flatMap((t: any) => t.events);
    const mutatingCall = events.find(
      (e: any) =>
        e["harness.event_type"] === "tool.call" &&
        e[HARNESS_ATTR.mutatedState] === true,
    );
    // Fixture sanity: the honest-absence seed exists.
    expect(mutatingCall).toBeDefined();
    const hasVerify = events.some(
      (e: any) => e["harness.event_type"] === "verify.result",
    );
    expect(hasVerify).toBe(false);

    const result = validateTrace(trace);
    expect(result.valid).toBe(true);
  });

  it("does not fabricate a verify.result into the validated trace", () => {
    const trace = fixture("valid-trace.json");
    const before = JSON.stringify(trace);
    validateTrace(trace);
    // The validator must not mutate the input to inject a verification event.
    expect(JSON.stringify(trace)).toBe(before);
  });
});
