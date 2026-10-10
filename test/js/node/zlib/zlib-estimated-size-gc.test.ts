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
// 5143, brotli decode 855, zstd compress 5272, zstd decompress 95968); `max`
// has enough headroom to survive dependency bumps while still catching a
// garbage estimate from an uninitialized or racing read.
function checkFootprintStableAcrossClose(create: () => any, className: string, min: number, max: number) {
  const engine = create();
  engine.on("error", () => {});
  engine.on("data", () => {});
  const handle = engine._handle;
  expect(handle.constructor.name).toBe(className);
  const before = estimateShallowMemoryUsageOf(handle);
  expect(estimateShallowMemoryUsageOf(handle)).toBe(before); // stable while live
  engine.destroy(); // closes the handle once and nulls engine._handle
  expect(engine._handle).toBeNull();
  const after = estimateShallowMemoryUsageOf(handle);
  expect(before).toBeGreaterThan(min);
  expect(before).toBeLessThan(max);
  expect(after).toBe(before);
}

test("brotli compress: estimated size stays tied to construction mode across close", () => {
  checkFootprintStableAcrossClose(() => zlib.createBrotliCompress(), "NativeBrotli", 5000, 60_000);
});

test("brotli decompress: estimated size stays tied to construction mode across close", () => {
  checkFootprintStableAcrossClose(() => zlib.createBrotliDecompress(), "NativeBrotli", 855, 60_000);
});

test("zstd compress: estimated size stays tied to construction mode across close", () => {
  checkFootprintStableAcrossClose(() => zlib.createZstdCompress(), "NativeZstd", 5000, 60_000);
});

test("zstd decompress: estimated size stays tied to construction mode across close", () => {
  checkFootprintStableAcrossClose(() => zlib.createZstdDecompress(), "NativeZstd", 90_000, 1_000_000);
});

// GC-safety guard: one spawned process interleaves 8 brotli and 8 zstd
// compression streams, forcing a full GC right after each write is queued on
// the work pool and again on the first data event (mid drive loop), so
// estimatedSize/visitChildren fires on the marking thread against live
// streams; each group's final GC marks the already-closed handles. Asserts
// every stream produced output and the process exits cleanly (this build has
// ASAN under `bun bd`).
//
// The guarded race is marking-thread vs work-pool timing, not compression
// effort, so quality/level are set low and both classes share one child
// process: spawn + module load dominate the fixture's cost, which matters on
// slow contended CI runners. A failed group names itself, either in the
// stderr of its rejection or as the missing "<group> OK" line.
const gcFixture = /* js */ `
  const zlib = require("zlib");
  const compressible = Buffer.alloc(128 * 1024, "abcdefgh");
  const random = require("crypto").randomBytes(128 * 1024);
  function drive(z, buf, name, bucket) {
    bucket.push(new Promise((resolve, reject) => {
      const fail = why => reject(new Error(name + ": " + why));
      let out = 0;
      let sampled = false;
      z.on("error", e => fail(e.message || e));
      z.on("data", c => {
        out += c.length;
        if (!sampled) { sampled = true; Bun.gc(true); }
      });
      z.on("end", () => (out > 0 ? resolve() : fail("stream produced no output")));
      z.write(buf, () => z.end());
      Bun.gc(true);
    }));
  }
  const brotli = [], zstd = [];
  for (let i = 0; i < 8; i++) {
    drive(zlib.createBrotliCompress({ chunkSize: 32 * 1024, params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 2 } }), compressible, "brotli", brotli);
    drive(zlib.createZstdCompress({ chunkSize: 32 * 1024, params: { [zlib.constants.ZSTD_c_compressionLevel]: 1 } }), random, "zstd", zstd);
  }
  Promise.all(brotli).then(() => { Bun.gc(true); console.log("brotli OK"); });
  Promise.all(zstd).then(() => { Bun.gc(true); console.log("zstd OK"); });
`;

test.concurrent("brotli+zstd: estimatedSize during GC while streams are live exits cleanly", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", gcFixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.split("\n").filter(Boolean).toSorted()).toEqual(["brotli OK", "zstd OK"]);
  expect(exitCode).toBe(0);
});
