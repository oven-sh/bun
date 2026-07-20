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

// The zlib.ts wrapper always drives the native handle as
// constructor -> init() -> write*() -> close(), caches onerror/writeCallback
// in init(), and nulls `_handle` on close. The native binding assumed that
// protocol: driving a handle outside it (reachable through `_handle` and
// `_handle.constructor`) used to abort the whole process with a Rust
// `unreachable!()` / `unwrap()` on `None`, or hand a null state pointer
// straight into brotli/zstd. Each case runs in a subprocess so a regression
// fails one test instead of taking down the runner. `handled` means the child
// reached the statement after the call; `threw ...` echoes the JS error.
describe.concurrent("zlib native handle driven outside the zlib.ts lifecycle", () => {
  async function run(body: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const zlib = require("node:zlib");\n${body}`],
      // BUN_DESTRUCT_VM_ON_EXIT makes exit run `lastChanceToFinalize`, so the
      // finalizer of every handle the case leaves behind runs deterministically
      // (the ASAN CI lanes do this on every exit; without it the child "passes"
      // and then aborts only on those lanes).
      env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
      stderr: "pipe",
    });
    // stderr is drained so a large diagnostic can't fill the pipe and block
    // the child, but it isn't asserted on (debug/ASAN builds write to it).
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), exitCode };
  }

  const CLOSED = "threw ERR_INVALID_STATE: zlib binding closed";
  const cases: [name: string, body: string, expected: string][] = [
    // init() after close(): the Context is in NodeMode::NONE, which
    // Context::init treats as unreachable.
    [
      "zlib: init() after close() throws",
      `const h = zlib.createDeflate()._handle;
       h.close();
       try { h.init(15, 6, 8, 0, new Uint32Array(2), () => {}, undefined); console.log("handled"); }
       catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      CLOSED,
    ],
    [
      "brotli: init() after close() throws",
      `const h = zlib.createBrotliCompress()._handle;
       h.close();
       try { h.init(new Uint32Array(0), new Uint32Array(2), () => {}); console.log("handled"); }
       catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      CLOSED,
    ],
    [
      "zstd: init() after close() throws",
      `const h = zlib.createZstdCompress()._handle;
       h.close();
       try { h.init(new Uint32Array(0), undefined, new Uint32Array(2), () => {}); console.log("handled"); }
       catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      CLOSED,
    ],
    // write/writeSync after close(): brotli/zstd do_work() treated
    // NodeMode::NONE as unreachable; zlib silently no-op'd on an ended stream.
    [
      "zlib: writeSync() after close() throws",
      `const h = zlib.createDeflate()._handle;
       h.close();
       try { h.writeSync(0, null, 0, 0, new Uint8Array(64), 0, 64); console.log("handled"); }
       catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      CLOSED,
    ],
    [
      "brotli: writeSync() after close() throws",
      `const h = zlib.createBrotliCompress()._handle;
       h.close();
       try { h.writeSync(0, null, 0, 0, new Uint8Array(64), 0, 64); console.log("handled"); }
       catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      CLOSED,
    ],
    [
      "zstd: writeSync() after close() throws",
      `const h = zlib.createZstdCompress()._handle;
       h.close();
       try { h.writeSync(0, null, 0, 0, new Uint8Array(64), 0, 64); console.log("handled"); }
       catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      CLOSED,
    ],
    // writeSync() before init(): brotli/zstd were handed a null state
    // pointer, which their C APIs dereference unconditionally.
    [
      "brotli: writeSync() before init() does not dereference a null encoder",
      `const C = zlib.createBrotliCompress()._handle.constructor;
       new C(8).writeSync(0, null, 0, 0, new Uint8Array(64), 0, 64); console.log("handled");`,
      "handled",
    ],
    [
      "zstd: writeSync() before init() does not dereference a null CCtx",
      `const C = zlib.createZstdCompress()._handle.constructor;
       new C(10).writeSync(0, null, 0, 0, new Uint8Array(64), 0, 64); console.log("handled");`,
      "handled",
    ],
    // With no onerror / writeCallback cached (init() never ran), an error or
    // an async write completion had no callback to unwrap.
    [
      "zlib: an error with no onerror cached is dropped, not fatal",
      `const C = zlib.createDeflate()._handle.constructor;
       new C(1).reset(); console.log("handled");`,
      "handled",
    ],
    [
      "brotli: async write() with no writeCallback cached completes",
      `const C = zlib.createBrotliDecompress()._handle.constructor;
       const h = new C(9);
       h.reset();
       h.write(0, null, 0, 0, new Uint8Array(64), 0, 64);
       console.log("handled");`,
      "handled",
    ],
    // A constructed-but-never-initialized handle reaching the GC finalizer:
    // brotli/zstd Context::close() tried to free/reset a state that was never
    // created, and zlib's asserted that deflateEnd accepted the zeroed stream.
    [
      "zlib: a never-initialized handle finalizes cleanly",
      `const C = zlib.createDeflate()._handle.constructor;
       new C(1); console.log("handled");`,
      "handled",
    ],
    [
      "brotli: a never-initialized handle finalizes cleanly",
      `const C = zlib.createBrotliCompress()._handle.constructor;
       new C(8); console.log("handled");`,
      "handled",
    ],
    [
      "zstd: a never-initialized handle finalizes cleanly",
      `const C = zlib.createZstdCompress()._handle.constructor;
       new C(10); console.log("handled");`,
      "handled",
    ],
    // init()/params() while an async write() is still running on the thread
    // pool: both sides would mutate the same native stream concurrently.
    [
      "zlib: init() while an async write is in flight throws",
      `const C = zlib.createDeflate()._handle.constructor;
       const h = new C(1);
       h.init(15, 6, 8, 0, new Uint32Array(2), () => {}, undefined);
       h.write(0, null, 0, 0, new Uint8Array(64), 0, 64);
       try { h.init(15, 6, 8, 0, new Uint32Array(2), () => {}, undefined); console.log("handled"); }
       catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      "threw ERR_INVALID_STATE: Write already in progress",
    ],
    [
      "zlib: params() while an async write is in flight throws",
      `const C = zlib.createDeflate()._handle.constructor;
       const h = new C(1);
       h.init(15, 6, 8, 0, new Uint32Array(2), () => {}, undefined);
       h.write(0, null, 0, 0, new Uint8Array(64), 0, 64);
       try { h.params(1, 0); console.log("handled"); }
       catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      "threw ERR_INVALID_STATE: Write already in progress",
    ],
    [
      "brotli: init() while an async write is in flight throws",
      `const C = zlib.createBrotliCompress()._handle.constructor;
       const h = new C(8);
       h.init(new Uint32Array(0), new Uint32Array(2), () => {});
       h.write(0, null, 0, 0, new Uint8Array(64), 0, 64);
       try { h.init(new Uint32Array(0), new Uint32Array(2), () => {}); console.log("handled"); }
       catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      "threw ERR_INVALID_STATE: Write already in progress",
    ],
    [
      "zstd: init() while an async write is in flight throws",
      `const C = zlib.createZstdCompress()._handle.constructor;
       const h = new C(10);
       h.init(new Uint32Array(0), undefined, new Uint32Array(2), () => {});
       h.write(0, null, 0, 0, new Uint8Array(64), 0, 64);
       try { h.init(new Uint32Array(0), undefined, new Uint32Array(2), () => {}); console.log("handled"); }
       catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      "threw ERR_INVALID_STATE: Write already in progress",
    ],
    // init() that fails partway (zlib: deflateInit2_ rejects the arguments;
    // brotli/zstd: a bad parameter key after the state was created) tears the
    // Context down; the handle has to reject further use.
    [
      "zlib: a handle whose init() arguments were rejected is closed",
      `const C = zlib.createDeflate()._handle.constructor;
       const h = new C(1);
       h.init(100, 6, 8, 0, new Uint32Array(2), () => {}, undefined);
       try { h.init(15, 6, 8, 0, new Uint32Array(2), () => {}, undefined); console.log("handled"); }
       catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      CLOSED,
    ],
    [
      "brotli: a handle whose init() parameters were rejected is closed",
      `const C = zlib.createBrotliCompress()._handle.constructor;
       const h = new C(8);
       const p = new Uint32Array(50).fill(0xffffffff); p[49] = 0;
       const r = h.init(p, new Uint32Array(2), () => {});
       try { h.writeSync(0, null, 0, 0, new Uint8Array(64), 0, 64); console.log("handled " + r); }
       catch (e) { console.log("threw " + e.code + ": " + e.message + " " + r); }`,
      "threw ERR_INVALID_STATE: zlib binding closed false",
    ],
    [
      "zstd: a handle whose init() parameters were rejected is closed",
      `const C = zlib.createZstdCompress()._handle.constructor;
       const h = new C(10);
       const p = new Uint32Array(50).fill(0xffffffff); p[49] = 0;
       try { h.init(p, undefined, new Uint32Array(2), () => {}); } catch {}
       try { h.writeSync(0, null, 0, 0, new Uint8Array(64), 0, 64); console.log("handled"); }
       catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      "threw ERR_INVALID_STATE: zlib binding closed",
    ],
  ];

  for (const [name, body, expected] of cases) {
    test.concurrent(name, async () => {
      expect(await run(body)).toEqual({ stdout: expected, exitCode: 0 });
    });
  }

  // deflateSetDictionary / inflateSetDictionary take a `uInt` length; a 2**32
  // byte dictionary overflowed the cast after the native handle had already
  // copied it. The length is now rejected before the copy, so the Uint8Array
  // below is never read and stays virtual (cheap).
  test.concurrent("zlib: a 2**32-byte dictionary throws instead of overflowing a u32", async () => {
    expect(
      await run(
        `try { zlib.deflateSync(Buffer.from("hello"), { dictionary: new Uint8Array(2 ** 32) }); console.log("handled"); }
         catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      ),
    ).toEqual({
      stdout:
        'threw ERR_OUT_OF_RANGE: The value of "dictionary.byteLength" is out of range. It must be <= 4294967295. Received 4294967296',
      exitCode: 0,
    });
  });
});
