/**
 * Hedged request: if the first attempt has not settled after `hedgeAfterMs`, start a second
 * one and take whichever succeeds first; the other is aborted. Cuts tail latency on calls
 * that are usually fast but occasionally stall, at the cost of one extra call only when slow.
 * A failed attempt starts the hedge immediately instead of waiting for the timer, unless
 * `retryIf` says a second call cannot help (e.g. quota / rate limit), which fails fast.
 */
export type HedgeResult<T> = { value: T; attempts: number; winner: number };

export function hedged<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: { hedgeAfterMs: number; signal?: AbortSignal; retryIf?: (err: unknown) => boolean },
): Promise<HedgeResult<T>> {
  const { hedgeAfterMs, signal, retryIf = () => true } = options;
  return new Promise((resolve, reject) => {
    // An aborted attempt may still be billed by the provider, but it reports no usage.
    const controllers: AbortController[] = [];
    let failures = 0;
    let lastError: unknown;
    let settled = false;
    const abortReason = () => signal?.reason ?? new DOMException("Aborted", "AbortError");

    const finish = (action: () => void, winner?: AbortController) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      for (const c of controllers) if (c !== winner) c.abort();
      action();
    };
    const onAbort = () => finish(() => reject(abortReason()));

    const start = () => {
      if (settled || controllers.length >= 2) return;
      const controller = new AbortController();
      controllers.push(controller);
      const attempt = controllers.length;
      run(controller.signal).then(
        (value) => finish(() => resolve({ value, attempts: controllers.length, winner: attempt }), controller),
        (err) => {
          if (settled) return;
          failures++;
          lastError = err;
          if (!retryIf(err)) {
            finish(() => reject(err));
          } else if (controllers.length < 2) {
            clearTimeout(timer);
            start();
          } else if (failures >= controllers.length) {
            finish(() => reject(lastError));
          }
        },
      );
    };

    if (signal?.aborted) return reject(abortReason());
    const timer = setTimeout(start, hedgeAfterMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    start();
  });
}
