// HTMLBundle.PendingResponse.onAborted removed itself from
// route.pending_responses and balanced the route ref, but never freed the
// PendingResponse allocation. resumePendingResponses() only deinit()s
// entries still in the list, so every aborted-while-building request leaked
// one PendingResponse struct.
//
// The allocation is tiny, so RSS can't isolate it. We instead count
// `[alloc] new(PendingResponse)` vs `[alloc] destroy(PendingResponse)` in the
// debug-build allocation log (Output.scoped(.alloc)).

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

// BUN_DEBUG_alloc output is only emitted in builds with
// Environment.allow_assert (debug). Release CI lanes skip this; the gate
// runs `bun bd` (debug+ASAN) so it is covered.
test.skipIf(!isDebug)("HTMLBundle.PendingResponse is freed when client aborts during build", async () => {
  using dir = tempDir("html-bundle-abort-leak", {
    "index.html": /* html */ `<!DOCTYPE html>
<html>
  <head><script type="module" src="./app.js"></script></head>
  <body><h1>hi</h1></body>
</html>
`,
    "app.js": `console.log("app");\n`,
    // setup() blocks until the fixture resolves __gateRelease, guaranteeing
    // the route stays in .building while we abort requests against it.
    "plugin.js": `export default {
  name: "gate",
  async setup() {
    globalThis.__gateStarted.resolve();
    await globalThis.__gateRelease.promise;
  },
};
`,
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.js"]\n`,
  });

  // BUN_DEBUG=<path> redirects all scoped debug output to this file so the
  // fixture can poll it as a condition and we can read the final tally here.
  const allocLog = path.join(String(dir), "alloc.log");

  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "bun-serve-html-abort-leak-fixture.ts")],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_DEBUG_alloc: "1",
      BUN_DEBUG: allocLog,
      ALLOC_LOG: allocLog,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const log = readFileSync(allocLog, "utf8");
  const created = [...log.matchAll(/\[alloc\] new\(PendingResponse\)/g)].length;
  const destroyed = [...log.matchAll(/\[alloc\] destroy\(PendingResponse\)/g)].length;

  if (exitCode !== 0) console.error({ stdout, stderr });
  // First fetch + 5 aborted raw sockets => at least 6 PendingResponses. Guard
  // against a future refactor silently skipping the building-state queue.
  expect(created).toBeGreaterThanOrEqual(6);
  // Every PendingResponse that was created must have been destroyed. Before
  // the fix the fixture fails inside `until()` waiting for the aborted
  // allocations to be destroyed (they never are), so exitCode is non-zero
  // and destroyed == 0.
  expect({ created, destroyed }).toEqual({ created, destroyed: created });
  expect(exitCode).toBe(0);
}, 60_000); // debug+ASAN subprocess + Bun.serve + bundler routinely exceeds the 5s local default
