import { describe, expect, it } from "vitest";

import {
  CONTENT_FIELD_KEYS,
  guardContentFields,
} from "../src/index.js";

/**
 * Layer 1 (SDK-side) redaction guard — REQ-06 defense-in-depth.
 *
 * The guard is an opt-in emit-or-omit gate over the two content-bearing fields
 * the HSC attribute registry marks opt-in (gen_ai.input.messages,
 * gen_ai.tool.call.arguments). It is NOT a deep PII scanner — the authoritative
 * redaction is collector-side. These tests pin: no-op on bags without content;
 * strip-by-default; preserve-on-consent; never-mutate-input; always-preserve
 * non-content identifiers.
 */

const MESSAGES = CONTENT_FIELD_KEYS[0]; // gen_ai.input.messages
const TOOL_ARGS = CONTENT_FIELD_KEYS[1]; // gen_ai.tool.call.arguments

describe("guardContentFields", () => {
  it("returns a bag with no content fields unchanged (no-op)", () => {
    const attrs = {
      "gen_ai.tool.name": "write_file",
      "gen_ai.request.model": "claude-sonnet-4",
      "harness.event_type": "tool.call",
    };
    const out = guardContentFields(attrs);
    expect(out).toEqual(attrs);
  });

  it("STRIPS the opt-in content fields by default (consent OFF)", () => {
    const attrs = {
      "gen_ai.tool.name": "write_file",
      [MESSAGES]: [{ role: "user", content: "my secret prompt" }],
      [TOOL_ARGS]: { path: "/etc/passwd" },
    };
    const out = guardContentFields(attrs);
    expect(out[MESSAGES]).toBeUndefined();
    expect(out[TOOL_ARGS]).toBeUndefined();
    // Non-content identifier survives.
    expect(out["gen_ai.tool.name"]).toBe("write_file");
  });

  it("strips content fields when allowContent is explicitly false", () => {
    const attrs = { [MESSAGES]: "raw", [TOOL_ARGS]: "raw" };
    const out = guardContentFields(attrs, { allowContent: false });
    expect(out[MESSAGES]).toBeUndefined();
    expect(out[TOOL_ARGS]).toBeUndefined();
  });

  it("PRESERVES the content fields when the operator opts in (consent ON)", () => {
    const attrs = {
      "gen_ai.tool.name": "write_file",
      [MESSAGES]: [{ role: "user", content: "consented content" }],
      [TOOL_ARGS]: { path: "ok" },
    };
    const out = guardContentFields(attrs, { allowContent: true });
    expect(out[MESSAGES]).toEqual([{ role: "user", content: "consented content" }]);
    expect(out[TOOL_ARGS]).toEqual({ path: "ok" });
    expect(out["gen_ai.tool.name"]).toBe("write_file");
  });

  it("never mutates its input bag (returns a new object)", () => {
    const attrs = {
      "gen_ai.request.model": "claude-sonnet-4",
      [MESSAGES]: "secret",
    };
    const snapshot = { ...attrs };
    const out = guardContentFields(attrs);
    // Input untouched.
    expect(attrs).toEqual(snapshot);
    expect(attrs[MESSAGES]).toBe("secret");
    // A new object was returned.
    expect(out).not.toBe(attrs);
  });

  it("always preserves non-content gen_ai.* / harness.* identifiers regardless of consent", () => {
    const identifiers = {
      "gen_ai.tool.name": "write_file",
      "gen_ai.request.model": "claude-sonnet-4",
      "gen_ai.agent.id": "agent-7",
      "harness.event_type": "tool.call",
      "harness.principle": "plan_execute",
    };
    const off = guardContentFields({ ...identifiers, [MESSAGES]: "x" });
    const on = guardContentFields({ ...identifiers, [MESSAGES]: "x" }, { allowContent: true });
    for (const [k, v] of Object.entries(identifiers)) {
      expect(off[k]).toBe(v);
      expect(on[k]).toBe(v);
    }
  });
});
