import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { validateTrace } from "../src/validate.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));

/** True if any AJV/structural error mentions the given dotted path fragment. */
function errorsMention(errors: unknown[], fragment: string): boolean {
  return errors.some((e) => JSON.stringify(e).includes(fragment));
}

describe("validateTrace — schema conformance", () => {
  it("accepts a well-formed HarnessTrace", () => {
    const result = validateTrace(fixture("valid-trace.json"));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a trace whose event is missing harness.event_type", () => {
    const result = validateTrace(fixture("missing-event-type.json"));
    expect(result.valid).toBe(false);
    expect(errorsMention(result.errors, "harness.event_type")).toBe(true);
  });

  it("rejects a trace whose event is missing harness.principle", () => {
    const result = validateTrace(fixture("missing-principle.json"));
    expect(result.valid).toBe(false);
    expect(errorsMention(result.errors, "harness.principle")).toBe(true);
  });

  it("rejects a trace with an invalid harness.quadrant.x value", () => {
    const result = validateTrace(fixture("bad-quadrant.json"));
    expect(result.valid).toBe(false);
    expect(errorsMention(result.errors, "quadrant.x")).toBe(true);
  });

  it("rejects a non-object trace without throwing", () => {
    expect(validateTrace(null).valid).toBe(false);
    expect(validateTrace("not a trace").valid).toBe(false);
    expect(validateTrace(42).valid).toBe(false);
  });
});
