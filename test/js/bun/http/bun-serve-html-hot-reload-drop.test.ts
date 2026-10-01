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

let ok = 0;
const ITER = 10;
for (let i = 0; i < ITER; i++) {
  let server;
  try {
    server = Bun.serve({
      port: 0,
      development: true,
      static: { "/": html },
      fetch: () => new Response("no"),
    });
  } catch (e) {
    // The DevServer watcher thread holds its inotify fd until it exits, which
    // it only does after a later event wakes its blocked read(); in an
    // inotify-constrained environment that can exhaust the per-user instance
    // budget before all iterations run. The race under test hits on the
    // first few iterations, so treat this as a soft stop.
    if (!String((e as any)?.message).includes("EMFILE")) throw e;
    break;
  }
  try {
    // Bundle once so app.js is in the watcher's watchlist.
    await (await fetch(server.url)).text();
    // Touch a watched file synchronously, then spin without yielding so the
    // watcher thread has time to observe the write and enqueue a hot-reload
    // event before the server is disposed below.
    writeFileSync(appJs, "export default " + i + ";\\n");
    const until = performance.now() + 20;
    while (performance.now() < until) {}
  } finally {
    server.stop(true);
  }
  // Yield so the event loop drains the concurrent queue with the server gone.
  await 1;
  ok++;
}
if (ok < 2) throw new Error("never reached the race window (ok=" + ok + ")");
console.log("done", ok);
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
  expect(stdout).toContain("done");
  expect(exitCode).toBe(0);
});
