// Shared by every fixture. Each fixture prints one JSON object per line on
// stdout; the test parses those lines. Without a display (ssh, CI) AppKit runs
// off screen and every assertion still applies; only if the frameworks cannot
// be loaded at all (ERR_OBJC_UNAVAILABLE) does the fixture print
// `SKIP no-window-server` and exit 0.
import { basename } from "node:path";

export function emit(event: Record<string, unknown>): void {
  console.log(JSON.stringify(event));
}

/**
 * A process's NSUserDefaults domain is its executable's name as launched; for
 * `bun x.ts` that is the one ~/Library/Preferences/bun.plist every script
 * shares, so nothing bun:appkit does may persist there. appkit.test.ts runs
 * each fixture through a symlink named `bun-appkit-fixture-…`, which gives it
 * an empty domain of its own: at exit, report every key written to it (the
 * test fails on any) and delete it. Run by hand under the real name the
 * domain is the shared one and is left alone; a fixture that never loaded the
 * bridge has written nothing and loads nothing here either.
 */
function reportUserDefaults(): void {
  const domain = basename(process.argv0);
  if (!domain.startsWith("bun-appkit-fixture-")) return;
  if (!require.cache["bun:objc"] && !require.cache["bun:appkit"]) return;
  const { objc } = require("bun:objc");
  const defaults = objc.classes.NSUserDefaults.standardUserDefaults();
  const written = defaults.persistentDomainForName_(domain);
  emit({ step: "user defaults", added: written ? objc.js(written.allKeys()) : [] });
  defaults.removePersistentDomainForName_(domain);
  defaults.synchronize();
}

export async function run(body: () => unknown | Promise<unknown>): Promise<void> {
  process.on("exit", reportUserDefaults);
  try {
    await body();
  } catch (e) {
    if ((e as { code?: string })?.code === "ERR_OBJC_UNAVAILABLE") {
      process.off("exit", reportUserDefaults);
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
