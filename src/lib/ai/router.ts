import {
  CLOUD_TASKS,
  LOCAL_TASKS,
  LONG_INPUT_CHARS,
  type AiStrategy,
  type AiTaskType,
  type RouteDecision,
} from "./types";

const LOCAL_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:latest";
const CLOUD_MODEL = process.env.CLOUD_MODEL ?? "gpt-4.1-mini";

const decision = (
  target: RouteDecision["target"],
  reason: string,
): RouteDecision => ({
  target,
  reason,
  model: target === "local" ? LOCAL_MODEL : CLOUD_MODEL,
});

export function isCloudConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * Step 2a — Runtime check: can this process reach local Ollama?
 * Hosted platforms (e.g. Vercel) always return false unless AI_FORCE_LOCAL=1.
 */
export function isLocalAiRuntime(): boolean {
  if (process.env.AI_FORCE_CLOUD === "1") return false;
  if (process.env.AI_FORCE_LOCAL === "1") return true;

  const hosted =
    process.env.VERCEL === "1" ||
    Boolean(process.env.VERCEL_ENV) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    process.env.NETLIFY === "true";

  return !hosted;
}

/**
 * Step 2b — Route decision: pick local or cloud from strategy / task / runtime.
 * Hosted runtimes always use cloud — never point at the visitor's Ollama.
 */
export function resolveRoute(options: {
  taskType: AiTaskType;
  strategy: AiStrategy;
  inputLength: number;
  cloudAvailable: boolean;
  localRuntime?: boolean;
}): RouteDecision {
  const {
    taskType,
    strategy,
    inputLength,
    cloudAvailable,
    localRuntime = isLocalAiRuntime(),
  } = options;

  // Non-local runtime: always cloud
  if (!localRuntime) {
    return decision(
      "cloud",
      cloudAvailable
        ? strategy === "only-local"
          ? "线上环境无法连接本机 Ollama，已自动改走云端"
          : "检测到非本机运行环境，已改走云端"
        : "线上环境未配置 OPENAI_API_KEY，无法使用本机 Ollama",
    );
  }

  switch (strategy) {
    case "only-local":
      return decision("local", "用户强制仅本地");

    case "only-cloud":
      return cloudAvailable
        ? decision("cloud", "用户强制仅云端")
        : decision("local", "强制云端但未配置 OPENAI_API_KEY，已降级本地");

    case "auto":
    default:
      // Deep analysis / refactor → prefer cloud
      if (CLOUD_TASKS.includes(taskType)) {
        return cloudAvailable
          ? decision("cloud", `任务「${taskType}」走云端`)
          : decision(
              "local",
              `任务「${taskType}」倾向云端，但未配置 Key，已降级本地`,
            );
      }

      // Long input → switch to cloud
      if (
        cloudAvailable &&
        inputLength >= LONG_INPUT_CHARS &&
        LOCAL_TASKS.includes(taskType)
      ) {
        return decision(
          "cloud",
          `输入较长（≥${LONG_INPUT_CHARS} 字），自动切云端`,
        );
      }

      // Default: local (cost / privacy)
      return decision(
        "local",
        `任务「${taskType}」走本地（省成本/隐私）`,
      );
  }
}

export const getLocalModel = () => LOCAL_MODEL;
export const getCloudModel = () => CLOUD_MODEL;

export const DEFAULT_STRONG_MODEL = "gemini-3.8-flash";

/**
 * Cloud model for complex requests (see difficulty.ts). CLOUD_MODEL_STRONG= (empty)
 * turns tiering off; unset defaults to gemini-3.8-flash only on Gemini deployments.
 */
export function getStrongCloudModel(): string | null {
  const raw = process.env.CLOUD_MODEL_STRONG;
  const fallback = CLOUD_MODEL.startsWith("gemini") ? DEFAULT_STRONG_MODEL : "";
  const model = raw === undefined ? fallback : raw.trim();
  return model && model !== CLOUD_MODEL ? model : null;
}

/** After a strong-tier outage, skip it for a while instead of paying a failed call per request. */
export const STRONG_COOLDOWN_MS = 5 * 60_000;
let strongDownUntil = 0;

export function noteStrongModelFailure(now = Date.now()): void {
  strongDownUntil = now + STRONG_COOLDOWN_MS;
}

export function isStrongModelCoolingDown(now = Date.now()): boolean {
  return now < strongDownUntil;
}
