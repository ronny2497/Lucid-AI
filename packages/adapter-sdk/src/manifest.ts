/**
 * @lucid/adapter-sdk — the AdapterManifest schema (REQ-07 authoring contract).
 *
 * An adapter manifest is the machine-readable declaration a third-party adapter
 * author ships alongside their integration: it states which HSC version the
 * adapter targets, which framework it bridges, which HSC event types it can
 * emit (`eventCoverage`), and — critically — which lifecycle hooks the framework
 * genuinely LACKS so the adapter explicitly omits them (`honestAbsences`).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HONEST ABSENCES (absence-is-signal at the manifest layer):
 *
 *   `honestAbsences` is how an adapter says "this framework has no verification
 *   hook, so I will NEVER emit verify.result — and that is correct, not a gap to
 *   paper over." The suite uses it to distinguish an honest omission from a
 *   coverage bug. An adapter MUST NOT list the same event type in both
 *   `eventCoverage` and `honestAbsences` — it cannot both cover and honestly
 *   omit the same event. The `.superRefine` rejects any such overlap.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Both `eventCoverage` and `honestAbsences` entries are refined to be members of
 * the canonical `EVENT_TYPES` tuple from `@lucid/hsc-schema` — adapters cannot
 * declare coverage of an event type that does not exist in HSC v0.
 *
 * `conformanceReport` is an optional URL linking to the machine-readable
 * ConformanceReport (the re-verifiable badge) the adapter passed.
 */

import { z } from "zod";
import { EVENT_TYPES } from "@lucid/hsc-schema";

/** Runtime membership set for the canonical HSC event-type enum. */
const EVENT_TYPE_SET: ReadonlySet<string> = new Set<string>(
  EVENT_TYPES as readonly string[],
);

/** A string refined to be a member of the canonical HSC EVENT_TYPES set. */
const hscEventType = z.string().refine((v) => EVENT_TYPE_SET.has(v), {
  message: "must be a member of the canonical HSC EVENT_TYPES set (@lucid/hsc-schema)",
});

/**
 * The adapter manifest (`targets HSC vX`). `.strict()` rejects unknown keys; the
 * `.superRefine` rejects any overlap between declared coverage and honest
 * absences.
 */
export const AdapterManifestSchema = z
  .object({
    /** Adapter package name, non-empty. */
    name: z.string().min(1),
    /** Adapter version, non-empty. */
    version: z.string().min(1),
    /** The HSC spec version this adapter targets (e.g. "v0"). */
    hscVersion: z.string().min(1),
    /** The framework + version this adapter bridges (e.g. "langgraph@0.2"). */
    framework: z.string().min(1),
    /** HSC event types this adapter can emit (each a member of EVENT_TYPES). */
    eventCoverage: z.array(hscEventType),
    /** Event types the framework genuinely lacks → the adapter explicitly omits. */
    honestAbsences: z.array(hscEventType),
    /** Optional link to the machine-readable ConformanceReport (the badge). */
    conformanceReport: z.string().url().optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const covered = new Set(manifest.eventCoverage);
    for (const absent of manifest.honestAbsences) {
      if (covered.has(absent)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["honestAbsences"],
          message: `"${absent}" appears in both eventCoverage and honestAbsences — an adapter cannot both cover and honestly omit the same event`,
        });
      }
    }
  });
export type AdapterManifest = z.infer<typeof AdapterManifestSchema>;
