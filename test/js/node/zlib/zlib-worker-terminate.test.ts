import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

// worker.terminate() while async node:zlib compression is in flight on the
// thread pool must not dereference the worker's freed VM/EventLoop from the
// pool-thread completion. Mixed gzip/brotli/deflate lanes keep do_work() busy
// so terminate reliably lands mid-compression.
test("worker.terminate() during in-flight node:zlib async compression does not UAF", async () => {
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
        await new Promise((resolve, reject) => {
          w.once("message", resolve);
          w.once("error", reject);
          w.once("exit", code => reject(new Error("worker exited " + code + " before ready")));
        });
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
}, 30_000);
