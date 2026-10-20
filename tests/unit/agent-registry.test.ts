import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAgent, listAgents } from "@/lib/ai/agents/registry";

describe("agent registry", () => {
  it("registers investigate and loads its runner lazily", async () => {
    const def = getAgent("investigate");
    assert.ok(def);
    assert.equal(def.taskType, "investigate");
    assert.equal(typeof def.dataVersion, "function");

    const run = await def.load();
    assert.equal(typeof run, "function");
    assert.equal(run.name, "runInvestigateAgent");
  });

  it("returns undefined for text tasks that are not agents", () => {
    assert.equal(getAgent("chat"), undefined);
    assert.equal(getAgent("summarize"), undefined);
  });

  it("lists registered agents", () => {
    const types = listAgents().map((a) => a.taskType);
    assert.deepEqual(types, ["investigate"]);
  });

  it("exposes a data version for investigate cache partitioning", async () => {
    const version = await getAgent("investigate")!.dataVersion!();
    assert.match(version, /^[0-9a-f]+/);
  });
});
