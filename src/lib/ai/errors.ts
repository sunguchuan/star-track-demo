/**
 * Normalize raw Ollama / cloud errors into AiProviderError
 * so the Gateway can decide fallbacks (quota → local, ollama_offline → cloud).
 */
export type AiErrorCode =
  | "quota_exhausted"
  | "rate_limited"
  | "auth"
  | "model_unavailable"
  | "context_too_long"
  | "provider_unavailable"
  | "ollama_offline"
  | "network"
  | "timeout"
  | "aborted"
  | "unknown";

export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly hint: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly provider: "local" | "cloud";

  constructor(options: {
    code: AiErrorCode;
    message: string;
    hint: string;
    retryable: boolean;
    provider: "local" | "cloud";
    status?: number;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "AiProviderError";
    this.code = options.code;
    this.hint = options.hint;
    this.retryable = options.retryable;
    this.provider = options.provider;
    this.status = options.status;
  }
}

function extractText(detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed) return "";

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const fromObj = (obj: Record<string, unknown>): string => {
      if (typeof obj.message === "string") return obj.message;
      if (typeof obj.error === "string") return obj.error;
      if (obj.error && typeof obj.error === "object") {
        const inner = obj.error as Record<string, unknown>;
        if (typeof inner.message === "string") return inner.message;
      }
      return "";
    };

    if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object") {
      return fromObj(parsed[0] as Record<string, unknown>) || trimmed;
    }
    if (parsed && typeof parsed === "object") {
      return fromObj(parsed as Record<string, unknown>) || trimmed;
    }
  } catch {
    // keep raw
  }

  return trimmed;
}

function classifyFromStatusAndText(
  status: number | undefined,
  text: string,
  provider: "local" | "cloud",
): Pick<AiProviderError, "code" | "message" | "hint" | "retryable"> {
  const lower = text.toLowerCase();

  if (
    status === 429 ||
    /resource_exhausted|exceeded your current quota|quota|rate limit|too many requests/i.test(
      text,
    )
  ) {
    const isQuota =
      /quota|resource_exhausted|billing|free.?tier|rpd|tokens?/i.test(text) &&
      !/per minute|rpm|retry in \d/i.test(lower);

    if (isQuota || /quota|resource_exhausted|billing|free.?tier/i.test(text)) {
      return {
        code: "quota_exhausted",
        message: "云端额度已用完（配额 / Token 耗尽）",
        hint:
          provider === "cloud"
            ? "可改用「仅本地」、换模型，或等待配额重置后再试。"
            : "请稍后重试。",
        retryable: true,
      };
    }

    return {
      code: "rate_limited",
      message: "请求过于频繁，已被限流",
      hint: "请等待几秒后重试；自动路由下可能会降级到本地。",
      retryable: true,
    };
  }

  if (status === 401 || status === 403 || /invalid.?api.?key|unauthor/i.test(text)) {
    return {
      code: "auth",
      message: "云端鉴权失败",
      hint: "请检查 .env.local 中的 OPENAI_API_KEY 是否有效。",
      retryable: false,
    };
  }

  if (
    status === 404 ||
    /no longer available|model .+ not found|does not exist|not found/i.test(text)
  ) {
    return {
      code: "model_unavailable",
      message:
        provider === "cloud"
          ? "云端模型不可用或已下线"
          : "本地模型未找到",
      hint:
        provider === "cloud"
          ? "请在 .env.local 更新 CLOUD_MODEL（例如 gemini-3.1-flash-lite）。"
          : "请运行 ollama pull <模型名>，并确认 OLLAMA_MODEL 配置正确。",
      retryable: false,
    };
  }

  if (
    /context.?length|maximum context|too many tokens|token.?limit|prompt is too long/i.test(
      text,
    )
  ) {
    return {
      code: "context_too_long",
      message: "输入过长，超出模型上下文限制",
      hint: "请缩短笔记内容后再试。",
      retryable: false,
    };
  }

  if (
    (status && status >= 500) ||
    /overloaded|unavailable|service.?unavailable|bad gateway|gateway timeout/i.test(text)
  ) {
    return {
      code: "provider_unavailable",
      message: `${provider === "cloud" ? "云端" : "本地"}服务暂时不可用${status ? ` (${status})` : ""}`,
      hint:
        provider === "cloud"
          ? "云端模型繁忙或临时故障；自动路由下会降级到本地，也可稍后重试。"
          : "请稍后重试；也可切换到另一侧模型。",
      retryable: true,
    };
  }

  return {
    code: "unknown",
    message:
      extractText(text).slice(0, 280) ||
      `${provider === "cloud" ? "云端" : "本地"}请求失败`,
    hint: "请稍后重试，或切换路由策略。",
    retryable: true,
  };
}

export function toProviderError(
  err: unknown,
  provider: "local" | "cloud",
): AiProviderError {
  if (err instanceof AiProviderError) return err;

  // AbortSignal.timeout() rejects fetch/read with a TimeoutError, not AbortError.
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return new AiProviderError({
      code: "timeout",
      message: "生成超时，已停止",
      hint: "可以缩短输入后重试，或换一侧模型。",
      retryable: true,
      provider,
      cause: err,
    });
  }

  if (err instanceof DOMException && err.name === "AbortError") {
    return new AiProviderError({
      code: "aborted",
      message: "已取消生成",
      hint: "",
      retryable: true,
      provider,
      cause: err,
    });
  }

  if (err instanceof TypeError || (err instanceof Error && /fetch failed|network/i.test(err.message))) {
    if (provider === "local") {
      return new AiProviderError({
        code: "ollama_offline",
        message: "无法连接本地 Ollama",
        hint: "请确认已启动 Ollama（默认 http://127.0.0.1:11434）。",
        retryable: true,
        provider,
        cause: err,
      });
    }
    return new AiProviderError({
      code: "network",
      message: "无法连接云端服务",
      hint: "请检查网络，或改用「仅本地」。",
      retryable: true,
      provider,
      cause: err,
    });
  }

  if (err instanceof Error) {
    const classified = classifyFromStatusAndText(undefined, err.message, provider);
    return new AiProviderError({
      ...classified,
      provider,
      cause: err,
    });
  }

  return new AiProviderError({
    code: "unknown",
    message: "生成失败，请稍后重试",
    hint: "请切换路由策略或检查模型服务。",
    retryable: true,
    provider,
  });
}

export function httpErrorToProviderError(options: {
  provider: "local" | "cloud";
  status: number;
  detail: string;
}): AiProviderError {
  const text = extractText(options.detail) || options.detail;
  const classified = classifyFromStatusAndText(
    options.status,
    text,
    options.provider,
  );
  return new AiProviderError({
    ...classified,
    provider: options.provider,
    status: options.status,
  });
}

/** Transient cloud failures that are safe to fall back to local under auto. */
export function shouldFallbackToLocal(err: unknown): boolean {
  const e = toProviderError(err, "cloud");
  return (
    e.code === "quota_exhausted" ||
    e.code === "rate_limited" ||
    e.code === "provider_unavailable" ||
    e.code === "network"
  );
}

/** Local failures that should fall back to cloud when Key is configured. */
export function shouldFallbackToCloud(err: unknown): boolean {
  const e = toProviderError(err, "local");
  return (
    e.code === "ollama_offline" ||
    e.code === "model_unavailable" ||
    e.code === "network"
  );
}
