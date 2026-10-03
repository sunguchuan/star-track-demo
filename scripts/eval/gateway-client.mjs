/**
 * Runs one request against POST /api/ai/chat and collects the SSE stream
 * into a plain record the scorers can read.
 */

const CASE_TIMEOUT_MS = 180_000;
const MAX_429_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runCase({ baseUrl, input, taskType = "investigate", strategy }) {
  for (let attempt = 0; ; attempt++) {
    const started = performance.now();
    const res = await fetch(`${baseUrl}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, taskType, strategy }),
      signal: AbortSignal.timeout(CASE_TIMEOUT_MS),
    });

    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      const wait = Number(res.headers.get("Retry-After") ?? "10");
      await sleep((Number.isFinite(wait) ? wait : 10) * 1000);
      continue;
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      return { httpStatus: res.status, httpError: text.slice(0, 300), ...emptyRun() };
    }
    return { httpStatus: res.status, ...(await collect(res.body, started)) };
  }
}

function emptyRun() {
  return {
    runId: null,
    metas: [],
    guardrails: [],
    toolCalls: [],
    toolResults: [],
    errors: [],
    output: "",
    outputAfterLastError: true,
    plan: null,
    ungroundedRefs: [],
    usage: null,
    ttftMs: null,
    totalMs: null,
  };
}

async function collect(body, started) {
  const run = emptyRun();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastErrorAt = -1;

  const handle = (event) => {
    switch (event.type) {
      case "run":
        run.runId = event.id;
        break;
      case "meta":
        run.metas.push({ via: event.via, model: event.model, reason: event.reason });
        break;
      case "guardrail":
        run.guardrails.push({
          stage: event.stage,
          rule: event.rule,
          action: event.action,
          detail: event.detail,
        });
        break;
      case "tool_call":
        run.toolCalls.push({ name: event.name, arguments: event.arguments });
        break;
      case "tool_result":
        run.toolResults.push({ name: event.name, ok: event.ok });
        break;
      case "plan":
        run.plan = event.plan;
        run.ungroundedRefs = event.ungroundedRefs ?? [];
        break;
      case "delta":
        if (run.ttftMs === null) run.ttftMs = Math.round(performance.now() - started);
        run.output += event.text;
        break;
      case "usage":
        run.usage = {
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          calls: event.calls,
          costUsd: event.costUsd,
          savedUsd: event.savedUsd,
        };
        break;
      case "error":
        run.errors.push({ code: event.code, message: event.message });
        lastErrorAt = run.output.length;
        break;
      case "done":
        run.totalMs = Math.round(performance.now() - started);
        break;
    }
  };

  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          handle(JSON.parse(line.slice(5).trim()));
        } catch {
          // ignore malformed lines
        }
      }
    }
  }

  run.totalMs ??= Math.round(performance.now() - started);
  // A fallback emits an error and then keeps streaming; only a trailing error means failure.
  run.outputAfterLastError = lastErrorAt === -1 || run.output.length > lastErrorAt;
  return run;
}

export async function fetchReferenceData(baseUrl) {
  const get = async (path) => {
    const res = await fetch(`${baseUrl}${path}`);
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
  };
  const [summary, batches, alerts] = await Promise.all([
    get("/api/fab/summary"),
    get("/api/fab/batches?limit=50"),
    get("/api/fab/alerts?limit=50"),
  ]);
  return { summary, batches, alerts };
}
