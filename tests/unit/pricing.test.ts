import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_CLOUD_PRICE,
  getCloudPrice,
  KNOWN_CLOUD_PRICES,
  priceForModel,
  priceTokens,
  UsageMeter,
} from "@/lib/ai/pricing";
import { getCloudModel, getStrongCloudModel } from "@/lib/ai/router";

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

describe("priceForModel", () => {
  afterEach(() => {
    delete process.env.CLOUD_MODEL_STRONG;
    delete process.env.CLOUD_STRONG_PRICE_INPUT_PER_M;
    delete process.env.CLOUD_STRONG_PRICE_OUTPUT_PER_M;
  });

  it("prices the standard model, the strong tier and other known models separately", () => {
    process.env.CLOUD_MODEL_STRONG = "gemini-3.8-flash";
    assert.deepEqual(priceForModel(null), getCloudPrice());
    assert.deepEqual(priceForModel(getCloudModel()), getCloudPrice());
    assert.deepEqual(priceForModel("gemini-3.8-flash"), KNOWN_CLOUD_PRICES["gemini-3.8-flash"]);
    assert.deepEqual(priceForModel("gemini-2.5-flash-lite"), KNOWN_CLOUD_PRICES["gemini-2.5-flash-lite"]);
    assert.deepEqual(priceForModel("unknown-model"), getCloudPrice());
  });

  it("applies CLOUD_STRONG_PRICE_* only to the strong model", () => {
    process.env.CLOUD_MODEL_STRONG = "my-strong";
    process.env.CLOUD_STRONG_PRICE_INPUT_PER_M = "2";
    process.env.CLOUD_STRONG_PRICE_OUTPUT_PER_M = "8";
    assert.deepEqual(priceForModel("my-strong"), { inputPerM: 2, outputPerM: 8 });
    assert.deepEqual(priceForModel(null), getCloudPrice());
  });

  it("disables the strong tier when CLOUD_MODEL_STRONG is empty or equals CLOUD_MODEL", () => {
    process.env.CLOUD_MODEL_STRONG = "";
    assert.equal(getStrongCloudModel(), null);
    process.env.CLOUD_MODEL_STRONG = getCloudModel();
    assert.equal(getStrongCloudModel(), null);
  });
});

describe("UsageMeter", () => {
  afterEach(() => {
    delete process.env.CLOUD_MODEL_STRONG;
  });

  it("returns null when no call reported usage", () => {
    assert.equal(new UsageMeter(PRICE).summary(), null);
  });

  it("prices each cloud call by its model and savings at the standard rate", () => {
    process.env.CLOUD_MODEL_STRONG = "gemini-3.8-flash";
    const meter = new UsageMeter();
    meter.add("cloud", { promptTokens: 1_000_000, completionTokens: 0 });
    meter.add("cloud", { promptTokens: 1_000_000, completionTokens: 0 }, "gemini-3.8-flash");
    meter.add("local", { promptTokens: 1_000_000, completionTokens: 0 }, "gemma4:latest");
    const usage = meter.summary();
    assert.ok(usage);
    assert.ok(Math.abs(usage.costUsd - (DEFAULT_CLOUD_PRICE.inputPerM + 0.75)) < 1e-12);
    assert.ok(Math.abs(usage.savedUsd - DEFAULT_CLOUD_PRICE.inputPerM) < 1e-12);
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
