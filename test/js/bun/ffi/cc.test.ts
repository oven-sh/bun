import { cc, CString, JSCallback, ptr, viewSource, type FFIFunction, type Library } from "bun:ffi";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  promises as fs,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { bunEnv, bunExe, isASAN, isWindows, normalizeBunSnapshot, tempDir, tempDirWithFiles } from "harness";
import path from "path";

// TODO: we need to install build-essential and Apple SDK in CI.
// It can't find includes. It can on machines with that enabled.
// TinyCC's setjmp/longjmp error handling conflicts with ASan.
it.todoIf(isWindows || isASAN)("can run a .c file", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), path.join(__dirname, "cc-fixture.js")],
    cwd: __dirname,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });

  expect(result.exitCode).toBe(0);
});

// TinyCC's setjmp/longjmp error handling conflicts with ASan.
describe.skipIf(isASAN)("given an add(a, b) function", () => {
  const source = /* c */ `
      int add(int a, int b) {
        return a + b;
      }
    `;
  let dir: string;

  beforeAll(() => {
    dir = tempDirWithFiles("bun-ffi-cc-test", {
      "add.c": source,
    });
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe("when compiled", () => {
    let res: Library<{ add: { args: ["int", "int"]; returns: "int" } }>;

    beforeAll(() => {
      res = cc({
        source: path.join(dir, "add.c"),
        symbols: {
          add: {
            returns: "int",
            args: ["int", "int"],
          },
        },
      });
    });

    afterAll(() => {
      res.close();
    });

    it("provides an add symbol", () => {
      expect(res.symbols.add(1, 2)).toBe(3);
    });

    // FIXME: produces junk
    it.skip("when passed arguments with incorrect types, throws an error", () => {
      // @ts-expect-error
      expect(() => res.symbols.add("1", "2")).toThrow();
    });

    // looks like `b` defaults to `0`, is this U.B. or expected?
    it.skip("when passed too few arguments, throws an error", () => {
      // @ts-expect-error
      expect(() => res.symbols.add(1)).toThrow();
    });

    it("when passed too many arguments, still works", () => {
      // @ts-expect-error
      expect(res.symbols.add(1, 2, 3)).toBe(3);
    });

    it("Only contains 1 symbol", () => {
      expect(Object.keys(res.symbols)).toHaveLength(1);
    });
  }); // </when compiled>

  it("when compiled with a symbol that doesn't exist, throws an error", () => {
    expect(() => {
      cc({
        source: path.join(dir, "add.c"),
        symbols: { subtract: { args: ["int", "int"], returns: "int" } },
      });
    }).toThrow(/"subtract" is missing/);
  });
}); // </given add(a, b) function>

describe("given a source file with syntax errors", () => {
  const source = /* c */ `
    int add(int a, int b) {
      return a  b;
    }
  `;
  let dir: string;

  beforeAll(() => {
    dir = tempDirWithFiles("bun-ffi-cc-test", {
      "add.c": source,
    });
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  // FIXME: fails asan poisoning check
  // TinyCC uses `setjmp` on an internal error handler, then jumps there when it
  // encounters a syntax error. Newer versions of tcc added a public API to
  // set a runtime error handler, but we need to upgrade in order to get it.
  // https://github.com/TinyCC/tinycc/blob/f8bd136d198bdafe71342517fa325da2e243dc68/libtcc.h#L106C9-L106C24
  it.skip("when compiled, throws an error", () => {
    expect(() => {
      cc({
        source: path.join(dir, "add.c"),
        symbols: {
          add: {
            returns: "int",
            args: ["int", "int"],
          },
        },
      });
    }).toThrow();
  });
});

describe.skip("given a ping(cstr) function", () => {
  const library = makeValidCase(
    "ping",
    /* c */ `
    char* ping(char* str) {
      return str;
    }
  `,
    {
      ping: {
        args: ["cstring"],
        returns: "cstring",
      },
    },
  );

  it("given a valid CString, returns the same pointer", () => {
    const buf = Buffer.from("hello\0");
    const arr = new Uint8Array(buf);
    const cstr = new CString(ptr(arr));

    expect(library.symbols.ping(cstr)).toBe(cstr);
  });
}); // </given a ping(cstr) function>

// FIXME: bus error
describe.skip("given a strlen(cstring) function", () => {
  const library = makeValidCase(
    "strlen",
    /* c */ `
      size_t strlen(char* str) {
        char* s = str;
        while (*s) s++;
        return s - str;
      }
    `,
    {
      strlen: {
        args: ["cstring"],
        returns: "usize",
      },
    },
  );

  it("given a valid CString containing 'hello', returns the correct length", () => {
    const buf = Buffer.from("hello\0");
    const arr = new Uint8Array(buf);
    const cstr = new CString(ptr(arr));

    expect(library.symbols.strlen(cstr)).toBe(5);
  });

  it("given a JSString, throws", () => {
    // @ts-expect-error
    expect(() => library.symbols.strlen("hello")).toThrow(TypeError);
  });
}); // </given a strlen(cstring) function>

// =============================================================================

function makeValidCase<Fns extends Record<string, FFIFunction>>(
  name: string,
  source: string,
  symbols: Fns,
): Library<Fns> {
  const filename = `${name}.c`;

  var library: Library<Fns>;

  beforeAll(() => {
    try {
      var dir = tempDirWithFiles(`bun-ffi-cc-${name}`, {
        [filename]: source,
      });

      library = cc({
        source: path.join(dir, filename),
        symbols,
      });
    } finally {
      // @ts-ignore -- `var` gets hoisted
      if (dir) fs.rm(dir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    library.close();
  });

  // @ts-ignore
  return library;
}

// =============================================================================

// The fixture needs pthread_create/pthread_join resolved against the host
// process, which TinyCC's in-memory output only supports on POSIX.
// TinyCC's setjmp/longjmp error handling conflicts with ASan.
describe.skipIf(isWindows || isASAN)("threadsafe JSCallback invoked from a foreign thread", () => {
  // TinyCC only ships its own builtin headers, so we cannot #include
  // <pthread.h>. pthread_t is `unsigned long` on glibc and a pointer on
  // macOS/musl; both fit in 8 bytes.
  const source = /* c */ `
    typedef unsigned long bun_test_pthread_t;
    extern int pthread_create(bun_test_pthread_t*, const void*, void* (*)(void*), void*);
    extern int pthread_join(bun_test_pthread_t, void**);

    typedef void (*bun_test_callback)(int);

    static bun_test_pthread_t bun_test_thread;
    static bun_test_callback bun_test_cb;
    static int bun_test_count;

    static void* bun_test_thread_main(void* arg) {
      for (int i = 0; i < bun_test_count; i++) {
        bun_test_cb(i);
      }
      return 0;
    }

    int start(void* cb, int n) {
      bun_test_cb = (bun_test_callback)cb;
      bun_test_count = n;
      return pthread_create(&bun_test_thread, 0, bun_test_thread_main, 0);
    }

    int join_thread(void) {
      return pthread_join(bun_test_thread, 0);
    }

    int enqueue_n(void* cb, int n) {
      bun_test_cb = (bun_test_callback)cb;
      bun_test_count = n;
      if (pthread_create(&bun_test_thread, 0, bun_test_thread_main, 0) != 0) {
        return 1;
      }
      return pthread_join(bun_test_thread, 0);
    }
  `;
  let dir: string;
  let library: Library<{
    start: { args: ["ptr", "int"]; returns: "int" };
    join_thread: { args: []; returns: "int" };
    enqueue_n: { args: ["ptr", "int"]; returns: "int" };
  }>;

  beforeAll(() => {
    dir = tempDirWithFiles("bun-ffi-cc-threadsafe", {
      "threadsafe-callback.c": source,
      // Test B fixture: enqueue invocations from a foreign thread, close the
      // callback while they are still queued, then wait for all of them to be
      // delivered anyway.
      "close-while-enqueued.js": /* js */ `
        import { cc, JSCallback } from "bun:ffi";
        import source from "./threadsafe-callback.c" with { type: "file" };

        const N = 50;
        const { symbols } = cc({
          source,
          symbols: {
            enqueue_n: { args: ["ptr", "int"], returns: "int" },
          },
        });

        let count = 0;
        const cb = new JSCallback(
          () => {
            count++;
          },
          { args: ["int"], threadsafe: true },
        );

        // enqueue_n joins the worker thread before returning, so all N tasks
        // are sitting in the event-loop queue and none have run yet.
        if (symbols.enqueue_n(cb.ptr, N) !== 0) {
          throw new Error("enqueue_n failed");
        }
        cb.close();

        while (count < N) {
          await new Promise(r => setImmediate(r));
        }
        console.log("ok");
      `,
    });
    library = cc({
      source: path.join(dir, "threadsafe-callback.c"),
      symbols: {
        start: { args: ["ptr", "int"], returns: "int" },
        join_thread: { args: [], returns: "int" },
        enqueue_n: { args: ["ptr", "int"], returns: "int" },
      },
    });
  });

  afterAll(async () => {
    library?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("delivers all callbacks invoked from a foreign thread while the JS thread churns GC handles", async () => {
    const N = 200;
    const received = new Set<number>();
    const { promise, resolve } = Promise.withResolvers<void>();

    const cb = new JSCallback(
      (value: number) => {
        received.add(value);
        if (received.size === N) {
          resolve();
        }
      },
      { args: ["int"], threadsafe: true },
    );

    expect(library.symbols.start(cb.ptr, N)).toBe(0);

    // Churn JS-thread GC handle allocation while the foreign thread is
    // invoking the callback. Each iteration allocates and frees Strong
    // handles from the same HandleSet the foreign thread used to race with.
    // The setImmediate yield is required: the foreign thread's invocations
    // arrive as concurrent event-loop tasks and are only drained on
    // event-loop ticks.
    let done = false;
    promise.then(() => {
      done = true;
    });
    while (!done) {
      const tmp = new JSCallback(() => {}, { returns: "void" });
      tmp.close();
      await new Promise(r => setImmediate(r));
    }

    expect(library.symbols.join_thread()).toBe(0);
    expect([...received].sort((a, b) => a - b)).toEqual(Array.from({ length: N }, (_, i) => i));
    cb.close();
  });

  it("close() with foreign-thread invocations still enqueued delivers the pending invocations", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "close-while-enqueued.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  });
});

// Pins GC liveness: compiled trampolines survive the library wrapper being
// collected, and a JSCallback's closure stays alive until close().
// TinyCC's setjmp/longjmp error handling conflicts with ASan.
describe.skipIf(isASAN)("GC liveness of compiled symbols and callbacks", () => {
  it("keeps symbol functions and callback closures alive across forced GC", async () => {
    using dir = tempDir("bun-ffi-cc-gc-liveness", {
      "lib.c": /* c */ `
        int twice(int x) { return x + x; }
        int invoke(int (*cb)(int), int value) { return cb(value); }
      `,
      "fixture.js": /* js */ `
        import { cc, JSCallback } from "bun:ffi";
        import path from "path";

        function makeSymbols() {
          // Only the bound functions escape; the library wrapper becomes collectible.
          const { symbols } = cc({
            source: path.join(import.meta.dir, "lib.c"),
            symbols: {
              twice: { args: ["int"], returns: "int" },
              invoke: { args: ["ptr", "int"], returns: "int" },
            },
          });
          return [symbols.twice, symbols.invoke];
        }

        function makeCallback() {
          // Closure has no reference outside the JSCallback.
          return new JSCallback(x => x * 3, { args: ["int"], returns: "int" });
        }

        const [twice, invoke] = makeSymbols();
        const cb = makeCallback();
        let total = 0;
        for (let i = 0; i < 100; i++) {
          Bun.gc(true);
          const doubled = twice(21);
          if (doubled !== 42) {
            throw new Error("twice() returned " + doubled + " at iteration " + i);
          }
          const tripled = invoke(cb.ptr, i);
          if (tripled !== i * 3) {
            throw new Error("callback returned " + tripled + " at iteration " + i);
          }
          total++;
        }
        cb.close();
        console.log("OK " + total);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr is included in the received object so failures show it, but is not
    // asserted empty: debug builds emit benign startup warnings.
    expect({ stdout: normalizeBunSnapshot(stdout), stderr, exitCode }).toMatchObject({
      stdout: "OK 100",
      exitCode: 0,
    });
  });
});

// va_arg on x86_64 SysV lowers to a call to __va_arg, which TinyCC expects
// libtcc1 to provide; Bun replaces libtcc1 with src/runtime/ffi/libtcc1.c.
// TinyCC's setjmp/longjmp error handling conflicts with ASan.
describe.skipIf(isASAN)("variadic functions inside cc()-compiled C", () => {
  it("va_arg over ints, doubles, and the stack overflow area", async () => {
    using dir = tempDir("bun-ffi-cc-varargs", {
      "varargs.c": /* c */ `
        #include <stdarg.h>

        static long long sum_ints(int count, ...) {
          va_list ap;
          va_start(ap, count);
          long long total = 0;
          for (int i = 0; i < count; i++) total += va_arg(ap, int);
          va_end(ap);
          return total;
        }

        static double sum_doubles(int count, ...) {
          va_list ap;
          va_start(ap, count);
          double total = 0;
          for (int i = 0; i < count; i++) total += va_arg(ap, double);
          va_end(ap);
          return total;
        }

        /* alternating int/double reads from one va_list: gp_offset and
           fp_offset must advance independently */
        static double sum_pairs(int count, ...) {
          va_list ap;
          va_start(ap, count);
          double total = 0;
          for (int i = 0; i < count; i++) {
            total += va_arg(ap, int);
            total += va_arg(ap, double);
          }
          va_end(ap);
          return total;
        }

        /* a 16-byte all-double struct occupies two SSE register save slots */
        struct dd { double a, b; };
        static double sum_dd(int count, ...) {
          va_list ap;
          va_start(ap, count);
          double total = 0;
          for (int i = 0; i < count; i++) {
            struct dd v = va_arg(ap, struct dd);
            total += v.a + v.b;
          }
          va_end(ap);
          return total;
        }

        /* 10 ints: exhausts the 6 integer registers and spills to the stack. */
        long long ten_ints(void) { return sum_ints(10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10); }
        /* 10 doubles: exhausts the 8 SSE registers and spills to the stack. */
        double ten_doubles(void) { return sum_doubles(10, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5); }
        double interleaved(void) { return sum_pairs(9, 1,0.5, 2,0.5, 3,0.5, 4,0.5, 5,0.5, 6,0.5, 7,0.5, 8,0.5, 9,0.5); }
        double double_pairs(void) {
          struct dd x = { 1.5, 2.5 }, y = { 3.0, 4.0 };
          return sum_dd(2, x, y);
        }
      `,
      "fixture.js": /* js */ `
        import { cc } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "varargs.c"),
          symbols: {
            ten_ints: { args: [], returns: "i64" },
            ten_doubles: { args: [], returns: "f64" },
            interleaved: { args: [], returns: "f64" },
            double_pairs: { args: [], returns: "f64" },
          },
        });
        console.log(
          JSON.stringify({
            ten_ints: Number(symbols.ten_ints()),
            ten_doubles: symbols.ten_doubles(),
            interleaved: symbols.interleaved(),
            double_pairs: symbols.double_pairs(),
          }),
        );
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr is included in the received object so failures show it, but is not
    // asserted empty: debug builds emit benign startup warnings.
    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: {
        ten_ints: 55,
        ten_doubles: 50,
        interleaved: 49.5,
        double_pairs: 11,
      },
      exitCode: 0,
    });
  });
});

// long double is 16 bytes on x86_64 and always va_arg'd through the stack; on
// aarch64 it is binary128 and its arithmetic needs soft-float helpers
// (__addtf3, ...) that Bun's TCC states do not provide, so x64 only.
describe.skipIf(isASAN || process.arch !== "x64")("long double varargs inside cc()-compiled C", () => {
  it("va_arg over long double", async () => {
    using dir = tempDir("bun-ffi-cc-varargs-ld", {
      "ld.c": /* c */ `
        #include <stdarg.h>

        static double sum_long_doubles(int count, ...) {
          va_list ap;
          va_start(ap, count);
          long double total = 0;
          for (int i = 0; i < count; i++) total += va_arg(ap, long double);
          va_end(ap);
          return (double)total;
        }

        double long_doubles(void) { return sum_long_doubles(3, 1.5L, 2.25L, 3.25L); }
      `,
      "fixture.js": /* js */ `
        import { cc } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "ld.c"),
          symbols: { long_doubles: { args: [], returns: "f64" } },
        });
        console.log(JSON.stringify({ long_doubles: symbols.long_doubles() }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: { long_doubles: 7 },
      exitCode: 0,
    });
  });
});

// TinyCC emits Local-Exec TLS, which has no PT_TLS segment to target under
// in-memory relocation and would alias the host's own thread block; it must be
// rejected up front instead of silently corrupting Bun's thread-locals.
describe.skipIf(isASAN)("thread-local storage inside cc()-compiled C", () => {
  it.each([
    ["_Thread_local", " = 0"],
    ["__thread", " = 0"],
    // No initializer: lands in .tbss, so the guard's tbss/SHF_TLS arm is covered too.
    ["_Thread_local", ""],
    ["__thread", ""],
  ])("%s int x%s; is a compile error", (keyword, init) => {
    using dir = tempDir("bun-ffi-cc-tls", {
      "tls.c": `${keyword} int bun_test_tls_counter${init};\nint bump(void) { return ++bun_test_tls_counter; }\n`,
    });
    expect(() => {
      cc({
        source: path.join(String(dir), "tls.c"),
        symbols: { bump: { args: [], returns: "int" } },
      });
    }).toThrow(/thread-local storage is not supported/);
  });
});

describe("double <-> JSValue conversions", () => {
  // JSC NaN-boxes doubles, so a NaN whose payload collides with the tag space
  // ("impure NaN", see JSC's PureNaN.h) must never be encoded as-is: it would
  // decode as a native-chosen JSValue (true, undefined, an Int32, or a cell
  // pointer). Every native -> JS double boundary has to purify first.
  // All scenarios run in one spawned fixture: a forged cell-pointer JSValue
  // can crash the process, which must not take the test runner with it.
  it("impure NaNs are purified: f64/f32 returns, JSCallback arguments, read.f64/f32", async () => {
    using dir = tempDir("bun-ffi-impure-nan", {
      "impure.c": /* c */ `
        typedef unsigned long long bits64;
        union caster { bits64 u; double d; float f; };

        /* 0xfffe000000000007 + DoubleEncodeOffset(2^49) == 0x7 == JSValue(true) */
        double forge_true(void) { union caster c; c.u = 0xfffe000000000007ULL; return c.d; }
        /* 0xfffe00000000000a encodes to 0xa == JSValue(undefined) */
        double forge_undefined(void) { union caster c; c.u = 0xfffe00000000000aULL; return c.d; }
        /* 0xfffc...: encoded value lands in the Int32 tag range, reads back as 0x12345678 */
        double forge_int32(void) { union caster c; c.u = 0xfffc000012345678ULL; return c.d; }
        /* 0xfffe000012345678: encodes to a cell pointer 0x12345678 */
        double forge_cell(void) { union caster c; c.u = 0xfffe000012345678ULL; return c.d; }
        /* float NaN with a full payload widens to an impure double NaN */
        float forge_f32(void) { union caster c; c.u = 0xffffffffULL; return c.f; }
        /* the canonical quiet NaN and ordinary values must be unaffected */
        double pure_nan(void) { union caster c; c.u = 0x7ff8000000000000ULL; return c.d; }
        double normal_double(void) { return 1.5; }
        double echo_f64(double x) { return x; }

        typedef double (*js_cb)(double);
        /* the JSCallback argument direction uses the same NaN-boxing */
        double invoke_with_impure(js_cb cb) {
          union caster c; c.u = 0xfffe000000000007ULL;
          return cb(c.d);
        }
      `,
      "fixture.js": /* js */ `
        import { cc, ptr, read, JSCallback } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "impure.c"),
          symbols: {
            forge_true: { args: [], returns: "f64" },
            forge_undefined: { args: [], returns: "f64" },
            forge_int32: { args: [], returns: "f64" },
            forge_cell: { args: [], returns: "f64" },
            forge_f32: { args: [], returns: "f32" },
            pure_nan: { args: [], returns: "f64" },
            normal_double: { args: [], returns: "f64" },
            echo_f64: { args: ["f64"], returns: "f64" },
            invoke_with_impure: { args: ["ptr"], returns: "f64" },
          },
        });

        const show = value => [typeof value, String(value)];
        const results = {};
        for (const name of [
          "forge_true",
          "forge_undefined",
          "forge_int32",
          "forge_cell",
          "forge_f32",
          "pure_nan",
          "normal_double",
        ]) {
          results[name] = show(symbols[name]());
        }
        results.echo_f64 = show(symbols.echo_f64(2.5));

        let callbackArg = null;
        const callback = new JSCallback(
          x => {
            callbackArg = show(x);
            return 0;
          },
          { args: ["f64"], returns: "f64" },
        );
        results.callback_return = show(symbols.invoke_with_impure(callback.ptr));
        results.callback_arg = callbackArg;
        callback.close();

        results.read_f64 = show(read.f64(ptr(new BigUint64Array([0xfffe000000000007n])), 0));
        results.read_f32 = show(read.f32(ptr(new Uint32Array([0xffffffff])), 0));

        console.log(JSON.stringify(results));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr is included in the received object so failures show it, but is not
    // asserted empty: debug builds emit benign startup warnings.
    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: {
        forge_true: ["number", "NaN"],
        forge_undefined: ["number", "NaN"],
        forge_int32: ["number", "NaN"],
        forge_cell: ["number", "NaN"],
        forge_f32: ["number", "NaN"],
        pure_nan: ["number", "NaN"],
        normal_double: ["number", "1.5"],
        echo_f64: ["number", "2.5"],
        callback_return: ["number", "0"],
        callback_arg: ["number", "NaN"],
        read_f64: ["number", "NaN"],
        read_f32: ["number", "NaN"],
      },
      exitCode: 0,
    });
  });

  // JSVALUE_TO_DOUBLE must decode int32-tagged JSValues: JSC tags integral
  // numbers as int32, so treating every numeric JSValue as double-encoded
  // hands C an impure NaN instead of the number. The C-side observers report
  // what the native code actually received, so these cannot pass by a
  // JS -> C -> JS round trip cancelling an encode bug against a decode bug.
  it("integral JS numbers reach C as the exact double, not NaN", async () => {
    using dir = tempDir("bun-ffi-int32-double", {
      "int32args.c": /* c */ `
        /* 1 => C saw the expected value, 2 => C saw NaN, 3 => something else */
        static int classify(double got, double expected) {
          if (got == expected) return 1;
          if (got != got) return 2;
          return 3;
        }
        int int32_arg_seen_by_c(double x) { return classify(x, 42.0); }
        int double_arg_seen_by_c(double x) { return classify(x, 1.5); }
        int f32_int32_arg_seen_by_c(float x) { return classify(x, 7.0f); }
        double echo_f64(double x) { return x; }

        typedef double (*js_cb)(double);
        int int32_callback_return_seen_by_c(js_cb cb) { return classify(cb(0.5), 3.0); }
      `,
      "fixture.js": /* js */ `
        import { cc, JSCallback } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "int32args.c"),
          symbols: {
            int32_arg_seen_by_c: { args: ["f64"], returns: "int" },
            double_arg_seen_by_c: { args: ["f64"], returns: "int" },
            f32_int32_arg_seen_by_c: { args: ["f32"], returns: "int" },
            echo_f64: { args: ["f64"], returns: "f64" },
            int32_callback_return_seen_by_c: { args: ["ptr"], returns: "int" },
          },
        });

        const results = {
          int32_arg: symbols.int32_arg_seen_by_c(42),
          double_arg: symbols.double_arg_seen_by_c(1.5),
          f32_int32_arg: symbols.f32_int32_arg_seen_by_c(7),
          echo_int32: [typeof symbols.echo_f64(7), String(symbols.echo_f64(7))],
        };

        const callback = new JSCallback(() => 3, { args: ["f64"], returns: "f64" });
        results.int32_callback_return = symbols.int32_callback_return_seen_by_c(callback.ptr);
        callback.close();

        console.log(JSON.stringify(results));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: {
        int32_arg: 1,
        double_arg: 1,
        f32_int32_arg: 1,
        echo_int32: ["number", "7"],
        int32_callback_return: 1,
      },
      exitCode: 0,
    });
  });

  // The f64 argument wrapper (ffiWrappers[FFIType.double] in ffi.ts) used
  // `if (!val) return 0`, which rewrote NaN and -0.0 to +0.0 before C ever
  // saw them, and its BigInt branch returned Math.abs() of the value. The C
  // functions report the value they received, so a JS round trip cannot mask
  // an argument-conversion bug. CFunction goes through the same
  // FFIBuilder/ffiWrappers path as dlopen; cc() only provides the pointers.
  it("f64 arguments reach C with NaN, -0.0, and BigInt sign intact", async () => {
    using dir = tempDir("bun-ffi-f64-args", {
      "observe.c": /* c */ `
        union f64bits { double d; unsigned long long u; };
        int isnan_f64(double x) { return x != x; }
        int signbit_f64(double x) { union f64bits c; c.d = x; return (int)(c.u >> 63); }
        double echo_f64(double x) { return x; }
        void* addr_isnan_f64(void) { return (void*)isnan_f64; }
        void* addr_signbit_f64(void) { return (void*)signbit_f64; }
        void* addr_echo_f64(void) { return (void*)echo_f64; }
      `,
      "fixture.js": /* js */ `
        import { cc, CFunction } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "observe.c"),
          symbols: {
            addr_isnan_f64: { args: [], returns: "ptr" },
            addr_signbit_f64: { args: [], returns: "ptr" },
            addr_echo_f64: { args: [], returns: "ptr" },
          },
        });

        const isnan_f64 = new CFunction({ ptr: symbols.addr_isnan_f64(), args: ["f64"], returns: "i32" });
        const signbit_f64 = new CFunction({ ptr: symbols.addr_signbit_f64(), args: ["f64"], returns: "i32" });
        const echo_f64 = new CFunction({ ptr: symbols.addr_echo_f64(), args: ["f64"], returns: "f64" });

        // Report a thrown conversion as a value so one failure cannot hide the rest.
        const show = fn => {
          try {
            const value = fn();
            return [typeof value, String(value)];
          } catch (err) {
            return ["threw", err.name];
          }
        };
        const results = {
          nan_isnan: isnan_f64(NaN),
          one_point_five_isnan: isnan_f64(1.5),
          negative_zero_signbit: signbit_f64(-0),
          positive_zero_signbit: signbit_f64(0),
          negative_one_signbit: signbit_f64(-1),
          negative_bigint: show(() => echo_f64(-5n)),
          positive_bigint: show(() => echo_f64(5n)),
          huge_bigint: show(() => echo_f64(2n ** 1024n)),
          negative_huge_bigint: show(() => echo_f64(-(2n ** 1024n))),
          fractional: show(() => echo_f64(-2.5)),
          string: show(() => echo_f64("2.5")),
          null_arg: show(() => echo_f64(null)),
          undefined_arg: show(() => echo_f64(undefined)),
        };
        console.log(JSON.stringify(results));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr is included in the received object so failures show it, but is not
    // asserted empty: debug builds emit benign startup warnings.
    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: {
        nan_isnan: 1,
        one_point_five_isnan: 0,
        negative_zero_signbit: 1,
        positive_zero_signbit: 0,
        negative_one_signbit: 1,
        negative_bigint: ["number", "-5"],
        positive_bigint: ["number", "5"],
        huge_bigint: ["number", "Infinity"],
        negative_huge_bigint: ["number", "-Infinity"],
        fractional: ["number", "-2.5"],
        string: ["threw", "TypeError"],
        null_arg: ["number", "0"],
        undefined_arg: ["number", "NaN"],
      },
      exitCode: 0,
    });
  });

  // JSVALUE_TO_INT32 must decode double-encoded JSValues: whether a JS number
  // is int32-tagged or double-encoded is the engine's choice (JIT tier, double
  // speculation, Math.* provenance), so an int-typed JSCallback return that
  // truncates the raw encoded bits hands C 0 once the callback tiers up.
  it("double-encoded JS numbers returned from an int-typed JSCallback reach C as the integer", async () => {
    using dir = tempDir("bun-ffi-int32-cb-return", {
      "cb.c": /* c */ `
        typedef int (*cb_i32)(int);
        int call_i32(cb_i32 f, int x) { return f(x); }
        typedef unsigned int (*cb_u32)(int);
        unsigned int call_u32(cb_u32 f, int x) { return f(x); }
        typedef signed char (*cb_i8)(int);
        int call_i8(cb_i8 f, int x) { return (int)f(x); }
        typedef unsigned short (*cb_u16)(int);
        int call_u16(cb_u16 f, int x) { return (int)f(x); }
      `,
      "fixture.js": /* js */ `
        import { cc, JSCallback } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "cb.c"),
          symbols: {
            call_i32: { args: ["function", "i32"], returns: "i32" },
            call_u32: { args: ["function", "i32"], returns: "u32" },
            call_i8: { args: ["function", "i32"], returns: "i32" },
            call_u16: { args: ["function", "i32"], returns: "i32" },
          },
        });

        // +0.5 then -0.5 on a runtime value: integer-valued, but the intermediate
        // pins a double-represented result regardless of JIT tier or const-folding.
        const asDouble = x => {
          const v = x + 0.5;
          return v - 0.5;
        };
        const echoDouble = new JSCallback(asDouble, { args: ["i32"], returns: "i32" });
        // Plain int32-tagged return must keep working.
        const echoInt = new JSCallback(x => x, { args: ["i32"], returns: "i32" });
        const fractional = new JSCallback(() => 5.7, { args: ["i32"], returns: "i32" });
        const negFractional = new JSCallback(() => -5.7, { args: ["i32"], returns: "i32" });
        const u32Double = new JSCallback(x => asDouble(x) + 3000000000, { args: ["i32"], returns: "u32" });
        const i8Double = new JSCallback(asDouble, { args: ["i32"], returns: "i8" });
        const u16Double = new JSCallback(asDouble, { args: ["i32"], returns: "u16" });

        const results = {
          echo_double: symbols.call_i32(echoDouble.ptr, 938),
          echo_int: symbols.call_i32(echoInt.ptr, 938),
          fractional: symbols.call_i32(fractional.ptr, 0),
          neg_fractional: symbols.call_i32(negFractional.ptr, 0),
          u32_double: symbols.call_u32(u32Double.ptr, 0),
          i8_double: symbols.call_i8(i8Double.ptr, -7),
          u16_double: symbols.call_u16(u16Double.ptr, 40000),
        };
        for (const cb of [echoDouble, echoInt, fractional, negFractional, u32Double, i8Double, u16Double]) cb.close();
        console.log(JSON.stringify(results));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: {
        echo_double: 938,
        echo_int: 938,
        fractional: 5,
        neg_fractional: -5,
        u32_double: 3000000000,
        i8_double: -7,
        u16_double: 40000,
      },
      exitCode: 0,
    });
  });

  // napi_create_double and napi_create_date take the double from the addon
  // verbatim, so they are the same boundary. cc()-compiled C resolves napi_*
  // from the host process; that lookup is only exercised on POSIX today (see
  // cc-fixture.c).
  it.skipIf(isWindows)("impure NaNs through napi_create_double and napi_create_date are purified", async () => {
    using dir = tempDir("bun-ffi-impure-nan-napi", {
      "impure_napi.c": /* c */ `
        typedef struct napi_env_fake* napi_env_t;
        typedef struct napi_value_fake* napi_value_t;
        union caster { unsigned long long u; double d; };
        extern int napi_create_double(napi_env_t env, double value, napi_value_t* result);
        extern int napi_create_date(napi_env_t env, double time, napi_value_t* result);
        napi_value_t impure_from_napi(napi_env_t env) {
          union caster c; c.u = 0xfffe000000000007ULL;
          napi_value_t result;
          napi_create_double(env, c.d, &result);
          return result;
        }
        napi_value_t impure_date_from_napi(napi_env_t env) {
          union caster c; c.u = 0xfffe000000000007ULL;
          napi_value_t result;
          napi_create_date(env, c.d, &result);
          return result;
        }
      `,
      "fixture.js": /* js */ `
        import { cc } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "impure_napi.c"),
          symbols: {
            impure_from_napi: { args: ["napi_env"], returns: "napi_value" },
            impure_date_from_napi: { args: ["napi_env"], returns: "napi_value" },
          },
        });

        const value = symbols.impure_from_napi();
        // Unpurified, the Date constructor receives JSValue(true) and
        // produces new Date(1) instead of an Invalid Date.
        const date = symbols.impure_date_from_napi();
        console.log(
          JSON.stringify({
            double: [typeof value, String(value)],
            date: [date instanceof Date, String(date.getTime())],
          }),
        );
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
    expect({ results, stderr, exitCode }).toMatchObject({
      results: {
        double: ["number", "NaN"],
        date: [true, "NaN"],
      },
      exitCode: 0,
    });
  });
});

describe.concurrent("pointer-typed arguments (function, ptr, cstring, buffer)", () => {
  // The wrapper cc() compiles used to treat anything that was not a number, a view, or null as a
  // double, so a JSCallback object (or any other object) became a garbage pointer and a `function`
  // argument called address -1. Everything the inline paths don't handle now goes through the
  // engine's conversion, the one dlopen()/CFunction symbols use, so the fixture runs one input
  // matrix through a cc() wrapper and through a CFunction over the very same C function and the
  // two tables must agree. Runs in a subprocess because the unfixed path is a segfault.
  //
  // The wrapper shape itself: pointer-typed arguments are converted into locals, tagged with
  // their type for the engine, and each conversion is followed by a bail-out, since it can run JS
  // (a `ptr` getter) and throw. Other arguments are still converted inline in the call, and a
  // napi handle scope is only opened once every conversion has succeeded, so bailing out never
  // leaves one open.
  it("converts pointer-typed arguments before the call and bails out if one threw", () => {
    const [source] = viewSource({
      f: { args: ["napi_env", "function", "f64", "cstring", "buffer", "ptr"], returns: "i32" },
    });
    expect(source.slice(source.indexOf("/* --- The Function To Call */"))).toMatchInlineSnapshot(`
      "/* --- The Function To Call */
      int32_t f(napi_env arg0, void* arg1, double arg2, void* arg3, void* arg4, void* arg5);

      /* ---- Your Wrapper Function ---- */
      ZIG_REPR_TYPE JSFunctionCall(void* JS_GLOBAL_OBJECT, void* callFrame) {
        LOAD_ARGUMENTS_FROM_CALL_FRAME;
        napi_env arg0 = (napi_env)&Bun__thisFFIModuleNapiEnv;
        argsPtr++;
        EncodedJSValue arg1 = { .asInt64 = *argsPtr++ };
        EncodedJSValue arg2 = { .asInt64 = *argsPtr++ };
        EncodedJSValue arg3 = { .asInt64 = *argsPtr++ };
        EncodedJSValue arg4 = { .asInt64 = *argsPtr++ };
        EncodedJSValue arg5;
        arg5.asInt64 = *argsPtr;
        bool threw = false;
        void* ptr1 = JSVALUE_TO_PTR(JS_GLOBAL_OBJECT, ABI_TYPE_FUNCTION, &threw, arg1);
        if (threw) return ValueEmpty.asZigRepr;
        void* ptr3 = JSVALUE_TO_PTR(JS_GLOBAL_OBJECT, ABI_TYPE_CSTRING, &threw, arg3);
        if (threw) return ValueEmpty.asZigRepr;
        void* ptr4 = JSVALUE_TO_PTR(JS_GLOBAL_OBJECT, ABI_TYPE_BUFFER, &threw, arg4);
        if (threw) return ValueEmpty.asZigRepr;
        void* ptr5 = JSVALUE_TO_PTR(JS_GLOBAL_OBJECT, ABI_TYPE_PTR, &threw, arg5);
        if (threw) return ValueEmpty.asZigRepr;
        void* handleScope = NapiHandleScope__open(&Bun__thisFFIModuleNapiEnv, false);
          int32_t return_value = f(    ((napi_env)&Bun__thisFFIModuleNapiEnv),     ptr1,     JSVALUE_TO_DOUBLE(arg2),     ptr3,     ptr4,     ptr5);

            NapiHandleScope__close(&Bun__thisFFIModuleNapiEnv, handleScope);
      return INT32_TO_JSVALUE((int32_t)return_value).asZigRepr;
      }

      "
    `);
  });

  it("accepts what dlopen accepts and throws a TypeError for the rest", async () => {
    using dir = tempDir("bun-ffi-cc-pointer-args", {
      "pointers.c": /* c */ `
        /* The tags the generated wrappers are compiled with must not be defined in the user's C. */
        enum { ABI_TYPE_PTR, ABI_TYPE_CSTRING, ABI_TYPE_FUNCTION, ABI_TYPE_BUFFER };

        typedef int (*callback_t)(int);
        int call_callback(callback_t callback) { return callback(21) * 2; }
        void* echo_ptr(void* p) { return p; }
        void* echo_cstring(const char* s) { return (void*)s; }
        void* echo_buffer(void* p) { return p; }

        static int native_calls = 0;
        int two_pointers(void* a, void* b) { native_calls++; return a == b; }
        int get_native_calls(void) { return native_calls; }

        void* address_of_call_callback(void) { return (void*)&call_callback; }
        void* address_of_echo_ptr(void) { return (void*)&echo_ptr; }
        void* address_of_echo_cstring(void) { return (void*)&echo_cstring; }
        void* address_of_echo_buffer(void) { return (void*)&echo_buffer; }
        void* address_of_two_pointers(void) { return (void*)&two_pointers; }
      `,
      "fixture.js": /* js */ `
        import { cc, CFunction, JSCallback, ptr } from "bun:ffi";
        import path from "path";

        const signatures = {
          call_callback: { args: ["function"], returns: "i32" },
          echo_ptr: { args: ["ptr"], returns: "ptr" },
          echo_cstring: { args: ["cstring"], returns: "ptr" },
          echo_buffer: { args: ["buffer"], returns: "ptr" },
          two_pointers: { args: ["ptr", "ptr"], returns: "i32" },
        };
        const { symbols: compiled } = cc({
          source: path.join(import.meta.dir, "pointers.c"),
          symbols: {
            ...signatures,
            get_native_calls: { args: [], returns: "i32" },
            ...Object.fromEntries(Object.keys(signatures).map(name => ["address_of_" + name, { args: [], returns: "ptr" }])),
          },
        });
        // The same C functions behind the engine's (dlopen-style) argument conversion.
        const engine = Object.fromEntries(
          Object.entries(signatures).map(([name, signature]) => [
            name,
            new CFunction({ ...signature, ptr: compiled["address_of_" + name]() }),
          ]),
        );

        const callback = new JSCallback(x => x + 1, { args: ["i32"], returns: "i32" });
        // A view over an explicit ArrayBuffer keeps one stable address shared by the view, the
        // buffer, and a DataView over it.
        const buffer = new ArrayBuffer(8);
        const view = new Uint8Array(buffer);
        const address = ptr(view);

        const inputs = {
          call_callback: {
            jscallback: callback,
            jscallback_ptr: callback.ptr,
            object_with_ptr: { ptr: callback.ptr },
            null: null,
            undefined: undefined,
            plain_function: () => 1,
            plain_object: {},
            string: "callback",
          },
          echo_ptr: {
            number: address,
            small_number: 8,
            view,
            array_buffer: buffer,
            bigint: BigInt(address),
            object_with_ptr: { ptr: address },
            jscallback: callback,
            null: null,
            undefined: undefined,
            plain_object: {},
            string: "hello",
            boolean: true,
          },
          echo_cstring: {
            number: address,
            view,
            null: null,
            undefined: undefined,
            plain_object: {},
            string: "hello",
          },
          echo_buffer: {
            view,
            data_view: new DataView(buffer),
            array_buffer: buffer,
            number: address,
            null: null,
            plain_object: {},
          },
        };

        function outcome(fn, input) {
          try {
            const result = fn(input);
            if (result === address) return "address";
            if (result === callback.ptr) return "callback.ptr";
            return result;
          } catch (error) {
            return error.name + ": " + error.message;
          }
        }

        function run(symbols) {
          const table = {};
          for (const name in inputs) {
            table[name] = {};
            for (const label in inputs[name]) table[name][label] = outcome(symbols[name], inputs[name][label]);
          }

          // Every read of .ptr is one conversion of this argument.
          let ptrReads = 0;
          const counted = { get ptr() { ptrReads++; return address; } };
          const { two_pointers } = symbols;
          table.two_pointers = {
            both_valid: outcome(() => two_pointers(address, view)),
            getter_as_first: outcome(() => two_pointers(counted, view)),
            getter_reads_so_far: ptrReads,
            second_invalid: outcome(() => two_pointers(address, {})),
            throwing_getter_as_second: outcome(() =>
              two_pointers(address, { get ptr() { throw new Error("from the ptr getter"); } }),
            ),
            first_invalid_with_getter_as_second: outcome(() => two_pointers({}, counted)),
            getter_reads_at_end: ptrReads,
            native_calls: compiled.get_native_calls(),
          };
          return table;
        }

        const results = { cc: run(compiled) };
        results.engine = run(engine);
        callback.close();
        console.log(JSON.stringify(results));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const cannotConvert = (type: string) => `TypeError: bun:ffi cannot convert argument to '${type}'`;
    const noCallback =
      "TypeError: bun:ffi: expected a callback (a JSCallback or an FFI function) but got undefined/null";
    const stringIsNotAPointer = "TypeError: To convert a string to a pointer, encode it as a buffer";
    const bufferNeedsAView = "TypeError: bun:ffi 'buffer' argument must be a TypedArray or DataView";
    const expected = {
      call_callback: {
        jscallback: 44,
        jscallback_ptr: 44,
        object_with_ptr: 44,
        null: noCallback,
        undefined: noCallback,
        plain_function: cannotConvert("function"),
        plain_object: cannotConvert("function"),
        string: stringIsNotAPointer,
      },
      echo_ptr: {
        number: "address",
        small_number: 8,
        view: "address",
        array_buffer: "address",
        bigint: "address",
        object_with_ptr: "address",
        jscallback: "callback.ptr",
        null: null,
        undefined: null,
        plain_object: cannotConvert("ptr"),
        string: stringIsNotAPointer,
        boolean: cannotConvert("ptr"),
      },
      echo_cstring: {
        number: "address",
        view: "address",
        null: null,
        undefined: null,
        plain_object: cannotConvert("cstring"),
        // Only the engine path transcodes JS strings (it owns an arena to free the copy after the
        // call); cc() has nowhere to free it, so it refuses the string instead of passing garbage.
        string: expect.any(Number),
      },
      echo_buffer: {
        view: "address",
        data_view: "address",
        array_buffer: bufferNeedsAView,
        number: bufferNeedsAView,
        null: bufferNeedsAView,
        plain_object: bufferNeedsAView,
      },
      two_pointers: {
        both_valid: 1,
        getter_as_first: 1,
        // Each argument is converted exactly once per call.
        getter_reads_so_far: 1,
        second_invalid: cannotConvert("ptr"),
        throwing_getter_as_second: "Error: from the ptr getter",
        // Conversion stops at the first argument that fails: the getter behind it never runs.
        first_invalid_with_getter_as_second: cannotConvert("ptr"),
        getter_reads_at_end: 1,
        // Only the two valid calls reached C. The engine table runs second, so its count includes
        // the cc() table's calls.
        native_calls: 2,
      },
    };

    // On a crash there is no JSON; report the process output instead so the failure shows it.
    const results = stdout.startsWith("{") ? JSON.parse(stdout) : { stdout, stderr };
    expect({ results, exitCode }).toEqual({
      results: {
        cc: {
          ...expected,
          echo_cstring: {
            ...expected.echo_cstring,
            string:
              "TypeError: bun:ffi: a JavaScript string is not valid here; return it from a 'cstring'-returning callback, or pass a pointer/TypedArray",
          },
        },
        engine: {
          ...expected,
          two_pointers: { ...expected.two_pointers, native_calls: 4 },
        },
      },
      exitCode: 0,
    });
  });

  // napi_env wrappers open a handle scope around the native call; a rejected pointer argument
  // has to bail out before that happens and leave later calls working. cc()-compiled C only
  // exercises napi on POSIX today (see the napi_create_double test above).
  it.skipIf(isWindows)("a rejected pointer argument bails out of a napi_env wrapper too", async () => {
    using dir = tempDir("bun-ffi-cc-pointer-args-napi", {
      "napi_ptr.c": /* c */ `
        typedef struct napi_env_fake* napi_env_t;
        static int native_calls = 0;
        /* bit 0: the trampoline filled in env, bit 1: p is non-null */
        int with_env(napi_env_t env, void* p) { native_calls++; return (env != 0 ? 1 : 0) | (p != 0 ? 2 : 0); }
        int get_native_calls(void) { return native_calls; }
      `,
      "fixture.js": /* js */ `
        import { cc } from "bun:ffi";
        import path from "path";

        const { symbols } = cc({
          source: path.join(import.meta.dir, "napi_ptr.c"),
          symbols: {
            with_env: { args: ["napi_env", "ptr"], returns: "i32" },
            get_native_calls: { args: [], returns: "i32" },
          },
        });

        const results = {};
        try {
          results.rejected = symbols.with_env(undefined, {});
        } catch (error) {
          results.rejected = error.name + ": " + error.message;
        }
        results.calls_after_rejection = symbols.get_native_calls();
        results.view = symbols.with_env(undefined, new Uint8Array(4));
        results.object_with_ptr = symbols.with_env(undefined, { ptr: 8 });
        results.null = symbols.with_env(undefined, null);
        results.calls_at_end = symbols.get_native_calls();
        console.log(JSON.stringify(results));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const results = stdout.startsWith("{") ? JSON.parse(stdout) : { stdout, stderr };
    expect({ results, exitCode }).toEqual({
      results: {
        rejected: "TypeError: bun:ffi cannot convert argument to 'ptr'",
        calls_after_rejection: 0,
        view: 3,
        object_with_ptr: 3,
        null: 1,
        calls_at_end: 3,
      },
      exitCode: 0,
    });
  });
});

describe.skipIf(isASAN)("compiler runtime header directory under BUN_TMPDIR", () => {
  const plantedHeader = "#define bool int\n#define true 100\n#define false 0\n";
  const files = {
    "sentinel.txt": "sentinel-unchanged\n",
    "add.c": /* c */ `
      #include <stdbool.h>
      int add(int a, int b) {
        return a + b + (int)true - 1;
      }
    `,
    "fixture.js": /* js */ `
      import { cc } from "bun:ffi";
      import path from "path";

      const { symbols } = cc({
        source: path.join(import.meta.dir, "add.c"),
        symbols: { add: { args: ["int", "int"], returns: "int" } },
      });
      console.log(symbols.add(1, 2));
    `,
  };

  async function runFixture(dir: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: { ...bunEnv, BUN_TMPDIR: String(dir) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  }

  it.skipIf(isWindows)("compiles a source that includes a compiler runtime header", async () => {
    using dir = tempDir("bun-ffi-cc-rt-dir", files);

    const [stdout, stderr, exitCode] = await runFixture(String(dir));

    expect(readFileSync(path.join(String(dir), `bun-cc-${process.getuid!()}`, "stdbool.h"), "utf8")).toContain(
      "_STDBOOL_H",
    );
    expect(stdout).toBe("3\n");
    expect(exitCode).toBe(0);
  });

  it.skipIf(isWindows)("does not write compiler runtime headers through a symlinked entry", async () => {
    using dir = tempDir("bun-ffi-cc-rt-dir-symlink", files);
    for (const name of ["bun-cc", `bun-cc-${process.getuid!()}`]) {
      const headerDir = path.join(String(dir), name);
      mkdirSync(headerDir, { recursive: true });
      chmodSync(headerDir, 0o755);
      symlinkSync("../sentinel.txt", path.join(headerDir, "stdbool.h"));
    }

    const [stdout, stderr, exitCode] = await runFixture(String(dir));

    expect(readFileSync(path.join(String(dir), "sentinel.txt"), "utf8")).toBe("sentinel-unchanged\n");
    expect(stdout).toBe("3\n");
    expect(exitCode).toBe(0);
  });

  it.skipIf(isWindows)(
    "does not place compiler runtime headers in a pre-existing group- and world-writable directory",
    async () => {
      using dir = tempDir("bun-ffi-cc-rt-dir-mode", files);
      const sharedName = `bun-cc-${process.getuid!()}`;
      for (const name of ["bun-cc", sharedName]) {
        const headerDir = path.join(String(dir), name);
        mkdirSync(headerDir, { recursive: true });
        writeFileSync(path.join(headerDir, "stdbool.h"), plantedHeader);
      }
      chmodSync(path.join(String(dir), "bun-cc"), 0o755);
      chmodSync(path.join(String(dir), sharedName), 0o777);

      const [stdout, stderr, exitCode] = await runFixture(String(dir));

      expect(readFileSync(path.join(String(dir), "bun-cc", "stdbool.h"), "utf8")).toBe(plantedHeader);
      expect(readFileSync(path.join(String(dir), sharedName, "stdbool.h"), "utf8")).toBe(plantedHeader);
      expect(stdout).toBe("3\n");
      expect(exitCode).toBe(0);
    },
  );

  it("does not reuse a pre-existing fixed-name bun-cc directory for compiler runtime headers", async () => {
    using dir = tempDir("bun-ffi-cc-rt-dir-fixed-name", files);
    const fixedDir = path.join(String(dir), "bun-cc");
    mkdirSync(fixedDir, { recursive: true });
    writeFileSync(path.join(fixedDir, "stdbool.h"), plantedHeader);

    const [stdout, stderr, exitCode] = await runFixture(String(dir));

    const staged = readdirSync(String(dir)).filter(
      name => name !== "bun-cc" && name.includes("bun-cc") && existsSync(path.join(String(dir), name, "stdbool.h")),
    );
    expect(staged.length).toBe(1);
    expect(readFileSync(path.join(String(dir), staged[0], "stdbool.h"), "utf8")).toContain("_STDBOOL_H");
    expect(readdirSync(fixedDir).sort()).toEqual(["stdbool.h"]);
    expect(readFileSync(path.join(fixedDir, "stdbool.h"), "utf8")).toBe(plantedHeader);
    expect(stdout).toBe("3\n");
    expect(exitCode).toBe(0);
  });
});

// The gate runs before any option is read or any C is compiled, so these do
// not need a working TinyCC and run under ASan too. Without the gate, the
// empty `symbols` object makes cc() fail with a plain validation error, which
// is the control for "cc() was not blocked".
describe.concurrent("disabling cc()", () => {
  // `report` receives one string: the error code, or the message for an
  // error without a code, or "no-error".
  const probeWith = (report: string) => /* js */ `
    const { cc } = require("bun:ffi");
    try {
      cc({ source: "does-not-exist.c", symbols: {} });
      ${report}("no-error");
    } catch (e) {
      ${report}(e.code ?? e.message);
    }
  `;
  const probe = probeWith("console.log");

  async function run(...args: string[]): Promise<[stdout: string, stderr: string, exitCode: number]> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  }

  it("cc() is allowed by default", async () => {
    const [stdout, stderr, exitCode] = await run("-e", probe);
    expect(stdout).toBe("Expected at least one exported symbol\n");
    expect(exitCode).toBe(0);
  });

  it("--no-ffi-cc makes cc() throw ERR_FFI_CC_DISABLED", async () => {
    const [stdout, stderr, exitCode] = await run("--no-ffi-cc", "-e", probe);
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });

  it("--no-addons makes cc() throw ERR_FFI_CC_DISABLED", async () => {
    const [stdout, stderr, exitCode] = await run("--no-addons", "-e", probe);
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });

  it("the error message names the disabled compiler", async () => {
    const [stdout, stderr, exitCode] = await run(
      "--no-ffi-cc",
      "-p",
      'require("bun:ffi").cc({ source: "does-not-exist.c", symbols: {} })',
    );
    expect(stdout).toBe("");
    expect(stderr).toContain("error: Cannot compile C code because the bun:ffi C compiler is disabled.");
    expect(stderr).toContain('code: "ERR_FFI_CC_DISABLED"');
    expect(exitCode).toBe(1);
  });

  it("BUN_OPTIONS=--no-ffi-cc makes cc() throw ERR_FFI_CC_DISABLED", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", probe],
      env: { ...bunEnv, BUN_OPTIONS: "--no-ffi-cc" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });

  // The Worker runs the probe and posts its one line back to the parent. A
  // worker that fails before it posts is reported on stdout instead of
  // hanging the process.
  const workerHost = (execArgv: string) => /* js */ `
    const { Worker } = require("node:worker_threads");
    const source = ${JSON.stringify(probeWith("require('node:worker_threads').parentPort.postMessage"))};
    const worker = new Worker(source, { eval: true, execArgv: ${execArgv} });
    let reported = false;
    worker.on("message", msg => {
      reported = true;
      console.log(msg);
      worker.terminate();
    });
    worker.on("error", e => {
      reported = true;
      console.log("worker error: " + (e.code ?? e.message));
      worker.terminate();
    });
    worker.on("exit", code => {
      if (!reported) console.log("worker exited with " + code + " before posting");
    });
  `;

  it("--no-ffi-cc stays in effect inside a Worker with an empty execArgv", async () => {
    const [stdout, stderr, exitCode] = await run("--no-ffi-cc", "-e", workerHost("[]"));
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });

  it("--no-addons stays in effect inside a Worker with an empty execArgv", async () => {
    const [stdout, stderr, exitCode] = await run("--no-addons", "-e", workerHost("[]"));
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });

  it("a Worker can disable cc() for itself with execArgv", async () => {
    const [stdout, stderr, exitCode] = await run("-e", workerHost('["--no-ffi-cc"]'));
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });

  it("a Worker cannot re-enable cc() that its parent disabled", async () => {
    const [stdout, stderr, exitCode] = await run("--no-ffi-cc", "-e", workerHost('["--smol"]'));
    expect(stdout).toBe("ERR_FFI_CC_DISABLED\n");
    expect(exitCode).toBe(0);
  });
});
