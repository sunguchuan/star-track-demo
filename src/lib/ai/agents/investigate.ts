/**
 * Multi-agent investigate workflow for taskType=investigate.
 *
 * LangGraph owns the Coordinator control flow (data → procedure → planner,
 * with early exit on direct reply / abort). Specialist tool rounds and the
 * planner still run through the existing TypeScript modules so tools, RAG,
 * guardrails and Action Plan checks stay outside the framework.
 */
import { promptCompressionEnabled } from "../compress";
import { detectReplyLanguage } from "../language";
import { RunTrace } from "../trace";
import type { StreamEvent } from "../types";
import {
  compileInvestigateGraph,
  type InvestigateGraphState,
} from "./investigate-graph";
import type { SpecialistRunContext } from "./specialists/types";
import type { AgentRunOptions } from "./types";

/**
 * Bridge LangGraph node emits into an async generator without a lost-wakeup
 * race: a completion or event that arrives between "queue empty" and
 * "register waiter" must still resume the consumer.
 */
/** Exported for unit tests of the stream bridge race. */
export function createEventBridge() {
  const pending: StreamEvent[] = [];
  const waiters: Array<() => void> = [];
  const kick = () => {
    const resolvers = waiters.splice(0, waiters.length);
    for (const resolve of resolvers) resolve();
  };
  return {
    pending,
    emit(event: StreamEvent) {
      pending.push(event);
      kick();
    },
    kick,
    waitUntil(hasWork: () => boolean) {
      return new Promise<void>((resolve) => {
        if (hasWork()) {
          resolve();
          return;
        }
        waiters.push(resolve);
        // Close the race where kick() ran after hasWork() was false but before
        // this waiter was registered.
        if (hasWork()) {
          const index = waiters.indexOf(resolve);
          if (index >= 0) waiters.splice(index, 1);
          resolve();
        }
      });
    },
  };
}

export async function* runInvestigateAgent(
  options: AgentRunOptions,
): AsyncGenerator<StreamEvent> {
  const span =
    options.span ??
    new RunTrace(crypto.randomUUID()).start("investigate", "agent");
  const language = detectReplyLanguage(options.userInput);
  const compress = promptCompressionEnabled();
  const coordinator = span.child("agent.coordinator", "agent", {
    metadata: {
      language,
      promptCompression: compress,
      workflow: "langgraph",
      orchestration: "data→procedure→planner",
    },
  });
  const specialistContext: SpecialistRunContext = {
    parentSpan: coordinator,
    userInput: options.userInput,
    language,
    compress,
    execution: {
      target: options.target,
      model: options.model,
      signal: options.signal,
      onUsage: options.onUsage,
    },
  };

  const bridge = createEventBridge();
  const graph = compileInvestigateGraph({
    emit: bridge.emit,
    specialistContext,
    options,
  });

  type Settled =
    | { ok: true; state: InvestigateGraphState }
    | { ok: false; error: unknown };
  let settled: Settled | null = null;
  const running = graph
    .invoke({ userInput: options.userInput })
    .then(
      (state): Settled => ({ ok: true, state }),
      (error: unknown): Settled => ({ ok: false, error }),
    )
    .then((result) => {
      settled = result;
      bridge.kick();
      return result;
    });

  while (true) {
    while (bridge.pending.length > 0) {
      yield bridge.pending.shift()!;
    }
    if (settled != null) break;
    await bridge.waitUntil(
      () => settled != null || bridge.pending.length > 0,
    );
  }

  const result = await running;
  if (!result.ok) {
    coordinator.end({ status: "error", statusMessage: "langgraph_failed" });
    throw result.error;
  }

  const state = result.state;
  if (state.aborted) {
    coordinator.end({ status: "warning", statusMessage: "aborted" });
    return;
  }
  if (state.directReply) {
    coordinator.end({
      metadata: { outcome: "direct_reply", agents: state.agents },
    });
    span.update({ metadata: { outcome: "direct_reply" } });
    return;
  }

  const outcome = state.plannerOutcome ?? "aborted";
  if (outcome === "aborted") {
    coordinator.end({ status: "warning", statusMessage: "aborted" });
    return;
  }

  coordinator.end({ metadata: { outcome, agents: state.agents } });
  span.update({ metadata: { outcome } });
}
