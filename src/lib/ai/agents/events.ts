import type { GuardrailHit, StreamEvent } from "../types";

export function guardrailEvent(hit: GuardrailHit): StreamEvent {
  return { type: "guardrail", ...hit };
}
