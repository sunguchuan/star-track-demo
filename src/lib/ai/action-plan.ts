/**
 * Structured Action Plan for taskType=investigate.
 * One zod schema drives both the JSON schema sent to the model (structured output)
 * and server-side validation of what comes back.
 */
import { z } from "zod";
import type { ReplyLanguage } from "./language";

/** IDs only; the pattern also stops grammar-constrained local models from putting sentences here. */
const REF_PATTERN = /^[A-Z][A-Z0-9-]{1,39}$/;

const refs = z
  .array(z.string().regex(REF_PATTERN))
  .max(6)
  .describe(
    "Batch IDs (B-…), tool IDs (T-…) or alert codes copied verbatim from the tool results that support this item. [] if none.",
  );

export const ActionPlanSchema = z
  .object({
    inScope: z
      .boolean()
      .describe("false when the request is not a fab / manufacturing investigation"),
    summary: z
      .string()
      .describe(
        "One-sentence conclusion. When inScope is false: one short sentence saying you only handle production-line investigation, and leave every list empty.",
      ),
    findings: z
      .array(z.object({ text: z.string(), refs }))
      .max(6)
      .describe("Symptoms: observations stated in the tool results"),
    causes: z
      .array(
        z.object({
          text: z.string(),
          confidence: z.enum(["high", "medium", "low"]),
          refs,
        }),
      )
      .max(5)
      .describe("Likely causes, most likely first"),
    actions: z
      .array(
        z.object({
          text: z.string(),
          priority: z.enum(["P0", "P1", "P2"]),
          owner: z
            .string()
            .describe("Role responsible, e.g. process / equipment / yield engineer"),
        }),
      )
      .max(6)
      .describe("Recommended actions, each executable"),
    dataToConfirm: z
      .array(z.string())
      .max(6)
      .describe("Data still needed to confirm the causes"),
  })
  .refine((p) => !p.inScope || (p.findings.length > 0 && p.actions.length > 0), {
    message: "inScope plans need at least one finding and one action",
  });

export type ActionPlan = z.infer<typeof ActionPlanSchema>;
export type PlanConfidence = ActionPlan["causes"][number]["confidence"];
export type PlanPriority = ActionPlan["actions"][number]["priority"];

/** JSON schema for response_format / Ollama `format` (no $schema key; Gemini rejects unknown keywords). */
export function actionPlanJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ActionPlanSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export type ParsedPlan =
  | { ok: true; plan: ActionPlan }
  | { ok: false; error: string };

export function parseActionPlan(raw: string): ParsedPlan {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${(err as Error).message}` };
  }
  const result = ActionPlanSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: z.prettifyError(result.error) };
  }
  return { ok: true, plan: result.data };
}

type RenderLabels = {
  conclusion: (summary: string) => string;
  sections: [string, string, string, string];
  confidence: Record<PlanConfidence, string>;
  refs: (text: string, refs: string) => string;
  owner: (owner: string) => string;
};

const RENDER_LABELS: Record<ReplyLanguage, RenderLabels> = {
  zh: {
    conclusion: (s) => `**结论**：${s}`,
    sections: ["1. 现象（事实）", "2. 可能原因", "3. 建议动作（可执行）", "4. 需确认的数据"],
    confidence: { high: "高", medium: "中", low: "低" },
    refs: (text, refs) => `${text}〔${refs}〕`,
    owner: (owner) => `（${owner}）`,
  },
  en: {
    conclusion: (s) => `**Conclusion**: ${s}`,
    sections: ["1. Symptoms (facts)", "2. Likely causes", "3. Recommended actions", "4. Data to confirm"],
    confidence: { high: "High", medium: "Medium", low: "Low" },
    refs: (text, refs) => `${text} [${refs}]`,
    owner: (owner) => ` (${owner})`,
  },
};

/**
 * Markdown twin of the plan: streamed as `delta` so notes, copy/paste, run logs and the
 * eval scorer keep working on plain text. Section titles match ACTION_PLAN_SECTIONS.
 */
export function renderActionPlan(plan: ActionPlan, language: ReplyLanguage = "zh"): string {
  if (!plan.inScope) return plan.summary;
  const l = RENDER_LABELS[language];
  const withRefs = (text: string, itemRefs: string[]) =>
    itemRefs.length > 0 ? l.refs(text, itemRefs.join(", ")) : text;

  const lines = [l.conclusion(plan.summary), "", `## ${l.sections[0]}`];
  for (const f of plan.findings) lines.push(`- ${withRefs(f.text, f.refs)}`);
  lines.push("", `## ${l.sections[1]}`);
  for (const c of plan.causes) {
    lines.push(`- [${l.confidence[c.confidence]}] ${withRefs(c.text, c.refs)}`);
  }
  lines.push("", `## ${l.sections[2]}`);
  for (const a of plan.actions) {
    lines.push(`- ${a.priority} · ${a.text}${a.owner ? l.owner(a.owner) : ""}`);
  }
  lines.push("", `## ${l.sections[3]}`);
  for (const d of plan.dataToConfirm) lines.push(`- ${d}`);
  return lines.join("\n");
}

export function planRefs(plan: ActionPlan): string[] {
  const all = [...plan.findings, ...plan.causes].flatMap((item) => item.refs);
  return [...new Set(all.map((r) => r.trim()).filter(Boolean))];
}

/** Refs the model cited that do not appear verbatim in the evidence. */
export function findUngroundedRefs(plan: ActionPlan, sources: string): string[] {
  return planRefs(plan).filter((ref) => !sources.includes(ref));
}
