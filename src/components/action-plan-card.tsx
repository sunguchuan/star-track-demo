"use client";

import type { ReactNode } from "react";
import type { PlanConfidence, PlanPriority } from "@/lib/ai/action-plan";
import type { AiPlanState } from "@/lib/ai/use-ai-stream";
import type { Dictionary } from "@/lib/i18n/dictionaries";

const CONFIDENCE_TONE: Record<PlanConfidence, string> = {
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-900",
  low: "bg-zinc-100 text-zinc-600",
};

const PRIORITY_TONE: Record<PlanPriority, string> = {
  P0: "bg-red-600 text-white",
  P1: "bg-amber-500 text-white",
  P2: "bg-sky-100 text-sky-800",
};

type Props = {
  value: AiPlanState;
  copy: Dictionary["aiPage"];
};

/** Structured Action Plan: summary + four fixed sections, refs checked against tool data. */
export function ActionPlanCard({ value, copy }: Props) {
  const { plan, ungroundedRefs } = value;

  if (!plan.inScope) {
    return (
      <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
        {plan.summary}
      </p>
    );
  }

  const refChips = (refs: string[]) =>
    refs.length > 0 && (
      <span className="mt-1 flex flex-wrap gap-1">
        {refs.map((ref) => {
          const ungrounded = ungroundedRefs.includes(ref);
          return (
            <span
              key={ref}
              title={ungrounded ? copy.plan.ungroundedRef : undefined}
              className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
                ungrounded
                  ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                  : "bg-violet-50 text-violet-800"
              }`}
            >
              {ungrounded ? `⚠ ${ref}` : ref}
            </span>
          );
        })}
      </span>
    );

  return (
    <div className="space-y-3 text-sm text-violet-950">
      <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-600">
          {copy.plan.summary}
        </p>
        <p className="mt-0.5 font-medium leading-relaxed">{plan.summary}</p>
      </div>

      <PlanSection title={copy.plan.findings} count={plan.findings.length}>
        {plan.findings.map((f, i) => (
          <li key={i} className="leading-relaxed">
            {f.text}
            {refChips(f.refs)}
          </li>
        ))}
      </PlanSection>

      <PlanSection title={copy.plan.causes} count={plan.causes.length}>
        {plan.causes.map((c, i) => (
          <li key={i} className="flex gap-2 leading-relaxed">
            <span
              className={`h-fit shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${CONFIDENCE_TONE[c.confidence]}`}
            >
              {copy.plan.confidence[c.confidence]}
            </span>
            <span>
              {c.text}
              {refChips(c.refs)}
            </span>
          </li>
        ))}
      </PlanSection>

      <PlanSection title={copy.plan.actions} count={plan.actions.length}>
        {plan.actions.map((a, i) => (
          <li key={i} className="flex gap-2 leading-relaxed">
            <span
              className={`h-fit shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${PRIORITY_TONE[a.priority]}`}
            >
              {a.priority}
            </span>
            <span className="flex-1">
              {a.text}
              {a.owner && (
                <span className="ml-1.5 whitespace-nowrap rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                  {a.owner}
                </span>
              )}
            </span>
          </li>
        ))}
      </PlanSection>

      {plan.dataToConfirm.length > 0 && (
        <PlanSection title={copy.plan.dataToConfirm} count={plan.dataToConfirm.length}>
          {plan.dataToConfirm.map((d, i) => (
            <li key={i} className="flex gap-2 leading-relaxed">
              <span
                aria-hidden
                className="mt-1 h-3 w-3 shrink-0 rounded-sm border border-violet-300"
              />
              {d}
            </li>
          ))}
        </PlanSection>
      )}
    </div>
  );
}

function PlanSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
      <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-zinc-700">
        {title}
        <span className="rounded-full bg-zinc-100 px-1.5 text-[10px] font-medium text-zinc-500">
          {count}
        </span>
      </h3>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}
