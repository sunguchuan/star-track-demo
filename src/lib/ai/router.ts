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

export function isCloudConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * Whether this server process is likely able to reach a local Ollama.
 * Vercel / hosted runtimes cannot; local `next dev` / `next start` can.
 * Override with AI_FORCE_CLOUD=1 or AI_FORCE_LOCAL=1.
 */
export function isLocalAiRuntime(): boolean {
  if (process.env.AI_FORCE_CLOUD === "1") return false;
  if (process.env.AI_FORCE_LOCAL === "1") return true;
  // Vercel sets VERCEL=1; also treat other common hosts as non-local.
  if (process.env.VERCEL === "1") return false;
  if (process.env.VERCEL_ENV) return false;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return false;
  if (process.env.NETLIFY === "true") return false;
  return true;
}

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

  // Hosted runtimes can never reach the visitor's Ollama — never pick local.
  if (!localRuntime) {
    if (cloudAvailable) {
      return {
        target: "cloud",
        reason:
          strategy === "only-local"
            ? "线上环境无法连接本机 Ollama，已自动改走云端"
            : "检测到非本机运行环境，已改走云端",
        model: CLOUD_MODEL,
      };
    }
    return {
      target: "cloud",
      reason: "线上环境未配置 OPENAI_API_KEY，无法使用本机 Ollama",
      model: CLOUD_MODEL,
    };
  }

  if (strategy === "only-local") {
    return {
      target: "local",
      reason: "用户强制仅本地",
      model: LOCAL_MODEL,
    };
  }

  if (strategy === "only-cloud") {
    if (!cloudAvailable) {
      return {
        target: "local",
        reason: "强制云端但未配置 OPENAI_API_KEY，已降级本地",
        model: LOCAL_MODEL,
      };
    }
    return {
      target: "cloud",
      reason: "用户强制仅云端",
      model: CLOUD_MODEL,
    };
  }

  // auto (local runtime)
  if ((CLOUD_TASKS as readonly string[]).includes(taskType)) {
    if (!cloudAvailable) {
      return {
        target: "local",
        reason: `任务「${taskType}」倾向云端，但未配置 Key，已降级本地`,
        model: LOCAL_MODEL,
      };
    }
    return {
      target: "cloud",
      reason: `任务「${taskType}」走云端`,
      model: CLOUD_MODEL,
    };
  }

  if (
    inputLength >= LONG_INPUT_CHARS &&
    (LOCAL_TASKS as readonly string[]).includes(taskType)
  ) {
    if (cloudAvailable) {
      return {
        target: "cloud",
        reason: `输入较长（≥${LONG_INPUT_CHARS} 字），自动切云端`,
        model: CLOUD_MODEL,
      };
    }
  }

  return {
    target: "local",
    reason: `任务「${taskType}」走本地（省成本/隐私）`,
    model: LOCAL_MODEL,
  };
}

export function getLocalModel() {
  return LOCAL_MODEL;
}

export function getCloudModel() {
  return CLOUD_MODEL;
}
