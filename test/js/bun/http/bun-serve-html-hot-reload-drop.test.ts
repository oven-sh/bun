import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

// The watcher thread posts a task for the dev server, which can be dropped before the task runs.
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
  const server = Bun.serve({
    port: 0,
    development: true,
    static: { "/": html },
    fetch: () => new Response("no"),
  });
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
}
console.log("done");
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

test.skipIf(!isLinux)("three changes in a row while the JS thread is busy are all bundled", async () => {
  using traceDir = tempDir("bun-serve-html-three-changes-trace", {});
  using dir = tempDir("bun-serve-html-three-changes", {
    "index.html": /*html*/ `<!DOCTYPE html><script type="module" src="./app.js"></script>`,
    "app.js": /*js*/ `import "./a.js"; import "./b.js"; import "./c.js";`,
    "a.js": "",
    "b.js": "",
    "c.js": "",
    "run.ts": /*ts*/ `
import { appendFileSync, readFileSync } from "node:fs";
import html from "./index.html";

using server = Bun.serve({ port: 0, development: true, routes: { "/": html } });
async function bundle() {
  const page = await (await fetch(server.url)).text();
  return (await fetch(new URL(page.match(/src="([^"]+\\.js)"/)[1], server.url))).text();
}
await bundle();

const deadline = Date.now() + 20_000;
function checkDeadline(what) {
  if (Date.now() > deadline) throw new Error("timed out waiting for " + what);
}

// The trace names a file once the watcher has read its events, so each one is a batch of its own.
for (const name of ["a", "b", "c"]) {
  appendFileSync(name + ".js", "console.log('new " + name + "');");
  while (!readFileSync(process.env.BUN_WATCHER_TRACE, "utf8").includes("/" + name + ".js")) checkDeadline(name);
}

let text;
while (!(text = await bundle()).includes("new c")) checkDeadline("the bundle");
console.log(text.match(/new [abc]\\b/g).sort().join());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.ts"],
    env: {
      ...bunEnv,
      BUN_WATCHER_TRACE: join(String(traceDir), "trace.log"),
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("new a,new b,new c\n");
  expect(exitCode).toBe(0);
});

test.skipIf(!isLinux)(
  "a stopped development server closes its inotify descriptor and frees the watched paths",
  async () => {
    using dir = tempDir("bun-serve-html-inotify-fd", {
      "index.html": /*html*/ `<!DOCTYPE html><script type="module" src="./app.js"></script>`,
      // The watcher copies the path of a folder in which an import is missing.
      "app.js": /*js*/ `import "./empty/missing.js";`,
      "empty": {},
      "run.ts": /*ts*/ `
import { readdirSync, readlinkSync } from "node:fs";
import html from "./index.html";

function count() {
  return readdirSync("/proc/self/fd").filter(fd => {
    try {
      return readlinkSync("/proc/self/fd/" + fd) === "anon_inode:inotify";
    } catch {}
  }).length;
}

async function serve() {
  const server = Bun.serve({ port: 0, development: true, routes: { "/": html } });
  await (await fetch(server.url)).text();
  console.log("serving", count());
  await server.stop(true);
}
await serve();

for (const deadline = Date.now() + 3000; count() > 0 && Date.now() < deadline; await Bun.sleep(1)) {
  Bun.gc(true);
}
console.log("stopped", count());
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.ts"],
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("serving 1\nstopped 0\n");
    expect(exitCode).toBe(0);
  },
);
