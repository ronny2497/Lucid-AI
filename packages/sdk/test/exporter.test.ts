import { describe, expect, it } from "vitest";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { configureExporter } from "../src/index.js";

/**
 * Wave-0 RED tests for the OTLP/HTTP exporter config. RED until src/exporter.ts
 * + src/index.ts exist.
 *
 * The collector's traces signal lives at POST /v1/traces (OTLP/HTTP spec). The
 * exporter URL must end with that path and default to http://localhost:4318.
 */

describe("configureExporter — OTLP/HTTP exporter targeting /v1/traces", () => {
  it("returns an OTLPTraceExporter instance", () => {
    const exporter = configureExporter();
    expect(exporter).toBeInstanceOf(OTLPTraceExporter);
  });

  it("defaults to http://localhost:4318 and targets /v1/traces", () => {
    const exporter = configureExporter();
    // The exporter exposes its resolved endpoint as `url`.
    expect((exporter as unknown as { url: string }).url).toBe(
      "http://localhost:4318/v1/traces",
    );
  });

  it("honors a custom endpoint, still targeting /v1/traces", () => {
    const exporter = configureExporter({ endpoint: "http://collector.internal:9999" });
    expect((exporter as unknown as { url: string }).url).toBe(
      "http://collector.internal:9999/v1/traces",
    );
  });

  it("strips a trailing slash from the supplied endpoint before joining", () => {
    const exporter = configureExporter({ endpoint: "http://localhost:4318/" });
    expect((exporter as unknown as { url: string }).url).toBe(
      "http://localhost:4318/v1/traces",
    );
  });
});
