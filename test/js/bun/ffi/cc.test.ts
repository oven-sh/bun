import { cc, CString, JSCallback, ptr, type FFIFunction, type Library } from "bun:ffi";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { promises as fs } from "fs";
import { bunEnv, bunExe, isArm64, isASAN, isWindows, normalizeBunSnapshot, tempDir, tempDirWithFiles } from "harness";
import path from "path";

// TinyCC (and all of bun:ffi) is disabled on Windows ARM64
const isFFIUnavailable = isWindows && isArm64;

// TODO: we need to install build-essential and Apple SDK in CI.
// It can't find includes. It can on machines with that enabled.
// TinyCC's setjmp/longjmp error handling conflicts with ASan.
it.todoIf(isWindows || isASAN || isFFIUnavailable)("can run a .c file", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), path.join(__dirname, "cc-fixture.js")],
    cwd: __dirname,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });

  expect(result.exitCode).toBe(0);
});

// TinyCC's setjmp/longjmp error handling conflicts with ASan.
// TinyCC is disabled on Windows ARM64.
describe.skipIf(isASAN || isFFIUnavailable)("given an add(a, b) function", () => {
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
describe.skipIf(isASAN || isFFIUnavailable)("GC liveness of compiled symbols and callbacks", () => {
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
describe.skipIf(isASAN || isFFIUnavailable)("variadic functions inside cc()-compiled C", () => {
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
describe.skipIf(isASAN || isFFIUnavailable || process.arch !== "x64")(
  "long double varargs inside cc()-compiled C",
  () => {
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
  },
);

// TinyCC compiles thread-local variables to Local-Exec TLS, which has no
// meaning inside an in-memory relocation (there is no PT_TLS segment): the
// generated loads/stores alias the host process's own thread block. TinyCC
// must reject it instead of silently corrupting Bun's thread-locals.
describe.skipIf(isASAN || isFFIUnavailable)("thread-local storage inside cc()-compiled C", () => {
  it.each(["_Thread_local", "__thread"])("%s is a compile error", keyword => {
    const dir = tempDirWithFiles(`bun-ffi-cc-tls`, {
      "tls.c": `${keyword} int bun_test_tls_counter = 0;\nint bump(void) { return ++bun_test_tls_counter; }\n`,
    });
    expect(() => {
      cc({
        source: path.join(dir, "tls.c"),
        symbols: { bump: { args: [], returns: "int" } },
      });
    }).toThrow(/thread-local storage is not supported/);
  });
});

describe.skipIf(isFFIUnavailable)("double <-> JSValue conversions", () => {
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
        string: ["number", "2.5"],
        null_arg: ["number", "0"],
        undefined_arg: ["number", "NaN"],
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
