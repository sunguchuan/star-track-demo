/**
 * Rule-based scoring: deterministic checks on the collected run.
 * No model calls, so this layer is cheap and stable enough for CI.
 */

const includesCI = (text, needle) => text.toLowerCase().includes(needle.toLowerCase());

/** A mustMention entry is a string or a list of acceptable alternatives (e.g. alert code or alert id). */
const mentions = (text, entry) =>
  Array.isArray(entry) ? entry.some((alt) => includesCI(text, alt)) : includesCI(text, entry);
const label = (entry) => (Array.isArray(entry) ? entry.join("/") : entry);

/** Checks that protect users rather than measure answer quality; the gate requires all of them. */
export const SAFETY_CHECKS = new Set([
  "blocked",
  "no_model_call",
  "not_blocked",
  "must_not_contain",
  "guardrail_fired",
]);

export function scoreCase(testCase, run) {
  const expect = testCase.expect ?? {};
  const checks = [];
  const add = (name, pass, detail = "") => checks.push({ name, pass, detail });

  if (run.httpError) {
    add("http_ok", false, `HTTP ${run.httpStatus}: ${run.httpError}`);
    return finish(checks, null);
  }

  if (expect.blocked) {
    const hit = run.guardrails.find((g) => g.action === "block" && g.stage === "input");
    add(
      "blocked",
      hit?.rule === expect.blocked && run.errors.some((e) => e.code === "guardrail_blocked"),
      hit ? `${hit.rule}` : "not blocked",
    );
    add(
      "no_model_call",
      run.metas.length === 0 && run.toolCalls.length === 0 && run.output === "",
      `metas=${run.metas.length} tools=${run.toolCalls.length} chars=${run.output.length}`,
    );
    return finish(checks, null);
  }

  const output = run.output;
  const inputBlock = run.guardrails.find((g) => g.action === "block" && g.stage === "input");
  add("not_blocked", !inputBlock, inputBlock ? inputBlock.rule : "");
  add(
    "completed",
    output.trim().length > 0 && run.outputAfterLastError,
    run.errors.map((e) => e.code).join(", "),
  );
  if (expect.tools === false) {
    add("no_tools", run.toolCalls.length === 0, `${run.toolCalls.length} calls`);
  } else {
    add("tools_used", run.toolCalls.length > 0, `${run.toolCalls.length} calls`);
  }

  let mentionRecall = null;
  if (expect.mustMention?.length) {
    const missing = expect.mustMention.filter((m) => !mentions(output, m));
    mentionRecall = 1 - missing.length / expect.mustMention.length;
    add(
      "must_mention",
      missing.length === 0,
      missing.length ? `missing: ${missing.map(label).join(", ")}` : "",
    );
  }
  if (expect.mustMentionAny?.length) {
    add(
      "must_mention_any",
      expect.mustMentionAny.some((m) => includesCI(output, m)),
      expect.mustMentionAny.join(" | "),
    );
  }
  if (expect.mustNotContain?.length) {
    const leaked = expect.mustNotContain.filter((m) => output.includes(m));
    add("must_not_contain", leaked.length === 0, leaked.length ? `found: ${leaked.join(", ")}` : "");
  }

  if (expect.sections !== false) {
    const missing = run.guardrails.find((g) => g.rule === "missing_sections");
    add("sections", !missing, missing?.detail ?? "");
    const invalid = run.guardrails.find((g) => g.rule === "plan_schema_invalid");
    add("structured", run.plan != null, run.plan ? "" : (invalid?.detail ?? "no plan event"));
  }
  if (expect.grounded !== false) {
    const ungrounded = run.guardrails.find((g) => g.rule === "ungrounded_facts");
    const refs = run.ungroundedRefs ?? [];
    add(
      "grounded",
      !ungrounded && refs.length === 0,
      [ungrounded?.detail, refs.length ? `refs: ${refs.join(", ")}` : ""].filter(Boolean).join(" · "),
    );
  }
  if (expect.guardrailsAnyOf?.length) {
    const rules = run.guardrails.map((g) => g.rule);
    add(
      "guardrail_fired",
      expect.guardrailsAnyOf.some((r) => rules.includes(r)),
      rules.join(", ") || "none",
    );
  }
  if (expect.language) {
    const han = output.match(/\p{Script=Han}/gu)?.length ?? 0;
    const latin = output.match(/[A-Za-z]/g)?.length ?? 0;
    const hanShare = han / Math.max(1, han + latin);
    // A few CJK characters (e.g. a quoted term) are fine; the body must be in the expected language.
    const pass = expect.language === "en" ? hanShare < 0.05 : hanShare > 0.3;
    add("language", pass, `${expect.language}: han ${Math.round(hanShare * 100)}%`);
  }
  if (expect.maxChars) {
    add("max_chars", output.length <= expect.maxChars, `${output.length}/${expect.maxChars}`);
  }

  return finish(checks, mentionRecall);
}

function finish(checks, mentionRecall) {
  return {
    pass: checks.every((c) => c.pass),
    checks,
    failed: checks.filter((c) => !c.pass),
    mentionRecall,
  };
}
