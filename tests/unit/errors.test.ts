import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  httpErrorToProviderError,
  shouldFallbackToCloud,
  shouldFallbackToLocal,
  toProviderError,
} from "@/lib/ai/errors";

const cloudHttp = (status: number, detail = "") =>
  httpErrorToProviderError({ provider: "cloud", status, detail });

describe("error classification", () => {
  it("maps HTTP status and provider text to codes", () => {
    assert.equal(
      cloudHttp(429, '{"error":{"message":"You exceeded your current quota"}}').code,
      "quota_exhausted",
    );
    assert.equal(cloudHttp(429, "Rate limit reached, retry in 5s").code, "rate_limited");
    assert.equal(cloudHttp(401, "invalid api key").code, "auth");
    assert.equal(cloudHttp(404, "model not found").code, "model_unavailable");
    assert.equal(cloudHttp(503, "The model is overloaded").code, "provider_unavailable");
    assert.equal(cloudHttp(400, "maximum context length exceeded").code, "context_too_long");
  });

  it("maps connection failures per provider", () => {
    assert.equal(toProviderError(new TypeError("fetch failed"), "local").code, "ollama_offline");
    assert.equal(toProviderError(new TypeError("fetch failed"), "cloud").code, "network");
  });

  it("distinguishes timeout from user abort", () => {
    assert.equal(
      toProviderError(new DOMException("t", "TimeoutError"), "cloud").code,
      "timeout",
    );
    assert.equal(toProviderError(new DOMException("a", "AbortError"), "cloud").code, "aborted");
  });
});

describe("fallback decisions", () => {
  it("cloud → local only for transient failures", () => {
    assert.equal(shouldFallbackToLocal(cloudHttp(429, "quota")), true);
    assert.equal(shouldFallbackToLocal(cloudHttp(429, "rate limit")), true);
    assert.equal(shouldFallbackToLocal(cloudHttp(503)), true);
    assert.equal(shouldFallbackToLocal(new TypeError("fetch failed")), true);
    assert.equal(shouldFallbackToLocal(cloudHttp(401)), false);
    assert.equal(shouldFallbackToLocal(new DOMException("t", "TimeoutError")), false);
  });

  it("local → cloud when Ollama is offline or the model is missing", () => {
    assert.equal(shouldFallbackToCloud(new TypeError("fetch failed")), true);
    assert.equal(
      shouldFallbackToCloud(httpErrorToProviderError({ provider: "local", status: 404, detail: "" })),
      true,
    );
    assert.equal(shouldFallbackToCloud(new DOMException("a", "AbortError")), false);
  });
});
