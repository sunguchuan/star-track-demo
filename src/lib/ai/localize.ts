/**
 * English for the Gateway's user-facing messages — guardrail hits, errors and hints, route
 * reasons — keyed by the Chinese source text, the way gettext keys on the source string.
 * The server, run records and traces keep one language; the UI translates on display, so
 * runs recorded earlier also read correctly after switching language. Unknown text (e.g. a
 * raw provider error, already English) is shown as is.
 */
import type { Locale } from "@/lib/i18n/dictionaries";

type Translate = (text: string) => string;

const EXACT: Record<string, string> = {
  // errors.ts — message
  "云端额度已用完（配额 / Token 耗尽）": "Cloud quota exhausted (quota / tokens used up)",
  "请求过于频繁，已被限流": "Too many requests; rate limited",
  "云端鉴权失败": "Cloud authentication failed",
  "云端模型不可用或已下线": "Cloud model unavailable or retired",
  "本地模型未找到": "Local model not found",
  "输入过长，超出模型上下文限制": "Input is too long for the model's context window",
  "生成超时，已停止": "Generation timed out and was stopped",
  "已取消生成": "Generation cancelled",
  "无法连接本地 Ollama": "Cannot reach the local Ollama",
  "无法连接云端服务": "Cannot reach the cloud service",
  "生成失败，请稍后重试": "Generation failed; please try again later",
  "云端未返回流式响应体": "The cloud returned no response stream",
  "Ollama 未返回流式响应体": "Ollama returned no response stream",
  "云端未返回向量": "The cloud returned no embedding",
  "Ollama 未返回向量": "Ollama returned no embedding",
  "未配置 OPENAI_API_KEY": "OPENAI_API_KEY is not configured",
  "线上环境未配置云端 API Key": "No cloud API key is configured in production",
  "无效 JSON": "Invalid JSON",
  "input 不能为空": "input must not be empty",
  // errors.ts — hint
  "可改用「仅本地」、换模型，或等待配额重置后再试。":
    "Switch to Local only, use another model, or wait for the quota to reset.",
  "请稍后重试。": "Please try again later.",
  "请等待几秒后重试；自动路由下可能会降级到本地。":
    "Wait a few seconds and retry; Auto route may fall back to local.",
  "请检查 .env.local 中的 OPENAI_API_KEY 是否有效。": "Check that OPENAI_API_KEY in .env.local is valid.",
  "请在 .env.local 更新 CLOUD_MODEL（例如 gemini-3.1-flash-lite）。":
    "Update CLOUD_MODEL in .env.local (e.g. gemini-3.1-flash-lite).",
  "请运行 ollama pull <模型名>，并确认 OLLAMA_MODEL 配置正确。":
    "Run ollama pull <model> and check that OLLAMA_MODEL is set correctly.",
  "请缩短笔记内容后再试。": "Shorten the note and try again.",
  "云端模型繁忙或临时故障；自动路由下会降级到本地，也可稍后重试。":
    "The cloud model is busy or temporarily down; Auto route falls back to local, or retry later.",
  "请稍后重试；也可切换到另一侧模型。": "Retry later, or switch between local and cloud.",
  "请稍后重试，或切换路由策略。": "Retry later, or change the routing option.",
  "可以缩短输入后重试，或换一侧模型。": "Shorten the input and retry, or switch between local and cloud.",
  "请确认已启动 Ollama（默认 http://127.0.0.1:11434）。":
    "Make sure Ollama is running (default http://127.0.0.1:11434).",
  "请检查网络，或改用「仅本地」。": "Check the network, or switch to Local only.",
  "请切换路由策略或检查模型服务。": "Change the routing option or check the model service.",
  "请在 Vercel → Project → Settings → Environment Variables 添加 OPENAI_API_KEY、OPENAI_BASE_URL、CLOUD_MODEL（与本地 .env.local 相同）。":
    "Add OPENAI_API_KEY, OPENAI_BASE_URL and CLOUD_MODEL under Vercel → Project → Settings → Environment Variables (same as the local .env.local).",

  // guardrails
  "检测到疑似提示词注入，已拦截": "Possible prompt injection detected; blocked",
  "请去掉要求模型忽略规则、泄露系统提示或扮演其他角色的内容后重试。":
    "Remove anything asking the model to ignore its rules, reveal the system prompt or play another role, then retry.",
  "检测到敏感信息，发送到云端前已脱敏": "Sensitive data detected; redacted before sending to the cloud",
  "检测到敏感信息，已改走本地模型，数据不出本机":
    "Sensitive data detected; using the local model so the data stays on this machine",
  "模型请求了未授权的工具，已拒绝执行": "The model requested a tool that is not allowed; refused",
  "工具参数未通过校验，未查询数据库": "Tool arguments failed validation; the database was not queried",
  "Action Plan 缺少规定章节": "The Action Plan is missing required sections",
  "以下内容未在工具返回的数据中找到，请人工核实": "Not found in the tool data; please verify manually",
  "输出中包含疑似密钥或密码，请勿直接转发": "The output may contain a key or password; don't forward it as is",
  "模型接口不支持结构化输出，已改用文本格式输出":
    "The model API doesn't support structured output; switched to a text Action Plan",
  "结构化输出未通过校验，已改用文本格式输出":
    "Structured output failed validation; switched to a text Action Plan",
  // guardrail details: sensitive-data labels and Action Plan sections
  私钥: "private key",
  密码: "password",
  身份证号: "ID number",
  手机号: "phone number",
  邮箱: "email",
  现象: "Symptoms",
  可能原因: "Likely causes",
  建议动作: "Recommended actions",
  需确认的数据: "Data to confirm",

  // route reasons
  "线上环境无法连接本机 Ollama，已自动改走云端": "Production can't reach a local Ollama; using cloud",
  "检测到非本机运行环境，已改走云端": "Not running locally; using cloud",
  "线上环境未配置 OPENAI_API_KEY，无法使用本机 Ollama":
    "Production has no OPENAI_API_KEY and can't use a local Ollama",
  "用户强制仅本地": "Local only, as selected",
  "用户强制仅云端": "Cloud only, as selected",
  "强制云端但未配置 OPENAI_API_KEY，已降级本地": "Cloud only was selected but OPENAI_API_KEY is not set; using local",
  "线上环境已强制改走云端": "Production always uses cloud",
  "检测到敏感信息，已改走本地（数据不出本机）": "Sensitive data detected; using local (data stays on this machine)",
  "相同输入已有结果，直接返回缓存": "Same input answered before; returned from the cache",
  "问题较复杂，但强模型刚出现故障（冷却中），仍用标准模型":
    "Complex question, but the strong model failed recently (cooling down); using the standard model",
  "强模型不可用，已改用标准云端模型": "Strong model unavailable; using the standard cloud model",
  "本地不可用，已自动改走云端": "Local unavailable; switched to cloud",
  "强模型没有给出更好的结果，保留标准模型的 Action Plan":
    "The strong model did no better; kept the standard model's Action Plan",
  // cloud fallback labels and escalation causes, used inside the patterns below
  云端额度不足: "Cloud quota exhausted",
  云端限流: "Cloud rate limited",
  云端服务暂时不可用: "Cloud service temporarily unavailable",
  无法连接云端: "Cannot reach the cloud",
  云端不可用: "Cloud unavailable",
  云端: "Cloud",
  本地: "Local",
  结构化输出未通过校验: "failed structured-output validation",
};

const SIDE: Record<string, string> = { 云端: "Cloud", 本地: "Local" };

const PATTERNS: [RegExp, (m: RegExpExecArray, t: Translate) => string][] = [
  [/^(云端|本地)服务暂时不可用(?: \((\d+)\))?$/, (m) => `${SIDE[m[1]]} service temporarily unavailable${m[2] ? ` (${m[2]})` : ""}`],
  [/^(云端|本地)请求失败$/, (m) => `${SIDE[m[1]]} request failed`],
  [/^请求过于频繁（每分钟最多 (\d+) 次），请 (\d+) 秒后再试$/, (m) => `Too many requests (at most ${m[1]} per minute); try again in ${m[2]} s`],
  [/^输入过长（(\d+) 字），超过上限 (\d+) 字$/, (m) => `Input too long (${m[1]} characters; the limit is ${m[2]})`],
  [/^请缩短到 (\d+) 字以内，或分段处理。$/, (m) => `Shorten it to ${m[1]} characters or split it into parts.`],
  [/^对话历史过长或格式无效，已丢弃 (\d+) 条$/, (m) => `Chat history too long or malformed; dropped ${m[1]} message(s)`],
  [/^运行超过 (\d+) 秒上限，已停止$/, (m) => `The run exceeded the ${m[1]} s limit and was stopped`],
  [/^单轮工具调用超过 (\d+) 次，只执行前 \d+ 个$/, (m) => `More than ${m[1]} tool calls in one round; only the first ${m[1]} were run`],
  [/^([^]+) 等 (\d+) 项$/, (m) => `${m[1]} (${m[2]} in total)`],
  [/^([^、]+)×(\d+)$/, (m, t) => `${t(m[1])} ×${m[2]}`],
  [/^任务「(.+)」走云端$/, (m) => `Task “${m[1]}” goes to cloud`],
  [/^任务「(.+)」倾向云端，但未配置 Key，已降级本地$/, (m) => `Task “${m[1]}” prefers cloud, but no key is set; using local`],
  [/^任务「(.+)」走本地（省成本\/隐私）$/, (m) => `Task “${m[1]}” runs locally (cost / privacy)`],
  [/^输入较长（≥(\d+) 字），自动切云端$/, (m) => `Long input (≥ ${m[1]} characters); switched to cloud`],
  [/^相似问题已有答案（相似度 ([\d.]+)%），直接返回缓存$/, (m) => `A similar question was answered before (similarity ${m[1]}%); returned from the cache`],
  [/^问题较复杂（(.+)），改用强模型$/, (m) => `Complex question (${m[1]}); using the strong model`],
  [/^引用了工具结果中没有的编号（(.+)）$/, (m) => `cited IDs that are not in the tool results (${m[1]})`],
  [/^强模型(.+)，Action Plan 改用标准模型$/, (m, t) => `Strong model: ${t(m[1])}; the Action Plan uses the standard model`],
  [/^标准模型(.+)，已升级强模型重新生成 Action Plan$/, (m, t) => `Standard model ${t(m[1])}; regenerated the Action Plan on the strong model`],
  [/^强模型(.+)，正在改用标准模型…$/, (m, t) => `Strong model: ${t(m[1])}; switching to the standard model…`],
  [/^(.+)，正在改用云端…$/, (m, t) => `${t(m[1])}; switching to cloud…`],
  [/^(.+)，正在降级到本地…$/, (m, t) => `${t(m[1])}; falling back to local…`],
  [/^(.+)，已自动降级本地$/, (m, t) => `${t(m[1])}; fell back to local`],
  // span status messages: "<error code>: <message>"
  [/^([a-z_]+): ([^]+)$/, (m, t) => `${m[1]}: ${t(m[2])}`],
];

/** Composed reasons ("A；B") and detail lists ("a、b") translate part by part. */
function translateParts(text: string, separator: string, joiner: string): string | null {
  if (!text.includes(separator)) return null;
  const parts = text.split(separator);
  const translated = parts.map(translate);
  return translated.some((part, i) => part !== parts[i]) ? translated.join(joiner) : null;
}

function translate(text: string): string {
  const exact = EXACT[text];
  if (exact) return exact;
  const reasons = translateParts(text, "；", "; ");
  if (reasons) return reasons;
  for (const [pattern, render] of PATTERNS) {
    const m = pattern.exec(text);
    if (m) return render(m, translate);
  }
  return translateParts(text, "、", ", ") ?? text;
}

export function localizeAiText(text: string, locale: Locale): string;
export function localizeAiText(text: string | null | undefined, locale: Locale): string | null | undefined;
export function localizeAiText(text: string | null | undefined, locale: Locale) {
  if (!text || locale === "zh") return text;
  return translate(text);
}
