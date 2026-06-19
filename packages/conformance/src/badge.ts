/**
 * @lucid/conformance — self-declared badge emission (`emitBadge`).
 *
 * The badge is the OUTWARD-FACING, machine-readable claim derived from a
 * ConformanceReport, following the OpenID Foundation self-certification model
 * (RESEARCH "Self-Certification"): there is NO registry authority. The badge
 * embeds the keys any third party needs to RE-VERIFY the claim by re-running the
 * offline suite — the HSC version, the suite version, and a reference to the
 * full report — so a badge can never assert more than its report substantiates.
 *
 * Repudiation resistance (T-06-06): a FAIL report yields a badge carrying
 * `verdict: "FAIL"`. emitBadge NEVER masks a failure and NEVER throws on a FAIL
 * report — the honest verdict is carried, not hidden.
 */

import type { ConformanceReport } from "./report.js";

/**
 * A self-declared, re-verifiable conformance badge. It is intentionally a strict
 * subset of the report's identifying fields plus a structural reference back to
 * the report (`reportRef`), so a reader can fetch and re-run the full report.
 */
export interface Badge {
  /** Marketing-facing standard label, e.g. "HSC v0". */
  readonly label: string;
  /** The HSC spec version the badge is keyed to. */
  readonly hscVersion: string;
  /** The conformance-suite version that produced the underlying report. */
  readonly suiteVersion: string;
  /** The carried verdict — "FAIL" is never masked. */
  readonly verdict: "PASS" | "FAIL";
  /** The adapter the badge is about. */
  readonly adapter: { readonly name: string; readonly hscVersion: string };
  /**
   * Declared event coverage, when the report carries it. Surfaced so adopters
   * can see coverage before trusting the badge (RESEARCH Pitfall 3); a low
   * coverage is a WARN in the report, never a masked claim here.
   */
  readonly eventCoverage?: readonly string[];
  /** A reference a verifier follows to fetch and re-run the full report. */
  readonly reportRef: {
    readonly hscVersion: string;
    readonly suiteVersion: string;
    readonly verdict: "PASS" | "FAIL";
    readonly generatedAt: string;
    readonly errorCount: number;
  };
}

export interface EmitBadgeOptions {
  /** Optional declared event coverage to surface on the badge. */
  eventCoverage?: readonly string[];
}

/**
 * Derive a self-declared badge from a ConformanceReport.
 *
 * The badge carries the report's verdict verbatim. On a FAIL report it returns a
 * badge with `verdict: "FAIL"` (it does not throw and does not pretend
 * conformance). The returned `reportRef` lets any party re-run the offline suite
 * and compare.
 */
export function emitBadge(
  report: ConformanceReport,
  opts: EmitBadgeOptions = {},
): Badge {
  return {
    label: `HSC ${report.hscVersion}`,
    hscVersion: report.hscVersion,
    suiteVersion: report.suiteVersion,
    verdict: report.verdict,
    adapter: { name: report.adapter.name, hscVersion: report.adapter.hscVersion },
    ...(opts.eventCoverage ? { eventCoverage: opts.eventCoverage } : {}),
    reportRef: {
      hscVersion: report.hscVersion,
      suiteVersion: report.suiteVersion,
      verdict: report.verdict,
      generatedAt: report.generatedAt,
      errorCount: report.errors.filter((e) => e.severity === "error").length,
    },
  };
}
