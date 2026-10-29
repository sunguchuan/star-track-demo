/**
 * LangGraph orchestration for the investigate workflow.
 *
 * Nodes still call the existing specialist runner and planner; this module only
 * replaces the hand-written Coordinator control flow (order, early exit, skip).
 * Tools, RAG, guardrails and Action Plan generation stay outside LangGraph.
 */
import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import type { StreamEvent } from "../types";
import { runPlanner, type PlannerOutcome } from "./planner";
import { getSpecialist } from "./specialists/registry";
import { gatherSpecialist } from "./specialists/runner";
import type { SpecialistRunContext } from "./specialists/types";
import type { AgentRunOptions } from "./types";

const InvestigateState = new StateSchema({
  userInput: z.string(),
  aborted: z.boolean().default(false),
  directReply: z.string().default(""),
  dataEvidence: z.array(z.string()).default(() => []),
  procedureEvidence: z.array(z.string()).default(() => []),
  dataToolMessages: z.array(z.any()).default(() => []),
  procedureToolMessages: z.array(z.any()).default(() => []),
  dataPayloadRaw: z.number().default(0),
  dataPayloadSent: z.number().default(0),
  procedurePayloadRaw: z.number().default(0),
  procedurePayloadSent: z.number().default(0),
  procedureSkipped: z.boolean().default(true),
  plannerOutcome: z
    .enum(["structured_plan", "text_fallback", "aborted"])
    .optional(),
  agents: z.array(z.string()).default(() => []),
});

export type InvestigateGraphState = typeof InvestigateState.State;

export type InvestigateGraphRuntime = {
  emit: (event: StreamEvent) => void;
  specialistContext: SpecialistRunContext;
  options: AgentRunOptions;
};

/** Build a compiled graph bound to this request's emit channel and spans. */
export function compileInvestigateGraph(runtime: InvestigateGraphRuntime) {
  const { emit, specialistContext, options } = runtime;
  const signal = options.signal;

  return new StateGraph(InvestigateState)
    .addNode("data", async () => {
      const data = await gatherSpecialist(
        getSpecialist("data"),
        specialistContext,
      );
      for (const event of data.events) emit(event);
      if (signal.aborted) {
        return { aborted: true, agents: ["data"] };
      }
      if (data.directReply) {
        emit({ type: "delta", text: data.directReply });
        return {
          directReply: data.directReply,
          dataEvidence: data.evidence,
          dataToolMessages: data.toolMessages,
          dataPayloadRaw: data.payloadStats.rawChars,
          dataPayloadSent: data.payloadStats.sentChars,
          agents: ["data"],
        };
      }
      return {
        dataEvidence: data.evidence,
        dataToolMessages: data.toolMessages,
        dataPayloadRaw: data.payloadStats.rawChars,
        dataPayloadSent: data.payloadStats.sentChars,
      };
    })
    .addNode("procedure", async (state) => {
      const procedure = await gatherSpecialist(
        getSpecialist("procedure"),
        specialistContext,
      );
      for (const event of procedure.events) emit(event);
      if (signal.aborted) {
        return {
          aborted: true,
          procedureSkipped: procedure.skipped,
          procedureEvidence: procedure.evidence,
          procedureToolMessages: procedure.toolMessages,
          procedurePayloadRaw: procedure.payloadStats.rawChars,
          procedurePayloadSent: procedure.payloadStats.sentChars,
          agents: procedure.skipped ? ["data"] : ["data", "procedure"],
        };
      }
      const agents = procedure.skipped
        ? ["data", "planner"]
        : ["data", "procedure", "planner"];
      specialistContext.parentSpan.update({
        metadata: {
          toolPayload: {
            rawChars: state.dataPayloadRaw + procedure.payloadStats.rawChars,
            sentChars:
              state.dataPayloadSent + procedure.payloadStats.sentChars,
          },
          agents,
        },
      });
      return {
        procedureSkipped: procedure.skipped,
        procedureEvidence: procedure.evidence,
        procedureToolMessages: procedure.toolMessages,
        procedurePayloadRaw: procedure.payloadStats.rawChars,
        procedurePayloadSent: procedure.payloadStats.sentChars,
        agents,
      };
    })
    .addNode("planner", async (state) => {
      const evidence = [...state.dataEvidence, ...state.procedureEvidence];
      // IDs typed by the user are quoted, not invented, so the original input
      // belongs in the grounding sources with the tool payloads.
      const sources = [options.userInput, ...evidence].join("\n");
      let outcome: PlannerOutcome = "aborted";
      const generator = runPlanner({
        parentSpan: specialistContext.parentSpan,
        userInput: options.userInput,
        toolTranscripts: [
          state.dataToolMessages,
          state.procedureToolMessages,
        ],
        sources,
        language: specialistContext.language,
        compress: specialistContext.compress,
        execution: specialistContext.execution,
        planModel: options.planModel,
        escalationModel: options.escalationModel,
      });
      while (true) {
        const next = await generator.next();
        if (next.done) {
          outcome = next.value;
          break;
        }
        emit(next.value);
      }
      if (outcome === "aborted" || signal.aborted) {
        return { aborted: true, plannerOutcome: "aborted" as const };
      }
      return { plannerOutcome: outcome };
    })
    .addEdge(START, "data")
    .addConditionalEdges("data", (state) => {
      if (state.aborted || state.directReply) return END;
      return "procedure";
    })
    .addConditionalEdges("procedure", (state) => {
      if (state.aborted) return END;
      return "planner";
    })
    .addEdge("planner", END)
    .compile();
}
