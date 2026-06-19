import { describe, expect, it } from "vitest";

import {
  checkRedactionCompleteness,
  CONTENT_FIELD_KEYS,
  type RedactionConfig,
} from "../src/index.js";

/**
 * Layer 4 (export-path) redaction-completeness gate — REQ-06 defense-in-depth.
 *
 * The 06-04 exporter calls this to set EvidencePackage.redaction_applied and to
 * refuse export when an enabled content field escaped without a configured
 * redaction action (RESEARCH Pitfall 4 / threat T-06-12). It is a
 * config/application check, not a deep PII scan. These tests pin: nothing
 * present → complete + not-applied; present + configured → complete + applied;
 * present + NOT configured → incomplete with offending fields listed.
 */

const MESSAGES = CONTENT_FIELD_KEYS[0]; // gen_ai.input.messages
const TOOL_ARGS = CONTENT_FIELD_KEYS[1]; // gen_ai.tool.call.arguments

const DROP_BOTH: RedactionConfig = {
  contentFields: { [MESSAGES]: "drop", [TOOL_ARGS]: "drop" },
};

describe("checkRedactionCompleteness", () => {
  it("returns complete + redactionApplied:false when NO content field is present", () => {
    const records = [
      { "gen_ai.request.model": "claude-sonnet-4", "gen_ai.agent.id": "agent-7" },
      { "harness.event_type": "tool.call" },
    ];
    const result = checkRedactionCompleteness(records, DROP_BOTH);
    expect(result.complete).toBe(true);
    expect(result.redactionApplied).toBe(false);
    expect(result.offendingFields).toEqual([]);
  });

  it("returns complete + redactionApplied:true when a content field is present AND configured", () => {
    const records = [{ [MESSAGES]: "hashed-or-dropped-upstream" }];
    const result = checkRedactionCompleteness(records, DROP_BOTH);
    expect(result.complete).toBe(true);
    expect(result.redactionApplied).toBe(true);
    expect(result.offendingFields).toEqual([]);
  });

  it("treats a blanket defaultAction as covering every content field", () => {
    const config: RedactionConfig = { contentFields: {}, defaultAction: "drop" };
    const records = [{ [MESSAGES]: "x" }, { [TOOL_ARGS]: "y" }];
    const result = checkRedactionCompleteness(records, config);
    expect(result.complete).toBe(true);
    expect(result.redactionApplied).toBe(true);
  });

  it("returns INCOMPLETE with the offending field listed when present but NOT configured", () => {
    // Config covers only tool args; messages are present but uncovered.
    const config: RedactionConfig = { contentFields: { [TOOL_ARGS]: "drop" } };
    const records = [{ [MESSAGES]: "leaked prompt", [TOOL_ARGS]: "args" }];
    const result = checkRedactionCompleteness(records, config);
    expect(result.complete).toBe(false);
    expect(result.redactionApplied).toBe(false);
    expect(result.offendingFields).toEqual([MESSAGES]);
  });

  it("lists multiple offending fields in registry order when none are configured", () => {
    const config: RedactionConfig = { contentFields: {} };
    const records = [{ [TOOL_ARGS]: "a" }, { [MESSAGES]: "b" }];
    const result = checkRedactionCompleteness(records, config);
    expect(result.complete).toBe(false);
    expect(result.offendingFields).toEqual([MESSAGES, TOOL_ARGS]);
  });

  it("is a configuration check — it does not inspect or transform the content value", () => {
    // Even a fully populated raw value is fine SO LONG AS an action is configured;
    // the gate proves an action exists, it does not re-scan the payload.
    const records = [{ [MESSAGES]: [{ role: "user", content: "raw text" }] }];
    const result = checkRedactionCompleteness(records, DROP_BOTH);
    expect(result.complete).toBe(true);
    expect(result.redactionApplied).toBe(true);
  });
});
