import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterManifestSchema } from "../src/manifest.js";

import { scaffoldAdapter } from "../src/scaffold.js";

/**
 * RED tests for scaffoldAdapter — the `adapter init` file emitter.
 *
 * Writes into a per-test tmp dir (used as the containment root) and asserts:
 *  - the three files are written,
 *  - the manifest JSON parses against AdapterManifestSchema,
 *  - the adapter source renders defineAdapter + the targeted HSC version,
 *  - an escaping targetDir is rejected before any write (T-06-08),
 *  - existing files are not clobbered unless force is set (T-06-09).
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lucid-scaffold-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scaffoldAdapter — writes a runnable adapter package", () => {
  it("writes an adapter source, a manifest JSON, and a conformance fixture", () => {
    const result = scaffoldAdapter({
      name: "acme-adapter",
      framework: "acme@1.0",
      hscVersion: "v0",
      targetDir: "acme-adapter",
      root,
    });

    expect(result.files.adapter).toMatch(/adapter\.ts$/);
    expect(result.files.manifest).toMatch(/manifest\.json$/);
    expect(result.files.fixture).toMatch(/\.json$/);

    // all three exist and are readable
    for (const p of Object.values(result.files)) {
      expect(() => readFileSync(p, "utf8")).not.toThrow();
    }
  });

  it("the written manifest JSON parses against AdapterManifestSchema", () => {
    const result = scaffoldAdapter({
      name: "acme-adapter",
      framework: "acme@1.0",
      hscVersion: "v0",
      targetDir: "acme-adapter",
      root,
    });

    const raw = JSON.parse(readFileSync(result.files.manifest, "utf8"));
    const parsed = AdapterManifestSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    expect(raw.name).toBe("acme-adapter");
    expect(raw.framework).toBe("acme@1.0");
    expect(raw.hscVersion).toBe("v0");
  });

  it("the written adapter source imports defineAdapter and targets the HSC version", () => {
    const result = scaffoldAdapter({
      name: "acme-adapter",
      framework: "acme@1.0",
      hscVersion: "v0",
      targetDir: "acme-adapter",
      root,
    });

    const src = readFileSync(result.files.adapter, "utf8");
    expect(src).toContain('from "@lucid/adapter-sdk"');
    expect(src).toContain("defineAdapter");
    expect(src).toContain('targets: "v0"');
    expect(src).toContain('framework: "acme@1.0"');
  });
});

describe("scaffoldAdapter — path containment guard (T-06-08)", () => {
  it("rejects a targetDir that escapes the root, before any write", () => {
    expect(() =>
      scaffoldAdapter({
        name: "evil",
        framework: "x@1",
        hscVersion: "v0",
        targetDir: "../../etc/escape",
        root,
      }),
    ).toThrow(/escapes/i);
  });

  it("rejects an absolute targetDir outside the root", () => {
    expect(() =>
      scaffoldAdapter({
        name: "evil",
        framework: "x@1",
        hscVersion: "v0",
        targetDir: "/etc",
        root,
      }),
    ).toThrow(/escapes/i);
  });
});

describe("scaffoldAdapter — no-clobber (T-06-09)", () => {
  it("refuses to overwrite an existing target file unless force is set", () => {
    const opts = {
      name: "acme-adapter",
      framework: "acme@1.0",
      hscVersion: "v0",
      targetDir: "acme-adapter",
      root,
    };
    const first = scaffoldAdapter(opts);
    // pre-existing adapter.ts now present
    writeFileSync(first.files.adapter, "// user edits\n", "utf8");

    expect(() => scaffoldAdapter(opts)).toThrow(/exists|clobber|overwrite/i);
    // the user's edit survived (no write happened)
    expect(readFileSync(first.files.adapter, "utf8")).toContain("user edits");
  });

  it("overwrites when force:true is passed", () => {
    const opts = {
      name: "acme-adapter",
      framework: "acme@1.0",
      hscVersion: "v0",
      targetDir: "acme-adapter",
      root,
    };
    const first = scaffoldAdapter(opts);
    writeFileSync(first.files.adapter, "// user edits\n", "utf8");

    expect(() => scaffoldAdapter({ ...opts, force: true })).not.toThrow();
    expect(readFileSync(first.files.adapter, "utf8")).toContain("defineAdapter");
  });
});

describe("scaffoldAdapter — the fixture is a valid HSC trace shape", () => {
  it("the conformance fixture is a HarnessTrace with hsc_version v0 and turns", () => {
    const result = scaffoldAdapter({
      name: "acme-adapter",
      framework: "acme@1.0",
      hscVersion: "v0",
      targetDir: "acme-adapter",
      root,
    });

    const trace = JSON.parse(readFileSync(result.files.fixture, "utf8"));
    expect(trace.hsc_version).toBe("v0");
    expect(Array.isArray(trace.turns)).toBe(true);
    expect(trace.turns.length).toBeGreaterThan(0);
    // honest absence: a freshly scaffolded fixture has no fabricated verify.result.
    const eventTypes = trace.turns.flatMap((t: { events: { [k: string]: unknown }[] }) =>
      t.events.map((e) => e["harness.event_type"]),
    );
    expect(eventTypes).not.toContain("verify.result");
  });
});
