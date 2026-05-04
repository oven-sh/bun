import { describe, expect, test } from "bun:test";
import { readFileSync, unlinkSync } from "fs";
import { tmpdirSync } from "harness";
import { join } from "path";

// @ts-expect-error unsafe is not in the public types
const prof = Bun.unsafe.mimallocProf;

const longA = Buffer.alloc(256, "x").toString();
const longB = Buffer.alloc(500, "x").toString();

describe("Bun.unsafe.mimallocProf", () => {
  test("API surface", () => {
    expect(typeof prof.start).toBe("function");
    expect(typeof prof.stop).toBe("function");
    expect(typeof prof.reset).toBe("function");
    expect(typeof prof.snapshot).toBe("function");
  });

  test("start/stop returns a profile.proto Buffer", () => {
    prof.start(4096);
    // generate native allocations that go through mimalloc (URL parser, inspect formatter)
    const keep: unknown[] = [];
    for (let i = 0; i < 1000; i++) keep.push(new URL("https://example.com/p/" + i + "?q=" + longA));
    for (let i = 0; i < 1000; i++) keep.push(Bun.inspect({ i, s: longB }));
    const pb = prof.stop();
    expect(Buffer.isBuffer(pb)).toBe(true);
    expect(pb.length).toBeGreaterThan(500);
    // profile.proto starts with sample_type field (tag 0x0a for field 1, wire type 2)
    expect(pb[0]).toBe(0x0a);
    // string table should contain the standard sample-type names
    const text = pb.toString("latin1");
    expect(text).toContain("inuse_space");
    expect(text).toContain("alloc_space");
    keep.length = 0;
  });

  test("reset clears samples", () => {
    prof.start(1024);
    for (let i = 0; i < 1000; i++) Bun.inspect({ i, s: longB });
    const pb0 = prof.stop();
    prof.start(1024);
    prof.reset();
    const pb1 = prof.stop();
    // pb1 has no samples (only headers/mappings/strings), pb0 has ~hundreds
    expect(pb1.length).toBeGreaterThan(0);
    expect(pb1.length).toBeLessThan(pb0.length / 2);
  });

  test("start with default rate", () => {
    prof.start(); // default 512 KiB
    Buffer.alloc(1024 * 1024);
    const pb = prof.stop();
    expect(pb.length).toBeGreaterThan(0);
  });

  test("start rejects non-positive rate", () => {
    expect(() => prof.start(0)).toThrow();
    expect(() => prof.start(-1)).toThrow();
  });

  test("snapshot writes a file", () => {
    const dir = tmpdirSync();
    const path = join(dir, `mimalloc-snapshot.bin`);
    const ok = prof.snapshot(path);
    expect(ok).toBe(true);
    const data = readFileSync(path);
    // snapshot magic 'MIHS' little-endian
    expect(data.readUInt32LE(0)).toBe(0x5348494d);
    unlinkSync(path);
  });
});
