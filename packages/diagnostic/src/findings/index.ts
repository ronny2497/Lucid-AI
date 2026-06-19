/**
 * @lucid/diagnostic — the findings engine (RESEARCH Pattern 4 + 5; REQ-04).
 *
 * `buildFindings` turns the raw `DetectorHit[]` (numerator side of every
 * principle), the per-principle `PrincipleScore[]` (the scorecard), and the 2×2
 * `Plot2x2` into a ranked, sequentially-named `Finding[]` — the actionable output
 * a developer reads and Phase 3 (`lucid evolve propose`) consumes.
 *
 * ## Ranking (Assumption A12 / RESEARCH Pattern 4)
 *
 * Findings sort by a FIXED leverage order over principles
 * (`feedback > context > plan_execute > one_at_a_time > codebase_docs`), then by
 * hit count descending within a principle. Ids `F1..Fn` are assigned per-run in the
 * sorted order — NEVER hardcoded in detectors (RESEARCH Anti-Pattern: non-sequential
 * finding ids). This is the Phase 2 heuristic default; learned ranking is Phase 5.
 *
 * ## Aggregation (RESEARCH Pattern 5)
 *
 * All hits from one detector roll up into a SINGLE finding. The flagship's many
 * per-call hits collapse into one finding whose evidence groups offenders by tool
 * name with counts (e.g. `db.write (2), api.post (1)`) rather than one finding per
 * event. Evidence/remediation carry only DERIVED counts + tool names — never raw
 * prompt or tool-argument content (threat T-02-09 / prohibition).
 *
 * ## Absence is signal (D-05)
 *
 * A principle whose score is `null` (no relevant events) produces an explicit
 * absence finding ("no <principle> events detected — absence is the finding"). It is
 * never silently dropped. For the feedback principle, an absent feedback column
 * (reported in `plot.emptyColumns`) reinforces — rather than duplicates — the
 * feedback finding: when there are real no-verify hits the flagship finding stands;
 * only a fully-empty feedback principle (null score, zero hits) yields the absence
 * finding.
 *
 * Pure: never mutates its inputs. Every returned `Finding` validates against
 * `FindingSchema`.
 */

import type { HscPrinciple } from "@lucid/hsc-schema";
import { GEN_AI_ATTR } from "@lucid/hsc-schema";
import type { DetectorHit, HarnessTrace } from "../types.js";
import { FindingSchema, type Finding, type PrincipleScore, type Plot2x2 } from "../schema.js";
import { viewTurns } from "../detectors/event-access.js";

/**
 * The fixed leverage order over principles (Assumption A12 / RESEARCH Pattern 4).
 * Findings are sorted by this order first, then by hit count descending within a
 * principle. Highest-leverage principle (feedback) ranks first.
 */
export const LEVERAGE_ORDER: readonly HscPrinciple[] = [
  "feedback",
  "context",
  "plan_execute",
  "one_at_a_time",
  "codebase_docs",
] as const;

/** Stable id of the synthesized feedback-absence finding (no feedback events at all). */
export const FEEDBACK_ABSENT_ID = "feedback.absent" as const;

/** Phase 3 entry point template (PRD §7): the forward action carried by every finding. */
function forwardActionFor(id: string): string {
  return `lucid evolve propose --finding ${id}`;
}

/** Severity is the underlying hits' leverage (RESEARCH: severity maps to leverage). */
type Severity = "high" | "med" | "low";
const SEVERITY_RANK: Record<Severity, number> = { high: 3, med: 2, low: 1 };

/**
 * Roll a detector's hits into one finding's evidence string, grouping offending
 * tool names with counts when the underlying events name tools (the flagship's
 * `db.write (2), api.post (1)` roll-up). Falls back to the first hit's evidence
 * when no tool names are derivable (e.g. context budget-pressure).
 */
function aggregateEvidence(
  hits: readonly DetectorHit[],
  toolNameByEvent: ReadonlyMap<string, string>,
): string {
  // Group by tool name across every event the hits cite.
  const countByTool = new Map<string, number>();
  for (const hit of hits) {
    for (const eventId of hit.eventIds) {
      const tool = toolNameByEvent.get(eventId);
      if (tool === undefined) continue;
      countByTool.set(tool, (countByTool.get(tool) ?? 0) + 1);
    }
  }
  if (countByTool.size > 0) {
    // Stable, deterministic order: count desc, then tool name asc.
    const grouped = [...countByTool.entries()]
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .map(([tool, count]) => `${tool} (${count})`)
      .join(", ");
    return grouped;
  }
  // No tool names — use the hits' own derived evidence (no raw content).
  return hits[0]?.evidence ?? "";
}

/** The dominant (highest) leverage across a detector's hits → the finding severity. */
function severityOf(hits: readonly DetectorHit[]): Severity {
  let best: Severity = "low";
  for (const hit of hits) {
    if (SEVERITY_RANK[hit.leverage] > SEVERITY_RANK[best]) best = hit.leverage;
  }
  return best;
}

/** Map each eventId to its tool name (derived once from the trace, for grouping). */
function toolNamesByEvent(trace: HarnessTrace): Map<string, string> {
  const map = new Map<string, string>();
  for (const turn of viewTurns(trace)) {
    for (const e of turn.events) {
      const tool = e.attr(GEN_AI_ATTR.toolName);
      if (typeof tool === "string") map.set(e.id, tool);
    }
  }
  return map;
}

/**
 * Build the ranked, sequentially-named findings for one diagnostic run.
 *
 * @param allHits every detector hit collected across the trace.
 * @param principleScores the per-principle scorecard (drives absence findings).
 * @param plot the 2×2 plot (its `emptyColumns` reinforce the feedback finding).
 * @param trace the structured trace (used to derive tool names for evidence grouping).
 * @returns findings sorted by `LEVERAGE_ORDER` then hit count desc, ids `F1..Fn`.
 */
export function buildFindings(
  allHits: readonly DetectorHit[],
  principleScores: readonly PrincipleScore[],
  plot: Plot2x2,
  trace: HarnessTrace,
): Finding[] {
  const toolNameByEvent = toolNamesByEvent(trace);

  // Group hits by detector id (one finding per detector — RESEARCH Pattern 5).
  const hitsByDetector = new Map<string, DetectorHit[]>();
  const orderByDetector: string[] = [];
  for (const hit of allHits) {
    let list = hitsByDetector.get(hit.detectorId);
    if (!list) {
      list = [];
      hitsByDetector.set(hit.detectorId, list);
      orderByDetector.push(hit.detectorId);
    }
    list.push(hit);
  }

  interface Draft {
    detectorId: string;
    principle: HscPrinciple;
    severity: Severity;
    evidence: string;
    remediation: string;
    eventIds: string[];
    hitCount: number;
  }

  const drafts: Draft[] = [];

  for (const detectorId of orderByDetector) {
    const hits = hitsByDetector.get(detectorId)!;
    const principle = hits[0]!.principle;
    const eventIds = hits.flatMap((h) => h.eventIds);
    drafts.push({
      detectorId,
      principle,
      severity: severityOf(hits),
      evidence: aggregateEvidence(hits, toolNameByEvent),
      remediation: hits[0]!.remediation,
      eventIds,
      hitCount: hits.length,
    });
  }

  // Absence is signal (D-05): any principle with score === null and no detector
  // hits surfaces as an explicit absence finding. The feedback principle's absence
  // is reinforced by an empty feedback column in the plot.
  const detectorsHitPrinciples = new Set(drafts.map((d) => d.principle));
  for (const ps of principleScores) {
    if (ps.score !== null) continue;
    if (detectorsHitPrinciples.has(ps.principle)) continue;
    const feedbackColumnEmpty =
      ps.principle === "feedback" && plot.emptyColumns.includes("feedback");
    const detectorId = ps.principle === "feedback" ? FEEDBACK_ABSENT_ID : `${ps.principle}.absent`;
    const columnNote =
      feedbackColumnEmpty ? " (the feedback column of the 2×2 is empty)" : "";
    drafts.push({
      detectorId,
      principle: ps.principle,
      severity: "high",
      evidence: `no ${ps.principle} events detected — absence is the finding${columnNote}`,
      remediation: `instrument ${ps.principle} events so this principle can be measured`,
      eventIds: [],
      hitCount: 0,
    });
  }

  // Rank: fixed leverage order over principles, then hit count desc within a principle.
  const leverageIndex = (p: HscPrinciple): number => {
    const i = LEVERAGE_ORDER.indexOf(p);
    return i === -1 ? LEVERAGE_ORDER.length : i;
  };
  drafts.sort((a, b) => {
    const byLeverage = leverageIndex(a.principle) - leverageIndex(b.principle);
    if (byLeverage !== 0) return byLeverage;
    return b.hitCount - a.hitCount;
  });

  // Assign sequential ids F1..Fn in sorted order; validate each against FindingSchema.
  return drafts.map((d, idx) => {
    const id = `F${idx + 1}`;
    return FindingSchema.parse({
      id,
      detectorId: d.detectorId,
      principle: d.principle,
      severity: d.severity,
      evidence: d.evidence,
      remediation: d.remediation,
      eventIds: d.eventIds,
      forwardAction: forwardActionFor(id),
    });
  });
}
