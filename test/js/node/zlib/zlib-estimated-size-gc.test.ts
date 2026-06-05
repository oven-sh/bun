// https://github.com/oven-sh/bun/issues/31865
// NativeBrotli/NativeZstd estimatedSize runs on JSC's concurrent GC marking
// thread, so it must not touch the `stream` JsCell. The external footprint is
// fixed at construction, so estimateShallowMemoryUsageOf(handle) stays constant
// across the stream's lifetime, including after close() mutates the mode on the
// JS thread: `after === before` is the contract.

import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import zlib from "node:zlib";

// estimateShallowMemoryUsageOf(cell) == sizeof(cell) + estimated_size(). `min`
// is a floor below the per-mode footprint the constructor caches (brotli encode
// 5143, brotli decode 855, zstd compress 5272, zstd decompress 95968).
function checkFootprintStableAcrossClose(create: () => any, min: number) {
  const engine = create();
  engine.on("error", () => {});
  engine.on("data", () => {});
  const handle = engine._handle;
  const before = estimateShallowMemoryUsageOf(handle);
  engine.destroy(); // closes the handle once and nulls engine._handle
  const after = estimateShallowMemoryUsageOf(handle);
  expect(before).toBeGreaterThan(min);
  expect(after).toBe(before);
}

test("brotli compress: estimated size stays tied to construction mode across close", () => {
  checkFootprintStableAcrossClose(() => zlib.createBrotliCompress(), 5000);
});

test("brotli decompress: estimated size stays tied to construction mode across close", () => {
  checkFootprintStableAcrossClose(() => zlib.createBrotliDecompress(), 855);
});

test("zstd compress: estimated size stays tied to construction mode across close", () => {
  checkFootprintStableAcrossClose(() => zlib.createZstdCompress(), 5000);
});

test("zstd decompress: estimated size stays tied to construction mode across close", () => {
  checkFootprintStableAcrossClose(() => zlib.createZstdDecompress(), 90000);
});

// GC-safety guard: drive a write so the JS thread enters with_mut, then force
// GC so estimatedSize/visitChildren fires on the marking thread against a live
// stream. Asserts the stream still works and the process exits cleanly (this
// build has ASAN under `bun bd`).
const brotliGcFixture = /* js */ `
  const zlib = require("zlib");
  const buf = Buffer.alloc(256 * 1024, "abcdefgh");
  let remaining = 0;
  for (let i = 0; i < 8; i++) {
    remaining++;
    const z = zlib.createBrotliCompress({ chunkSize: 64 * 1024 });
    z.on("error", e => { throw e; });
    z.on("data", () => {});
    z.write(buf, () => { z.end(); if (--remaining === 0) console.log("OK"); });
    Bun.gc(true);
    Bun.gc(true);
  }
  Bun.gc(true);
`;

const zstdGcFixture = /* js */ `
  const zlib = require("zlib");
  const crypto = require("crypto");
  const buf = crypto.randomBytes(256 * 1024);
  let remaining = 0;
  for (let i = 0; i < 8; i++) {
    remaining++;
    const z = zlib.createZstdCompress({ chunkSize: 64 * 1024 });
    z.on("error", e => { throw e; });
    z.on("data", () => {});
    z.write(buf, () => { z.end(); if (--remaining === 0) console.log("OK"); });
    Bun.gc(true);
    Bun.gc(true);
  }
  Bun.gc(true);
`;

async function runGc(fixture: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("brotli: estimatedSize during GC while a stream is live exits cleanly", async () => {
  const { stdout, stderr, exitCode } = await runGc(brotliGcFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test.concurrent("zstd: estimatedSize during GC while a stream is live exits cleanly", async () => {
  const { stdout, stderr, exitCode } = await runGc(zstdGcFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
