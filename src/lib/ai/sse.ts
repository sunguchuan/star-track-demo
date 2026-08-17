import type { StreamEvent } from "./types";

/** Encode an internal StreamEvent as one SSE line (`data: {...}\n\n`) */
export function sseEncode(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Step 5 — Wrap a readable stream as a text/event-stream response for the client */
export function createSseResponse(
  stream: ReadableStream<Uint8Array>,
  init?: ResponseInit,
): Response {
  return new Response(stream, {
    ...init,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...init?.headers,
    },
  });
}
