import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { join } from "node:path";

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
});

// `_handle.init()` can run again on a handle that zlib.ts already initialized.
// zlib does not free the state that an init finds in its stream, so each second
// init() used to leak the state of the one before it.
describe.concurrent("zlib native handle: a second init()", () => {
  const prelude = /* js */ `
    const zlib = require("node:zlib");
    const { Z_NO_FLUSH, Z_SYNC_FLUSH, Z_FINISH } = zlib.constants;
    const { DEFLATE, INFLATE, GZIP, GUNZIP, DEFLATERAW, INFLATERAW, UNZIP } = zlib.constants;
    const modes = { Deflate: DEFLATE, Inflate: INFLATE, Gzip: GZIP, Gunzip: GUNZIP, DeflateRaw: DEFLATERAW, InflateRaw: INFLATERAW, Unzip: UNZIP };
    const Handle = zlib.createDeflate()._handle.constructor;
    const errors = [];

    function init(handle, windowBits = 15, level = 6, dictionary) {
      handle.init(windowBits, level, 8, 0, handle.state, () => {}, dictionary);
    }
    // A handle after its first init(), as the constructors of zlib.ts leave it.
    function open(mode, windowBits, level, dictionary) {
      const handle = new Handle(mode);
      handle.onerror = (message, errno, code) => errors.push(code + ": " + message);
      handle.state = new Uint32Array(2);
      init(handle, windowBits, level, dictionary);
      return handle;
    }
    // The bytes that one writeSync() gives, or none when it reports an error.
    function write(handle, flush, input) {
      const out = Buffer.alloc(8192);
      const reported = errors.length;
      handle.writeSync(flush, input, 0, input.length, out, 0, out.length);
      if (errors.length > reported) return Buffer.alloc(0);
      return Buffer.from(out.subarray(0, out.length - handle.state[0]));
    }
    // "open", or why the handle refuses a write.
    function status(handle) {
      try {
        handle.writeSync(Z_NO_FLUSH, null, 0, 0, Buffer.alloc(64), 0, 64);
        return "open";
      } catch (e) {
        return e.message;
      }
    }
    const text = Buffer.alloc(1000, "a");
    const unpack = { [DEFLATE]: zlib.inflateSync, [GZIP]: zlib.gunzipSync, [DEFLATERAW]: zlib.inflateRawSync };
    const packed = {
      [INFLATE]: zlib.deflateSync(text),
      [GUNZIP]: zlib.gzipSync(text),
      [INFLATERAW]: zlib.deflateRawSync(text),
      [UNZIP]: zlib.gzipSync(text),
    };
  `;

  async function run(body: string, env: NodeJS.Dict<string> = bunEnv) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", prelude + body],
      // The finalizer of every handle runs at exit, as on the ASAN lanes.
      env: { ...env, BUN_DESTRUCT_VM_ON_EXIT: "1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  // What a second init() gives does not change with the fix: these pass without it too.
  const cases: [name: string, body: string, expected: string][] = [
    [
      "before the first use leaves a handle that works, on every mode",
      /* js */ `
        const results = Object.values(modes).map(mode => {
          const handle = open(mode);
          init(handle);
          const out = write(handle, Z_FINISH, packed[mode] ?? text);
          return (mode in packed ? out : unpack[mode](out)).equals(text);
        });
        console.log(...results, ...errors);`,
      "true true true true true true true",
    ],
    [
      "on a stream in use leaves the handle open, on every mode",
      /* js */ `
        const results = Object.values(modes).map(mode => {
          const handle = open(mode);
          write(handle, Z_NO_FLUSH, (packed[mode] ?? text).subarray(0, 12));
          init(handle);
          return status(handle);
        });
        console.log(...results, ...errors);`,
      "open open open open open open open",
    ],
    [
      "before the first use replaces the arguments of the first one",
      /* js */ `
        const deflate = open(DEFLATE, 15, 0);
        init(deflate, 9, 9);
        const out = write(deflate, Z_FINISH, text);
        const inflate = open(INFLATE, 9);
        init(inflate, 15);
        // 17 bytes: level 9, not the level 0 of the first init(). 18: the header of a 512-byte window.
        console.log(out.length, out.subarray(0, 1).toString("hex"), write(inflate, Z_FINISH, packed[INFLATE]).length, ...errors);`,
      "17 18 1000",
    ],
    [
      "gives its dictionary to the next reset()",
      /* js */ `
        const dictionary = Buffer.from("hello world dictionary");
        const added = open(DEFLATE);
        write(added, Z_SYNC_FLUSH, Buffer.from("x"));
        init(added, 15, 6, dictionary);
        added.reset();
        const withDictionary = write(added, Z_FINISH, Buffer.from("hello world"));
        const removed = open(DEFLATERAW, 15, 6, dictionary);
        write(removed, Z_FINISH, Buffer.from("hello world"));
        init(removed);
        removed.reset();
        const withoutDictionary = write(removed, Z_FINISH, Buffer.from("hello world"));
        console.log(
          (withDictionary[1] & 0x20) !== 0,
          zlib.inflateSync(withDictionary, { dictionary }).toString(),
          zlib.inflateRawSync(withoutDictionary).toString(),
          ...errors,
        );`,
      "true hello world hello world",
    ],
    [
      "that zlib rejects closes the handle",
      /* js */ `
        const results = [];
        for (const mode of [DEFLATE, INFLATE]) {
          const unused = open(mode);
          init(unused, 100);
          const used = open(mode);
          write(used, Z_NO_FLUSH, (packed[mode] ?? text).subarray(0, 12));
          init(used, 100);
          results.push(status(unused), status(used));
        }
        console.log(results.join(", "), ...errors);`,
      Array(4).fill("zlib binding closed").join(", "),
    ],
  ];

  for (const [name, body, expected] of cases) {
    test(name, async () => {
      const { stdout, exitCode } = await run(body);
      expect({ stdout, exitCode }).toEqual({ stdout: expected, exitCode: 0 });
    });
  }

  // Every call order that left a state behind: six states for each call.
  const everyOrder = /* js */ `
    function everyOrder(mode) {
      const unused = open(mode);
      init(unused);
      init(unused);
      const used = open(mode);
      status(used);
      init(used);
      init(used);
      const rejected = open(mode);
      init(rejected, 100);
      const rejectedInUse = open(mode);
      status(rejectedInUse);
      init(rejectedInUse, 100);
    }
  `;

  // LeakSanitizer reports each allocation that nothing frees. Only a build with ASAN has it.
  test.skipIf(!isASAN)("frees every zlib state (LeakSanitizer)", async () => {
    const { stdout, stderr, exitCode } = await run(
      everyOrder +
        /* js */ `
        // test/leaksan.supp hides what the evaluation of the entry module allocates.
        setImmediate(() => {
          Object.values(modes).forEach(everyOrder);
          console.log("done");
        });`,
      {
        ...bunEnv,
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `malloc_context_size=30:print_suppressions=0:suppressions=${join(import.meta.dir, "../../../leaksan.supp")}`,
      },
    );
    const summary = /SUMMARY: AddressSanitizer: (\d+) byte\(s\) leaked in (\d+) allocation/.exec(stderr);
    expect({
      stdout,
      leakedBytes: Number(summary?.[1] ?? 0),
      leakedStates: Number(summary?.[2] ?? 0),
      exitCode,
    }).toEqual({
      stdout: "done",
      leakedBytes: 0,
      leakedStates: 0,
      exitCode: 0,
    });
  });

  // Without ASAN, the resident memory shows the leak: one state of a deflate
  // mode keeps 209 KB resident, and one of an inflate mode 12 KB. Under ASAN the
  // test above counts the states, and the resident memory follows ASAN's own
  // bookkeeping instead.
  test.skipIf(isASAN)("does not grow the resident memory", async () => {
    const rounds = 12;
    const warmupRounds = 2;
    const callsPerRound = 16;
    const { stdout, stderr, exitCode } = await run(
      everyOrder +
        /* js */ `
        const { readFileSync } = require("node:fs");
        // See leak-fixture.ts: on Linux this counter is exact, and the one behind rss() is not.
        function anonymousBytes() {
          return Number(/^Anonymous:\\s+(\\d+) kB$/m.exec(readFileSync("/proc/self/smaps_rollup", "utf8"))[1]) * 1024;
        }
        let residentBytes = process.memoryUsage.rss;
        if (process.platform === "linux") {
          try {
            anonymousBytes();
            residentBytes = anonymousBytes;
          } catch {}
        }
        const samples = {};
        for (const [name, mode] of Object.entries(modes)) {
          samples[name] = [];
          for (let round = 0; round < ${rounds}; round++) {
            for (let i = 0; i < ${callsPerRound}; i++) everyOrder(mode);
            Bun.gc(true);
            samples[name].push(residentBytes());
          }
        }
        console.log(JSON.stringify(samples));`,
      { ...bunEnv, BUN_JSC_useJIT: "0" },
    );
    expect(stderr).toBe("");
    const samples = JSON.parse(stdout) as Record<string, number[]>;
    // The median slope over every pair of samples, as in leak.test.ts: a stray sample does not move it.
    const bytesPerCall = Object.entries(samples).map(([name, ofMode]): [string, number] => {
      expect(ofMode).toHaveLength(rounds);
      const measured = ofMode.slice(warmupRounds);
      const slopes: number[] = [];
      for (let i = 0; i < measured.length; i++) {
        for (let j = i + 1; j < measured.length; j++) slopes.push((measured[j] - measured[i]) / (j - i));
      }
      return [name, Math.round(slopes.sort((a, b) => a - b)[slopes.length >> 1] / callsPerRound)];
    });
    expect(bytesPerCall.map(([name]) => name)).toEqual([
      "Deflate",
      "Inflate",
      "Gzip",
      "Gunzip",
      "DeflateRaw",
      "InflateRaw",
      "Unzip",
    ]);
    // One call of everyOrder() left 75 KB or more behind. The bound is a tenth of that.
    expect(bytesPerCall.filter(([, bytes]) => bytes >= 7_500)).toEqual([]);
    expect(exitCode).toBe(0);
  });
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
    ["reset() and the next frame", `stream.reset(); stream.end("x"); await finished(stream); console.log("ok");`],
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
