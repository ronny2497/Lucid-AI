import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runComplianceExport,
  parseArgs,
  resolveInRoot,
  type ComplianceExportArgs,
} from "../src/cli.js";
import { InMemoryAuditSource } from "../src/source.js";
import { verifyChainJsonl } from "../src/audit-trail.js";
import { EvidencePackageSchema } from "../src/schema.js";
import type { AuditDraftRecord } from "../src/index.js";

/**
 * CLI path-guard + happy-path (REQ-06, T-06-18 / T-06-16). Pins: `--out ../escape`
 * is rejected BEFORE any write; a happy-path export writes a parseable
 * manifest.json + a chain-verifiable audit-trail.jsonl; a redaction-incomplete
 * source exits 1 with NO files written.
 */

const SECRET = "cli-secret";

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

function baseArgs(out: string, over: Partial<ComplianceExportArgs> = {}): ComplianceExportArgs {
  return {
    regime: "eu-ai-act",
    agentId: "agent-7",
    since: "2026-01-01T00:00:00.000Z",
    until: "2026-12-31T00:00:00.000Z",
    out,
    secret: SECRET,
    ...over,
  };
}

describe("parseArgs", () => {
  it("parses a full valid invocation", () => {
    const { args, error } = parseArgs(
      ["--regime", "eu-ai-act", "--agent", "a1", "--since", "s", "--until", "u", "--out", "o", "--secret", "k"],
    );
    expect(error).toBeUndefined();
    expect(args?.regime).toBe("eu-ai-act");
    expect(args?.agentId).toBe("a1");
  });

  it("errors on a missing required flag", () => {
    const { error } = parseArgs(["--regime", "eu-ai-act", "--agent", "a1"]);
    expect(error).toMatch(/missing required argument/);
  });

  it("errors on an unsupported regime", () => {
    const { error } = parseArgs(
      ["--regime", "gdpr", "--agent", "a", "--since", "s", "--until", "u", "--out", "o", "--secret", "k"],
    );
    expect(error).toMatch(/unsupported regime/);
  });

  it("falls back to LUCID_AUDIT_SECRET when --secret is absent", () => {
    const { args, error } = parseArgs(
      ["--regime", "colorado", "--agent", "a", "--since", "s", "--until", "u", "--out", "o"],
      "env-secret",
    );
    expect(error).toBeUndefined();
    expect(args?.secret).toBe("env-secret");
  });
});

describe("resolveInRoot path containment", () => {
  it("rejects a path that escapes the project root", () => {
    expect(() => resolveInRoot("../escape", "/tmp/root")).toThrow(/escapes project root/);
  });

  it("rejects an absolute path outside the root", () => {
    expect(() => resolveInRoot("/etc/passwd", "/tmp/root")).toThrow(/escapes project root/);
  });

  it("accepts an in-root relative path", () => {
    expect(resolveInRoot("out/evidence", "/tmp/root")).toBe("/tmp/root/out/evidence");
  });
});

describe("runComplianceExport", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lucid-compliance-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects --out ../escape BEFORE any write", async () => {
    const src = new InMemoryAuditSource([draft()]);
    const outcome = await runComplianceExport(baseArgs("../escape"), root, src);
    expect(outcome.code).toBe(1);
    expect(outcome.lines.join("\n")).toMatch(/escapes project root/);
    // Nothing written.
    expect(outcome.writtenPaths).toBeUndefined();
  });

  it("happy path: writes a parseable manifest.json + chain-verifiable audit-trail.jsonl", async () => {
    const src = new InMemoryAuditSource([draft({ record_id: "r1" }), draft({ record_id: "r2" })]);
    const outcome = await runComplianceExport(baseArgs("evidence-out"), root, src);
    expect(outcome.code).toBe(0);

    const pkgDir = join(root, "evidence-out", "evidence-package");
    const manifestPath = join(pkgDir, "manifest.json");
    const trailPath = join(pkgDir, "audit-trail.jsonl");
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(trailPath)).toBe(true);
    expect(existsSync(join(pkgDir, "change-manifests"))).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.regime).toBe("eu-ai-act");
    expect(manifest.disclaimer.length).toBeGreaterThan(0);
    expect(manifest.obligation_coverage.partial).toBe(true);

    const trail = readFileSync(trailPath, "utf8");
    const v = verifyChainJsonl(trail, SECRET);
    expect(v.valid).toBe(true);
    expect(v.records).toHaveLength(2);
    for (const r of v.records ?? []) {
      expect(EvidencePackageSchema.shape.records.element.safeParse(r).success).toBe(true);
    }
  });

  it("writes change-manifest reference stubs only when change_manifest data is present", async () => {
    const src = new InMemoryAuditSource([draft({ record_id: "r1", change_manifest_ids: ["cm-9"] })]);
    const outcome = await runComplianceExport(baseArgs("evidence-cm"), root, src);
    expect(outcome.code).toBe(0);
    const changeDir = join(root, "evidence-cm", "evidence-package", "change-manifests");
    const entries = readdirSync(changeDir);
    expect(entries).toContain("cm-9.ref.json");
    const ref = JSON.parse(readFileSync(join(changeDir, "cm-9.ref.json"), "utf8"));
    expect(ref.change_manifest_id).toBe("cm-9");
    expect(ref.cited_by).toContain("r1");
  });

  it("change-manifests/ stays empty when no change_manifest data is present", async () => {
    const src = new InMemoryAuditSource([draft({ change_manifest_ids: [] })]);
    const outcome = await runComplianceExport(baseArgs("evidence-empty"), root, src);
    expect(outcome.code).toBe(0);
    const changeDir = join(root, "evidence-empty", "evidence-package", "change-manifests");
    expect(readdirSync(changeDir)).toHaveLength(0);
  });

  it("redaction-incomplete source exits 1 with NO files written", async () => {
    const src = new InMemoryAuditSource([draft({ input_summary: "leaked prompt" })]);
    const outcome = await runComplianceExport(
      baseArgs("evidence-blocked", { redactionConfig: { contentFields: {} } }),
      root,
      src,
    );
    expect(outcome.code).toBe(1);
    expect(outcome.lines.join("\n")).toMatch(/redaction incomplete/);
    expect(existsSync(join(root, "evidence-blocked"))).toBe(false);
  });
});
