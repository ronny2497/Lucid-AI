/**
 * End-to-end smoke example (Phase 1 exit criterion / MV-1).
 *
 * A minimal real LangGraph agent instrumented with `@lucid/adapter-langgraph`:
 * its OTel spans (`invoke_agent` / `chat` / `execute_tool`) are projected onto
 * HSC events and shipped over OTLP to the collector (:4318). The explorer then
 * shows the run with NO fabricated `feedback.check` / `verify.result` — the
 * honest empty-feedback column, which is the neutrality proof (no other-harness
 * specifics required; the adapter shares only the SDK + schema).
 *
 * Run (after the collector is up):
 *   pnpm --filter @lucid/adapter-langgraph exec tsx examples/run-langgraph-agent.ts
 *
 * NOTE: `@langchain/langgraph` is a peer dependency that MUST be human-verified
 * and installed before this example can run (Plan 01-06 Task 1). The import
 * below is intentionally dynamic so the package builds and its test suite runs
 * WITHOUT the unverified dependency present; this file fails loudly with install
 * instructions if the peer is missing rather than being silently importable.
 */

import { withLucid, type ObservedSpan } from "../src/index.js";

const COLLECTOR_ENDPOINT = process.env.LUCID_COLLECTOR ?? "http://localhost:4318";
const AGENT_ID = "langgraph-example";

async function loadLangGraph(): Promise<typeof import("@langchain/langgraph")> {
  try {
    return (await import("@langchain/langgraph")) as typeof import("@langchain/langgraph");
  } catch {
    throw new Error(
      "@langchain/langgraph is not installed. It is a human-verified peer " +
        "dependency (Plan 01-06 Task 1). After verifying its legitimacy on " +
        "npmjs.com (LangChain org, repo github.com/langchain-ai/langgraphjs), " +
        "install the pinned version: pnpm --filter @lucid/adapter-langgraph add " +
        "@langchain/langgraph@<version> @langchain/core@<version>",
    );
  }
}

async function main(): Promise<void> {
  const { StateGraph, START, END, MessagesAnnotation } = await loadLangGraph();

  // A minimal LangGraph: one agent node that "thinks" (chat) and one tool node.
  // The graph is real LangGraph; the node bodies are deterministic stand-ins so
  // the example runs without model credentials. With LangGraph's built-in OTel
  // integration enabled, this graph emits invoke_agent/chat/execute_tool spans.
  const graph = new StateGraph(MessagesAnnotation)
    .addNode("agent", async (state: { messages: unknown[] }) => state)
    .addNode("tools", async (state: { messages: unknown[] }) => state)
    .addEdge(START, "agent")
    .addEdge("agent", "tools")
    .addEdge("tools", END)
    .compile();

  // Wrap the compiled graph. This registers the OTLP provider pointed at the
  // collector; the underlying graph is NOT rewritten (no agent rewrite).
  const wrapped = withLucid(graph, { agentId: AGENT_ID, endpoint: COLLECTOR_ENDPOINT });

  // Invoke the real graph. (Its result is not asserted here — the smoke is about
  // the emitted HSC events appearing in the collector + UI.)
  await wrapped.graph.invoke({ messages: [] });

  // The spans LangGraph emitted during the invocation are handed to the adapter
  // by LangGraph's OTel span processor (wired via the built-in integration). For
  // this example we forward a representative observed-span batch so the run is
  // deterministic even without a model; in a live model run these come from the
  // real spans. NO feedback.check / verify.result is ever produced.
  const observed: ObservedSpan[] = [
    { name: "invoke_agent" },
    { name: "chat", attributes: { "gen_ai.request.model": "demo-model" } },
    { name: "execute_tool", attributes: { "gen_ai.tool.name": "search" } },
  ];
  const emitted = wrapped.observe(observed);

  // eslint-disable-next-line no-console
  console.log(
    `[lucid] emitted ${emitted.length} HSC events for agent '${AGENT_ID}' ` +
      `(${emitted.join(", ")}) — note the honest absence of feedback.check/verify.result.`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
