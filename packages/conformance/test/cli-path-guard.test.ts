import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveInRoot, runConformance } from "../src/cli.js";

/**
 * HI-01: the CLI path guard must reject a symlink that lives INSIDE the project
 * root but points OUTSIDE it. The old lexical-only guard followed such a symlink
 * and read the out-of-root target; the realpath guard must reject it before any
 * read.
 */
describe("CLI path guard — symlink escape (HI-01)", () => {
  let root: string;
  let outsideDir: string;

  beforeEach(() => {
    // Two sibling temp dirs: `root` is the "project root", `outsideDir` holds a
    // secret the attacker wants to exfiltrate via an in-root symlink.
    const base = mkdtempSync(join(tmpdir(), "lucid-cli-guard-"));
    root = join(base, "project");
    outsideDir = join(base, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, "secret.json"), '{"hsc_version":"v0"}', "utf8");
  });

  afterEach(() => {
    // Clean up the whole temp base (parent of root + outsideDir).
    rmSync(join(root, ".."), { recursive: true, force: true });
  });

  it("resolveInRoot throws for an in-root symlink pointing outside the root", () => {
    const link = join(root, "escape.json");
    symlinkSync(join(outsideDir, "secret.json"), link);
    expect(() => resolveInRoot("escape.json", root)).toThrow(/escapes project root/);
  });

  it("runConformance refuses the symlink-escape path without reading the target", () => {
    const link = join(root, "escape.json");
    symlinkSync(join(outsideDir, "secret.json"), link);
    const outcome = runConformance("escape.json", root);
    expect(outcome.code).toBe(1);
    expect(outcome.lines.join("\n")).toMatch(/escapes project root/);
  });

  it("still accepts a real in-root file (resolves to a path inside the root)", () => {
    const inRoot = join(root, "trace.json");
    // A lexically- and really-in-root file: not valid HSC, but the guard must
    // let it through to validation (it must NOT be rejected as an escape).
    writeFileSync(inRoot, '{"not":"a valid trace"}', "utf8");
    const resolved = resolveInRoot("trace.json", root);
    expect(resolved).toMatch(/trace\.json$/);
    // runConformance reaches validation and reports a conformance FAIL (code 1),
    // NOT a path-escape error.
    const outcome = runConformance("trace.json", root);
    expect(outcome.lines.join("\n")).not.toMatch(/escapes project root/);
  });

  it("rejects a lexical `..` escape (defense-in-depth, pre-existing guard)", () => {
    expect(() => resolveInRoot("../outside/secret.json", root)).toThrow(
      /escapes project root/,
    );
  });
});
