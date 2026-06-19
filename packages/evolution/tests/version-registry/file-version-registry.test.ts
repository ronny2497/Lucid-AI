/**
 * FileVersionRegistry — reversible-by-construction snapshots (Task 3, REQ-05 /
 * T-04-05). Also validates the two golden ApplyRecord fixtures against
 * ApplyRecordSchema (one KEEP add-gate, one REVERT auto-rollback trim-context).
 */

import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { FileVersionRegistry } from "../../src/version-registry.js";
import { ApplyRecordSchema } from "../../src/apply-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "..", "fixtures");
const harnessFixture = join(fixturesRoot, "harness-v37");

describe("FileVersionRegistry", () => {
  let base: string;
  let registry: FileVersionRegistry;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "lucid-harness-"));
    // Copy the synthetic harness-v37 tree into a writable temp base.
    cpSync(harnessFixture, base, { recursive: true });
    registry = new FileVersionRegistry(base);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("snapshots affected files into .lucid/snapshots/{id}/ BEFORE any write", async () => {
    const snap = await registry.snapshot("my-agent", "v37", [
      "config/gates.yaml",
      "prompts/system.txt",
    ]);
    // The immutable copies exist immediately after snapshot returns, before any mutation.
    expect(existsSync(join(snap.snapshotDir, "config/gates.yaml"))).toBe(true);
    expect(existsSync(join(snap.snapshotDir, "prompts/system.txt"))).toBe(true);
    expect(snap.snapshotDir).toContain(join(".lucid", "snapshots"));
  });

  it("records a contentHash that matches the snapshotted file content", async () => {
    const { createHash } = await import("node:crypto");
    const snap = await registry.snapshot("my-agent", "v37", ["config/gates.yaml"]);
    const file = snap.files.find((f) => f.path === "config/gates.yaml");
    const content = readFileSync(join(base, "config/gates.yaml"));
    const expected = "sha256:" + createHash("sha256").update(content).digest("hex");
    expect(file?.contentHash).toBe(expected);
  });

  it("round-trip: snapshot -> mutate -> revert restores byte-identical content", async () => {
    const target = join(base, "config/gates.yaml");
    const original = readFileSync(target);

    const snap = await registry.snapshot("my-agent", "v37", ["config/gates.yaml"]);

    // Mutate the live file (simulating an apply).
    writeFileSync(target, "gates: [] # mutated by apply\n", "utf8");
    expect(readFileSync(target).equals(original)).toBe(false);

    await registry.revert(snap);

    const restored = readFileSync(target);
    expect(restored.equals(original)).toBe(true);
  });

  it("getSnapshot / listVersions read back persisted snapshots", async () => {
    await registry.snapshot("my-agent", "v37", ["config/gates.yaml"]);
    const list = await registry.listVersions("my-agent");
    expect(list).toHaveLength(1);
    expect(await registry.getSnapshot("my-agent", "v37")).not.toBeNull();
    expect(await registry.getSnapshot("my-agent", "v99")).toBeNull();
    expect(await registry.listVersions("other-agent")).toHaveLength(0);
  });
});

describe("golden ApplyRecord fixtures", () => {
  it("golden-apply-add-gate.json validates (verdict KEEP, contentHash present)", () => {
    const raw = JSON.parse(readFileSync(join(fixturesRoot, "golden-apply-add-gate.json"), "utf8"));
    const rec = ApplyRecordSchema.parse(raw);
    expect(rec.verdict).toBe("KEEP");
    expect(rec.changeKind).toBe("add-gate");
    expect(rec.rollbackStatus).toBe("none");
    expect(rec.contentHash.length).toBeGreaterThan(0);
    expect((rec.candidateScore ?? 0) >= (rec.baselineScore ?? 0)).toBe(true);
  });

  it("golden-apply-rollback.json validates (verdict REVERT, auto-rollback)", () => {
    const raw = JSON.parse(readFileSync(join(fixturesRoot, "golden-apply-rollback.json"), "utf8"));
    const rec = ApplyRecordSchema.parse(raw);
    expect(rec.verdict).toBe("REVERT");
    expect(rec.changeKind).toBe("trim-context");
    expect(rec.rollbackStatus).toBe("auto-rollback");
    expect((rec.candidateScore ?? 0) < (rec.baselineScore ?? 0)).toBe(true);
    expect((rec.delta ?? 0) < 0).toBe(true);
  });
});
