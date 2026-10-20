/**
 * Multi-agent investigate workflow for taskType=investigate.
 *
 * The coordinator composes registered specialists and the planner:
 * data (live fab tools) -> procedure (knowledge search, when available)
 * -> planner (structured Action Plan). Gateway only loads this workflow
 * through the task-level Agent registry.
 */
import { promptCompressionEnabled } from "../compress";
import { detectReplyLanguage } from "../language";
import { RunTrace } from "../trace";
import type { StreamEvent } from "../types";
import { runPlanner, type PlannerOutcome } from "./planner";
import { getSpecialist } from "./specialists/registry";
import { gatherSpecialist } from "./specialists/runner";
import type { SpecialistRunContext } from "./specialists/types";
import type { AgentRunOptions } from "./types";

export async function* runInvestigateAgent(
  options: AgentRunOptions,
): AsyncGenerator<StreamEvent> {
  const span =
    options.span ??
    new RunTrace(crypto.randomUUID()).start("investigate", "agent");
  const language = detectReplyLanguage(options.userInput);
  const compress = promptCompressionEnabled();
  const coordinator = span.child("agent.coordinator", "agent", {
    metadata: { language, promptCompression: compress, workflow: "multi_agent" },
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

  // Data first: it owns short out-of-scope / identity replies. If it answers
  // directly, procedure and planner must not spend calls on the request.
  const data = await gatherSpecialist(
    getSpecialist("data"),
    specialistContext,
  );
  for (const event of data.events) yield event;

  if (options.signal.aborted) {
    coordinator.end({ status: "warning", statusMessage: "aborted" });
    return;
  }

  if (data.directReply) {
    coordinator.end({
      metadata: { outcome: "direct_reply", agents: ["data"] },
    });
    span.update({ metadata: { outcome: "direct_reply" } });
    yield { type: "delta", text: data.directReply };
    return;
  }

  const procedure = await gatherSpecialist(
    getSpecialist("procedure"),
    specialistContext,
  );
  for (const event of procedure.events) yield event;

  if (options.signal.aborted) {
    coordinator.end({ status: "warning", statusMessage: "aborted" });
    return;
  }

  const evidence = [...data.evidence, ...procedure.evidence];
  const agents = procedure.skipped
    ? ["data", "planner"]
    : ["data", "procedure", "planner"];
  coordinator.update({
    metadata: {
      toolPayload: {
        rawChars:
          data.payloadStats.rawChars + procedure.payloadStats.rawChars,
        sentChars:
          data.payloadStats.sentChars + procedure.payloadStats.sentChars,
      },
      agents,
    },
  });

  // IDs typed by the user (for example a batch that does not exist) are quoted,
  // not invented by the model, so the original input belongs in the evidence.
  const sources = [options.userInput, ...evidence].join("\n");
  const outcome: PlannerOutcome = yield* runPlanner({
    parentSpan: coordinator,
    userInput: options.userInput,
    toolTranscripts: [data.toolMessages, procedure.toolMessages],
    sources,
    language,
    compress,
    execution: specialistContext.execution,
    planModel: options.planModel,
    escalationModel: options.escalationModel,
  });

  if (outcome === "aborted") {
    coordinator.end({ status: "warning", statusMessage: "aborted" });
    return;
  }

  coordinator.end({ metadata: { outcome, agents } });
  span.update({ metadata: { outcome } });
}
