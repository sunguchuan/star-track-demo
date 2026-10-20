/**
 * Generic output guardrails — run after streaming finishes (tokens are already
 * shown, so these warn rather than block).
 *
 * FAB Action Plan section checks live with the investigate agent
 * (`agents/investigate-guards.ts`); this module keeps secrets and grounding only.
 */
import type { GuardrailHit } from "../types";
import { describeFindings, findSensitive } from "./input";

const BATCH_ID = /\bB-\d{6}-\d{2}\b/g;
const TOOL_ID = /\bT-[A-Z]+-\d{2}\b/g;
const ALERT_CODE = /\b[A-Z]{2,}(?:-[A-Z]{2,})+\b/g;
const PERCENT = /(\d+(?:\.\d+)?)\s*%/g;
const NUMBER_TOLERANCE = 0.05;

function evidenceNumbers(evidence: string): number[] {
  const stripped = evidence
    .replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?/g, " ")
    .replace(BATCH_ID, " ")
    .replace(TOOL_ID, " ");
  const values = new Set<number>();
  for (const m of stripped.matchAll(/-?\d+(?:\.\d+)?/g)) {
    values.add(Math.abs(Number(m[0])));
  }
  return [...values];
}

/** A percentage is grounded if it appears in the data or is a simple difference/ratio of data values. */
function isGroundedPercent(value: number, numbers: number[]): boolean {
  const near = (a: number) => Math.abs(a - value) <= NUMBER_TOLERANCE;
  const nearRounded = (a: number) =>
    Number.isInteger(value) && Math.abs(Math.round(a) - value) < 0.5;

  // "100% 全检" / "0% 报废" describe procedures or targets, not data points.
  if (value === 0 || value === 100) return true;
  if (numbers.some(near)) return true;
  for (const a of numbers) {
    for (const b of numbers) {
      if (a === b) continue;
      const diff = Math.round(Math.abs(a - b) * 10) / 10;
      if (near(diff)) return true;
      if (b !== 0) {
        const ratio = (a / b) * 100;
        if (near(ratio) || nearRounded(ratio)) return true;
      }
    }
  }
  return false;
}

export function checkGrounding(output: string, evidence: string): string[] {
  const ungrounded: string[] = [];
  const add = (item: string) => {
    if (!ungrounded.includes(item)) ungrounded.push(item);
  };

  for (const pattern of [BATCH_ID, TOOL_ID, ALERT_CODE]) {
    for (const m of output.matchAll(pattern)) {
      if (!evidence.includes(m[0])) add(m[0]);
    }
  }

  const numbers = evidenceNumbers(evidence);
  for (const m of output.matchAll(PERCENT)) {
    if (!isGroundedPercent(Number(m[1]), numbers)) add(`${m[1]}%`);
  }

  return ungrounded;
}

/** Secrets only — PII in output is often legitimate (e.g. polishing a contact note). */
export function checkOutputSecrets(output: string): GuardrailHit[] {
  const findings = findSensitive(output, ["secret"]);
  if (findings.length === 0) return [];
  return [
    {
      stage: "output",
      rule: "output_secret",
      action: "warn",
      message: "输出中包含疑似密钥或密码，请勿直接转发",
      detail: describeFindings(findings),
    },
  ];
}
