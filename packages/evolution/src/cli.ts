/**
 * @lucid/evolution — the testable `lucid evolve` command surface (plan 03-03, Task 2).
 *
 * Mirrors the `@lucid/collector` CLI pattern: command bodies are plain async
 * functions over an injected `CliIO` sink, a `ProposalStore`, and (for propose) an
 * HSC emit sink. They unit-test without a process or an argv parser; `commander`
 * is wired ONLY in the collector's `run()` (which lazily imports these functions).
 *
 * THREE COMMANDS (RESEARCH Pattern 4 — HITL review surface):
 *   - propose --finding <id> --from <diagnostic.json>  → render + emit + persist
 *   - review  <id> --accept | --reject [--note]        → status-only transition
 *   - list    [--agent] [--status]                     → filtered proposal list
 *
 * THE L0 BOUNDARY (a tested security property): NONE of these write to any harness
 * config/prompt/skill/context file. The only side effects are (a) the `ProposalStore`
 * (a JSON index), and (b) the `evolve.propose` HSC audit event. `--accept` sets
 * `status: "accepted"` and applies NOTHING; `"applied"` is unreachable (throws in
 * `updateManifestStatus`). Every render carries the explicit advisory line so a
 * human never mistakes an accept for an apply (anti over-trust, T-03-09).
 *
 * INPUT (the 02-04 reconciliation): `propose` needs a `DiagnosticResult` to operate
 * on. Phase 2 does NOT persist one (02-04 computes it on demand). So the testable
 * default is `--from <diagnostic.json>`: a developer-supplied DiagnosticResult JSON
 * file, parsed against `DiagnosticResultSchema` at the trust boundary (T-03-04).
 * The diagnose-integrated path (re-running `diagnose()` over a stored trace) is
 * documented for when 02-04's `diagnose` is wired into the CLI.
 */

import { readFileSync } from "node:fs";

import { DiagnosticResultSchema } from "@lucid/diagnostic";

import type { ChangeManifest } from "./schema.js";
import type { ProposalStore } from "./proposal-store.js";
import { propose } from "./propose.js";
import { updateManifestStatus, type ReviewStatus } from "./review.js";
import { emitEvolvePropose, type EvolveProposeRecord } from "./hsc-emit.js";

/** A minimal output sink so tests can capture stdout/stderr (mirrors collector CliIO). */
export interface CliIO {
  out: (line: string) => void;
  err: (line: string) => void;
}

/** The explicit anti-over-trust statement appended to every manifest render (T-03-09). */
export const ADVISORY_LINE = "# advisory only — nothing has been applied";

/** Args for `proposeCommand`. `agent` is optional context; `finding`+`from` are required. */
export interface ProposeArgs {
  /** The finding id to propose for, e.g. "F1". */
  finding: string;
  /** Path to a DiagnosticResult JSON file (the --from source). */
  from: string;
  /** Optional agent id (advisory; the manifest target comes from the diagnostic). */
  agent?: string;
}

/** Args for `reviewCommand`. Exactly one of `accept`/`reject` is expected. */
export interface ReviewArgs {
  accept?: boolean;
  reject?: boolean;
  note?: string;
}

/** Args for `listCommand`. Both filters are optional (AND-combined). */
export interface ListArgs {
  agent?: string;
  status?: ChangeManifest["status"];
}

/**
 * Render a `change_manifest` as a human-review YAML-like block. Display only — the
 * canonical storage format is JSON (RESEARCH "Don't Hand-Roll": no yaml dependency).
 * ALWAYS ends with the explicit advisory line (T-03-09).
 */
export function renderManifestYaml(manifest: ChangeManifest): string {
  const lines: string[] = [];
  lines.push(`# change_manifest ${manifest.id}`);
  lines.push(`target: ${manifest.target}`);
  lines.push(`change: ${manifest.change}`);
  lines.push(`detail: ${manifest.detail}`);
  lines.push(`rationale: ${manifest.rationale}`);
  lines.push(`evidence_ref: ${manifest.evidence_ref}`);
  lines.push("expected_effect:");
  for (const [principle, delta] of Object.entries(manifest.expected_effect)) {
    if (delta === null || delta === undefined) continue;
    const signed = delta > 0 ? `+${delta}` : `${delta}`;
    lines.push(`  ${principle}: ${signed}`);
  }
  lines.push(`status: ${manifest.status}`);
  lines.push(`estimator: ${manifest.estimator}`);
  if (manifest.review_note !== undefined) {
    lines.push(`review_note: ${manifest.review_note}`);
  }
  lines.push(`generated_at: ${manifest.generated_at}`);
  lines.push(ADVISORY_LINE);
  return lines.join("\n");
}

/** Load + validate a DiagnosticResult from a --from JSON path (trust boundary, T-03-04). */
function loadDiagnostic(path: string) {
  const raw = readFileSync(path, "utf8");
  return DiagnosticResultSchema.parse(JSON.parse(raw));
}

/**
 * `lucid evolve propose --finding <id> --from <diagnostic.json>`.
 *
 * Loads the DiagnosticResult, finds the named finding, calls `propose()`, renders
 * the manifest as YAML (WITH the advisory line) to `io.out`, emits the
 * `evolve.propose` HSC event via the sink, and persists via the store. Returns 0.
 *
 * W4 (not-found path — mirrors reviewCommand's unknown-id handling): when the
 * `--finding` id is absent from the supplied diagnostic, prints an error to
 * `io.err` and returns exit code 1 — applies/persists/emits NOTHING.
 */
export async function proposeCommand(
  io: CliIO,
  store: ProposalStore,
  sink: (record: EvolveProposeRecord) => void,
  args: ProposeArgs,
): Promise<number> {
  const diagnostic = loadDiagnostic(args.from);
  const finding = diagnostic.findings.find((f) => f.id === args.finding);
  if (finding === undefined) {
    io.err(`finding not found: ${args.finding} (in diagnostic ${diagnostic.traceId})`);
    return 1;
  }

  const manifest = propose(finding, diagnostic);
  io.out(renderManifestYaml(manifest));
  emitEvolvePropose(manifest, sink);
  await store.saveProposal(manifest);
  return 0;
}

/**
 * `lucid evolve review <id> --accept | --reject [--note]`.
 *
 * Loads the manifest, records the decision via `updateManifestStatus` (status only),
 * and persists. Returns 1 (and an error) when the id is unknown. Writes NO harness
 * file; `"applied"` is unreachable (updateManifestStatus throws on it).
 */
export async function reviewCommand(
  io: CliIO,
  store: ProposalStore,
  id: string,
  args: ReviewArgs,
): Promise<number> {
  const manifest = await store.getProposal(id);
  if (manifest === null) {
    io.err(`proposal not found: ${id}`);
    return 1;
  }
  if (!args.accept && !args.reject) {
    io.err("review requires --accept or --reject");
    return 1;
  }

  const status: ReviewStatus = args.accept ? "accepted" : "rejected";
  const reviewed = updateManifestStatus(manifest, status, args.note);
  await store.saveProposal(reviewed);
  io.out(`${reviewed.id}  status=${reviewed.status}`);
  io.out(ADVISORY_LINE);
  return 0;
}

/**
 * `lucid evolve list [--agent <id>] [--status <status>]`.
 *
 * Prints a one-line summary per matching proposal, or `(no proposals)` when empty.
 * Read-only — no write of any kind.
 */
export async function listCommand(
  io: CliIO,
  store: ProposalStore,
  args: ListArgs = {},
): Promise<number> {
  const proposals = await store.listProposals({
    agentId: args.agent,
    status: args.status,
  });
  if (proposals.length === 0) {
    io.out("(no proposals)");
    return 0;
  }
  for (const m of proposals) {
    const effect = Object.entries(m.expected_effect)
      .filter(([, d]) => d !== null && d !== undefined)
      .map(([p, d]) => `${p}${(d as number) > 0 ? "+" : ""}${d}`)
      .join(",");
    io.out(
      `${m.id}  target=${m.target}  change=${m.change}  status=${m.status}  expect=${effect || "?"}`,
    );
  }
  return 0;
}
