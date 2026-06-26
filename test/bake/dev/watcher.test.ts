// Tests for the dev server's file watcher that cannot be expressed with the
// `devTest` harness: it always spawns the dev server with `cwd` = the project
// root, so every source path is under `top_level_dir`. These need the project
// to live OUTSIDE the process cwd.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";

const N = 8;
const moduleSource = (i: number, k: number) => `export const v${i} = ${i * 1000 + k};\n`;

// HMR server plus a bare HMR websocket client, all inside one child process.
// The project lives in `../app` relative to the child's cwd. Everything is
// driven by websocket messages (the first server message is `version`;
// replying "she" subscribes to the hot_update + errors topics, so every
// rebundle is observable) -- no timers.
const serveFixture = `
import * as fs from "node:fs";
const ROOT = import.meta.dir + "/app";
const N = ${N};
const ROUNDS = 4;

const html = (await import(ROOT + "/index.html")).default;
const srv = Bun.serve({
  port: 0,
  development: { hmr: true },
  routes: { "/": html },
  fetch: () => new Response("not found", { status: 404 }),
});
await (await fetch("http://127.0.0.1:" + srv.port + "/")).arrayBuffer();

const ws = new WebSocket("ws://127.0.0.1:" + srv.port + "/_bun/hmr");
let msgCount = 0;
let opened = false;
let waiters: Array<() => void> = [];
let dead: Array<(e: Error) => void> = [];
const pump = () => waiters.splice(0).forEach(f => f());
const fail = (e: Error) => dead.splice(0).forEach(f => f(e));
ws.onopen = () => ((opened = true), pump());
ws.onmessage = () => (msgCount++, pump());
ws.onclose = () => fail(new Error("hmr websocket closed: dev server crashed?"));
ws.onerror = () => fail(new Error("hmr websocket error"));
const until = (cond: () => boolean) =>
  new Promise<void>((resolve, reject) => {
    dead.push(reject);
    const check = () => (cond() ? resolve() : waiters.push(check));
    check();
  });

await until(() => opened);
await until(() => msgCount >= 1);
ws.send("she");

for (let k = 1; k <= ROUNDS; k++) {
  const base = msgCount;
  // Touch every module. The file watcher holds each module's absolute path
  // for the whole session; hashing it on this inotify/kqueue event is what
  // read freed memory before the fix.
  for (let i = 0; i < N; i++) {
    fs.writeFileSync(ROOT + "/m" + i + ".ts", "export const v" + i + " = " + (i * 1000 + k) + ";\\n");
  }
  await until(() => msgCount > base);
}
console.log("SURVIVED");
process.exit(0);
`;

const appFiles: Record<string, string> = {
  "app/index.html": `<!doctype html><html><head><link rel="stylesheet" href="./index.css"></head><body><script type="module" src="./app.ts"></script></body></html>\n`,
  "app/index.css": "body{color:#000}\n",
  "app/app.ts":
    [...Array(N).keys()].map(i => `import { v${i} } from "./m${i}.ts";`).join("\n") +
    `\n(globalThis as any).T = [${[...Array(N).keys()].map(i => "v" + i)}];\n`,
};
for (let i = 0; i < N; i++) appFiles[`app/m${i}.ts`] = moduleSource(i, 0);

// The bundler registers every source with the file watcher, and the watcher
// outlives the bundle. When a source is outside `top_level_dir` (= the child's
// cwd), its display path is not a byte range of its absolute path, so
// `dupe_alloc` placed `path.text` in the per-bundle arena; the watcher kept a
// borrowed pointer into it, and the first file event after that bundle's arena
// was freed read freed memory on the "File Watcher" thread
// (`HotReloadEvent::append_file` -> `StringArrayHashMap::get_or_put` -> wyhash).
//
// MIMALLOC_PURGE_DELAY=0 makes mimalloc return the destroyed arena's pages to
// the OS immediately, so the unfixed binary faults deterministically on the
// very first hot reload instead of depending on page-recycling timing.
test.skipIf(!isASAN)(
  "watchlist entries must not borrow paths from a finished bundle's arena",
  async () => {
    using dir = tempDir("dev-watcher-arena-path", {
      "serve-fixture.ts": serveFixture,
      // Pins `top_level_dir` to `cwd/`, leaving `../app` outside it.
      "cwd/package.json": "{}",
      ...appFiles,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), `${dir}/serve-fixture.ts`],
      cwd: `${dir}/cwd`,
      env: { ...bunEnv, MIMALLOC_PURGE_DELAY: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect({ stdout, exitCode, signalCode: proc.signalCode }, stderr).toEqual({
      stdout: "SURVIVED\n",
      exitCode: 0,
      signalCode: null,
    });
  },
  60_000,
);
