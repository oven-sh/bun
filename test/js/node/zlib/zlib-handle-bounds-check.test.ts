import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { totalmem } from "node:os";
import zlib from "node:zlib";
import { inflate, nothing, Z_FINISH } from "./zlib-golden/engine";
import { input } from "./zlib-golden/inputs";
import { Bits, inZlib, stored } from "./zlib-golden/write";

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
    // init() after close(): the handle has no Context left.
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
    // writeSync() before init(): there is no state to work on yet.
    [
      "brotli: writeSync() before init() does without a decoder or an encoder",
      `const C = zlib.createBrotliCompress()._handle.constructor;
       for (const h of [new C(8), new C(9)]) {
         h.onerror = (...error) => console.log(...error);
         for (const flush of [0, 2]) h.writeSync(flush, null, 0, 0, new Uint8Array(64), 0, 64);
       }`,
      Array(2).fill("Compression failed -1 ERR_BROTLI_COMPRESSION_FAILED").join("\n"),
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
    // init() that fails partway (zlib: the arguments are rejected;
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
    [
      "zstd: a handle whose init() dictionary was rejected is closed",
      `const C = zlib.createZstdCompress()._handle.constructor;
       const h = new C(11);
       try { h.init(new Uint32Array(0), undefined, new Uint32Array(2), () => {}, Buffer.from("37a430ec01000000", "hex")); } catch {}
       try { h.writeSync(0, null, 0, 0, new Uint8Array(64), 0, 64); console.log("handled"); }
       catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      CLOSED,
    ],
    [
      "zstd: reset() before init() does nothing",
      `const C = zlib.createZstdCompress()._handle.constructor;
       const h = new C(10), out = new Uint8Array(64);
       h.reset();
       h.writeSync(zlib.constants.ZSTD_e_end, null, 0, 0, out, 0, 64);
       console.log(out.some(Boolean) ? "wrote a frame" : "handled");`,
      "handled",
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

  test.concurrent("zlib: params() after a buffered writeSync keeps the pending input in the stream", async () => {
    expect(
      await run(
        `const d = zlib.createDeflate({ level: 0 });
         const h = d._handle;
         const ws = d._writeState;
         const input = Buffer.alloc(1024, 97);
         const out1 = Buffer.alloc(4096);
         h.writeSync(zlib.constants.Z_NO_FLUSH, input, 0, input.length, out1, 0, out1.length);
         const head = Buffer.from(out1.subarray(0, out1.length - ws[0]));
         out1.buffer.transfer();
         h.params(1, 0);
         const out2 = Buffer.alloc(4096);
         h.writeSync(zlib.constants.Z_FINISH, null, 0, 0, out2, 0, out2.length);
         const tail = out2.subarray(0, out2.length - ws[0]);
         const result = zlib.inflateSync(Buffer.concat([head, tail]));
         console.log(head.length + " " + result.length + " " + result.equals(input));`,
      ),
    ).toEqual({ stdout: "2 1024 true", exitCode: 0 });
  });

  test.concurrent.each([
    ["ZSTD_c_stableInBuffer", "createZstdCompress", 1006],
    ["ZSTD_d_stableOutBuffer", "createZstdDecompress", 1001],
  ])("zstd: init() refuses the experimental %s", async (_, create, key) => {
    expect(
      await run(
        `for (const value of [0, 1]) {
           const params = new Uint32Array(${key} + 1).fill(-1);
           params[${key}] = value;
           try { console.log(zlib.${create}()._handle.init(params, undefined, new Uint32Array(2), () => {})); }
           catch (e) { console.log("threw " + e.code + ": " + e.message); }
         }`,
      ),
    ).toEqual({
      stdout: Array(2).fill("threw ERR_ZLIB_INITIALIZATION_FAILED: Setting parameter failed").join("\n"),
      exitCode: 0,
    });
  });

  test.concurrent("zstd: a compressor that failed does not read the input of the write that failed", async () => {
    expect(
      await run(
        `const size = 1 << 18;
         const h = zlib.createZstdCompress({ pledgedSrcSize: size })._handle;
         h.onerror = (message, errno, code) => console.log(code);
         const pattern = require("node:crypto").randomBytes(1 << 14);
         const out = Buffer.alloc(size * 2);
         const memory = new ArrayBuffer(size + 1, { maxByteLength: size + 1 });
         h.writeSync(zlib.constants.ZSTD_e_continue, null, 0, 0, out, 0, out.length);
         h.writeSync(zlib.constants.ZSTD_e_end, Buffer.from(memory).fill(pattern), 0, size + 1, out, 0, out.length);
         memory.resize(0);
         h.writeSync(zlib.constants.ZSTD_e_flush, pattern, 0, pattern.length, out, 0, out.length);`,
      ),
    ).toEqual({ stdout: "ZSTD_error_srcSize_wrong\nZSTD_error_srcSize_wrong", exitCode: 0 });
  });

  test.concurrent("zstd: a compressor that broke its pledge keeps failing until reset()", async () => {
    expect(
      await run(
        `const stream = zlib.createZstdCompress({ pledgedSrcSize: 5 });
         const h = stream._handle;
         h.onerror = (message, errno, code) => console.log(code);
         const out = Buffer.alloc(64);
         const write = input => h.writeSync(zlib.constants.ZSTD_e_end, input, 0, input.length, out, 0, out.length);
         write(Buffer.from("hi"));
         write(Buffer.from("hello"));
         h.reset();
         write(Buffer.from("hello"));
         console.log(zlib.zstdDecompressSync(out.subarray(0, out.length - stream._writeState[0])).toString());
         h.reset();
         write(Buffer.from("hi"));`,
      ),
    ).toEqual({
      stdout: "ZSTD_error_srcSize_wrong\nZSTD_error_srcSize_wrong\nhello\nZSTD_error_srcSize_wrong",
      exitCode: 0,
    });
  });

  test.concurrent("zstd: a decompressor that failed keeps failing until reset()", async () => {
    expect(
      await run(
        `const stream = zlib.createZstdDecompress();
         const h = stream._handle;
         h.onerror = (message, errno, code) => console.log(code);
         const frame = zlib.zstdCompressSync("hello", { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } });
         const out = Buffer.alloc(64);
         const write = input => h.writeSync(zlib.constants.ZSTD_e_end, input, 0, input.length, out, 0, out.length);
         write(frame.with(-1, ~frame.at(-1)));
         write(frame);
         h.reset();
         write(frame);
         console.log(out.toString("latin1", 0, out.length - stream._writeState[0]));`,
      ),
    ).toEqual({ stdout: "ZSTD_error_checksum_wrong\nZSTD_error_checksum_wrong\nhello", exitCode: 0 });
  });

  const isShortOfMemory = Math.min(totalmem(), process.constrainedMemory() || Infinity) < 10 * 1024 ** 3;

  test.concurrent.skipIf(isShortOfMemory)("brotli: refuses a dictionary above 2**30 bytes", async () => {
    expect(
      await run(
        `const usesBuiltInWords = zlib.brotliCompressSync("information about the government of the international development");
           const bytes = new Uint8Array(2 ** 31);
           for (const method of ["brotliDecompressSync", "brotliCompressSync"])
             for (const dictionary of [bytes, bytes.subarray(0, 2 ** 30 + 1)]) {
               try { zlib[method](usesBuiltInWords, { dictionary }); console.log("handled"); }
               catch (e) { console.log(e.code); }
             }`,
      ),
    ).toEqual({ stdout: Array(4).fill("ERR_ZLIB_INITIALIZATION_FAILED").join("\n"), exitCode: 0 });
  });

  test.concurrent.skipIf(isShortOfMemory)(
    "brotli: an init() that refuses its dictionary says why, and leaves no decoder or encoder",
    async () => {
      expect(
        await run(
          `const C = zlib.createBrotliCompress()._handle.constructor;
           const tooLarge = new Uint8Array(2 ** 30 + 1);
           for (const h of [new C(8), new C(9)]) {
             h.onerror = (...error) => console.log(...error);
             for (const dictionary of [undefined, tooLarge]) h.init(new Uint32Array(0), new Uint32Array(2), () => {}, dictionary);
             h.writeSync(2, null, 0, 0, new Uint8Array(64), 0, 64);
           }`,
        ),
      ).toEqual({
        stdout: [
          "Failed to attach brotli dictionary -1 ERR_ZLIB_DICTIONARY_LOAD_FAILED",
          "Failed to prepare brotli dictionary -1 ERR_ZLIB_DICTIONARY_LOAD_FAILED",
          "Compression failed -1 ERR_BROTLI_COMPRESSION_FAILED",
        ].join("\n"),
        exitCode: 0,
      });
    },
  );
});

describe.concurrent("zlib native handle argument validation", () => {
  async function run(body: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const zlib = require("node:zlib");\n${body}`],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), exitCode };
  }

  test.concurrent("brotli: writeSync() rejects a flush operation outside the brotli range", async () => {
    expect(
      await run(
        `const s = zlib.createBrotliCompress();
         try { s._processChunk(Buffer.from("x"), zlib.constants.Z_FINISH); console.log("handled"); }
         catch (e) { console.log("threw " + e.code + ": " + e.message); }
         console.log(zlib.brotliDecompressSync(zlib.brotliCompressSync("still works")).toString());`,
      ),
    ).toEqual({ stdout: "threw ERR_INVALID_ARG_VALUE: Invalid flush value\nstill works", exitCode: 0 });
  });

  test.concurrent("brotli: write() rejects a flush operation outside the brotli range", async () => {
    expect(
      await run(
        `const h = zlib.createBrotliCompress()._handle;
         try { h.write(zlib.constants.Z_FINISH, null, 0, 0, new Uint8Array(64), 0, 64); console.log("handled"); }
         catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      ),
    ).toEqual({ stdout: "threw ERR_INVALID_ARG_VALUE: Invalid flush value", exitCode: 0 });
  });

  test.concurrent("zstd: writeSync() rejects a flush operation outside the zstd range", async () => {
    expect(
      await run(
        `const h = zlib.createZstdCompress()._handle;
         try { h.writeSync(zlib.constants.Z_FINISH, null, 0, 0, new Uint8Array(64), 0, 64); console.log("handled"); }
         catch (e) { console.log("threw " + e.code + ": " + e.message); }
         console.log(zlib.zstdDecompressSync(zlib.zstdCompressSync("still works")).toString());`,
      ),
    ).toEqual({ stdout: "threw ERR_INVALID_ARG_VALUE: Invalid flush value\nstill works", exitCode: 0 });
  });

  test.concurrent("brotli: writeSync() accepts every brotli flush operation", async () => {
    expect(
      await run(
        `const ops = [zlib.constants.BROTLI_OPERATION_PROCESS, zlib.constants.BROTLI_OPERATION_FLUSH, zlib.constants.BROTLI_OPERATION_FINISH, zlib.constants.BROTLI_OPERATION_EMIT_METADATA];
         for (const op of ops) {
           const h = zlib.createBrotliCompress()._handle;
           h.writeSync(op, null, 0, 0, new Uint8Array(64), 0, 64);
         }
         try { zlib.createBrotliCompress()._handle.writeSync(zlib.constants.BROTLI_OPERATION_EMIT_METADATA + 1, null, 0, 0, new Uint8Array(64), 0, 64); console.log("handled"); }
         catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      ),
    ).toEqual({ stdout: "threw ERR_INVALID_ARG_VALUE: Invalid flush value", exitCode: 0 });
  });

  test.concurrent("write() rejects an output buffer backed by a resizable ArrayBuffer", async () => {
    expect(
      await run(
        `const h = zlib.createDeflateRaw()._handle;
         const out = new Uint8Array(new ArrayBuffer(64, { maxByteLength: 128 }));
         try { h.write(zlib.constants.Z_NO_FLUSH, null, 0, 0, out, 0, 64); console.log("handled"); }
         catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      ),
    ).toEqual({
      stdout:
        'threw ERR_INVALID_ARG_VALUE: The "out" argument must not be backed by a resizable ArrayBuffer or a WebAssembly.Memory',
      exitCode: 0,
    });
  });

  test.concurrent("write() rejects an input buffer backed by a resizable ArrayBuffer", async () => {
    expect(
      await run(
        `const h = zlib.createDeflateRaw()._handle;
         const input = new Uint8Array(new ArrayBuffer(16, { maxByteLength: 64 }));
         try { h.write(zlib.constants.Z_NO_FLUSH, input, 0, 16, new Uint8Array(1024), 0, 1024); console.log("handled"); }
         catch (e) { console.log("threw " + e.code + ": " + e.message); }`,
      ),
    ).toEqual({
      stdout: 'threw ERR_INVALID_ARG_VALUE: The "in" argument must not be backed by a resizable ArrayBuffer',
      exitCode: 0,
    });
  });

  // A growable SharedArrayBuffer grows in place and never shrinks, so the
  // pointer/length captured for the threadpool write stays a valid prefix even
  // across a concurrent grow(). The resizable-buffer rejection above must not
  // apply to it.
  test.concurrent("write() accepts an output buffer backed by a growable SharedArrayBuffer", async () => {
    expect(
      await run(
        `const C = zlib.createDeflateRaw()._handle.constructor;
         const h = new C(zlib.constants.DEFLATERAW);
         const ws = new Uint32Array(2);
         const { promise, resolve } = Promise.withResolvers();
         h.init(15, 6, 8, 0, ws, resolve, undefined);
         const sab = new SharedArrayBuffer(64, { maxByteLength: 128 });
         if (!sab.growable) throw new Error("SharedArrayBuffer is not growable");
         const out = new Uint8Array(sab);
         h.write(zlib.constants.Z_FINISH, Buffer.from("hello"), 0, 5, out, 0, 64);
         sab.grow(128);
         await promise;
         const written = 64 - ws[0];
         console.log("ok " + zlib.inflateRawSync(Buffer.from(out.slice(0, written))).toString());`,
      ),
    ).toEqual({ stdout: "ok hello", exitCode: 0 });
  });

  test.concurrent("write() accepts an input buffer backed by a growable SharedArrayBuffer", async () => {
    expect(
      await run(
        `const C = zlib.createDeflateRaw()._handle.constructor;
         const h = new C(zlib.constants.DEFLATERAW);
         const ws = new Uint32Array(2);
         const { promise, resolve } = Promise.withResolvers();
         h.init(15, 6, 8, 0, ws, resolve, undefined);
         const sab = new SharedArrayBuffer(16, { maxByteLength: 64 });
         if (!sab.growable) throw new Error("SharedArrayBuffer is not growable");
         const input = new Uint8Array(sab);
         input.set(Buffer.from("hello world"));
         const out = Buffer.alloc(1024);
         h.write(zlib.constants.Z_FINISH, input, 0, 11, out, 0, 1024);
         sab.grow(64);
         await promise;
         const written = 1024 - ws[0];
         console.log("ok " + zlib.inflateRawSync(out.subarray(0, written)).toString());`,
      ),
    ).toEqual({ stdout: "ok hello world", exitCode: 0 });
  });

  test.concurrent("write() treats a detached output as empty", async () => {
    expect(
      await run(
        `const state = new Uint32Array(2), out = new Uint8Array(new ArrayBuffer(64));
         out.buffer.transfer();
         const h = zlib.createDeflate()._handle;
         h.init(15, 6, 8, 0, state, () => console.log(...state), undefined);
         h.write(zlib.constants.Z_NO_FLUSH, Buffer.from("abc"), 0, 3, out, 0, 0);`,
      ),
    ).toEqual({ stdout: "0 3", exitCode: 0 });
  });

  describe.each(["write", "writeSync"])("%s()", method => {
    const codecs = [
      ["createDeflateRaw", "Z_FINISH", "inflateRawSync"],
      ["createBrotliCompress", "BROTLI_OPERATION_FINISH", "brotliDecompressSync"],
      ["createZstdCompress", "ZSTD_e_end", "zstdDecompressSync"],
    ];

    test.concurrent.each(codecs)("%s rejects input and output ranges that overlap", async (create, finish) => {
      const message = 'ERR_INVALID_ARG_VALUE: The "in" and "out" ranges must not overlap';
      expect(
        await run(
          `const small = new Uint8Array(256), large = Buffer.allocUnsafeSlow(8192), memory = new ArrayBuffer(8192);
           for (const ranges of [
             [small, 0, 64, small, 63, 128],
             [large, 4096, 64, large, 0, 4097],
             [new Uint8Array(memory, 16), 0, 64, new DataView(memory), 79, 4096],
           ]) {
             try { zlib.${create}()._handle.${method}(zlib.constants.${finish}, ...ranges); console.log("handled"); }
             catch (e) { console.log(e.code + ": " + e.message); }
           }
           memory.transfer();
           console.log(memory.detached);`,
        ),
      ).toEqual({ stdout: [message, message, message, true].join("\n"), exitCode: 0 });
    });

    test.concurrent.each(codecs)("%s accepts adjacent ranges of one buffer", async (create, finish, inverse) => {
      expect(
        await run(
          `for (const [inOff, outOff] of [[0, 11], [128, 0]]) {
             const stream = zlib.${create}();
             const h = stream._handle;
             const buffer = Buffer.alloc(139);
             buffer.write("hello world", inOff);
             const { promise, resolve } = Promise.withResolvers();
             Object.assign(h, { buffer, cb: resolve, availOutBefore: 128, availInBefore: 11, inOff });
             h.${method}(zlib.constants.${finish}, buffer, inOff, 11, buffer, outOff, 128);
             ${method === "write" ? "await promise;" : ""}
             console.log(zlib.${inverse}(buffer.subarray(outOff, outOff + 128 - stream._writeState[0])).toString());
           }`,
        ),
      ).toEqual({ stdout: "hello world\nhello world", exitCode: 0 });
    });
  });
});

// With ZSTD_c_nbWorkers >= 1, a write posts a job to zstd's worker threads and returns. A frame's first
// job reads the stream's dictionary. Level 19 keeps the job running after the write callback.
describe("zstd compressor with workers and a dictionary", () => {
  const prelude = /* js */ `
    const zlib = require("node:zlib");
    const { pbkdf2Sync } = require("node:crypto");
    const { finished } = require("node:stream/promises");
    const { ZSTD_c_compressionLevel, ZSTD_c_jobSize, ZSTD_c_nbWorkers, ZSTD_c_overlapLog } = zlib.constants;

    const hex = (seed, length) => Buffer.from(pbkdf2Sync(seed, "", 1, length / 2, "sha256").toString("hex"));
    // Large enough that the allocator returns the freed dictionary to the OS.
    const dictionary = hex("dictionary", 192 * 1024);
    const input = hex("input", 512 * 1024);
    const stream = zlib
      .createZstdCompress({
        dictionary,
        params: {
          [ZSTD_c_nbWorkers]: 2,
          [ZSTD_c_jobSize]: input.length,
          [ZSTD_c_overlapLog]: 1,
          [ZSTD_c_compressionLevel]: 19,
        },
      })
      .on("data", () => {});
    await new Promise(done => stream.write(input, done));
  `;

  test.each([
    ["destroy()", `stream.destroy(); console.log("ok");`],
    [
      "reset() and the next frame",
      // reset() refuses if the job got to report output before write() returned.
      `stream.reset();
       stream.end("x");
       await finished(stream).catch(e => { if (e.code !== "ERR_ZLIB_INCOMPLETE_FRAME") throw e; });
       console.log("ok");`,
    ],
  ])("doesn't crash on %s while a job is running", async (_, body) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", prelude + body],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ok", exitCode: 0 });
  });
});

describe("zlib native handle errors and arguments", () => {
  const { DEFLATE, INFLATE, GZIP, GUNZIP, DEFLATERAW, INFLATERAW, UNZIP } = zlib.constants;
  const Handle = (zlib.createDeflate() as any)._handle.constructor;

  function handleFor(mode: number) {
    const [handle, state, errors] = [new Handle(mode), new Uint32Array(2), [] as unknown[]];
    handle.onerror = (message: string, errno: number, code: string) => errors.push({ message, errno, code });
    return {
      handle,
      errors,
      init(windowBits = 15, level = 6, memLevel = 8, strategy = 0, dictionary?: Uint8Array) {
        handle.init(windowBits, level, memLevel, strategy, state, () => {}, dictionary);
      },
      finish(data: Uint8Array) {
        const out = Buffer.alloc(data.length + 100);
        handle.writeSync(Z_FINISH, data, 0, data.length, out, 0, out.length);
        return out.subarray(0, out.length - state[0]);
      },
      [Symbol.dispose]: () => handle.close(),
    };
  }

  const plain = Buffer.from("plain");
  const whole = (dictionary?: Uint8Array) => inZlib(stored(new Bits(), plain, true).end(), plain, 15, dictionary);

  test.each([
    ["incorrect header check", -3, "Z_DATA_ERROR", plain, undefined],
    ["unexpected end of file", -5, "Z_BUF_ERROR", whole().subarray(0, -1), undefined],
    ["Missing dictionary", 2, "Z_NEED_DICT", whole(plain), undefined],
    ["Bad dictionary", 2, "Z_NEED_DICT", whole(plain), Buffer.from("other")],
  ])("%p has the number %d", (message, errno, code, data, dictionary) => {
    expect(() => zlib.inflateSync(data, { dictionary })).toThrow(expect.objectContaining({ message, errno, code }));
  });

  test("a stream that is cut short gives its output first, also if that takes all of the room", () => {
    const data = input("noise", 128);
    const { output, error } = inflate("InflateRaw", [stored(new Bits(), data, false).end()], { chunkSize: 64 });
    expect([output.equals(data), error]).toEqual([true, "Z_BUF_ERROR unexpected end of file"]);
  });

  describe.each([DEFLATE, INFLATE])("before init(), in mode %d", mode => {
    const failure = (message: string) => [{ message, errno: -2, code: "Z_STREAM_ERROR" }];

    test("writeSync() fails", () => {
      using it = handleFor(mode);
      it.finish(nothing);
      expect(it.errors).toEqual(failure("Zlib error"));
    });

    test("reset() fails", () => {
      using it = handleFor(mode);
      it.handle.reset();
      expect(it.errors).toEqual(failure("Failed to reset stream"));
    });

    test("params() fails where it means something", () => {
      using it = handleFor(mode);
      it.handle.params(1, 0);
      expect(it.errors).toEqual(mode === DEFLATE ? failure("Failed to set parameters") : []);
    });
  });

  describe("init()", () => {
    test.each([
      [DEFLATE, [7]],
      [DEFLATE, [16]],
      [DEFLATE, [32]],
      [DEFLATE, [16 + 256 + 9]],
      [DEFLATERAW, [8]],
      [DEFLATERAW, [16]],
      [DEFLATERAW, [256 + 9]],
      [GZIP, [8]],
      [GZIP, [16]],
      [DEFLATE, [15, -2]],
      [DEFLATE, [15, 10]],
      [DEFLATE, [15, 256 + 6]],
      [DEFLATE, [15, 6, 0]],
      [DEFLATE, [15, 6, 10]],
      [DEFLATE, [15, 6, 256 + 8]],
      [DEFLATE, [15, 6, 8, -1]],
      [DEFLATE, [15, 6, 8, 5]],
      [INFLATE, [7]],
      [INFLATE, [17]],
      [INFLATE, [48]],
      [INFLATE, [256 + 9]],
      [GUNZIP, [7]],
      [INFLATERAW, [7]],
      [INFLATERAW, [16]],
      [UNZIP, [7]],
      [UNZIP, [16]],
    ])("closes a handle in mode %d for %j", (mode, args) => {
      using it = handleFor(mode);
      it.init(...args);
      expect(() => it.finish(nothing)).toThrow("zlib binding closed");
    });

    const refused = (code: string, message: string) =>
      expect.objectContaining({ code, message: expect.stringContaining(message) });
    const notUint32Array = refused("ERR_INVALID_ARG_TYPE", '"writeResult"');
    const tooShort = refused("ERR_INVALID_ARG_VALUE", "at least 2 elements");

    test.each([
      [[undefined, () => {}], notUint32Array],
      [[[0, 0], () => {}], notUint32Array],
      [[new ArrayBuffer(8), () => {}], notUint32Array],
      [[new DataView(new ArrayBuffer(8)), () => {}], notUint32Array],
      [[new Uint8Array(8), () => {}], notUint32Array],
      [[new Int32Array(2), () => {}], notUint32Array],
      [[new Uint32Array(0), () => {}], tooShort],
      [[new Uint32Array(1), () => {}], tooShort],
      [[new Uint32Array(new ArrayBuffer(8), 4), () => {}], tooShort],
      [[new Uint32Array(2), {}], refused("ERR_INVALID_ARG_TYPE", '"writeCallback"')],
      [[new Uint32Array(2), () => {}, "text"], refused("ERR_INVALID_ARG_TYPE", '"dictionary"')],
    ])("refuses %p and changes nothing", (args, error) => {
      using it = handleFor(DEFLATE);
      it.init(15, 0);
      expect(() => it.handle.init(15, 6, 8, 0, ...args)).toThrow(error);
      expect(it.finish(plain)).toEqual(zlib.deflateSync(plain, { level: 0 }));
    });

    test("writes to the first two elements of a longer array", () => {
      using it = handleFor(INFLATERAW);
      const state = new Uint32Array(3).fill(9);
      it.handle.init(15, 6, 8, 0, state, () => {}, undefined);
      it.finish(Buffer.concat([stored(new Bits(), plain, true).end(), plain]));
      expect([...state]).toEqual([110, 5, 9]);
    });

    test("leaves a write that is under way its array and its callback", async () => {
      using it = handleFor(DEFLATERAW);
      const [first, second] = [new Uint32Array(2), new Uint32Array(2)];
      const { promise, resolve } = Promise.withResolvers();
      it.handle.init(15, 0, 8, 0, first, () => resolve("first"), undefined);
      it.handle.write(Z_FINISH, plain, 0, plain.length, Buffer.alloc(100), 0, 100);
      expect(() => it.handle.init(15, 0, 8, 0, second, () => resolve("second"), undefined)).toThrow(
        refused("ERR_INVALID_STATE", "Write already in progress"),
      );
      expect([await promise, ...first, ...second]).toEqual(["first", 90, 0, 0, 0]);
    });

    test("says that the handle is closing, or closed, before it looks at its arguments", async () => {
      using it = handleFor(DEFLATERAW);
      const init = () => it.handle.init(15, 0, 8, 0, undefined, undefined, undefined);
      const { promise, resolve, reject } = Promise.withResolvers();
      const written = () => Promise.try(init).then(reject, resolve);
      it.handle.init(15, 0, 8, 0, new Uint32Array(2), written, undefined);
      it.handle.write(Z_FINISH, plain, 0, plain.length, Buffer.alloc(100), 0, 100);
      it.handle.close();
      expect(await promise).toEqual(refused("ERR_INVALID_STATE", "Pending close"));
      expect(init).toThrow(refused("ERR_INVALID_STATE", "zlib binding closed"));
    });

    test("starts over", () => {
      using it = handleFor(DEFLATE);
      it.init(15, 9, 8, 0, Buffer.from("first"));
      it.finish(plain);
      it.init(9, 0, 8, 0, plain);
      expect(it.finish(plain)).toEqual(zlib.deflateSync(plain, { windowBits: 9, level: 0, dictionary: plain }));
      it.init();
      expect(it.finish(plain)).toEqual(zlib.deflateSync(plain));
      expect(it.errors).toEqual([]);
    });
  });

  describe("params()", () => {
    test.each([
      [-2, 0],
      [10, 0],
      [6, -1],
      [6, 5],
    ])("refuses level %d with strategy %d", (level, strategy) => {
      using it = handleFor(DEFLATE);
      it.init();
      it.handle.params(level, strategy);
      expect(it.errors).toEqual([{ message: "Failed to set parameters", errno: -2, code: "Z_STREAM_ERROR" }]);
    });

    test("takes -1 for the default level", () => {
      using it = handleFor(DEFLATE);
      it.init(15, 0);
      it.handle.params(-1, 0);
      expect(it.finish(plain)).toEqual(zlib.deflateSync(plain));
    });

    test("leaves gzip alone, as in Node.js", () => {
      using it = handleFor(GZIP);
      it.init();
      it.handle.params(0, 0);
      expect(it.finish(plain)).toEqual(zlib.gzipSync(plain));
    });
  });
});

describe.skipIf(Math.min(totalmem(), process.constrainedMemory() || Infinity) < 12 * 1024 ** 3)("2 ** 32 bytes", () => {
  const size = 2 ** 32;
  // The CRC-32 of zeros with a 1 at the end, and their number modulo 2 ** 32.
  const trailer = "1bdf05a500000000";
  const prelude = `import zlib from "node:zlib";\nconst size = ${size};\n`;
  const iter = `
    import { from, fromSync, pull, pullSync, text, textSync } from "node:stream/iter";
    import iter from "node:zlib/iter";
  `;
  // In a process of its own, which gives the memory back to the next one.
  async function run(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--experimental-stream-iter", "--no-warnings", "-e", prelude + script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  test.each([
    ["inflateSync", size],
    ["inflate", size],
    ["inflateSync", size - 0.5],
  ])("as the chunkSize of %s(): %d", async (method, chunkSize) => {
    expect(
      await run(`
        const print = (error, out) => console.log(error ?? out.toString("hex"));
        const out = zlib.${method}(zlib.deflateSync("abc"), { chunkSize: ${chunkSize} }, print);
        if (out) print(null, out);
      `),
    ).toEqual({ stdout: "616263", stderr: "", exitCode: 0 });
  });

  test.each([
    "textSync(pullSync(fromSync(input), iter.decompressDeflateSync({ chunkSize: size })))",
    "await text(pull(from(input), iter.decompressDeflate({ chunkSize: size })))",
  ])("as the chunkSize of zlib/iter: %s", async read => {
    expect(await run(`${iter} const input = zlib.deflateSync("abc"); console.log(${read});`)).toEqual({
      stdout: "abc",
      stderr: "",
      exitCode: 0,
    });
  });

  test.each(["write", "writeSync"])("are more than the handle can count after %s()", async method => {
    expect(
      await run(`
        const [large, small, whole] = [Buffer.allocUnsafe(size), Buffer.alloc(64), zlib.deflateSync("")];
        const write = ({ _handle: handle, _writeState: state }, prepare, ...args) =>
          new Promise(resolve => {
            const done = uncounted => resolve(state.join() + " + " + uncounted);
            handle.init(15, 1, 8, 0, state, done, undefined);
            prepare?.(handle);
            const result = handle.${method}(0, ...args);
            ${method === "writeSync" ? "done(result);" : ""}
          }).catch(error => error.code + " " + error.message);
        const end = handle => handle.writeSync(0, whole, 0, whole.length, small, 0, 64);
        console.log(await write(zlib.createDeflate(), null, small, 0, 64, large, 0, size));
        console.log(await write(zlib.createDeflate(), null, large, 0, size, small, 0, 1));
        console.log(await write(zlib.createInflate(), end, large, 0, size, small, 0, 64));
        console.log(await write(zlib.createInflate(), end, large, 1, size - 1, small, 0, 64));
      `),
    ).toEqual({
      stdout: [
        "ERR_OUT_OF_RANGE out_len must be <= 4294967295",
        // There is not even room for the header.
        "0,4294967295 + 1",
        "64,4294967295 + 1",
        "64,4294967295 + undefined",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  test("end where they end", async () => {
    expect(
      await run(`
        const [large, small] = [Buffer.allocUnsafe(size), Buffer.alloc(64)];
        for (const method of ["write", "writeSync"]) {
          for (const args of [[large, size, 1, small, 0, 64], [small, 0, 64, large, size, 1]]) {
            try {
              zlib.createDeflate()._handle[method](0, ...args);
            } catch (error) {
              console.log(error.message);
            }
          }
        }
        console.log(zlib.createDeflate()._handle.writeSync(0, large, size, 0, small, 0, 64));
      `),
    ).toEqual({
      stdout: ["in", "out", "in", "out"]
        .map(it => `${it}_off + ${it}_len (4294967297) exceeds ${it}put buffer length (4294967296)\n`)
        .concat("undefined")
        .join(""),
      stderr: "",
      exitCode: 0,
    });
  });

  test("are all read", async () => {
    expect(
      await run(`
        ${iter}
        const input = Buffer.allocUnsafe(size), last = zlib.zstdCompressSync("abc");
        // A skippable frame.
        input.writeUInt32LE(0x184d2a50);
        input.writeUInt32LE(size - 8 - last.length, 4);
        last.copy(input, size - last.length);
        for (const read of [
          () => zlib.zstdDecompressSync(input),
          () => util.promisify(zlib.zstdDecompress)(input),
          () => zlib.createZstdDecompress()._processChunk(input.buffer, zlib.constants.ZSTD_e_end),
          () => textSync(pullSync(fromSync(input), iter.decompressZstdSync())),
          () => text(pull(from(input), iter.decompressZstd())),
        ]) {
          console.log(String(await read()));
        }
      `),
    ).toEqual({ stdout: Array(5).fill("abc").join("\n"), stderr: "", exitCode: 0 });
  });

  test("are all read if the first write takes none of them", async () => {
    expect(
      await run(`
        ${iter}
        // The decoder counts the last byte of a frame once all of its output is out.
        const first = zlib.zstdCompressSync(Buffer.alloc(100_000, "a"));
        const last = Buffer.concat([first, zlib.zstdCompressSync("b")]);
        const input = [first.subarray(0, -1), Buffer.allocUnsafe(size)];
        input[1][0] = first.at(-1);
        input[1].writeUInt32LE(0x184d2a50, 1);
        input[1].writeUInt32LE(size - 9 - last.length, 5);
        last.copy(input[1], size - last.length);
        async function stream() {
          const decoder = zlib.createZstdDecompress();
          decoder.write(input[0]);
          const out = Buffer.concat(await decoder.end(input[1]).toArray());
          console.log(decoder.bytesWritten - first.length);
          return String(out);
        }
        function atOnce() {
          const decoder = zlib.createZstdDecompress();
          decoder._handle.writeSync(0, input[0], 0, input[0].length, Buffer.alloc(64), 0, 64);
          return String(decoder._processChunk(input[1], zlib.constants.ZSTD_e_end));
        }
        for (const read of [
          stream,
          () => new async_hooks.AsyncLocalStorage().run(1, stream),
          atOnce,
          () => textSync(pullSync(fromSync(input), iter.decompressZstdSync())),
          () => text(pull(from(input), iter.decompressZstd())),
        ]) {
          const out = await read();
          console.log(out.length, out.slice(-2));
        }
      `),
    ).toEqual({
      stdout: [size - 1, "200001 ab", size - 1, ...Array(4).fill("200001 ab")].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  test("do not count as written behind the end of a stream", async () => {
    expect(
      await run(`
        const inflate = zlib.createInflate(), whole = zlib.deflateSync("abc");
        inflate.write(whole);
        console.log(String(await inflate.end(Buffer.allocUnsafe(size)).toArray()), inflate.bytesWritten - whole.length);
      `),
    ).toEqual({ stdout: "abc 0", stderr: "", exitCode: 0 });
  });

  // These builds take minutes to compress so much.
  const isSlow = isDebug || isASAN;

  test.skipIf(isSlow).each(["gzipSync", "gzip"])("are all taken by %s()", async method => {
    expect(
      await run(`
        const input = Buffer.alloc(size);
        input[size - 1] = 1;
        const print = (error, out) => console.log(error ?? out.subarray(-8).toString("hex"));
        const out = zlib.${method}(input, { level: 1, chunkSize: 1 << 20 }, print);
        if (out) print(null, out);
      `),
    ).toEqual({ stdout: trailer, stderr: "", exitCode: 0 });
  });
});
