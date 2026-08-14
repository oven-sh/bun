import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// An exception a loop-level callback leaves pending is folded — reported as
// uncaught, or turned into the loop's stand-down when it is the VM's
// termination — in exactly one place per dispatcher: the tick loop for queued
// tasks, the timer drains, the landing frames of the uSockets / uWS / lsquic /
// pipe-reader / libuv callbacks (`dispatch::fold`), the teardown runners. Every
// callback those dispatchers invoke returns `JsResult` and never reports on its
// own; a frame that must go on to run more JS after a callback threw uses
// `EventLoop::run_callback`, and a parked stream promise is settled by the
// settle primitives in `streams.rs`.
//
// So the fold may only be named from the files below. Everything else is a
// `?`, a `run_callback`, or a `dispatch::fold` at a foreign landing frame.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(abs => abs.endsWith(".rs"));

const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

const FOLD = new RegExp(String.raw`\breport_error_or_terminate\s*\(`, "g");

const DISPATCHERS = new Set([
  "src/jsc/Task.rs", // the fold itself
  "src/jsc/event_loop.rs", // run_callback, release_task_unrun
  "src/jsc/VirtualMachine.rs", // cleanup-hook runner
  "src/jsc/web_worker.rs", // a worker thread's start sequence: its outermost frame
  "src/jsc/RuntimeTranspilerStore.rs", // the transpiled-module fulfilment drain
  "src/runtime/dispatch.rs", // task queue tick, timer switch, `fold` for foreign landing frames
  "src/runtime/timer/mod.rs", // timer drains
  "src/runtime/test_runner/timers/FakeTimers.rs", // the fake clock's timer drain
  "src/runtime/cli/run_command.rs", // the process entry: outermost frame for the preconnect scripts
  "src/runtime/napi/napi_body.rs", // the threadsafe-function queue drain
  "src/runtime/webcore/streams.rs", // the stream settle primitives (Pending::run & co.)
  "src/runtime/dns_jsc/dns.rs", // resolver completion callbacks (c-ares, libinfo, libuv)
  "src/runtime/node/quic/fold.rs", // node:quic's event drain and lsquic/UDP callback boundaries
  "src/runtime/ipc/fold.rs", // the IPC message drain
]);

const offenders: string[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  if (DISPATCHERS.has(source)) continue;
  const content = await file(abs).text();
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\bfn\s+\w+\s*\(/g, "fn _(");
  for (const m of stripped.matchAll(FOLD)) {
    const line = stripped.slice(0, m.index).split("\n").length;
    offenders.push(
      `${source}:${line}: \`${m[0]}\` — return the JsResult to this frame's dispatcher (or use EventLoop::run_callback if more JS must run after it)`,
    );
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  expect(scanned).toBeGreaterThan(0);
});

test("loop-level exceptions are folded only by a dispatcher", () => {
  expect(offenders).toEqual([]);
});
