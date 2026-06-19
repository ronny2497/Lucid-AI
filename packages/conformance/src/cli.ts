#!/usr/bin/env node
/**
 * `lucid conformance` CLI — two modes:
 *
 *   --trace <file>          Layer 2 only: validate one HSC trace with
 *                           validateTrace() and print a pass/fail summary
 *                           (the original, unchanged behavior).
 *   --adapter <trace-or-dir>  Run the full THREE-LAYER suite (runConformanceSuite)
 *                           over one trace or every .json in a directory, printing
 *                           a per-layer ✓/✗ DX summary. With --emit-badge, also
 *                           writes a conformance-report.json + badge.json next to
 *                           each input.
 *
 * The process exit code is 0 only when the verdict is PASS (every trace, in
 * directory mode). Hardened against two untrusted-input threats — the SAME guards
 * apply to --trace and --adapter (including every file in a directory and every
 * badge/report output path):
 *
 *   T-00-06 (path traversal): the resolved trace path MUST live inside the
 *     project root. Any path that escapes it is rejected BEFORE the file is
 *     opened.
 *   T-00-07 (oversized input / DoS): the file size is checked against a fixed
 *     byte ceiling BEFORE reading; oversized files are refused without being
 *     read into memory. Malformed JSON is caught and reported as invalid.
 */

import { readFileSync, statSync, realpathSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute, join, basename, dirname } from "node:path";

import { validateTrace } from "./validate.js";
import { runConformanceSuite } from "./suite.js";
import { emitBadge } from "./badge.js";
import type { ConformanceReport, LayerResult } from "./report.js";

/** Maximum trace file size we will read (8 MiB). Above this we refuse (T-00-07). */
export const MAX_TRACE_BYTES = 8 * 1024 * 1024;

export interface CliOutcome {
  /** Process exit code: 0 valid, 1 invalid/error. */
  code: number;
  /** Human-readable lines to print. */
  lines: string[];
}

/** Parse `--trace <path>` out of argv (the value after the flag). */
export function parseTraceArg(argv: string[]): string | undefined {
  const i = argv.indexOf("--trace");
  if (i === -1) {
    return undefined;
  }
  return argv[i + 1];
}

/** Parse `--adapter <trace-or-dir>` out of argv (the value after the flag). */
export function parseAdapterArg(argv: string[]): string | undefined {
  const i = argv.indexOf("--adapter");
  if (i === -1) {
    return undefined;
  }
  return argv[i + 1];
}

/** True when `--emit-badge` is present in argv. */
export function parseEmitBadge(argv: string[]): boolean {
  return argv.includes("--emit-badge");
}

/**
 * Resolve a user-supplied trace path against the project root and reject any
 * path that escapes it (T-00-06). Returns the absolute, in-root path or throws.
 *
 * Containment is checked TWICE for defense-in-depth:
 *   1. Lexically, on the `..`-normalized absolute path — this catches escapes
 *      even when the target does not yet exist on disk.
 *   2. On the canonical real path (symlinks resolved via realpathSync) — this
 *      closes the symlink-escape hole (HI-01): a symlink living inside the root
 *      that points outside (`<root>/link.json -> /etc/passwd`) is lexically
 *      in-root but its realpath is not, so it is rejected before any read.
 *
 * Both the candidate and the root are realpath'd before comparison so that a
 * symlinked root (or `/tmp` -> `/private/tmp` on macOS) does not produce a false
 * "escapes root" verdict. If the candidate does not exist yet, realpathSync
 * throws ENOENT; we fall back to the lexical absolute path so the downstream
 * stat() reports a clean "cannot stat" error rather than masking it here.
 */
export function resolveInRoot(traceArg: string, projectRoot: string): string {
  const root = resolve(projectRoot);
  const abs = isAbsolute(traceArg) ? resolve(traceArg) : resolve(root, traceArg);

  // (1) Lexical containment — works even for not-yet-existing paths.
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`trace path escapes project root: ${traceArg}`);
  }

  // (2) Real-path containment — defeats symlink escapes (HI-01).
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    // Path does not exist (yet): keep the lexical absolute path; the caller's
    // stat() will surface a "cannot stat" error.
    return abs;
  }
  // Resolve the root's real path too, so a symlinked root is compared fairly.
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = root;
  }
  const realRel = relative(realRoot, real);
  if (realRel === "" || realRel.startsWith("..") || isAbsolute(realRel)) {
    throw new Error(`trace path escapes project root: ${traceArg}`);
  }
  return real;
}

/**
 * Core CLI logic, exposed for testing. Performs path + size guards, reads and
 * parses the file, validates it, and returns an exit code + output lines.
 * Does not touch process state.
 */
export function runConformance(traceArg: string | undefined, projectRoot: string): CliOutcome {
  if (!traceArg) {
    return { code: 1, lines: ["error: --trace <file> is required"] };
  }

  let absPath: string;
  try {
    absPath = resolveInRoot(traceArg, projectRoot);
  } catch (err) {
    return { code: 1, lines: [`error: ${(err as Error).message}`] };
  }

  // T-00-07: size guard BEFORE reading.
  let stat;
  try {
    stat = statSync(absPath);
  } catch {
    return { code: 1, lines: [`error: cannot stat trace file: ${traceArg}`] };
  }
  if (!stat.isFile()) {
    return { code: 1, lines: [`error: not a file: ${traceArg}`] };
  }
  if (stat.size > MAX_TRACE_BYTES) {
    return {
      code: 1,
      lines: [
        `error: trace file too large (${stat.size} bytes > ${MAX_TRACE_BYTES} byte ceiling)`,
      ],
    };
  }

  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch {
    return { code: 1, lines: [`error: cannot read trace file: ${traceArg}`] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { code: 1, lines: [`error: invalid JSON: ${(err as Error).message}`] };
  }

  const result = validateTrace(parsed);
  if (result.valid) {
    return { code: 0, lines: [`PASS: ${traceArg} conforms to HSC v0`] };
  }

  const lines = [`FAIL: ${traceArg} does not conform to HSC v0`, `${result.errors.length} error(s):`];
  for (const e of result.errors) {
    lines.push(`  - ${JSON.stringify(e)}`);
  }
  return { code: 1, lines };
}

/**
 * Read + size-guard a single in-root trace file and JSON-parse it. Reuses the
 * EXISTING resolveInRoot containment guard (T-00-06 / T-06-04) and MAX_TRACE_BYTES
 * size ceiling (T-00-07 / T-06-05). Returns `{ parsed }` on success or
 * `{ error }` with a printable message — never throws on untrusted input.
 */
function readGuardedTrace(
  pathArg: string,
  projectRoot: string,
): { parsed?: unknown; error?: string } {
  let absPath: string;
  try {
    absPath = resolveInRoot(pathArg, projectRoot);
  } catch (err) {
    return { error: (err as Error).message };
  }
  let stat;
  try {
    stat = statSync(absPath);
  } catch {
    return { error: `cannot stat trace file: ${pathArg}` };
  }
  if (!stat.isFile()) {
    return { error: `not a file: ${pathArg}` };
  }
  if (stat.size > MAX_TRACE_BYTES) {
    return {
      error: `trace file too large (${stat.size} bytes > ${MAX_TRACE_BYTES} byte ceiling)`,
    };
  }
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch {
    return { error: `cannot read trace file: ${pathArg}` };
  }
  try {
    return { parsed: JSON.parse(raw) };
  } catch (err) {
    return { error: `invalid JSON: ${(err as Error).message}` };
  }
}

/** Render one layer's ✓/✗ summary line (PRD §7 DX format). */
function layerLine(name: string, layer: LayerResult): string {
  const mark = layer.pass ? "✓" : "✗";
  const errCount = layer.errors.filter((e) => e.severity === "error").length;
  const head = `  ${mark} ${name} (${layer.passed}/${layer.checks} checks`;
  return errCount > 0 ? `${head}, ${errCount} error(s))` : `${head})`;
}

/** Render the three-layer report summary + located failing rules/remedies. */
function reportSummaryLines(label: string, report: ConformanceReport): string[] {
  const lines: string[] = [];
  lines.push(
    report.verdict === "PASS"
      ? `PASS: ${label} is HSC ${report.hscVersion} conformant`
      : `FAIL: ${label} is NOT HSC ${report.hscVersion} conformant`,
  );
  lines.push(layerLine("Layer 1 OTel validity", report.layers.otelValidity));
  lines.push(layerLine("Layer 2 HSC extension", report.layers.hscExtension));
  lines.push(layerLine("Layer 3 behavioral honesty", report.layers.behavioralHonesty));
  const errors = report.errors.filter((e) => e.severity === "error");
  if (errors.length > 0) {
    lines.push(`${errors.length} violation(s):`);
    for (const e of errors) {
      const at = e.path ? ` @ ${e.path}` : "";
      lines.push(`  - [${e.layer}/${e.code}]${at} ${e.message}`);
    }
  }
  return lines;
}

/**
 * `--adapter <trace-or-dir>` runner. Resolves + size-guards each trace through
 * the EXISTING guards, runs the three-layer suite, prints a per-layer DX summary,
 * and (when `--emit-badge`) writes a conformance-report.json + badge.json next to
 * the input (each output path also containment-checked). Exit code 0 only when
 * EVERY trace verdict is PASS.
 */
export function runAdapter(
  adapterArg: string | undefined,
  projectRoot: string,
  emitBadgeFlag = false,
): CliOutcome {
  if (!adapterArg) {
    return { code: 1, lines: ["error: --adapter <trace-or-dir> is required"] };
  }

  // Resolve the adapter path once (containment) and decide file vs. directory.
  let absAdapter: string;
  try {
    absAdapter = resolveInRoot(adapterArg, projectRoot);
  } catch (err) {
    return { code: 1, lines: [`error: ${(err as Error).message}`] };
  }
  let stat;
  try {
    stat = statSync(absAdapter);
  } catch {
    return { code: 1, lines: [`error: cannot stat adapter path: ${adapterArg}`] };
  }

  // Build the list of trace path-args to evaluate (each re-guarded on read).
  let traceArgs: string[];
  if (stat.isDirectory()) {
    let entries: string[];
    try {
      entries = readdirSync(absAdapter)
        .filter((f) => f.endsWith(".json"))
        .sort();
    } catch {
      return { code: 1, lines: [`error: cannot read adapter directory: ${adapterArg}`] };
    }
    if (entries.length === 0) {
      return { code: 1, lines: [`error: no .json traces in adapter directory: ${adapterArg}`] };
    }
    traceArgs = entries.map((f) => join(adapterArg, f));
  } else {
    traceArgs = [adapterArg];
  }

  const lines: string[] = [];
  let allPass = true;
  for (const traceArg of traceArgs) {
    const { parsed, error } = readGuardedTrace(traceArg, projectRoot);
    if (error) {
      allPass = false;
      lines.push(`error: ${error}`);
      continue;
    }
    const report = runConformanceSuite(parsed, {
      hscVersion: "v0",
      adapter: { name: basename(traceArg), hscVersion: "v0" },
    });
    lines.push(...reportSummaryLines(traceArg, report));
    if (report.verdict !== "PASS") {
      allPass = false;
    }

    if (emitBadgeFlag) {
      const badge = emitBadge(report);
      const inputDir = dirname(resolveInRoot(traceArg, projectRoot));
      const reportName = `${basename(traceArg, ".json")}.conformance-report.json`;
      const badgeName = `${basename(traceArg, ".json")}.badge.json`;
      try {
        // `inputDir` is already realpath-contained (from resolveInRoot on the
        // trace above) and reportName/badgeName are basenames (no traversal), so
        // the outputs are within root by construction. Do NOT re-run resolveInRoot
        // on them — it realpath-resolves and would throw ENOENT on these
        // not-yet-created output files (the HI-01 symlink guard only applies to
        // existing input paths).
        const reportPath = join(inputDir, reportName);
        const badgePath = join(inputDir, badgeName);
        writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
        writeFileSync(badgePath, JSON.stringify(badge, null, 2), "utf8");
        lines.push(`  wrote ${reportName} + ${badgeName}`);
      } catch (err) {
        allPass = false;
        lines.push(`error: cannot write badge/report: ${(err as Error).message}`);
      }
    }
  }

  return { code: allPass ? 0 : 1, lines };
}

/** Entry point: wire argv + cwd into the right runner and set process state. */
export function main(argv: string[] = process.argv.slice(2), projectRoot: string = process.cwd()): void {
  const adapterArg = parseAdapterArg(argv);
  const outcome = adapterArg
    ? runAdapter(adapterArg, projectRoot, parseEmitBadge(argv))
    : runConformance(parseTraceArg(argv), projectRoot);
  for (const line of outcome.lines) {
    if (outcome.code === 0) {
      console.log(line);
    } else {
      console.error(line);
    }
  }
  process.exitCode = outcome.code;
}

// Run when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
