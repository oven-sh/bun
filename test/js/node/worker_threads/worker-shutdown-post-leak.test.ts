import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows } from "harness";
import { join } from "path";

// mimalloc does not destroy a private heap when the thread that used it exits, so a Worker's VM teardown
// has to destroy the arena that Bun.{TOML,YAML,JSON5,JSONC,XML}.parse park on its thread, whichever way
// the Worker ends. The cases count heaps: RSS does not show one small heap, and LeakSanitizer does not
// track mimalloc heaps.
describe("a Worker leaves no parse arena behind", () => {
  const parseAll = `Bun.TOML.parse("a = 1"); Bun.YAML.parse("a: 1"); Bun.JSON5.parse("{a:1}"); Bun.JSONC.parse('{"a":1}'); Bun.XML.parse("<a>1</a>");`;
  // Worker kind, what the Worker does, its source, the errors the parent must see from it.
  const cases: [string, string, string, string[]][] = [
    ["web", "parses and runs to completion", parseAll, []],
    ["web", "parses and is terminated", `${parseAll} postMessage(1); setInterval(() => {}, 1000);`, []],
    ["web", "parses and calls process.exit()", `${parseAll} process.exit(0);`, []],
    ["web", "parses and throws", `${parseAll} throw new Error("boom");`, ["boom"]],
    ["web", "parses only in an exit handler", `process.on("exit", () => { ${parseAll} });`, []],
    ["web", "only gets a SyntaxError from a parse", `try { Bun.TOML.parse("a = "); } catch {}`, []],
    // A node:worker_threads Worker wraps the same native Worker and takes seconds to start on a
    // debug build, so it gets one case.
    ["node:worker_threads", "parses and runs to completion", parseAll, []],
  ];
  const countLeftBehind = `
    const { WORKER_KIND, WORKER_SOURCE } = process.env;
    const liveHeaps = () => require("bun:jsc").heapStats().mimalloc.heaps.current;
    const errors = [];
    // The message of a web Worker's error event also carries a code frame and a stack.
    const sawError = message => errors.push(message.includes("boom") ? "boom" : message);
    const web = source => new Promise(resolve => {
      const worker = new Worker(URL.createObjectURL(new Blob([source])));
      worker.addEventListener("error", event => (sawError(event.message), event.preventDefault()));
      worker.addEventListener("message", () => worker.terminate());
      worker.addEventListener("close", resolve);
    });
    const NodeWorker = WORKER_KIND === "web" ? null : require("worker_threads").Worker;
    const node = source => new Promise(resolve => {
      new NodeWorker(source, { eval: true }).on("error", error => sawError(error.message)).on("exit", resolve);
    });
    // Whatever the process sets up lazily for its first Worker is part of the baseline.
    await web("JSON.parse('1')");
    const before = liveHeaps();
    await (NodeWorker ? node : web)(WORKER_SOURCE);
    console.log(JSON.stringify({ leftBehind: liveHeaps() - before, errors }));
  `;
  test.concurrent.each(cases)("a %s Worker that %s", async (kind, _, source, errors) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", countLeftBehind],
      env: { ...bunEnv, WORKER_KIND: kind, WORKER_SOURCE: source },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe(JSON.stringify({ leftBehind: 0, errors }) + "\n");
    expect(exitCode).toBe(0);
  });
});

// A worker's shutdown used to drain its concurrent queue and only then mark
// the context terminating. A cross-thread postTaskTo landing in between (the
// parent's stdio-backpressure ack, any MessagePort scheduleDrain) was enqueued
// onto a queue that is never drained again, leaking the ConcurrentTask +
// EventLoopTask. The window is a handful of instructions so debug builds
// essentially never hit it; CI's release-asan lane does (see
// test/js/node/test/parallel/test-worker-stdio-flush.js). This runs the
// worker-stdio-on-exit scenario under LSan as a guard on the asan lane.
test.skipIf(!isASAN || isWindows)(
  "cross-thread MessagePort post during worker shutdown does not leak a ConcurrentTask",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Worker } = require("worker_threads");
          const assert = require("assert");
          const w = new Worker(
            'process.on("exit", () => {' +
            '  process.stdout.write(" ");' +
            '  process.stdout.write("world");' +
            '});' +
            'process.stdout.write("hello");',
            { eval: true, stdout: true },
          );
          let data = "";
          w.stdout.setEncoding("utf8");
          w.stdout.on("data", chunk => { data += chunk; });
          w.on("exit", () => assert.strictEqual(data, "hello world"));
        `,
      ],
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  },
);
