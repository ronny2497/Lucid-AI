#!/usr/bin/env node
/**
 * `lucid compliance export` CLI — assembles an evidence-package/ directory.
 *
 *   --regime <eu-ai-act|colorado>   the regulatory regime (required)
 *   --agent  <id>                   the agent id to scope to (required)
 *   --since  <iso>                  inclusive period start (required)
 *   --until  <iso>                  inclusive period end (required)
 *   --out    <dir>                  output directory (required, containment-guarded)
 *   --secret <key>                  HMAC secret for the hash chain (or LUCID_AUDIT_SECRET)
 *
 * The testable core `runComplianceExport(args, projectRoot, source)` takes an
 * INJECTED AuditSource so tests need no live store. The argv `run()` entrypoint
 * lazily imports `@lucid/store` and wraps it in `traceStoreAuditSource` — the
 * SINGLE place `@lucid/store` is referenced (an optional/dev wiring boundary, not
 * a hard runtime dep of the library surface; see Assumption A1).
 *
 * Hardening (reuses the conformance cli.ts guard pattern):
 *   T-06-18 (path traversal): `--out` is resolved through the SAME double-
 *     containment `resolveInRoot` guard (lexical + realpath) BEFORE any write.
 *   T-06-16 (PII leak): exportEvidence refuses on incomplete redaction; the CLI
 *     maps that to exit 1 with an actionable reason and writes NOTHING.
 */

import { mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";

import { exportEvidence } from "./export.js";
import { toJsonl } from "./audit-trail.js";
import { RegimeSchema, type Regime } from "./schema.js";
import type { RedactionConfig } from "./redaction-gate.js";
import type { AuditSource } from "./index.js";

/** Parsed + validated CLI arguments. */
export interface ComplianceExportArgs {
  readonly regime: Regime;
  readonly agentId: string;
  readonly since: string;
  readonly until: string;
  readonly out: string;
  readonly secret: string;
  /** Optional redaction config; defaults to drop-both (safe default). */
  readonly redactionConfig?: RedactionConfig;
}

/** The CLI outcome: exit code + printable lines + (on success) written paths. */
export interface ComplianceExportOutcome {
  readonly code: number;
  readonly lines: string[];
  readonly writtenPaths?: string[];
}

/**
 * Resolve a user-supplied output path against the project root and reject any
 * path that escapes it (T-06-18). Mirrors conformance/cli.ts `resolveInRoot`
 * (the cited source): lexical containment first (works for not-yet-existing
 * dirs), then realpath containment (defeats symlink escapes). Both root and
 * candidate are realpath'd before comparison so a symlinked root is fair.
 */
export function resolveInRoot(pathArg: string, projectRoot: string): string {
  const root = resolve(projectRoot);
  const abs = isAbsolute(pathArg) ? resolve(pathArg) : resolve(root, pathArg);

  // (1) Lexical containment — works even for not-yet-existing paths.
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`output path escapes project root: ${pathArg}`);
  }

  // (2) Real-path containment — defeats symlink escapes.
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    // Output dir does not exist yet: keep the lexical absolute path. The lexical
    // check above already proved it is inside the root.
    return abs;
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = root;
  }
  const realRel = relative(realRoot, real);
  if (realRel === "" || realRel.startsWith("..") || isAbsolute(realRel)) {
    throw new Error(`output path escapes project root: ${pathArg}`);
  }
  return real;
}

/** Parse the value after `--flag` from argv. */
function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

/** Parse argv into validated args, or return an error message. */
export function parseArgs(
  argv: string[],
  secretFromEnv?: string,
): { args?: ComplianceExportArgs; error?: string } {
  const regimeRaw = flagValue(argv, "--regime");
  const agentId = flagValue(argv, "--agent");
  const since = flagValue(argv, "--since");
  const until = flagValue(argv, "--until");
  const out = flagValue(argv, "--out");
  const secret = flagValue(argv, "--secret") ?? secretFromEnv;

  const missing: string[] = [];
  if (!regimeRaw) missing.push("--regime");
  if (!agentId) missing.push("--agent");
  if (!since) missing.push("--since");
  if (!until) missing.push("--until");
  if (!out) missing.push("--out");
  if (missing.length > 0) {
    return { error: `missing required argument(s): ${missing.join(", ")}` };
  }
  if (!secret) {
    return { error: "missing HMAC secret: pass --secret <key> or set LUCID_AUDIT_SECRET" };
  }

  const regimeParsed = RegimeSchema.safeParse(regimeRaw);
  if (!regimeParsed.success) {
    return { error: `unsupported regime: ${regimeRaw} (expected eu-ai-act | colorado)` };
  }

  return {
    args: {
      regime: regimeParsed.data,
      agentId: agentId as string,
      since: since as string,
      until: until as string,
      out: out as string,
      secret,
    },
  };
}

/** A safe default redaction config: drop both opt-in content keys. */
const DEFAULT_REDACTION: RedactionConfig = {
  contentFields: { "gen_ai.input.messages": "drop", "gen_ai.tool.call.arguments": "drop" },
};

/**
 * Testable export core: resolves `--out` through the containment guard, runs the
 * export (which itself runs the redaction gate), and — only on success — writes
 * the evidence-package/ directory:
 *   - manifest.json      (regime, period, disclaimer, obligation coverage)
 *   - audit-trail.jsonl  (the hash-chained records, append-only)
 *   - change-manifests/  (subdir; populated only when change_manifest data exists)
 *
 * Returns exit 1 (writing NOTHING) on path escape or incomplete redaction.
 */
export async function runComplianceExport(
  args: ComplianceExportArgs,
  projectRoot: string,
  source: AuditSource,
): Promise<ComplianceExportOutcome> {
  // (1) Containment-guard the output dir BEFORE doing any work (T-06-18).
  let absOut: string;
  try {
    absOut = resolveInRoot(args.out, projectRoot);
  } catch (err) {
    return { code: 1, lines: [`error: ${(err as Error).message}`] };
  }

  // (2) Assemble the package (redaction gate runs inside exportEvidence).
  const outcome = await exportEvidence(source, {
    regime: args.regime,
    agentId: args.agentId,
    since: args.since,
    until: args.until,
    redactionConfig: args.redactionConfig ?? DEFAULT_REDACTION,
    secret: args.secret,
  });

  if (!outcome.ok) {
    // Refused (incomplete redaction) — write NOTHING (T-06-16).
    return { code: 1, lines: [`error: ${outcome.reason}`] };
  }

  // (3) Write the evidence-package/ directory.
  const pkgDir = join(absOut, "evidence-package");
  const changeDir = join(pkgDir, "change-manifests");
  const manifestPath = join(pkgDir, "manifest.json");
  const trailPath = join(pkgDir, "audit-trail.jsonl");

  // The obligation coverage lives in manifest.json alongside the regime/period
  // and the disclaimer — the auditor-facing summary.
  const manifest = {
    regime: outcome.package.regime,
    agent_id: outcome.package.agent_id,
    generated_at: outcome.package.generated_at,
    period: outcome.package.period,
    disclaimer: outcome.package.disclaimer,
    redaction_applied: outcome.package.redaction_applied,
    obligation_coverage: outcome.coverage,
    record_count: outcome.package.records.length,
  };

  try {
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    writeFileSync(trailPath, toJsonl(outcome.package.records), "utf8");
  } catch (err) {
    return { code: 1, lines: [`error: cannot write evidence package: ${(err as Error).message}`] };
  }

  // change-manifests/ is populated only when change_manifest data is present;
  // otherwise the subdir stays empty (honest absence, never fabricated).
  const manifestIds = new Set<string>();
  for (const r of outcome.package.records) {
    for (const id of r.change_manifest_ids) manifestIds.add(id);
  }
  const writtenChange: string[] = [];
  for (const id of manifestIds) {
    // We only have the id (Assumption A1: no @lucid/evolution import), so write a
    // reference stub linking the id to the records that cite it — never invent
    // the manifest body.
    const refPath = join(changeDir, `${id}.ref.json`);
    const citingRecords = outcome.package.records
      .filter((r) => r.change_manifest_ids.includes(id))
      .map((r) => r.record_id);
    try {
      writeFileSync(refPath, JSON.stringify({ change_manifest_id: id, cited_by: citingRecords }, null, 2), "utf8");
      writtenChange.push(refPath);
    } catch {
      // Non-fatal: the trail + manifest are the load-bearing artifacts.
    }
  }

  const lines = [
    `PASS: wrote evidence-package/ for regime ${outcome.package.regime}`,
    `  manifest.json (${outcome.coverage.partial ? "PARTIAL" : "FULL"} obligation coverage)`,
    `  audit-trail.jsonl (${outcome.package.records.length} hash-chained record(s))`,
    `  change-manifests/ (${writtenChange.length} reference(s))`,
  ];
  return { code: 0, lines, writtenPaths: [manifestPath, trailPath, ...writtenChange] };
}

/**
 * argv entrypoint. Lazily imports `@lucid/store` and wraps the live store in
 * `traceStoreAuditSource` — the SINGLE store-binding boundary (Assumption A1).
 * `@lucid/store` is an OPTIONAL wiring dependency, not part of the library
 * surface; the import is dynamic so importing `@lucid/compliance` as a library
 * never pulls in the store.
 */
export async function run(
  argv: string[] = process.argv.slice(2),
  projectRoot: string = process.cwd(),
): Promise<void> {
  const { args, error } = parseArgs(argv, process.env.LUCID_AUDIT_SECRET);
  if (error || !args) {
    console.error(`error: ${error}`);
    process.exitCode = 1;
    return;
  }

  // Lazy store binding — the one place @lucid/store is referenced. The specifier
  // is held in a variable so the static type resolver does not require
  // @lucid/store at compile time (it is an OPTIONAL wiring dependency).
  let source: AuditSource;
  try {
    const storeSpecifier = "@lucid/store";
    const storeMod: unknown = await import(storeSpecifier);
    const { traceStoreAuditSource } = await import("./source.js");
    // The concrete store factory is provided by @lucid/store; the exact symbol
    // is resolved at wire time. We accept any structural TraceQuerier.
    const factory = (storeMod as { openTraceStore?: (...a: unknown[]) => unknown }).openTraceStore;
    if (typeof factory !== "function") {
      throw new Error("@lucid/store does not export openTraceStore");
    }
    const store = factory(projectRoot);
    source = traceStoreAuditSource(store as never);
  } catch (err) {
    console.error(`error: cannot bind @lucid/store: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const outcome = await runComplianceExport(args, projectRoot, source);
  for (const line of outcome.lines) {
    if (outcome.code === 0) console.log(line);
    else console.error(line);
  }
  process.exitCode = outcome.code;
}

// Run when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  void run();
}
