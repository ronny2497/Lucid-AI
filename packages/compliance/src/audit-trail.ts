/**
 * Tamper-evident, append-only audit log — the hash-chain core (REQ-06, T-06-15).
 *
 * Each record carries `prev_hash` (the previous record's `integrity_hash`) and
 * `integrity_hash` = HMAC-SHA256(secret, canonical-JSON({ ...content, prev_hash })).
 * Because every hash folds in the previous one, editing or reordering ANY record
 * breaks the chain from that point forward — and `verifyChain` recomputes every
 * hash to detect it and names the first broken index.
 *
 * No external ledger / blockchain dependency (RESEARCH "Don't-Hand-Roll": hash
 * chaining over append-only JSONL with `node:crypto` is independently verifiable
 * and sufficient for Article 12). `node:crypto` is a Node built-in — no install.
 *
 * This module is the PURE chain logic over `EuAiActRecord`s. The on-disk form is
 * append-only JSONL (one record per line), which the exporter / CLI writes; this
 * file never touches the filesystem.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { EuAiActRecordSchema, type EuAiActRecord } from "./schema.js";
import type { AuditDraftRecord } from "./index.js";

/**
 * The genesis `prev_hash` — a documented constant 64 zero hex chars (the width
 * of a SHA-256 hex digest). The first record in any chain links to this so the
 * `prev_hash` field is always present and non-empty (the schema requires it).
 */
export const GENESIS_PREV_HASH = "0".repeat(64);

/**
 * Canonical JSON serialization with STABLE key ordering so the HMAC is
 * reproducible regardless of in-memory key insertion order. Keys are sorted
 * lexicographically at every object level; arrays preserve order (chain order is
 * meaningful). Only the record's content + the supplied `prev_hash` are hashed —
 * the `integrity_hash` field itself is never folded into its own input.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
  return `{${parts.join(",")}}`;
}

/**
 * Compute the integrity hash for a draft record under a given `prev_hash`. The
 * `prev_hash` is folded into the hashed content (so a record cannot be silently
 * relinked to a different predecessor without changing its hash). An existing
 * `integrity_hash` / `prev_hash` on the input is ignored — only the content
 * fields plus the supplied `prev_hash` are hashed.
 */
function computeIntegrityHash(record: AuditDraftRecord, prevHash: string, secret: string): string {
  // Defensive: never fold a record's own hash fields into its hash input, even
  // if a caller passed a value that structurally carries them.
  const { integrity_hash, prev_hash, ...content } = record as AuditDraftRecord &
    Partial<Pick<EuAiActRecord, "integrity_hash" | "prev_hash">>;
  void integrity_hash;
  void prev_hash;
  const payload = canonicalize({ ...content, prev_hash: prevHash });
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Append one draft record to the chain: stamp `prev_hash` (the previous record's
 * `integrity_hash`, or {@link GENESIS_PREV_HASH} for the first record) and
 * `integrity_hash` (HMAC-SHA256 over the canonicalized content + prev_hash).
 *
 * Returns a fully-formed {@link EuAiActRecord}. This is the ONLY place the chain
 * is closed — drafts arrive from the (untrusted) AuditSource without hash fields,
 * and the exporter stamps them here so the chain cannot be sourced upstream.
 */
export function appendAuditRecord(
  record: AuditDraftRecord,
  prevHash: string,
  secret: string,
): EuAiActRecord {
  const { integrity_hash: _ih, prev_hash: _ph, ...content } = record as AuditDraftRecord &
    Partial<Pick<EuAiActRecord, "integrity_hash" | "prev_hash">>;
  void _ih;
  void _ph;
  const integrity_hash = computeIntegrityHash(record, prevHash, secret);
  return { ...content, prev_hash: prevHash, integrity_hash };
}

/**
 * Hash-chain a whole sequence of draft records in order, linking each to the
 * previous record's `integrity_hash` (the first to {@link GENESIS_PREV_HASH}).
 */
export function chainRecords(
  drafts: readonly AuditDraftRecord[],
  secret: string,
): EuAiActRecord[] {
  const out: EuAiActRecord[] = [];
  let prev = GENESIS_PREV_HASH;
  for (const draft of drafts) {
    const stamped = appendAuditRecord(draft, prev, secret);
    out.push(stamped);
    prev = stamped.integrity_hash;
  }
  return out;
}

/** The verdict from {@link verifyChain}. */
export interface ChainVerification {
  /** True only when every record's hash + linkage recomputes exactly. */
  readonly valid: boolean;
  /**
   * The 0-based index of the FIRST record whose recomputed integrity_hash or
   * prev_hash linkage does not match. `null` when `valid` is true.
   */
  readonly firstBrokenIndex: number | null;
  /** A human-readable reason for the break (empty when valid). */
  readonly reason: string;
}

/** Constant-time hex-string compare (avoids leaking via timing on verify). */
function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return a === b;
  }
}

/**
 * Verify a hash-chained record sequence. Recomputes each record's
 * `integrity_hash` from its content + recorded `prev_hash`, and asserts that
 * each record's `prev_hash` equals the previous record's `integrity_hash` (the
 * first links to {@link GENESIS_PREV_HASH}). Any content edit, reorder, relink,
 * or out-of-band append is detected and the FIRST broken index is named.
 */
export function verifyChain(
  records: readonly EuAiActRecord[],
  secret: string,
): ChainVerification {
  let expectedPrev = GENESIS_PREV_HASH;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    // (1) Linkage: prev_hash must point at the previous record's integrity_hash.
    if (!hexEqual(rec.prev_hash, expectedPrev)) {
      return {
        valid: false,
        firstBrokenIndex: i,
        reason: `record ${i} prev_hash does not link to the previous record's integrity_hash`,
      };
    }
    // (2) Integrity: recomputed hash over content + recorded prev_hash must match.
    const recomputed = computeIntegrityHash(rec, rec.prev_hash, secret);
    if (!hexEqual(rec.integrity_hash, recomputed)) {
      return {
        valid: false,
        firstBrokenIndex: i,
        reason: `record ${i} integrity_hash does not match recomputed HMAC (content tampered)`,
      };
    }
    expectedPrev = rec.integrity_hash;
  }
  return { valid: true, firstBrokenIndex: null, reason: "" };
}

/**
 * Parse + verify a chain that has been serialized to append-only JSONL (one
 * record per line). Returns the parsed records on success or the chain
 * verification failure. Blank lines are ignored. A line that is not a valid
 * EuAiActRecord is reported as a break at that index.
 */
export function verifyChainJsonl(
  jsonl: string,
  secret: string,
): ChainVerification & { records?: EuAiActRecord[] } {
  const lines = jsonl.split("\n").filter((l) => l.trim().length > 0);
  const records: EuAiActRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      return { valid: false, firstBrokenIndex: i, reason: `line ${i} is not valid JSON` };
    }
    const result = EuAiActRecordSchema.safeParse(parsed);
    if (!result.success) {
      return {
        valid: false,
        firstBrokenIndex: i,
        reason: `line ${i} is not a valid EuAiActRecord`,
      };
    }
    records.push(result.data);
  }
  const verification = verifyChain(records, secret);
  return { ...verification, records };
}

/** Serialize a chained record sequence to append-only JSONL (one per line). */
export function toJsonl(records: readonly EuAiActRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + (records.length > 0 ? "\n" : "");
}
