/**
 * @lucid/conformance — Layer 1: OTel-envelope validity (`validateOtelEnvelope`).
 *
 * Layer 1 validates the OTLP/JSON on-disk envelope
 * (`resourceSpans[] > scopeSpans[] > spans[] > attributes[]` of `{key, value}`)
 * and the OTel-level attribute rules from `docs/standard/otel-mapping.md`:
 *
 *   (a) gen_ai.system present        — deprecated; superseded by
 *                                      gen_ai.provider.name (tag "gen-ai-system-present").
 *   (b) harness.* under gen_ai.*     — the two-namespace rule: a harness concept
 *                                      emitted under the gen_ai.* namespace, or a
 *                                      gen_ai concept emitted under harness.* — the
 *                                      two namespaces are strictly separate
 *                                      (tag "harness-under-gen-ai").
 *   (c) gen_ai.operation.name        — only the pinned OTel set
 *                                      {execute_tool, invoke_agent, chat} is
 *                                      permitted (tag "wrong-operation-name").
 *
 * Each rule reads an INDIVIDUAL attribute (or the structural nesting) in
 * isolation. Following the absence-is-signal prohibition (RESEARCH Pitfall 1,
 * spec §4), this layer NEVER reasons about whether some event type is PRESENT or
 * ABSENT — an honest trace that omits a verification step is not a Layer 1
 * concern. There is intentionally no cross-event presence rule here.
 *
 * Like validate.ts, this is a collect-everything pass (it does not short-circuit
 * on the first error) and it NEVER mutates its input.
 *
 * The namespace prefixes are DERIVED from the @lucid/hsc-schema attribute maps
 * (HARNESS_ATTR / GEN_AI_ATTR) rather than hardcoded literals, so a namespace
 * rename in the schema package flows through here automatically.
 */

import { HARNESS_ATTR, GEN_AI_ATTR } from "@lucid/hsc-schema";

import type { ErrorEntry } from "./report.js";

/** Result of validating the OTLP envelope: a verdict plus collected errors. */
export interface OtelEnvelopeResult {
  valid: boolean;
  errors: ErrorEntry[];
}

/**
 * The pinned OTel `gen_ai.operation.name` value set (otel-mapping.md §"OTel span
 * operations used" / transport-profile.md). HSC v0 reuses EXACTLY these and
 * invents no new operation names. Derived as a frozen set so a stray typo in a
 * trace (`context_load`, `plan_emit`, …) is flagged.
 */
export const PINNED_OPERATION_NAMES: ReadonlySet<string> = new Set<string>([
  "execute_tool",
  "invoke_agent",
  "chat",
]);

/**
 * Derive the two namespace prefixes from the attribute maps so we never hardcode
 * the literal "harness." / "gen_ai." strings (key_links: derive from the maps).
 * Every value in HARNESS_ATTR begins with `harness.`; every value in GEN_AI_ATTR
 * begins with `gen_ai.`. Take the common prefix up to and including the first dot.
 */
function prefixOf(path: string): string {
  const dot = path.indexOf(".");
  return dot === -1 ? path : path.slice(0, dot + 1);
}

const HARNESS_PREFIX = prefixOf(Object.values(HARNESS_ATTR)[0]); // "harness."
const GEN_AI_PREFIX = prefixOf(Object.values(GEN_AI_ATTR)[0]); // "gen_ai."

/** The full set of canonical harness.* concept paths (for the namespace rule). */
const HARNESS_PATHS: ReadonlySet<string> = new Set<string>(Object.values(HARNESS_ATTR));
/** The full set of canonical gen_ai.* concept paths (for the mirror rule). */
const GEN_AI_PATHS: ReadonlySet<string> = new Set<string>(Object.values(GEN_AI_ATTR));
/** The deprecated gen_ai attribute (superseded by gen_ai.provider.name). */
const GEN_AI_SYSTEM = "gen_ai.system";

function err(
  code: string,
  message: string,
  path: string,
  severity: "error" | "warn" = "error",
): ErrorEntry {
  return { code, message, path, layer: "otelValidity", severity };
}

/**
 * Is the value an OTLP/JSON envelope (has a `resourceSpans` array)? The suite
 * uses this to decide whether to run Layer 1 as a hard check (OTLP shape) or to
 * report a single informational "not-otlp" note (turns/events shape).
 */
export function isOtlpShape(trace: unknown): boolean {
  return (
    typeof trace === "object" &&
    trace !== null &&
    Array.isArray((trace as { resourceSpans?: unknown }).resourceSpans)
  );
}

/**
 * Validate an unknown value as an OTLP/JSON trace envelope.
 *
 * Walks resourceSpans[] > scopeSpans[] > spans[] > attributes[]. Missing
 * structural levels produce a path-bearing "otel-envelope" error. Each span
 * attribute is checked against the three OTel-level rules. The input is never
 * mutated.
 */
export function validateOtelEnvelope(trace: unknown): OtelEnvelopeResult {
  const errors: ErrorEntry[] = [];

  if (typeof trace !== "object" || trace === null) {
    errors.push(err("otel-envelope", "trace is not an object", "/"));
    return { valid: false, errors };
  }

  const resourceSpans = (trace as { resourceSpans?: unknown }).resourceSpans;
  if (!Array.isArray(resourceSpans)) {
    errors.push(
      err("otel-envelope", "missing resourceSpans[] array", "/resourceSpans"),
    );
    return { valid: false, errors };
  }

  resourceSpans.forEach((rs, rsIdx) => {
    const rsPath = `/resourceSpans/${rsIdx}`;
    const scopeSpans = (rs as { scopeSpans?: unknown })?.scopeSpans;
    if (!Array.isArray(scopeSpans)) {
      errors.push(
        err("otel-envelope", "missing scopeSpans[] array", `${rsPath}/scopeSpans`),
      );
      return;
    }
    scopeSpans.forEach((ss, ssIdx) => {
      const ssPath = `${rsPath}/scopeSpans/${ssIdx}`;
      const spans = (ss as { spans?: unknown })?.spans;
      if (!Array.isArray(spans)) {
        errors.push(
          err("otel-envelope", "missing spans[] array", `${ssPath}/spans`),
        );
        return;
      }
      spans.forEach((span, spanIdx) => {
        const spanPath = `${ssPath}/spans/${spanIdx}`;
        const attributes = (span as { attributes?: unknown })?.attributes;
        if (attributes !== undefined && !Array.isArray(attributes)) {
          errors.push(
            err(
              "otel-envelope",
              "span.attributes must be an array of {key,value}",
              `${spanPath}/attributes`,
            ),
          );
          return;
        }
        if (!Array.isArray(attributes)) {
          return; // a span with no attributes is structurally fine for Layer 1
        }
        attributes.forEach((attr, attrIdx) => {
          const attrPath = `${spanPath}/attributes/${attrIdx}`;
          const key = (attr as { key?: unknown })?.key;
          if (typeof key !== "string") {
            errors.push(
              err("otel-envelope", "attribute is missing a string key", attrPath),
            );
            return;
          }

          // (a) gen_ai.system present (deprecated → gen_ai.provider.name).
          if (key === GEN_AI_SYSTEM) {
            errors.push(
              err(
                "gen-ai-system-present",
                `attribute "${GEN_AI_SYSTEM}" is deprecated; use "${GEN_AI_ATTR.providerName}" (otel-mapping.md anti-patterns)`,
                `${attrPath}/${key}`,
              ),
            );
          }

          // (b) two-namespace rule: a harness concept under gen_ai.*, or a
          //     gen_ai concept under harness.*. We detect the documented
          //     anti-pattern by checking whether a known harness.* concept name
          //     was re-rooted under the gen_ai.* prefix (and vice versa).
          if (key.startsWith(GEN_AI_PREFIX)) {
            // Strip the gen_ai. prefix and re-root under harness.; if that names
            // a real harness concept, the attribute was mis-namespaced.
            const reRooted = HARNESS_PREFIX + key.slice(GEN_AI_PREFIX.length);
            if (HARNESS_PATHS.has(reRooted)) {
              errors.push(
                err(
                  "harness-under-gen-ai",
                  `harness concept "${reRooted}" was placed under the ${GEN_AI_PREFIX}* namespace as "${key}"; the two namespaces are strictly separate (otel-mapping.md)`,
                  `${attrPath}/${key}`,
                ),
              );
            }
          } else if (key.startsWith(HARNESS_PREFIX)) {
            // A gen_ai concept re-rooted under harness.* is the mirror violation.
            const reRooted = GEN_AI_PREFIX + key.slice(HARNESS_PREFIX.length);
            if (GEN_AI_PATHS.has(reRooted)) {
              errors.push(
                err(
                  "harness-under-gen-ai",
                  `gen_ai concept "${reRooted}" was placed under the ${HARNESS_PREFIX}* namespace as "${key}"; the two namespaces are strictly separate (otel-mapping.md)`,
                  `${attrPath}/${key}`,
                ),
              );
            }
          }

          // (c) gen_ai.operation.name must be in the pinned set.
          if (key === GEN_AI_ATTR.operationName) {
            const opValue = stringValueOf((attr as { value?: unknown }).value);
            if (opValue !== undefined && !PINNED_OPERATION_NAMES.has(opValue)) {
              errors.push(
                err(
                  "wrong-operation-name",
                  `${GEN_AI_ATTR.operationName} = ${JSON.stringify(
                    opValue,
                  )} is not in the pinned OTel set {execute_tool, invoke_agent, chat} (otel-mapping.md)`,
                  `${attrPath}/${key}`,
                ),
              );
            }
          }
        });
      });
    });
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Extract the string value from an OTLP/JSON attribute value object
 * (`{ stringValue: "…" }`). Returns undefined for non-string OTLP values (int,
 * bool, array) since the operation.name rule only applies to string values.
 */
function stringValueOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const sv = (value as { stringValue?: unknown }).stringValue;
  return typeof sv === "string" ? sv : undefined;
}
