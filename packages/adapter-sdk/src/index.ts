/**
 * @lucid/adapter-sdk — public surface.
 *
 * Wave 0 (this plan) freezes the AdapterManifest authoring contract. The
 * declarative `defineAdapter()` surface and the emit-or-omit helpers (built on
 * @lucid/sdk) are added by 06-03 — intentionally NOT stubbed here so there is no
 * placeholder code masquerading as an implementation.
 */

export { AdapterManifestSchema, type AdapterManifest } from "./manifest.js";

// The no-fabrication gate (D-05) every adapter emission routes through.
export {
  emitOrOmit,
  PERMITTED_INFERENCE,
  PROHIBITED_INFERENCE,
  type EmitContext,
  type EmitResult,
  type OmitReason,
} from "./emit-or-omit.js";

// The declarative authoring surface over @lucid/sdk.
export {
  defineAdapter,
  HOOK_EVENT_TYPE,
  type Adapter,
  type AdapterSpec,
  type Hook,
  type HookContext,
  type HookName,
} from "./define-adapter.js";

// The `adapter init` scaffolder (emits a runnable adapter stub + manifest + fixture).
export {
  scaffoldAdapter,
  type ScaffoldOptions,
  type ScaffoldResult,
} from "./scaffold.js";
