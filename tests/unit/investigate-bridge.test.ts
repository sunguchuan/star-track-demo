import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEventBridge } from "@/lib/ai/agents/investigate";

describe("investigate LangGraph event bridge", () => {
  it("does not hang when completion wins the race before a waiter is registered", async () => {
    const bridge = createEventBridge();
    let settled = false;

    // Simulate graph.invoke finishing in the same turn as "queue empty".
    queueMicrotask(() => {
      settled = true;
      bridge.kick();
    });

    assert.equal(bridge.pending.length, 0);
    assert.equal(settled, false);
    await bridge.waitUntil(() => settled || bridge.pending.length > 0);
    assert.equal(settled, true);
  });

  it("delivers an event that arrives between empty-check and waiter registration", async () => {
    const bridge = createEventBridge();
    queueMicrotask(() => {
      bridge.emit({ type: "delta", text: "x" });
    });
    await bridge.waitUntil(() => bridge.pending.length > 0);
    assert.equal(bridge.pending[0]?.type, "delta");
  });
});
