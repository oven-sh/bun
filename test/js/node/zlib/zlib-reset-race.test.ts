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
// After the fix, reset() is deferred until the in-flight write completes
// (mirroring pending_close).

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const zstdFixture = /* js */ `
  const zlib = require("zlib");
  const crypto = require("crypto");

  // Random data at a high compression level so each threadpool job is slow
  // enough that reset() lands while ZSTD_compressStream2 is still running.
  const buf = crypto.randomBytes(4 * 1024 * 1024);

  let remaining = 0;
  for (let i = 0; i < 8; i++) {
    remaining++;
    const z = zlib.createZstdCompress({
      chunkSize: 4 * 1024 * 1024,
      params: { [zlib.constants.ZSTD_c_compressionLevel]: 19 },
    });
    z.on("error", () => {});
    z.on("data", () => {});
    z.write(buf, () => {
      z.end();
      if (--remaining === 0) console.log("OK");
    });
    // Spin briefly so the threadpool starts ZSTD_compressStream2 before reset().
    const start = Date.now();
    while (Date.now() - start < 30) {}
    // Before the fix this frees the ZSTD_CCtx while the worker thread is
    // inside ZSTD_compressStream2 -> heap-use-after-free under ASAN.
    z.reset();
  }
`;

const brotliFixture = /* js */ `
  const zlib = require("zlib");

  const buf = Buffer.alloc(8 * 1024 * 1024, "abcdefgh");

  let remaining = 0;
  for (let i = 0; i < 8; i++) {
    remaining++;
    const z = zlib.createBrotliCompress({
      chunkSize: 1024 * 1024,
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    });
    z.on("error", () => {});
    z.on("data", () => {});
    z.write(buf, () => {
      z.end();
      if (--remaining === 0) console.log("OK");
    });
    const start = Date.now();
    while (Date.now() - start < 10) {}
    // Before the fix this frees the BrotliEncoderState while the worker
    // thread is inside BrotliEncoderCompressStream.
    z.reset();
  }
`;

const deflateFixture = /* js */ `
  const zlib = require("zlib");
  const crypto = require("crypto");

  const buf = crypto.randomBytes(4 * 1024 * 1024);

  let remaining = 0;
  for (let i = 0; i < 8; i++) {
    remaining++;
    const z = zlib.createDeflate({ chunkSize: 4 * 1024 * 1024, level: 9 });
    z.on("error", () => {});
    z.on("data", () => {});
    z.write(buf, () => {
      z.end();
      if (--remaining === 0) console.log("OK");
    });
    const start = Date.now();
    while (Date.now() - start < 10) {}
    // Before the fix this calls deflateReset() on the z_stream while the
    // worker thread is inside deflate() -> data race / state corruption.
    z.reset();
  }
`;

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
}, 60_000);

test("brotli: reset() while an async write is in flight does not use-after-free", async () => {
  const { stdout, stderr, exitCode } = await run(brotliFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
}, 60_000);

test("deflate: reset() while an async write is in flight does not race", async () => {
  const { stdout, stderr, exitCode } = await run(deflateFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
}, 60_000);
