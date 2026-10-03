/**
 * Token → USD estimates. Local (Ollama) calls cost nothing; their tokens are priced
 * at the cloud rate to show what keeping work local saved.
 */
import type { AiRouteTarget, RunUsage, TokenUsage } from "./types";

export type ModelPrice = {
  /** USD per 1M input tokens. */
  inputPerM: number;
  /** USD per 1M output tokens (incl. thinking tokens). */
  outputPerM: number;
};

/** gemini-3.1-flash-lite paid tier (ai.google.dev/gemini-api/docs/pricing, checked 2026-10). */
export const DEFAULT_CLOUD_PRICE: ModelPrice = { inputPerM: 0.25, outputPerM: 1.5 };

function envNumber(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Override with CLOUD_PRICE_INPUT_PER_M / CLOUD_PRICE_OUTPUT_PER_M when switching CLOUD_MODEL. */
export function getCloudPrice(): ModelPrice {
  return {
    inputPerM: envNumber("CLOUD_PRICE_INPUT_PER_M") ?? DEFAULT_CLOUD_PRICE.inputPerM,
    outputPerM: envNumber("CLOUD_PRICE_OUTPUT_PER_M") ?? DEFAULT_CLOUD_PRICE.outputPerM,
  };
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
  private readonly price: ModelPrice;

  constructor(price: ModelPrice = getCloudPrice()) {
    this.price = price;
  }

  add(target: AiRouteTarget, usage: TokenUsage): void {
    this.totals[target].promptTokens += usage.promptTokens;
    this.totals[target].completionTokens += usage.completionTokens;
    this.calls += 1;
  }

  /** Null when no call reported usage (blocked runs, providers that omit it). */
  summary(): RunUsage | null {
    if (this.calls === 0) return null;
    const { local, cloud } = this.totals;
    return {
      promptTokens: local.promptTokens + cloud.promptTokens,
      completionTokens: local.completionTokens + cloud.completionTokens,
      calls: this.calls,
      costUsd: priceTokens(cloud, this.price),
      savedUsd: priceTokens(local, this.price),
    };
  }
}
