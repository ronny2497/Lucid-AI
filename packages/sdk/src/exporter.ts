/**
 * OTLP/HTTP exporter configuration for @lucid/sdk.
 *
 * `configureExporter()` builds an `OTLPTraceExporter` pointed at the collector's
 * traces signal endpoint (`POST <endpoint>/v1/traces`, OTLP/HTTP spec),
 * defaulting to the local collector at `http://localhost:4318`. `initTracing()`
 * wires that exporter into a `NodeTracerProvider` via a `BatchSpanProcessor` and
 * registers it as the global provider so `harness.event` / `harness.start`
 * spans flow to the collector.
 */

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

/** Default local OTel collector OTLP/HTTP base endpoint. */
export const DEFAULT_ENDPOINT = "http://localhost:4318";

/** The OTLP/HTTP traces signal path appended to the base endpoint. */
const TRACES_PATH = "/v1/traces";

export interface ExporterOptions {
  /**
   * Collector OTLP/HTTP base endpoint (scheme + host + optional port). The
   * `/v1/traces` signal path is appended automatically; a trailing slash on the
   * endpoint is tolerated. Defaults to `http://localhost:4318`.
   */
  endpoint?: string;
  /** Extra OTLP/HTTP headers (e.g. auth) forwarded to the underlying exporter. */
  headers?: Record<string, string>;
}

/** Join a base endpoint with the traces signal path, normalizing slashes. */
function tracesUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}${TRACES_PATH}`;
}

/**
 * Build an `OTLPTraceExporter` targeting `<endpoint>/v1/traces`.
 *
 * @example
 *   configureExporter()                                  // http://localhost:4318/v1/traces
 *   configureExporter({ endpoint: "http://host:9999" })  // http://host:9999/v1/traces
 */
export type ConfiguredExporter = OTLPTraceExporter & { readonly url: string };

export function configureExporter(opts: ExporterOptions = {}): ConfiguredExporter {
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const url = tracesUrl(endpoint);
  const exporter = new OTLPTraceExporter({ url, headers: opts.headers });
  // The OTLP exporter keeps the resolved URL internal (no public accessor in
  // exporter-trace-otlp-http 0.219); surface it explicitly so callers/tests can
  // assert the configured target endpoint.
  Object.defineProperty(exporter, "url", { value: url, enumerable: true });
  return exporter as ConfiguredExporter;
}

export interface InitTracingOptions extends ExporterOptions {
  /** Pass a pre-built exporter instead of constructing one from `endpoint`. */
  exporter?: OTLPTraceExporter;
}

/**
 * Register a `NodeTracerProvider` (with a `BatchSpanProcessor` shipping to the
 * OTLP/HTTP exporter) as the global tracer provider. After this call,
 * `harness.event` / `harness.start` spans are batched and exported to the
 * collector. Returns the provider so the caller can `await provider.shutdown()`
 * on process exit to flush in-flight spans.
 */
export function initTracing(opts: InitTracingOptions = {}): NodeTracerProvider {
  const exporter = opts.exporter ?? configureExporter(opts);
  const provider = new NodeTracerProvider({
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  provider.register();
  return provider;
}
