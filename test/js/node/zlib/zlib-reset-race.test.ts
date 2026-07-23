// Regression test: calling .reset() on a zlib/brotli/zstd stream while an
// async write is running on the threadpool must not use-after-free the
// encoder state.
//
// Before the fix, CompressionStream.reset() called this.stream.reset()
// unconditionally, which for brotli/zstd destroys and re-creates the encoder
// instance and for zlib calls deflateReset()/inflateReset(). If the
// threadpool thread was concurrently inside doWork() operating on that state,
// zstd would read freed memory (heap-use-after-free under ASAN) and brotli
// would silently corrupt or fail compression.
//
// reset() now throws instead of touching the live state, matching node
// (`CompressionStream::Reset` in src/node_zlib.cc). The state is left alone
// either way, so the use-after-free this test guards cannot happen; the
// fixtures below assert the throw and still exit cleanly.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Asserts node's behavior: reset() during an in-flight write throws rather
// than freeing state the worker thread is using. Tolerates the write having
// already landed (then reset() legitimately succeeds).
const resetInFlight = /* js */ `
  function resetWhileWriting(z, inFlight) {
    try {
      z.reset();
      if (inFlight()) {
        console.error("reset() did not throw while a write was in flight");
        process.exit(1);
      }
    } catch (err) {
      if (err.message !== "Cannot reset zlib stream while a write is in progress") {
        console.error("unexpected error from reset(): " + err.message);
        process.exit(1);
      }
    }
  }
`;

const zstdFixture = /* js */ `
  const zlib = require("zlib");
  const crypto = require("crypto");
  ${resetInFlight}

  // Random data at a high compression level so each threadpool job is slow
  // enough that reset() lands while ZSTD_compressStream2 is still running.
  const buf = crypto.randomBytes(1024 * 1024);

  let remaining = 0;
  for (let i = 0; i < 4; i++) {
    remaining++;
    let written = false;
    const z = zlib.createZstdCompress({
      chunkSize: 1024 * 1024,
      params: { [zlib.constants.ZSTD_c_compressionLevel]: 19 },
    });
    z.on("error", () => {});
    z.on("data", () => {});
    z.write(buf, () => {
      written = true;
      z.end();
      if (--remaining === 0) console.log("OK");
    });
    // Spin briefly so the threadpool starts ZSTD_compressStream2 before reset().
    const start = Date.now();
    while (Date.now() - start < 30) {}
    // Before the fix this freed the ZSTD_CCtx while the worker thread was
    // inside ZSTD_compressStream2 -> heap-use-after-free under ASAN.
    resetWhileWriting(z, () => !written);
  }
`;

const brotliFixture = /* js */ `
  const zlib = require("zlib");
  ${resetInFlight}

  const buf = Buffer.alloc(2 * 1024 * 1024, "abcdefgh");

  let remaining = 0;
  for (let i = 0; i < 4; i++) {
    remaining++;
    let written = false;
    const z = zlib.createBrotliCompress({
      chunkSize: 1024 * 1024,
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    });
    z.on("error", () => {});
    z.on("data", () => {});
    z.write(buf, () => {
      written = true;
      z.end();
      if (--remaining === 0) console.log("OK");
    });
    const start = Date.now();
    while (Date.now() - start < 10) {}
    // Before the fix this freed the BrotliEncoderState while the worker
    // thread was inside BrotliEncoderCompressStream.
    resetWhileWriting(z, () => !written);
  }
`;

const deflateFixture = /* js */ `
  const zlib = require("zlib");
  const crypto = require("crypto");
  ${resetInFlight}

  const buf = crypto.randomBytes(2 * 1024 * 1024);

  let remaining = 0;
  for (let i = 0; i < 4; i++) {
    remaining++;
    let written = false;
    const z = zlib.createDeflate({ chunkSize: 2 * 1024 * 1024, level: 9 });
    z.on("error", () => {});
    z.on("data", () => {});
    z.write(buf, () => {
      written = true;
      z.end();
      if (--remaining === 0) console.log("OK");
    });
    const start = Date.now();
    while (Date.now() - start < 10) {}
    // Before the fix this called deflateReset() on the z_stream while the
    // worker thread was inside deflate() -> data race / state corruption.
    resetWhileWriting(z, () => !written);
  }
`;

// These tests are intentionally sequential (not test.concurrent): each
// subprocess launches several threadpool compression jobs at high quality
// levels, and running three of them at once makes individual test wall
// times highly variable under CPU contention. Sequential keeps each test
// comfortably under the default timeout.
async function run(fixture: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("zstd: reset() while an async write is in flight does not use-after-free", async () => {
  const { stdout, stderr, exitCode } = await run(zstdFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test("brotli: reset() while an async write is in flight does not use-after-free", async () => {
  const { stdout, stderr, exitCode } = await run(brotliFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test("deflate: reset() while an async write is in flight does not race", async () => {
  const { stdout, stderr, exitCode } = await run(deflateFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
