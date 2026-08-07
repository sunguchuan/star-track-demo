import type { StreamEvent } from "./types";

export function sseEncode(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

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
