import { describe, expect, it } from "vitest";

import { mapColorado, PENDING_AG_RULEMAKING } from "../src/regimes/colorado.js";
import type { AuditDraftRecord } from "../src/index.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Colorado SB 26-189 overlay — a LIGHTER, deliberately-partial template
 * (RESEARCH Pitfall 6). Pins: statute-undetermined fields carry the explicit
 * [PENDING AG RULEMAKING] sentinel; coverage is NEVER full; the source never
 * references the repealed SB 24-205.
 */

function draft(over: Partial<AuditDraftRecord> = {}): AuditDraftRecord {
  return {
    record_id: "rec",
    start_time: "2026-01-01T00:00:00.000Z",
    end_time: "2026-01-01T00:01:00.000Z",
    agent_id: "agent-7",
    harness_version: "1.2.3",
    model_id: "claude-sonnet-4",
    change_manifest_ids: [],
    ...over,
  };
}

describe("mapColorado", () => {
  it("marks statute-undetermined obligations with the PENDING AG RULEMAKING sentinel", () => {
    const { coverage } = mapColorado([draft()]);
    const pending = coverage.obligations.filter((o) => o.note.includes(PENDING_AG_RULEMAKING));
    expect(pending.length).toBeGreaterThan(0);
    for (const o of pending) {
      expect(o.status).toBe("partial");
    }
  });

  it("NEVER claims full coverage of SB 26-189 (coverage.partial is always true)", () => {
    expect(mapColorado([draft()]).coverage.partial).toBe(true);
    expect(mapColorado([]).coverage.partial).toBe(true);
  });

  it("still surfaces the available basic identification as full coverage", () => {
    const { coverage } = mapColorado([draft()]);
    const id = coverage.obligations.find((o) => o.obligation.includes("affected-decision identification"));
    expect(id?.status).toBe("full");
  });

  it("the colorado source never references the repealed earlier statute (no '24-205' literal)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../src/regimes/colorado.ts"), "utf8");
    // The forbidden repealed-law citation must not appear anywhere in the source
    // (matches the plan's verification grep gate: grep -rc '24-205' src/ === 0).
    expect(src.includes("24-205")).toBe(false);
    // SB 26-189 IS the current statute and is expected to be referenced.
    expect(src.includes("26-189")).toBe(true);
  });

  it("passes records through unchanged (overlay shares the EU record shape)", () => {
    const recs = [draft({ record_id: "x" })];
    const { records } = mapColorado(recs);
    expect(records).toEqual(recs);
  });
});
