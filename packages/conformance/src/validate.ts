/**
 * @lucid/conformance — validateTrace()
 *
 * Machine-checks an HSC trace against the v0 JSON Schema (compiled with AJV
 * 2020-12) PLUS one structural rule: every event in every turn must carry
 * `harness.event_type` (HARNESS_ATTR.eventType). Schema and structural errors
 * are collected together.
 *
 * Honest absence (D-05): this validator NEVER fabricates or auto-fills a
 * missing event (e.g. a `verify.result`) to make a trace pass. A
 * `tool.call{mutated_state:true}` with no following `verify.result` is a valid
 * trace — the absence is signal, and it is preserved as-is. The input object
 * is never mutated.
 */

import * as Ajv2020Module from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import {
  harnessTraceSchema,
  HARNESS_ATTR,
  EVENT_TYPES,
  EVENT_PRINCIPLE,
  EMITTER_SPECIFIED_Y,
  quadrantFor,
  type HscEventType,
} from "@lucid/hsc-schema";

// `ajv/dist/2020` and `ajv-formats` are CommonJS modules whose runtime value is
// the default export. Under NodeNext + esModuleInterop the namespace carries a
// `.default`; unwrap it (with a fallback for bundler interop) so the same
// source compiles under tsc AND runs under esbuild/vitest.
const Ajv2020 = ((Ajv2020Module as { default?: unknown }).default ??
  Ajv2020Module) as typeof import("ajv/dist/2020.js").default;
const addFormats = ((addFormatsModule as { default?: unknown }).default ??
  addFormatsModule) as typeof import("ajv-formats")["default"];

/** Result of validating a trace: a boolean verdict plus collected errors. */
export interface ValidationResult {
  valid: boolean;
  errors: unknown[];
}

// Compile the schema once at module load. strict + allErrors per RESEARCH
// "JSON Schema: Recommended Approach".
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validateSchema = ajv.compile(harnessTraceSchema as object);

/**
 * Structural pass: walk every event of every turn and assert it carries
 * `harness.event_type`. The JSON Schema also `require`s this field, but the
 * structural pass produces a stable, path-bearing error independent of schema
 * evolution and guards against a trace shape the schema cannot reach.
 */
function structuralErrors(trace: unknown): unknown[] {
  const errors: unknown[] = [];
  if (typeof trace !== "object" || trace === null) {
    return errors; // shape errors are reported by the schema pass
  }
  const turns = (trace as { turns?: unknown }).turns;
  if (!Array.isArray(turns)) {
    return errors;
  }
  turns.forEach((turn, turnIdx) => {
    const events = (turn as { events?: unknown })?.events;
    if (!Array.isArray(events)) {
      return;
    }
    events.forEach((event, eventIdx) => {
      const path = `/turns/${turnIdx}/events/${eventIdx}`;
      if (
        typeof event !== "object" ||
        event === null ||
        !(HARNESS_ATTR.eventType in (event as Record<string, unknown>))
      ) {
        errors.push({
          structural: true,
          instancePath: path,
          message: `event must carry ${HARNESS_ATTR.eventType}`,
          missing: HARNESS_ATTR.eventType,
        });
      }
    });
  });
  return errors;
}

const EVENT_TYPE_SET: ReadonlySet<string> = new Set<string>(EVENT_TYPES as readonly string[]);

/**
 * Predicate pass (spec §6 criterion #1 + #2): for every event, assert the
 * principle and quadrant tags match the canonical bindings in @lucid/hsc-schema
 * — NOT just enum membership (which the JSON Schema already covers). This is the
 * machine-checkable OQ-02 predicate plus the §2 event→principle binding.
 *
 * Rules, per event type:
 *   - principle: must equal EVENT_PRINCIPLE[event_type] (the §2 table). `error`
 *     is cross-cutting (§3.3) and carries no principle binding, so it is skipped.
 *   - quadrant.x: must equal quadrantFor(event_type).x for ALL types (absent key
 *     is treated as null — the spec uses null for untagged axes).
 *   - quadrant.y:
 *       * feedback.check (EMITTER_SPECIFIED_Y, §3.2.1): y is emitter-specified
 *         and REQUIRED — it must be present and non-null (computational or
 *         inferential, already enum-checked by the schema). A missing/null y is
 *         an error.
 *       * verify.result (§6.2): y MAY be overridden from the default
 *         computational to inferential, so either is accepted.
 *       * all other types: y must equal quadrantFor(event_type).y.
 *
 * Honest absence (D-05) is untouched: this pass NEVER fabricates events and
 * NEVER mutates the input — it only reads tags and collects errors.
 */
function predicateErrors(trace: unknown): unknown[] {
  const errors: unknown[] = [];
  if (typeof trace !== "object" || trace === null) {
    return errors;
  }
  const turns = (trace as { turns?: unknown }).turns;
  if (!Array.isArray(turns)) {
    return errors;
  }
  turns.forEach((turn, turnIdx) => {
    const events = (turn as { events?: unknown })?.events;
    if (!Array.isArray(events)) {
      return;
    }
    events.forEach((event, eventIdx) => {
      if (typeof event !== "object" || event === null) {
        return; // shape errors are reported by the schema/structural passes
      }
      const e = event as Record<string, unknown>;
      const et = e[HARNESS_ATTR.eventType];
      // Unknown / missing event types are caught by the schema + structural
      // passes; only run the predicate for the canonical EVENT_TYPES members.
      if (typeof et !== "string" || !EVENT_TYPE_SET.has(et)) {
        return;
      }
      const eventType = et as HscEventType;
      const path = `/turns/${turnIdx}/events/${eventIdx}`;

      // (a) principle binding (§2). `error` has no binding (§3.3) — skip.
      const expectedPrinciple = EVENT_PRINCIPLE[eventType];
      if (expectedPrinciple !== undefined) {
        const principle = e[HARNESS_ATTR.principle];
        if (principle !== expectedPrinciple) {
          errors.push({
            predicate: true,
            instancePath: `${path}/${HARNESS_ATTR.principle}`,
            message: `principle for ${eventType} must be ${JSON.stringify(
              expectedPrinciple,
            )}, got ${JSON.stringify(principle ?? null)}`,
          });
        }
      }

      // (b) quadrant.x — always table-derived (§3.2). Absent key == null.
      const { x: expectedX, y: expectedY } = quadrantFor(eventType);
      const actualX = HARNESS_ATTR.quadrantX in e ? e[HARNESS_ATTR.quadrantX] ?? null : null;
      if (actualX !== expectedX) {
        errors.push({
          predicate: true,
          instancePath: `${path}/${HARNESS_ATTR.quadrantX}`,
          message: `quadrant.x for ${eventType} must be ${JSON.stringify(
            expectedX,
          )}, got ${JSON.stringify(actualX)}`,
        });
      }

      // (c) quadrant.y — emitter-specified / override / table-derived.
      const actualY = HARNESS_ATTR.quadrantY in e ? e[HARNESS_ATTR.quadrantY] ?? null : null;
      if (EMITTER_SPECIFIED_Y.has(eventType)) {
        // §3.2.1: feedback.check.y is REQUIRED (must be set by the emitter).
        if (actualY == null) {
          errors.push({
            predicate: true,
            instancePath: `${path}/${HARNESS_ATTR.quadrantY}`,
            message: `quadrant.y for ${eventType} is emitter-specified and REQUIRED (§3.2.1); got null`,
          });
        }
        // A non-null value is already enum-restricted to {computational,
        // inferential} by the schema, so any non-null value is acceptable.
      } else if (eventType === "verify.result") {
        // §6.2: verify.result.y MAY be overridden computational -> inferential.
        if (actualY !== "computational" && actualY !== "inferential") {
          errors.push({
            predicate: true,
            instancePath: `${path}/${HARNESS_ATTR.quadrantY}`,
            message: `quadrant.y for verify.result must be "computational" or "inferential" (§6.2), got ${JSON.stringify(
              actualY,
            )}`,
          });
        }
      } else if (actualY !== expectedY) {
        errors.push({
          predicate: true,
          instancePath: `${path}/${HARNESS_ATTR.quadrantY}`,
          message: `quadrant.y for ${eventType} must be ${JSON.stringify(
            expectedY,
          )}, got ${JSON.stringify(actualY)}`,
        });
      }
    });
  });
  return errors;
}

/**
 * Validate an unknown value as an HSC v0 HarnessTrace.
 *
 * @param trace - untrusted, unparsed-into-JS trace object
 * @returns `{ valid, errors }` — `valid` is true only when the schema, the
 *          structural pass, AND the principle/quadrant predicate pass all
 *          produce no errors. The input is never mutated.
 */
export function validateTrace(trace: unknown): ValidationResult {
  const ok = validateSchema(trace);
  const schemaErrors = ok ? [] : [...(validateSchema.errors ?? [])];
  const structural = structuralErrors(trace);
  const predicate = predicateErrors(trace);
  const errors = [...schemaErrors, ...structural, ...predicate];
  return { valid: errors.length === 0, errors };
}
