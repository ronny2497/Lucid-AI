/**
 * @lucid/collector — public surface.
 *
 * Consumers (Plan 01-04 query/metrics routes, Plan 01-06 adapters, and tests)
 * import the Hono app factory and the ingestion building blocks from here.
 */

export { createCollectorApp, type CollectorOptions } from "./server.js";
export {
  createTracesHandler,
  DEFAULT_MAX_BODY_BYTES,
  type ReceiverOptions,
} from "./receiver.js";
export { extractSpans, OtlpJsonSpanSchema, OtlpEnvelopeError } from "./otlp.js";
export { validateHscSpans, type ValidationResult } from "./validator.js";
export { mountQueryRoutes, type RunListRow } from "./routes/index.js";
export { deriveBaseMetrics, percentile, type BaseMetrics } from "./metrics.js";
