import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { isLocalAiRuntime, resolveRoute } from "@/lib/ai/router";
import { LONG_INPUT_CHARS, type AiStrategy, type AiTaskType } from "@/lib/ai/types";

function route(
  taskType: AiTaskType,
  strategy: AiStrategy,
  opts: { cloud?: boolean; local?: boolean; length?: number } = {},
) {
  return resolveRoute({
    taskType,
    strategy,
    inputLength: opts.length ?? 100,
    cloudAvailable: opts.cloud ?? true,
    localRuntime: opts.local ?? true,
  }).target;
}

describe("resolveRoute", () => {
  it("hosted runtime always routes to cloud, whatever the strategy", () => {
    for (const strategy of ["auto", "only-local", "only-cloud"] as const) {
      assert.equal(route("summarize", strategy, { local: false }), "cloud");
      assert.equal(route("summarize", strategy, { local: false, cloud: false }), "cloud");
    }
  });

  it("explicit strategies win on a local runtime", () => {
    assert.equal(route("analyze", "only-local"), "local");
    assert.equal(route("summarize", "only-cloud"), "cloud");
    assert.equal(route("summarize", "only-cloud", { cloud: false }), "local");
  });

  it("auto sends cloud tasks to cloud, or local when no key", () => {
    for (const task of ["analyze", "refactor", "investigate"] as const) {
      assert.equal(route(task, "auto"), "cloud");
      assert.equal(route(task, "auto", { cloud: false }), "local");
    }
  });

  it("auto keeps short local tasks local and moves long ones to cloud", () => {
    assert.equal(route("summarize", "auto"), "local");
    assert.equal(route("summarize", "auto", { length: LONG_INPUT_CHARS }), "cloud");
    assert.equal(
      route("summarize", "auto", { length: LONG_INPUT_CHARS, cloud: false }),
      "local",
    );
  });
});

describe("isLocalAiRuntime", () => {
  const KEYS = [
    "AI_FORCE_CLOUD",
    "AI_FORCE_LOCAL",
    "VERCEL",
    "VERCEL_ENV",
    "AWS_LAMBDA_FUNCTION_NAME",
    "NETLIFY",
  ];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function withEnv(env: Record<string, string>) {
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, env);
    return isLocalAiRuntime();
  }

  it("defaults to local", () => assert.equal(withEnv({}), true));
  it("detects Vercel / Lambda / Netlify as hosted", () => {
    assert.equal(withEnv({ VERCEL: "1" }), false);
    assert.equal(withEnv({ VERCEL_ENV: "preview" }), false);
    assert.equal(withEnv({ AWS_LAMBDA_FUNCTION_NAME: "fn" }), false);
    assert.equal(withEnv({ NETLIFY: "true" }), false);
  });
  it("force flags override detection, cloud first", () => {
    assert.equal(withEnv({ VERCEL: "1", AI_FORCE_LOCAL: "1" }), true);
    assert.equal(withEnv({ AI_FORCE_CLOUD: "1" }), false);
    assert.equal(withEnv({ AI_FORCE_CLOUD: "1", AI_FORCE_LOCAL: "1" }), false);
  });
});
