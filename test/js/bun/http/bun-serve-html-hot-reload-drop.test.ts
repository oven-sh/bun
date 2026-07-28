import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The file-watcher thread enqueues a `ConcurrentTask` that is stored inline
// inside `DevServer.watcher_atomics.events[*]`. If the server is dropped
// before the event loop drains that node the drain reads freed memory: a
// `Segmentation fault at address 0x48` on release builds (the zeroed
// `{tag: 0, ptr: null}` dispatches as `fs.access` with a null receiver), or
// heap-use-after-free under ASAN.
//
// Lives in its own file because the neighbouring `bun-serve-html.test.ts`
// bundles React and exceeds the default per-test timeout under a debug+ASAN
// build regardless of this change.
test("stopping a development server while a hot-reload event is queued", async () => {
  using dir = tempDir("bun-serve-html-drop-race", {
    "index.html": /*html*/ `<!DOCTYPE html>
<html><head><script type="module" src="./app.js"></script></head><body>hi</body></html>`,
    "app.js": /*js*/ `export default 0;\n`,
    "run.ts": /*ts*/ `
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;
const appJs = join(here, "app.js");
const { default: html } = await import(join(here, "index.html"));

const ITER = 10;
for (let i = 0; i < ITER; i++) {
  {
    using server = Bun.serve({
      port: 0,
      development: true,
      static: { "/": html },
      fetch: () => new Response("no"),
    });
    // Bundle once so app.js is in the watcher's watchlist.
    await (await fetch(server.url)).text();
    // Touch a watched file synchronously, then spin without yielding so the
    // watcher thread has time to observe the write and enqueue a hot-reload
    // event before the server is disposed at scope exit.
    writeFileSync(appJs, "export default " + i + ";\\n");
    const until = performance.now() + 20;
    while (performance.now() < until) {}
  }
  // Yield so the event loop drains the concurrent queue with the server gone.
  await 1;
}
console.log("done", ITER);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.ts"],
    // Repeated Bun.serve({ development: true }) currently leaks a few small
    // ServerConfig allocations; this test covers the hot-reload-drop UAF,
    // not those leaks, so keep ASAN on but leave LSAN off for the child.
    env: { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (!stdout.includes("done")) console.error(stderr);
  expect(stdout).toContain("done 10");
  expect(exitCode).toBe(0);
});
