// Shared by every fixture. Each fixture prints one JSON object per line on
// stdout; the test parses those lines. Without a display (ssh, CI) AppKit runs
// off screen and every assertion still applies; only if the frameworks cannot
// be loaded at all (ERR_APPKIT_UNAVAILABLE) does the fixture print
// `SKIP no-window-server` and exit 0.

export function emit(event: Record<string, unknown>): void {
  console.log(JSON.stringify(event));
}

export async function run(body: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await body();
  } catch (e) {
    if ((e as { code?: string })?.code === "ERR_APPKIT_UNAVAILABLE") {
      console.log("SKIP no-window-server");
      process.exit(0);
    }
    throw e;
  }
}

/** Resolves once `cond()` is truthy; rejects with `what` after `timeoutMs`. Polls on a 5 ms timer. */
export function waitFor(cond: () => unknown, what: string, timeoutMs = 1000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (cond()) return resolve();
      if (performance.now() > deadline) return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(poll, 5);
    };
    poll();
  });
}

export const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
