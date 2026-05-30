import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Tests for bounds checking on native zlib handle write/writeSync methods.
// These verify that user-controlled offset/length parameters are validated
// against actual buffer bounds, preventing out-of-bounds memory access.

describe("zlib native handle bounds checking", () => {
  function createHandle() {
    const zlib = require("zlib");
    const deflate = zlib.createDeflateRaw();
    return deflate._handle;
  }

  test("writeSync rejects in_len exceeding input buffer", () => {
    const handle = createHandle();
    const inBuf = Buffer.alloc(16);
    const outBuf = Buffer.alloc(1024);

    // in_len=65536 far exceeds the 16-byte input buffer
    expect(() => {
      handle.writeSync(0, inBuf, 0, 65536, outBuf, 0, 1024);
    }).toThrow(/exceeds input buffer length/);
  });

  test("writeSync rejects out_len exceeding output buffer", () => {
    const handle = createHandle();
    const inBuf = Buffer.alloc(16);
    const outBuf = Buffer.alloc(16);

    // out_len=65536 far exceeds the 16-byte output buffer
    expect(() => {
      handle.writeSync(0, inBuf, 0, 16, outBuf, 0, 65536);
    }).toThrow(/exceeds output buffer length/);
  });

  test("writeSync rejects in_off + in_len exceeding input buffer", () => {
    const handle = createHandle();
    const inBuf = Buffer.alloc(16);
    const outBuf = Buffer.alloc(1024);

    // in_off=10 + in_len=16 = 26 > 16
    expect(() => {
      handle.writeSync(0, inBuf, 10, 16, outBuf, 0, 1024);
    }).toThrow(/exceeds input buffer length/);
  });

  test("writeSync rejects out_off + out_len exceeding output buffer", () => {
    const handle = createHandle();
    const inBuf = Buffer.alloc(16);
    const outBuf = Buffer.alloc(16);

    // out_off=10 + out_len=16 = 26 > 16
    expect(() => {
      handle.writeSync(0, inBuf, 0, 16, outBuf, 10, 16);
    }).toThrow(/exceeds output buffer length/);
  });

  test("writeSync allows valid bounds", () => {
    const handle = createHandle();
    const inBuf = Buffer.alloc(16);
    const outBuf = Buffer.alloc(1024);

    // This should not throw - valid bounds
    expect(() => {
      handle.writeSync(0, inBuf, 0, 16, outBuf, 0, 1024);
    }).not.toThrow();
  });

  test("writeSync allows valid offset + length within bounds", () => {
    const handle = createHandle();
    const inBuf = Buffer.alloc(32);
    const outBuf = Buffer.alloc(1024);

    // in_off=8 + in_len=16 = 24 <= 32, valid
    expect(() => {
      handle.writeSync(0, inBuf, 8, 16, outBuf, 0, 1024);
    }).not.toThrow();
  });

  test("writeSync allows null input (flush only)", () => {
    const handle = createHandle();
    const outBuf = Buffer.alloc(1024);

    // null input is valid (flush only)
    expect(() => {
      handle.writeSync(0, null, 0, 0, outBuf, 0, 1024);
    }).not.toThrow();
  });
});

describe("zlib native handle writeState", () => {
  test("writeSync updates the writeState array", () => {
    const zlib = require("zlib");
    const deflate = zlib.createDeflateRaw();
    const handle = deflate._handle;
    const ws = deflate._writeState;
    const inBuf = Buffer.from("hello world ".repeat(10));
    const outBuf = Buffer.alloc(1024);

    ws[0] = 0;
    ws[1] = 0xffffffff;
    handle.writeSync(2 /* Z_SYNC_FLUSH */, inBuf, 0, inBuf.length, outBuf, 0, outBuf.length);

    // writeState receives (availOut, availIn) after the write completes.
    expect(ws[0]).toBeGreaterThan(0);
    expect(ws[0]).toBeLessThan(outBuf.length);
    expect(ws[1]).toBe(0);
  });

  test("write completion with a detached writeState backing store does not crash", async () => {
    // The native handle caches the writeState array passed to init(). If its
    // backing ArrayBuffer is detached mid-stream, completing a write must
    // re-resolve the array and skip the update rather than write through a
    // stale pointer into freed/transferred memory.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const zlib = require("zlib");
          const deflate = zlib.createDeflateRaw();
          const handle = deflate._handle;
          const ws = deflate._writeState;
          const input = Buffer.from("hello world ".repeat(10));
          const out = Buffer.alloc(1024);
          handle.writeSync(2, input, 0, input.length, out, 0, out.length);
          // Detach the writeState backing store; the transferred copy is
          // dropped immediately and collected.
          structuredClone(ws.buffer, { transfer: [ws.buffer] });
          Bun.gc(true);
          // This write completion must not touch the detached store.
          handle.writeSync(2, Buffer.from("more data here"), 0, 14, out, 0, out.length);
          // A fresh stream still works end-to-end.
          const compressed = zlib.deflateRawSync("still works");
          console.log(zlib.inflateRawSync(compressed).toString());
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("still works");
    expect(exitCode).toBe(0);
  });
});
