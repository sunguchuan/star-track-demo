/**
 * Pure rules of the answer cache (no I/O): which tasks are cached and how, what goes into
 * the partition key, and when a similar past question is allowed to answer a new one.
 *
 * Embedding similarity alone is not enough: "B7 yield dropping" vs "B9 yield dropping" or
 * "yield rising" vs "yield dropping" score as high as real paraphrases (measured 0.94–0.96
 * with gemini-embedding-001). So a hit also needs the same key terms: IDs and numbers,
 * direction words and question type. Calibrated with `npm run eval:cache`.
 */
import { createHash } from "crypto";
import { detectReplyLanguage, type ReplyLanguage } from "./language";
import type { AiRouteTarget, AiStrategy, AiTaskType, ChatMessage } from "./types";

/** Bump when prompts or answer formats change so old answers are never served. */
export const CACHE_VERSION = "v1";

export type CacheMode = "exact" | "semantic";

/**
 * Questions are cached by meaning; rewrite tasks only by identical input, because two
 * similar paragraphs still need different translations / summaries.
 */
export function cacheModeFor(taskType: AiTaskType, hasHistory: boolean): CacheMode | null {
  if (taskType === "investigate") return "semantic";
  if (taskType === "chat") return hasHistory ? null : "semantic";
  return "exact";
}

/** Answers produced by a side the request's strategy excludes are never served. */
export function allowedTargets(strategy: AiStrategy): AiRouteTarget[] {
  if (strategy === "only-local") return ["local"];
  if (strategy === "only-cloud") return ["cloud"];
  return ["local", "cloud"];
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 一..九十九 → number; anything else → null. */
export function parseChineseNumber(text: string): number | null {
  if (!/^[零〇一二两三四五六七八九十]+$/.test(text)) return null;
  if (!text.includes("十")) {
    return text.length === 1 ? (CN_DIGITS[text] ?? null) : null;
  }
  const [tens, ones] = text.split("十");
  if (ones && ones.length > 1) return null;
  const t = tens === "" ? 1 : CN_DIGITS[tens];
  const o = ones === "" ? 0 : CN_DIGITS[ones];
  return t == null || o == null || tens.length > 1 ? null : t * 10 + o;
}

const EN_NUMBERS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, twenty: 20, thirty: 30,
};

const DIRECTION_WORDS: [direction: "up" | "down", pattern: RegExp][] = [
  ["up", /上升|升高|提高|提升|增加|增长|变好|改善|好转|回升|往上走|\b(?:ris(?:e|es|ing)|rose|increas\w*|improv\w*|higher|better|grow\w*|up)\b/i],
  ["down", /下降|下滑|降低|减少|变差|恶化|下跌|走低|往下掉|\b(?:drop\w*|declin\w*|decreas\w*|fall\w*|fell|lower|worse|degrad\w*|dip\w*|down)\b/i],
];

/**
 * Question type. "Which alerts are open" and "how should the open alerts be handled" share
 * every entity and still score ~0.93 (gemini) / ~0.85 (embeddinggemma).
 */
const QUESTION_TYPES: [type: string, pattern: RegExp][] = [
  ["why", /为什么|为啥|为何|原因|\b(?:why|caus\w*|reason\w*)\b/i],
  ["how", /怎么|如何|怎样|\bhow\b(?!\s+(?:many|much))/i],
  ["amount", /多少|\bhow\s+(?:many|much)\b/i],
  ["which", /哪些|哪几|列出|\b(?:which|list)\b/i],
];

/** One-letter labels: "A 班", "B线", "shift A", "line B", "A-shift". */
const LETTER_LABELS = [
  /(?<![A-Za-z])([A-Z])\s*(?=班|线|区|组)/g,
  /\b(?:[Ss]hift|[Ll]ine|[Bb]ay|[Aa]rea|[Cc]rew)\s+([A-Z])\b/g,
  /\b([A-Z])[-\s]shift\b/g,
];

/**
 * Terms that must match exactly for a semantic hit: equipment / batch / alert IDs and
 * numbers (normalized to upper case / digits), one-letter shift / line labels, the
 * direction of change asked about, and the question type (why / how / how many / which).
 */
export function extractKeyTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const match of text.matchAll(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g)) {
    const token = match[0];
    if (/\d/.test(token)) {
      terms.add(/^\d+$/.test(token) ? String(Number(token)) : token.toUpperCase());
    } else if (/^[A-Z]{2,}(?:-[A-Z0-9]+)+$/.test(token)) {
      terms.add(token);
    } else if (EN_NUMBERS[token.toLowerCase()] != null) {
      terms.add(String(EN_NUMBERS[token.toLowerCase()]));
    }
  }
  for (const match of text.matchAll(
    /([零〇一二两三四五六七八九十]+)(?=个月|小时|星期|天|日|周|月|年|次|批|片|台|班)/g,
  )) {
    const value = parseChineseNumber(match[1]);
    if (value != null) terms.add(String(value));
  }
  for (const pattern of LETTER_LABELS) {
    for (const match of text.matchAll(pattern)) terms.add(`#${match[1].toUpperCase()}`);
  }
  for (const [direction, pattern] of DIRECTION_WORDS) {
    if (pattern.test(text)) terms.add(`~${direction}`);
  }
  for (const [type, pattern] of QUESTION_TYPES) {
    if (pattern.test(text)) terms.add(`?${type}`);
  }
  return [...terms].sort();
}

export type CacheContext = {
  mode: CacheMode;
  taskType: AiTaskType;
  language: ReplyLanguage;
  /** Everything an answer depends on besides the question itself. */
  partition: string;
  /** sha256 of task + input + history: the exact-mode key. */
  exactKey: string;
  terms: string;
  allowed: AiRouteTarget[];
};

export function buildCacheContext(options: {
  mode: CacheMode;
  taskType: AiTaskType;
  input: string;
  history: ChatMessage[];
  strategy: AiStrategy;
  /** Fingerprint of the data the answer is based on (FAB tables for investigate). */
  dataVersion: string;
}): CacheContext {
  const language = detectReplyLanguage(options.input);
  return {
    mode: options.mode,
    taskType: options.taskType,
    language,
    partition: [CACHE_VERSION, options.mode, options.taskType, language, options.dataVersion].join("|"),
    exactKey: createHash("sha256")
      .update(JSON.stringify([options.taskType, options.input.trim(), options.history]))
      .digest("hex"),
    terms: extractKeyTerms(options.input).join(" "),
    allowed: allowedTargets(options.strategy),
  };
}

/**
 * Per embedding model: their similarity scales differ. From `npm run eval:cache`: the
 * highest-scoring must-not-hit pair the key terms cannot tell apart is 0.69
 * (embeddinggemma) / 0.90 (gemini); thresholds keep a clear margin above that.
 */
export const DEFAULT_THRESHOLDS: Record<string, number> = {
  embeddinggemma: 0.8,
  "gemini-embedding-001": 0.92,
};
const FALLBACK_THRESHOLD = 0.92;

export function similarityThreshold(model: string): number {
  const override = Number(process.env.AI_CACHE_THRESHOLD);
  if (Number.isFinite(override) && override > 0 && override <= 1) return override;
  const base = model.split(":")[0];
  return DEFAULT_THRESHOLDS[base] ?? FALLBACK_THRESHOLD;
}

/**
 * Only clean answers are reused: a successful run with no provider error (a fallback may
 * leave partial output from the first model), no sensitive input, nothing flagged by the
 * tool / resource / output guardrails, and no unverified references in the plan.
 */
export function storeSkipReason(run: {
  status: string;
  outputChars: number;
  errorCode: string | null;
  sensitive: boolean;
  guardrailStages: string[];
  ungroundedRefs: number;
}): string | null {
  if (run.status !== "ok" || run.outputChars === 0) return `status ${run.status}`;
  if (run.errorCode) return `provider error ${run.errorCode}`;
  if (run.sensitive) return "sensitive input";
  const flagged = run.guardrailStages.find((s) => s !== "input");
  if (flagged) return `${flagged} guardrail hit`;
  if (run.ungroundedRefs > 0) return "ungrounded references";
  return null;
}

export type CacheCandidate = {
  id: string;
  target: AiRouteTarget;
  terms: string;
  similarity: number;
};

export type CacheDecision = {
  hit: CacheCandidate | null;
  /** Closest candidate regardless of rules, for the trace. */
  best: (CacheCandidate & { termsMatch: boolean }) | null;
  rejectedByTerms: number;
};

export function decideHit(
  candidates: CacheCandidate[],
  context: Pick<CacheContext, "terms" | "allowed">,
  threshold: number,
): CacheDecision {
  let hit: CacheCandidate | null = null;
  let best: CacheDecision["best"] = null;
  let rejectedByTerms = 0;
  for (const c of candidates) {
    if (!context.allowed.includes(c.target)) continue;
    const termsMatch = c.terms === context.terms;
    if (!best || c.similarity > best.similarity) best = { ...c, termsMatch };
    if (c.similarity < threshold) continue;
    if (!termsMatch) {
      rejectedByTerms += 1;
      continue;
    }
    if (!hit || c.similarity > hit.similarity) hit = c;
  }
  return { hit, best, rejectedByTerms };
}
