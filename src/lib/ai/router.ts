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
  if (process.env.VERCEL === "1") return false;
  return true;
}

function preferCloudWhenLocalUnavailable(
  cloudAvailable: boolean,
  reason: string,
): RouteDecision | null {
  if (!cloudAvailable) return null;
  return {
    target: "cloud",
    reason,
    model: CLOUD_MODEL,
  };
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

  if (strategy === "only-local") {
    if (!localRuntime) {
      const hosted = preferCloudWhenLocalUnavailable(
        cloudAvailable,
        "线上环境无法连接本机 Ollama，已自动改走云端",
      );
      if (hosted) return hosted;
    }
    return {
      target: "local",
      reason: "用户强制仅本地",
      model: LOCAL_MODEL,
    };
  }

  if (strategy === "only-cloud") {
    if (!cloudAvailable) {
      if (localRuntime) {
        return {
          target: "local",
          reason: "强制云端但未配置 OPENAI_API_KEY，已降级本地",
          model: LOCAL_MODEL,
        };
      }
      return {
        target: "cloud",
        reason: "强制云端但未配置 OPENAI_API_KEY（请求将失败）",
        model: CLOUD_MODEL,
      };
    }
    return {
      target: "cloud",
      reason: "用户强制仅云端",
      model: CLOUD_MODEL,
    };
  }

  // Hosted / non-local: prefer cloud whenever configured.
  if (!localRuntime) {
    const hosted = preferCloudWhenLocalUnavailable(
      cloudAvailable,
      "检测到非本机运行环境，默认走云端",
    );
    if (hosted) return hosted;
  }

  // auto
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
