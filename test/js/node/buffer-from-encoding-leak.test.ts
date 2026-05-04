import { describe, expect, test } from "bun:test";

// JSBuffer__bufferFromPointerAndLengthAndDeinit used to skip the deallocator entirely
// when the resulting length was 0. Buffer.from(<string with no valid hex>, "hex") would
// allocate len/2 bytes, decode zero bytes, and hand a zero-length slice back to C++ —
// which then dropped the allocation on the floor.

describe("Buffer.from(string, encoding) does not leak when decoded length is 0", () => {
  test("hex with no valid hex digits returns an empty Buffer", () => {
    expect(Buffer.from("zz", "hex")).toEqual(Buffer.alloc(0));
    expect(Buffer.from("z", "hex")).toEqual(Buffer.alloc(0));
    expect(Buffer.from("   ", "base64")).toEqual(Buffer.alloc(0));
  });

  test("hex with no valid hex digits does not leak the staging allocation", () => {
    // 8192 input chars -> 4096-byte staging allocation which is leaked per call
    // without the fix.
    const str = Buffer.alloc(8192, "z").toString();
    const iterations = 50_000;

    // warm up so any one-time allocations (JIT tiers, caches) don't count
    for (let i = 0; i < 1000; i++) Buffer.from(str, "hex");
    Bun.gc(true);
    const before = process.memoryUsage.rss();

    for (let i = 0; i < iterations; i++) Buffer.from(str, "hex");
    Bun.gc(true);
    const after = process.memoryUsage.rss();

    const growthMB = (after - before) / 1024 / 1024;
    // Without the fix this grows by ~200 MB (50k * 4096 bytes). With the fix,
    // growth is noise.
    expect(growthMB).toBeLessThan(40);
  });
});
