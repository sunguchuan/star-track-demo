/**
 * Registry for tool-using specialists inside the investigate workflow.
 * The Gateway-level registry selects a task workflow; this registry selects
 * the roles that workflow composes.
 */
import { dataSpecialist } from "./data";
import { procedureSpecialist } from "./procedure";
import type { SpecialistDefinition, ToolSpecialistId } from "./types";

const specialists: Record<ToolSpecialistId, SpecialistDefinition> = {
  data: dataSpecialist,
  procedure: procedureSpecialist,
};

export function getSpecialist(id: ToolSpecialistId): SpecialistDefinition {
  return specialists[id];
}

export function listSpecialists(): SpecialistDefinition[] {
  return Object.values(specialists);
}
