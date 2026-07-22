import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

// Regression test for a heap-use-after-free when a Worker is terminated
// while async node:zlib operations (gzip/brotliCompress/deflate) are running
// on the thread pool. The pool-thread completion callback dereferenced the
// worker's VirtualMachine/EventLoop after WebWorker::shutdown had already
// freed it:
//
//   heap-use-after-free  READ of size 8  thread T16 (Bun Pool 2)
//     #0 event_loop                       src/jsc/VirtualMachine.rs
//     #1 async_job_run<NativeBrotli>      src/runtime/node/node_zlib_binding.rs
//   freed by thread (Worker): WebWorker::shutdown  src/jsc/web_worker.rs
//
// Keeping several codecs in flight at once makes the do_work() window wide
// enough that terminate() reliably lands inside it.
test("worker.terminate() during in-flight node:zlib async compression does not UAF", async () => {
  // ASAN poisons the freed VM immediately; a couple of rounds are enough.
  // Release builds need the freed page to be reused/unmapped, which takes a
  // few more.
  const ROUNDS = isASAN ? 4 : 10;

  const script = /* js */ `
      const { Worker } = require("node:worker_threads");
      const src = \`
        const { parentPort } = require("node:worker_threads");
        const zlib = require("node:zlib");
        const { promisify } = require("node:util");
        const gz = promisify(zlib.gzip);
        const br = promisify(zlib.brotliCompress);
        const df = promisify(zlib.deflate);
        const big = Buffer.alloc(16 << 20, 0x61);
        const lanes = (n, f) => {
          for (let i = 0; i < n; i++)
            (async () => { for (;;) { try { await f(); } catch {} } })();
        };
        lanes(2, () => gz(big));
        lanes(1, () => br(big.subarray(0, 4 << 20)));
        lanes(2, () => df(big.subarray(0, 10 << 20)));
        parentPort.postMessage("up");
      \`;
      (async () => {
        for (let r = 0; r < ${ROUNDS}; r++) {
          const w = new Worker(src, { eval: true });
          await new Promise(res => w.once("message", res));
          await Bun.sleep(60 + (r * 41) % 220);
          await w.terminate();
        }
        console.log("ok");
      })().catch(e => {
        console.error(e);
        process.exit(1);
      });
    `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("heap-use-after-free");
  expect(stderr).not.toContain("AddressSanitizer");
  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ok", exitCode: 0 });
}, // 16 MiB buffer; the default 5s is too short for that even once. // Per-test override: each round starts a Worker under ASAN and compresses a
60_000);
