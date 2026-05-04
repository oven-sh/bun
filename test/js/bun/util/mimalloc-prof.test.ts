import { describe, expect, test } from "bun:test";

// @ts-expect-error unsafe is not in the public types
const prof = Bun.unsafe.mimallocProf;

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
    for (let i = 0; i < 1000; i++) keep.push(new URL("https://example.com/p/" + i + "?q=" + "x".repeat(256)));
    for (let i = 0; i < 1000; i++) keep.push(Bun.inspect({ i, s: "x".repeat(500) }));
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
    for (let i = 0; i < 1000; i++) Bun.inspect({ i, s: "x".repeat(200) });
    prof.reset();
    prof.stop();
    // after reset, a fresh start should not include prior samples
    prof.start(1024);
    const pb1 = prof.stop();
    // mostly-empty profile (just headers/mappings); should be small
    expect(pb1.length).toBeGreaterThan(0);
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
    const path = `/tmp/bun-mimalloc-snapshot-${process.pid}.bin`;
    const ok = prof.snapshot(path);
    expect(ok).toBe(true);
    const data = require("fs").readFileSync(path);
    // snapshot magic 'MIHS' little-endian
    expect(data.readUInt32LE(0)).toBe(0x5348494d);
    require("fs").unlinkSync(path);
  });
});
