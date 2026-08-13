import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// An exception a loop-level callback leaves pending is folded — reported as
// uncaught, or turned into the loop's stand-down when it is the VM's
// termination — in exactly one place per dispatcher: the tick loop for queued
// tasks, the timer drain, the pipe reader/writer trampolines, the uSockets and
// uWS trampolines, the teardown runners. Every callback those dispatchers invoke
// returns `JsResult` and never reports on its own; a frame that must go on to
// run more JS after a callback threw uses `EventLoop::run_callback`.
//
// So the fold functions may only be named from the files that host a
// dispatcher. Everything else is either a `?` or a `run_callback`.

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

const FOLD = new RegExp(
  String.raw`\b(?:report_error_or_terminate|fold_at_loop_entry|__bun_fold_loop_js_error|report_uncaught_exception_from_error|report_active_exception_as_unhandled|report_unhandled)\s*\(`,
  "g",
);

// The dispatchers. A file here hosts a trampoline/drain that folds what the
// callbacks it invokes return.
const DISPATCHERS = new Set([
  "src/jsc/Task.rs", // the fold itself + the bun_io/uws_sys hook
  "src/jsc/lib.rs", // JsResultExt (definitions)
  "src/jsc/JSGlobalObject.rs", // definitions
  "src/jsc/event_loop.rs", // run_callback, release_task_unrun
  "src/jsc/VirtualMachine.rs", // cleanup-hook runner
  "src/runtime/dispatch.rs", // task queue tick
  "src/runtime/timer/mod.rs", // timer drains
  "src/runtime/socket/uws_handlers.rs", // uSockets trampolines
  "src/io/lib.rs", // pipe reader/writer trampolines
  "src/uws_sys/WebSocket.rs", // uWS websocket/upgrade trampolines
]);

// Frames not yet returning `JsResult` to a folding dispatcher — each is marked
// `TODO(one-fold)` or is a foreign completion boundary awaiting its trampoline.
// Ratcheted: this table may only shrink.
const INTERIM: Record<string, number> = {
  "src/runtime/node/quic/session.rs": 13, // lsquic event drain
  "src/runtime/node/quic/endpoint.rs": 3,
  "src/runtime/node/quic/mod.rs": 1,
  "src/runtime/cli/run_command.rs": 7, // main entry: is itself the outermost boundary
  "src/runtime/webcore/streams.rs": 4, // HTTPResponseSink teardown (uWS response callbacks / host fns)
  "src/runtime/ipc_host.rs": 4,
  "src/runtime/ipc.rs": 1,
  "src/runtime/api/bun/h2_frame_parser.rs": 4,
  "src/runtime/api/html_rewriter.rs": 3,
  "src/runtime/webcore/ByteStream.rs": 2, // SourceContext::on_cancel
  "src/runtime/bake/DevServer.rs": 2,
  "src/runtime/webcore/fetch/FetchTasklet.rs": 1,
  "src/runtime/webcore/blob/write_file.rs": 1, // libuv completion (Windows)
  "src/runtime/webcore/blob/read_file.rs": 1, // libuv completion (Windows)
  "src/runtime/webcore/Request.rs": 1,
  "src/runtime/webcore/FileSink.rs": 1, // subprocess exit path
  "src/runtime/webcore/Blob.rs": 1, // pool read `cancel` at teardown
  "src/runtime/test_runner/jest.rs": 1,
  "src/runtime/socket/udp_socket.rs": 1,
  "src/runtime/shell/interpreter.rs": 1,
  "src/runtime/node/node_crypto_binding.rs": 1,
  "src/runtime/dns_jsc/dns.rs": 1, // c-ares completion
  "src/runtime/api/BunObject.rs": 1,
  "src/jsc/web_worker.rs": 1,
};

const counts: Record<string, number> = {};
const offenders: string[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\bfn\s+\w+\s*\(/g, "fn _(");
  for (const m of stripped.matchAll(FOLD)) {
    if (DISPATCHERS.has(source)) continue;
    const line = stripped.slice(0, m.index).split("\n").length;
    counts[source] = (counts[source] ?? 0) + 1;
    if (counts[source] > (INTERIM[source] ?? 0)) {
      offenders.push(
        `${source}:${line}: \`${m[0]}\` — return the JsResult to this frame's dispatcher (or use EventLoop::run_callback if more JS must run after it)`,
      );
    }
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  expect(scanned).toBeGreaterThan(0);
});

test("loop-level exceptions are folded only by a dispatcher", () => {
  expect(offenders).toEqual([]);
});

test("interim frames carry exactly their recorded count (ratchet)", () => {
  for (const [f, n] of Object.entries(INTERIM)) {
    expect([f, counts[f] ?? 0]).toEqual([f, n]);
  }
});
