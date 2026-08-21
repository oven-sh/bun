import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "path";

const leaksanSupp = join(import.meta.dirname, "../../../leaksan.supp");

// A failing run spends most of its time in LSan's report symbolization, which
// takes tens of seconds on the debug binary; even a clean run takes several.
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
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${leaksanSupp}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  },
  LEAK_TEST_TIMEOUT,
);

// The Bun.main getter caches the worker's resolved entry path in its
// VirtualMachine (an atom when the path is ASCII, a plain WTF string copy
// otherwise). A node-kind worker reads Bun.main during bootstrap, when
// process.mainModule is set up, so every Worker started from a file populated
// it, and the worker's VM teardown never released it: one string leaked per
// Worker. Eval workers have no file to resolve and never hit this.
//
// The string lives in WTF's allocator, which LSan cannot see through bmalloc;
// Malloc=1 routes it through the system allocator. That also exposes the
// worker thread's EventNames table, a separate per-thread leak (#38164) that
// is not what this test checks, so it is tolerated on top of the shared
// suppressions until that fix lands.
test.concurrent.skipIf(!isASAN || isWindows).each([
  ["ascii", "sub"],
  ["non-ascii", "s\u00fcb"],
])(
  "a worker_threads Worker started from a file (%s path) does not leak its resolved Bun.main path",
  async (_, subdir) => {
    using dir = tempDir("worker-main-path-leak", {
      "main.mjs": `
        import { Worker } from "node:worker_threads";
        import { join } from "node:path";
        new Worker(join(import.meta.dirname, ${JSON.stringify(subdir)}, "worker.js")).on("exit", code =>
          console.log("exit", code),
        );
      `,
      [`${subdir}/worker.js`]: "",
      "leaksan.supp": readFileSync(leaksanSupp, "utf8") + "\nleak:WebCore::eventNames\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        Malloc: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(String(dir), "leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "exit 0\n", stderr: "", exitCode: 0 });
  },
  LEAK_TEST_TIMEOUT,
);
