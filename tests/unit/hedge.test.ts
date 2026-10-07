import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hedged } from "@/lib/ai/hedge";

const HEDGE_MS = 20;

/** Attempt n resolves / rejects after delays[n] ms; records starts and aborts. */
function fakeCalls(plan: { ms: number; fail?: boolean }[]) {
  const started: number[] = [];
  const aborted: number[] = [];
  const run = (signal: AbortSignal) => {
    const n = started.length;
    started.push(n + 1);
    const { ms, fail } = plan[n];
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => (fail ? reject(new Error(`attempt ${n + 1} failed`)) : resolve(`reply ${n + 1}`)), ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        aborted.push(n + 1);
        reject(new Error("aborted"));
      });
    });
  };
  return { run, started, aborted };
}

describe("hedged", () => {
  it("returns the first attempt when it is fast, without a second call", async () => {
    const calls = fakeCalls([{ ms: 5 }]);
    const result = await hedged(calls.run, { hedgeAfterMs: HEDGE_MS });
    await new Promise((r) => setTimeout(r, HEDGE_MS * 2));
    assert.deepEqual(result, { value: "reply 1", attempts: 1, winner: 1 });
    assert.deepEqual(calls.started, [1]);
  });

  it("starts a second attempt when the first stalls, and aborts the loser", async () => {
    const calls = fakeCalls([{ ms: 500 }, { ms: 5 }]);
    const result = await hedged(calls.run, { hedgeAfterMs: HEDGE_MS });
    assert.deepEqual(result, { value: "reply 2", attempts: 2, winner: 2 });
    assert.deepEqual(calls.aborted, [1]);
  });

  it("starts the hedge immediately when the first attempt fails", async () => {
    const calls = fakeCalls([{ ms: 1, fail: true }, { ms: 1 }]);
    const started = Date.now();
    const result = await hedged(calls.run, { hedgeAfterMs: 1_000 });
    assert.equal(result.value, "reply 2");
    assert.ok(Date.now() - started < 500, "did not wait for the hedge timer");
  });

  it("fails fast without a second call when retryIf rejects the error", async () => {
    const calls = fakeCalls([{ ms: 1, fail: true }, { ms: 1 }]);
    const result = hedged(calls.run, { hedgeAfterMs: HEDGE_MS, retryIf: () => false });
    await assert.rejects(result, /attempt 1 failed/);
    await new Promise((r) => setTimeout(r, HEDGE_MS * 2));
    assert.deepEqual(calls.started, [1]);
  });

  it("rejects with the last error when every attempt fails", async () => {
    const calls = fakeCalls([{ ms: 1, fail: true }, { ms: 1, fail: true }]);
    await assert.rejects(hedged(calls.run, { hedgeAfterMs: HEDGE_MS }), /attempt 2 failed/);
  });

  it("rejects and aborts every attempt when the caller aborts", async () => {
    const calls = fakeCalls([{ ms: 500 }, { ms: 500 }]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("caller gave up")), HEDGE_MS * 2);
    await assert.rejects(hedged(calls.run, { hedgeAfterMs: HEDGE_MS, signal: controller.signal }), /caller gave up/);
    assert.deepEqual(calls.aborted.sort(), [1, 2]);
  });
});
