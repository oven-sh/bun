// Shared by every fixture. Each fixture prints one JSON object per line on
// stdout; the test parses those lines. Without a display (ssh, CI) AppKit runs
// off screen and every assertion still applies; only if the frameworks cannot
// be loaded at all (ERR_OBJC_UNAVAILABLE) does the fixture print
// `SKIP no-window-server` and exit 0.

export function emit(event: Record<string, unknown>): void {
  console.log(JSON.stringify(event));
}

export async function run(body: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await body();
  } catch (e) {
    if ((e as { code?: string })?.code === "ERR_OBJC_UNAVAILABLE") {
      console.log("SKIP no-window-server");
      process.exit(0);
    }
    throw e;
  }
}

/** Resolves once `cond()` gives (or resolves to) a truthy value; rejects with `what` after `timeoutMs`. Polls on a 5 ms timer. */
export async function waitFor(cond: () => unknown, what: string | (() => string), timeoutMs = 1000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!(await cond())) {
    if (performance.now() > deadline)
      throw new Error(`timed out waiting for ${typeof what === "string" ? what : what()}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

export const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
