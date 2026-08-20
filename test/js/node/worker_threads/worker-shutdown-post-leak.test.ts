import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "path";

// Every test here starts a worker VM under debug+ASAN and then runs LSan over
// the exiting process, which already takes a few seconds on a loaded machine;
// symbolizing a report against the debug binary takes tens of seconds more.
const LEAK_TEST_TIMEOUT = 90_000;

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
  LEAK_TEST_TIMEOUT,
);

// WebCore::eventNames() keeps its table of event-name atoms in a C++
// thread_local, and Bun compiles with -fno-c++-static-destructors, so the table
// was never freed when a worker thread exited. Every worker allocates one the
// moment it comes online (WorkerMessagingProxy::workerGlobalScopeStarted, right
// after its entry script has run), even a worker whose script is empty, so the
// cases below only differ in how the thread ends; a worker that exits or
// registers listeners itself does so from a callback, once it is online.
// Malloc=1 makes WTF's fastMalloc use the system allocator, which is what lets
// LSan see the table at all.
describe.concurrent("a worker thread frees its event name table when it exits", () => {
  const lsanEnv = {
    ...bunEnv,
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    Malloc: "1",
    ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
    LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
  };

  test.skipIf(!isASAN || isWindows).each([
    {
      route: "worker_threads Worker whose event loop drains",
      files: {
        "main.mjs": `
          import { Worker } from "node:worker_threads";
          new Worker("", { eval: true }).on("exit", code => console.log("exit", code));
        `,
      },
      stdout: "exit 0\n",
    },
    {
      route: "worker_threads Worker that calls process.exit()",
      files: {
        "main.mjs": `
          import { Worker } from "node:worker_threads";
          new Worker("setImmediate(() => process.exit(7));", { eval: true }).on("exit", code => console.log("exit", code));
        `,
      },
      stdout: "exit 7\n",
    },
    {
      route: "worker_threads Worker terminated by its parent while it listens on parentPort",
      files: {
        "main.mjs": `
          import { Worker } from "node:worker_threads";
          const worker = new Worker(
            \`
              const { parentPort } = require("node:worker_threads");
              setImmediate(() => {
                parentPort.on("message", () => {});
                parentPort.postMessage("listening");
              });
            \`,
            { eval: true },
          );
          worker.on("message", () => worker.terminate());
          worker.on("exit", () => console.log("terminated"));
        `,
      },
      stdout: "terminated\n",
    },
    {
      route: "Web Worker whose event loop drains",
      files: {
        "main.mjs": `
          new Worker(new URL("./worker.js", import.meta.url)).addEventListener("close", () => console.log("close"));
        `,
        "worker.js": "",
      },
      stdout: "close\n",
    },
  ])(
    "$route",
    async ({ files, stdout: expectedStdout }) => {
      using dir = tempDir("worker-event-names", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.mjs"],
        cwd: String(dir),
        env: lsanEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: expectedStdout, stderr: "", exitCode: 0 });
    },
    LEAK_TEST_TIMEOUT,
  );
});
