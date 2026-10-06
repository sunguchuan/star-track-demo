/**
 * Token → USD estimates, per model. Local (Ollama) calls cost nothing; their tokens are
 * priced at the standard cloud model's rate to show what keeping work local saved.
 */
import { getCloudModel, getStrongCloudModel } from "./router";
import type { AiRouteTarget, RunUsage, TokenUsage } from "./types";

export type ModelPrice = {
  /** USD per 1M input tokens. */
  inputPerM: number;
  /** USD per 1M output tokens (incl. thinking tokens). */
  outputPerM: number;
};

/** gemini-3.1-flash-lite paid tier (ai.google.dev/gemini-api/docs/pricing, checked 2026-10). */
export const DEFAULT_CLOUD_PRICE: ModelPrice = { inputPerM: 0.25, outputPerM: 1.5 };

/** Paid-tier list prices (checked 2026-10; 3.6–3.8 Flash at the 2026 introductory rate). */
export const KNOWN_CLOUD_PRICES: Record<string, ModelPrice> = {
  "gemini-3.1-flash-lite": DEFAULT_CLOUD_PRICE,
  "gemini-3.8-flash": { inputPerM: 0.75, outputPerM: 3.75 },
  "gemini-3.7-flash": { inputPerM: 0.75, outputPerM: 3.75 },
  "gemini-3.6-flash": { inputPerM: 0.75, outputPerM: 3.75 },
  "gemini-3.5-flash": { inputPerM: 1.5, outputPerM: 9 },
  "gemini-3.5-flash-lite": { inputPerM: 0.3, outputPerM: 2.5 },
  "gemini-2.5-flash": { inputPerM: 0.3, outputPerM: 2.5 },
  "gemini-2.5-flash-lite": { inputPerM: 0.1, outputPerM: 0.4 },
};

function envNumber(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function priceWithOverrides(prefix: string, base: ModelPrice): ModelPrice {
  return {
    inputPerM: envNumber(`${prefix}_INPUT_PER_M`) ?? base.inputPerM,
    outputPerM: envNumber(`${prefix}_OUTPUT_PER_M`) ?? base.outputPerM,
  };
}

/** Standard cloud model (CLOUD_MODEL); override with CLOUD_PRICE_INPUT_PER_M / _OUTPUT_PER_M. */
export function getCloudPrice(): ModelPrice {
  return priceWithOverrides(
    "CLOUD_PRICE",
    KNOWN_CLOUD_PRICES[getCloudModel()] ?? DEFAULT_CLOUD_PRICE,
  );
}

/** Strong tier (CLOUD_MODEL_STRONG); override with CLOUD_STRONG_PRICE_INPUT_PER_M / _OUTPUT_PER_M. */
export function getStrongPrice(): ModelPrice {
  const model = getStrongCloudModel();
  return priceWithOverrides(
    "CLOUD_STRONG_PRICE",
    (model ? KNOWN_CLOUD_PRICES[model] : undefined) ?? getCloudPrice(),
  );
}

export function priceForModel(model?: string | null): ModelPrice {
  if (!model || model === getCloudModel()) return getCloudPrice();
  if (model === getStrongCloudModel()) return getStrongPrice();
  return KNOWN_CLOUD_PRICES[model] ?? getCloudPrice();
}

export function priceTokens(usage: TokenUsage, price: ModelPrice): number {
  return (
    (usage.promptTokens * price.inputPerM + usage.completionTokens * price.outputPerM) /
    1_000_000
  );
}

/** Accumulates provider-reported usage for one Gateway run. */
export class UsageMeter {
  private readonly totals: Record<AiRouteTarget, TokenUsage> = {
    local: { promptTokens: 0, completionTokens: 0 },
    cloud: { promptTokens: 0, completionTokens: 0 },
  };
  private calls = 0;
  private costUsd = 0;
  private savedUsd = 0;
  private readonly fixedPrice: ModelPrice | null;

  /** A fixed price applies to every model (tests); otherwise each call is priced by its model. */
  constructor(price: ModelPrice | null = null) {
    this.fixedPrice = price;
  }

  add(target: AiRouteTarget, usage: TokenUsage, model?: string | null): void {
    this.totals[target].promptTokens += usage.promptTokens;
    this.totals[target].completionTokens += usage.completionTokens;
    this.calls += 1;
    if (target === "cloud") {
      this.costUsd += priceTokens(usage, this.fixedPrice ?? priceForModel(model));
    } else {
      this.savedUsd += priceTokens(usage, this.fixedPrice ?? getCloudPrice());
    }
  }

  /** Null when no call reported usage (blocked runs, providers that omit it). */
  summary(): RunUsage | null {
    if (this.calls === 0) return null;
    const { local, cloud } = this.totals;
    return {
      promptTokens: local.promptTokens + cloud.promptTokens,
      completionTokens: local.completionTokens + cloud.completionTokens,
      calls: this.calls,
      costUsd: this.costUsd,
      savedUsd: this.savedUsd,
    };
  }
}
