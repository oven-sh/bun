import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// NativeBrotli/NativeZstd report external allocations to the GC via an
// estimatedSize function. The codegen contract for that flag is "Called from
// any thread", i.e. it runs inside JSC's concurrent GC visitChildren on the
// marking thread. Those impls used to read `self.stream.get().mode` through a
// JsCell whose Send/Sync impl is only sound under JS-thread affinity. While
// the JS thread holds `&mut` inside a `stream.with_mut(...)` drive loop (init,
// do_work), the marking thread could materialize an aliasing `&` through
// `stream.get()` - a Rust aliasing violation.
//
// The fix caches the per-mode footprint in a plain immutable field at
// construction, so estimatedSize never reads `self.stream`. The footprint is
// then fixed for the life of the handle, independent of the `mode` field that
// close() mutates on the JS thread.

// estimateShallowMemoryUsageOf(cell) returns sizeof(cell) + estimated_size().
// The native stream handle lives on engine._handle. We keep our own reference
// to it, read its estimated size while live, then destroy the engine (which
// closes the handle and, on the old code, set mode = NONE so estimatedSize
// reported 0 for the external state). With the cached footprint the reported
// external size does not collapse after close; it stays tied to the
// construction-time mode. That is the observable effect of no longer reading
// the live `mode` through the JsCell.
//
// `min` is the per-mode external footprint the constructor caches:
//   brotli encode 5143, brotli decode 855, zstd compress 5272, zstd decompress 95968.
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
  const zlib = require("zlib");
  checkFootprintStableAcrossClose(() => zlib.createBrotliCompress(), 5000);
});

test("brotli decompress: estimated size stays tied to construction mode across close", () => {
  const zlib = require("zlib");
  checkFootprintStableAcrossClose(() => zlib.createBrotliDecompress(), 855);
});

test("zstd compress: estimated size stays tied to construction mode across close", () => {
  const zlib = require("zlib");
  checkFootprintStableAcrossClose(() => zlib.createZstdCompress(), 5000);
});

test("zstd decompress: estimated size stays tied to construction mode across close", () => {
  const zlib = require("zlib");
  checkFootprintStableAcrossClose(() => zlib.createZstdDecompress(), 90000);
});

// GC-safety guard: drive a write so the JS thread enters with_mut, then force
// GC so estimatedSize/visitChildren fires on the marking thread against a live
// stream. Asserts the stream still works and the process exits cleanly (this
// build has ASAN under `bun bd`). This guards the aliasing contract the fix
// established: estimatedSize must never touch the JsCell.
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
  const cleanedStderr = stderr
    .split("\n")
    .filter(line => line && !line.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  return { stdout, stderr: cleanedStderr, exitCode };
}

test("brotli: estimatedSize during GC while a stream is live exits cleanly", async () => {
  const { stdout, stderr, exitCode } = await runGc(brotliGcFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test("zstd: estimatedSize during GC while a stream is live exits cleanly", async () => {
  const { stdout, stderr, exitCode } = await runGc(zstdGcFixture);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
