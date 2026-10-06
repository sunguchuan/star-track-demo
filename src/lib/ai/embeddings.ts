/**
 * Text → vector for the semantic cache and knowledge retrieval. Local-first like the rest
 * of the Gateway: Ollama (embeddinggemma) where a local runtime exists, the cloud
 * OpenAI-compatible /embeddings endpoint (gemini-embedding-001) otherwise or when Ollama fails.
 *
 * Vectors from different models live in different spaces, so every result carries its
 * model name and callers only ever compare vectors of the same model.
 */
import { httpErrorToProviderError, toProviderError } from "./errors";
import { getOllamaBaseUrl } from "./ollama";
import type { AiRouteTarget } from "./types";

export type Embedding = {
  model: string;
  target: AiRouteTarget;
  /** L2-normalized, so cosine similarity is a dot product. */
  vector: Float32Array;
  promptTokens: number | null;
};

/**
 * similarity: question ↔ question (cache). query / document: asymmetric retrieval, where a
 * short question is matched against longer passages.
 */
export type EmbedPurpose = "similarity" | "query" | "document";

export type EmbedInput = { text: string; title?: string };

export const DEFAULT_LOCAL_EMBED_MODEL = "embeddinggemma";
export const DEFAULT_CLOUD_EMBED_MODEL = "gemini-embedding-001";
export const EMBED_TIMEOUT_MS = 8000;
/** Indexing sends whole batches; allow for a cold model load. */
export const EMBED_BATCH_TIMEOUT_MS = 60_000;
const EMBED_BATCH_SIZE = 32;
/** gemini-embedding-001, USD per 1M input tokens. */
const DEFAULT_CLOUD_EMBED_PRICE_PER_M = 0.15;

export function cloudEmbedPricePerM(): number {
  const value = Number(process.env.CLOUD_EMBED_PRICE_PER_M);
  return Number.isFinite(value) && value >= 0 && process.env.CLOUD_EMBED_PRICE_PER_M?.trim()
    ? value
    : DEFAULT_CLOUD_EMBED_PRICE_PER_M;
}

export function embeddingCostUsd(target: AiRouteTarget, tokens: number): number {
  return target === "cloud" ? (tokens * cloudEmbedPricePerM()) / 1_000_000 : 0;
}

export function getLocalEmbedModel(): string {
  return process.env.OLLAMA_EMBED_MODEL?.trim() || DEFAULT_LOCAL_EMBED_MODEL;
}

export function getCloudEmbedModel(): string {
  return process.env.CLOUD_EMBED_MODEL?.trim() || DEFAULT_CLOUD_EMBED_MODEL;
}

export function normalize(values: ArrayLike<number>): Float32Array {
  const vector = Float32Array.from(values);
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}

/** Both vectors normalized; mismatched lengths (different models) never match. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * EmbeddingGemma is trained with task prefixes: STS for question ↔ question, and separate
 * query / document prompts for retrieval. Other models get the plain text (plus title).
 */
export function embedPrompt(model: string, input: EmbedInput, purpose: EmbedPurpose): string {
  if (!model.startsWith("embeddinggemma")) {
    return input.title ? `${input.title}\n${input.text}` : input.text;
  }
  if (purpose === "document") return `title: ${input.title || "none"} | text: ${input.text}`;
  if (purpose === "query") return `task: search result | query: ${input.text}`;
  return `task: sentence similarity | query: ${input.text}`;
}

type BatchResult = { model: string; vectors: Float32Array[]; promptTokens: number | null };

async function embedLocal(
  inputs: EmbedInput[],
  purpose: EmbedPurpose,
  signal: AbortSignal,
): Promise<BatchResult> {
  const model = getLocalEmbedModel();
  const prompts = inputs.map((input) => embedPrompt(model, input, purpose));
  let res: Response;
  try {
    res = await fetch(`${getOllamaBaseUrl()}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Small model; keep it resident so the cache lookup doesn't pay a ~30 s cold load.
      body: JSON.stringify({
        model,
        input: prompts.length === 1 ? prompts[0] : prompts,
        keep_alive: process.env.OLLAMA_EMBED_KEEP_ALIVE?.trim() || "1h",
      }),
      signal,
    });
  } catch (err) {
    throw toProviderError(err, "local");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw httpErrorToProviderError({
      provider: "local",
      status: /not found|pull/i.test(detail) ? 404 : res.status,
      detail: detail || res.statusText,
    });
  }
  const data = (await res.json()) as { embeddings?: number[][]; prompt_eval_count?: number };
  const rows = data.embeddings ?? [];
  if (rows.length !== inputs.length || rows.some((v) => !v?.length)) {
    throw toProviderError(new Error("Ollama 未返回向量"), "local");
  }
  return { model, vectors: rows.map(normalize), promptTokens: data.prompt_eval_count ?? null };
}

async function embedCloud(
  inputs: EmbedInput[],
  purpose: EmbedPurpose,
  signal: AbortSignal,
): Promise<BatchResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw httpErrorToProviderError({ provider: "cloud", status: 401, detail: "未配置 OPENAI_API_KEY" });
  }
  const base = process.env.OPENAI_BASE_URL?.replace(/\/$/, "") ?? "https://api.openai.com/v1";
  const model = getCloudEmbedModel();
  const texts = inputs.map((input) => embedPrompt(model, input, purpose));
  let res: Response;
  try {
    res = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: texts.length === 1 ? texts[0] : texts }),
      signal,
    });
  } catch (err) {
    throw toProviderError(err, "cloud");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw httpErrorToProviderError({ provider: "cloud", status: res.status, detail: detail || res.statusText });
  }
  const data = (await res.json()) as {
    data?: { embedding?: number[]; index?: number }[];
    usage?: { prompt_tokens?: number };
  };
  const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (rows.length !== inputs.length || rows.some((r) => !r.embedding?.length)) {
    throw toProviderError(new Error("云端未返回向量"), "cloud");
  }
  return {
    model,
    vectors: rows.map((r) => normalize(r.embedding!)),
    promptTokens: data.usage?.prompt_tokens ?? null,
  };
}

/**
 * Local first when a local runtime exists, cloud as fallback. Throws when neither side
 * is usable; the cache then simply behaves as a miss.
 */
export async function embedText(options: {
  text: string;
  localRuntime: boolean;
  cloudAvailable: boolean;
  purpose?: EmbedPurpose;
  signal?: AbortSignal;
}): Promise<Embedding> {
  const purpose = options.purpose ?? "similarity";
  const input = [{ text: options.text }];
  const attemptSignal = () => {
    const timeout = AbortSignal.timeout(EMBED_TIMEOUT_MS);
    return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  };
  const single = (target: AiRouteTarget, r: BatchResult): Embedding => ({
    model: r.model,
    target,
    vector: r.vectors[0],
    promptTokens: r.promptTokens,
  });
  if (options.localRuntime) {
    try {
      return single("local", await embedLocal(input, purpose, attemptSignal()));
    } catch (err) {
      if (!options.cloudAvailable || options.signal?.aborted) throw err;
    }
  }
  return single("cloud", await embedCloud(input, purpose, attemptSignal()));
}

/** Passages for a retrieval index, on one fixed side so every vector shares a model. */
export async function embedDocuments(options: {
  inputs: EmbedInput[];
  target: AiRouteTarget;
  signal?: AbortSignal;
}): Promise<{ model: string; target: AiRouteTarget; vectors: Float32Array[]; promptTokens: number }> {
  const embed = options.target === "local" ? embedLocal : embedCloud;
  const vectors: Float32Array[] = [];
  let promptTokens = 0;
  let model = options.target === "local" ? getLocalEmbedModel() : getCloudEmbedModel();
  for (let i = 0; i < options.inputs.length; i += EMBED_BATCH_SIZE) {
    const timeout = AbortSignal.timeout(EMBED_BATCH_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const batch = await embed(options.inputs.slice(i, i + EMBED_BATCH_SIZE), "document", signal);
    model = batch.model;
    vectors.push(...batch.vectors);
    promptTokens += batch.promptTokens ?? 0;
  }
  return { model, target: options.target, vectors, promptTokens };
}
