/**
 * Resource guardrails: per-client rate limit, run timeout, output token cap.
 * The rate limiter is in-memory, so on serverless it is per instance (best effort).
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Requests per client per minute; 0 disables the limiter. */
export const RATE_LIMIT_PER_MIN = envInt("AI_RATE_LIMIT_PER_MIN", 20);
/** Whole-run budget including tool calls and fallback. */
export const RUN_TIMEOUT_MS = envInt("AI_RUN_TIMEOUT_MS", 120_000);
/** Passed as max_tokens (cloud) / num_predict (Ollama). */
export const MAX_OUTPUT_TOKENS = envInt("AI_MAX_OUTPUT_TOKENS", 4096);

const WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 5000;
const hitsByClient = new Map<string, number[]>();

export function clientKeyFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip")?.trim() || "local";
}

export function checkRateLimit(
  key: string,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSec: number; limit: number } {
  if (RATE_LIMIT_PER_MIN === 0) return { ok: true };

  const recent = (hitsByClient.get(key) ?? []).filter(
    (t) => now - t < WINDOW_MS,
  );

  if (recent.length >= RATE_LIMIT_PER_MIN) {
    hitsByClient.set(key, recent);
    const retryAfterSec = Math.max(
      1,
      Math.ceil((WINDOW_MS - (now - recent[0])) / 1000),
    );
    return { ok: false, retryAfterSec, limit: RATE_LIMIT_PER_MIN };
  }

  recent.push(now);
  hitsByClient.set(key, recent);

  if (hitsByClient.size > MAX_TRACKED_CLIENTS) {
    for (const [k, times] of hitsByClient) {
      if (times.every((t) => now - t >= WINDOW_MS)) hitsByClient.delete(k);
    }
  }

  return { ok: true };
}
