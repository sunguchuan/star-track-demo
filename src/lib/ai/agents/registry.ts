/**
 * Agent registry — Gateway resolves taskType → AgentDefinition and never
 * hard-codes a specific agent. See docs/ai-gateway.md §13.
 */
import type { AiTaskType } from "../types";
import type { AgentDefinition } from "./types";

const agents = new Map<AiTaskType, AgentDefinition>();

export function registerAgent(def: AgentDefinition): void {
  agents.set(def.taskType, def);
}

export function getAgent(taskType: AiTaskType): AgentDefinition | undefined {
  return agents.get(taskType);
}

export function listAgents(): AgentDefinition[] {
  return [...agents.values()];
}

registerAgent({
  taskType: "investigate",
  load: async () => (await import("./investigate")).runInvestigateAgent,
  dataVersion: async () => {
    const { getFabDataVersion } = await import("@/lib/fab/queries");
    const { isKnowledgeEnabled } = await import("@/lib/ai/tools/knowledge");
    if (!isKnowledgeEnabled()) return getFabDataVersion();
    const { getCorpusVersion } = await import("@/lib/rag/retrieve");
    return `${getFabDataVersion()}+kb:${getCorpusVersion()}`;
  },
});
