/**
 * @lucid/adapter-openai-agents — public surface (the THIRD community adapter).
 *
 * Authored ENTIRELY on the public `@lucid/adapter-sdk` + `@lucid/hsc-schema`
 * surface (no core-internal access) — the EC-1 proof that a third party can
 * author + certify an adapter unaided. It emits NO `verify.result` /
 * `feedback.check` (the OpenAI Agents SDK has neither), and declares that honest
 * absence on its manifest rather than synthesizing the events (D-05).
 */

export {
  adapter,
  buildManifest,
  projectStep,
  runScenario,
  HSC_VERSION,
  FRAMEWORK,
  HONEST_ABSENCES,
} from "./adapter.js";
export type {
  AgentsStepKind,
  AgentsRunStep,
  HscEventRecord,
  HscTrace,
  RunScenarioOptions,
} from "./adapter.js";
