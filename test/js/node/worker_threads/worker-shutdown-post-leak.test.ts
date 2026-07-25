import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows } from "harness";
import { join } from "path";

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
