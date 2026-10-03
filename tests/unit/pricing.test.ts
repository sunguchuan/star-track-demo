import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_CLOUD_PRICE,
  getCloudPrice,
  priceTokens,
  UsageMeter,
} from "@/lib/ai/pricing";

const PRICE = { inputPerM: 0.25, outputPerM: 1.5 };

describe("priceTokens", () => {
  it("prices input and output tokens per million", () => {
    assert.equal(priceTokens({ promptTokens: 1_000_000, completionTokens: 0 }, PRICE), 0.25);
    assert.equal(priceTokens({ promptTokens: 0, completionTokens: 1_000_000 }, PRICE), 1.5);
    assert.ok(
      Math.abs(priceTokens({ promptTokens: 4000, completionTokens: 1000 }, PRICE) - 0.0025) < 1e-12,
    );
  });
});

describe("getCloudPrice", () => {
  afterEach(() => {
    delete process.env.CLOUD_PRICE_INPUT_PER_M;
    delete process.env.CLOUD_PRICE_OUTPUT_PER_M;
  });

  it("defaults to the Gemini Flash-Lite list price", () => {
    assert.deepEqual(getCloudPrice(), DEFAULT_CLOUD_PRICE);
  });

  it("reads env overrides and ignores invalid values", () => {
    process.env.CLOUD_PRICE_INPUT_PER_M = "0.15";
    process.env.CLOUD_PRICE_OUTPUT_PER_M = "not-a-number";
    assert.deepEqual(getCloudPrice(), {
      inputPerM: 0.15,
      outputPerM: DEFAULT_CLOUD_PRICE.outputPerM,
    });
  });
});

describe("UsageMeter", () => {
  it("returns null when no call reported usage", () => {
    assert.equal(new UsageMeter(PRICE).summary(), null);
  });

  it("sums calls, charges cloud tokens and counts local tokens as savings", () => {
    const meter = new UsageMeter(PRICE);
    meter.add("cloud", { promptTokens: 2000, completionTokens: 500 });
    meter.add("cloud", { promptTokens: 2000, completionTokens: 500 });
    meter.add("local", { promptTokens: 4000, completionTokens: 1000 });
    const usage = meter.summary();
    assert.ok(usage);
    assert.equal(usage.promptTokens, 8000);
    assert.equal(usage.completionTokens, 2000);
    assert.equal(usage.calls, 3);
    assert.ok(Math.abs(usage.costUsd - 0.0025) < 1e-12);
    assert.ok(Math.abs(usage.savedUsd - 0.0025) < 1e-12);
  });
});
