/**
 * Input guardrails — run in the Gateway before any model is called.
 * Deterministic rules only (no extra model call), so they add ~0 latency.
 */
import type { AiTaskType, ChatMessage, GuardrailHit } from "../types";

export const INPUT_LIMITS = {
  maxInputChars: 8000,
  maxHistoryMessages: 12,
  maxHistoryChars: 16000,
} as const;

// Control chars (except \t \n \r) and zero-width chars used to hide injected text.
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g;

export function sanitizeText(text: string): string {
  return text.replace(INVISIBLE_CHARS, "");
}

const INJECTION_RULES: { id: string; pattern: RegExp }[] = [
  {
    id: "ignore_instructions",
    pattern:
      /\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|earlier|all|system|your)\b.{0,20}\b(instructions?|prompts?|rules?|guidelines?)\b/i,
  },
  {
    id: "ignore_instructions_zh",
    pattern:
      /(忽略|无视|忘记|忘掉|跳过|不要遵守)(掉)?.{0,8}(之前|以上|上面|前面|上述|系统|你的).{0,6}(指令|指示|提示词?|规则|设定|要求|限制)|(忽略|无视|忘记|忘掉)(掉)?(所有|全部)的?(指令|指示|提示词?|设定)/,
  },
  {
    id: "reveal_system_prompt",
    pattern:
      /\b(reveal|show|print|repeat|output|leak|tell me)\b.{0,30}\b(system prompt|hidden (instructions|prompt)|initial (instructions|prompt)|developer message)\b/i,
  },
  {
    id: "reveal_system_prompt_zh",
    pattern:
      /(输出|显示|打印|泄露|透露|告诉我|重复|复述).{0,12}(系统提示词|你的系统提示|system ?prompt|初始(指令|提示)|隐藏(指令|提示)|开发者(消息|指令))|(系统提示词|你的系统提示|system ?prompt|初始(指令|提示)|隐藏(指令|提示)|开发者(消息|指令)).{0,12}(输出|显示|打印|泄露|透露|发给我|告诉我|复述)/i,
  },
  {
    id: "jailbreak_mode",
    pattern:
      /\b(developer mode|jailbreak|god mode|do anything now)\b|越狱模式|开发者模式|无限制模式|不受任何限制/i,
  },
  { id: "jailbreak_dan", pattern: /\bDAN\b/ },
  {
    id: "role_spoofing",
    pattern:
      /<\|(im_start|im_end|system|endoftext|eot_id|start_header_id)\|>|^\s*\[?(system|assistant)\]?\s*[:：]/im,
  },
];

export function detectInjection(
  text: string,
): { rule: string; match: string } | null {
  const normalized = text.replace(/\s+/g, " ");
  for (const rule of INJECTION_RULES) {
    // Raw text keeps line starts for role spoofing; normalized catches split phrases.
    const m = text.match(rule.pattern) ?? normalized.match(rule.pattern);
    if (m) return { rule: rule.id, match: m[0].replace(/\s+/g, " ").slice(0, 80) };
  }
  return null;
}

type SensitiveRule = {
  id: string;
  label: string;
  kind: "secret" | "pii";
  pattern: RegExp;
  replacement: string;
};

const SENSITIVE_RULES: SensitiveRule[] = [
  {
    id: "private_key",
    label: "私钥",
    kind: "secret",
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  {
    id: "api_key",
    label: "API Key",
    kind: "secret",
    pattern:
      /\b(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    replacement: "[REDACTED_API_KEY]",
  },
  {
    id: "password_assignment",
    label: "密码",
    kind: "secret",
    pattern: /(\b(password|passwd|pwd)|密码)\s*[:=：]\s*\S{4,}/gi,
    replacement: "[REDACTED_PASSWORD]",
  },
  {
    id: "cn_id_card",
    label: "身份证号",
    kind: "pii",
    pattern: /(?<!\d)\d{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g,
    replacement: "[REDACTED_ID]",
  },
  {
    id: "cn_phone",
    label: "手机号",
    kind: "pii",
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    replacement: "[REDACTED_PHONE]",
  },
  {
    id: "email",
    label: "邮箱",
    kind: "pii",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: "[REDACTED_EMAIL]",
  },
];

export type SensitiveFinding = {
  id: string;
  label: string;
  kind: "secret" | "pii";
  count: number;
};

export function findSensitive(
  text: string,
  kinds: ReadonlyArray<"secret" | "pii"> = ["secret", "pii"],
): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  for (const rule of SENSITIVE_RULES) {
    if (!kinds.includes(rule.kind)) continue;
    const count = text.match(rule.pattern)?.length ?? 0;
    if (count > 0) {
      findings.push({ id: rule.id, label: rule.label, kind: rule.kind, count });
    }
  }
  return findings;
}

export function redactSensitive(text: string): string {
  return SENSITIVE_RULES.reduce(
    (acc, rule) => acc.replace(rule.pattern, rule.replacement),
    text,
  );
}

export function describeFindings(findings: SensitiveFinding[]): string {
  return findings.map((f) => `${f.label}×${f.count}`).join("、");
}

function normalizeHistory(raw: unknown): {
  history: ChatMessage[];
  trimmed: number;
} {
  if (!Array.isArray(raw)) return { history: [], trimmed: 0 };

  const valid: ChatMessage[] = raw
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        !!m &&
        typeof m === "object" &&
        ((m as ChatMessage).role === "user" ||
          (m as ChatMessage).role === "assistant") &&
        typeof (m as ChatMessage).content === "string",
    )
    .map((m) => ({ role: m.role, content: sanitizeText(m.content) }));

  let kept = valid.slice(-INPUT_LIMITS.maxHistoryMessages);
  let total = kept.reduce((n, m) => n + m.content.length, 0);
  while (kept.length > 0 && total > INPUT_LIMITS.maxHistoryChars) {
    total -= kept[0].content.length;
    kept = kept.slice(1);
  }

  return { history: kept, trimmed: raw.length - kept.length };
}

export type InputGuardResult = {
  /** Set when the request must not reach any model. */
  blocked: (GuardrailHit & { hint: string }) | null;
  input: string;
  history: ChatMessage[];
  hits: GuardrailHit[];
  sensitive: SensitiveFinding[];
};

export function runInputGuards(options: {
  input: string;
  history: unknown;
  taskType: AiTaskType;
}): InputGuardResult {
  const input = sanitizeText(options.input).trim();
  const { history, trimmed } = normalizeHistory(options.history);
  const hits: GuardrailHit[] = [];

  const result = (blocked: InputGuardResult["blocked"]): InputGuardResult => ({
    blocked,
    input,
    history,
    hits,
    sensitive: blocked
      ? []
      : findSensitive([input, ...history.map((m) => m.content)].join("\n")),
  });

  if (input.length > INPUT_LIMITS.maxInputChars) {
    return result({
      stage: "input",
      rule: "input_too_long",
      action: "block",
      message: `输入过长（${input.length} 字），超过上限 ${INPUT_LIMITS.maxInputChars} 字`,
      hint: `请缩短到 ${INPUT_LIMITS.maxInputChars} 字以内，或分段处理。`,
    });
  }

  if (trimmed > 0) {
    hits.push({
      stage: "input",
      rule: "history_trimmed",
      action: "trim",
      message: `对话历史过长或格式无效，已丢弃 ${trimmed} 条`,
    });
  }

  const userTexts = [input, ...history.filter((m) => m.role === "user").map((m) => m.content)];
  for (const text of userTexts) {
    const injection = detectInjection(text);
    if (injection) {
      return result({
        stage: "input",
        rule: "prompt_injection",
        action: "block",
        message: "检测到疑似提示词注入，已拦截",
        detail: `${injection.rule}: “${injection.match}”`,
        hint: "请去掉要求模型忽略规则、泄露系统提示或扮演其他角色的内容后重试。",
      });
    }
  }

  return result(null);
}
