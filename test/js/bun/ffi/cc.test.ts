import { cc, CString, FFIType, JSCallback, ptr, type FFIFunction, type Library } from "bun:ffi";
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

    it("coerces incorrect-type arguments via `|0` instead of producing junk", () => {
      // The generated int arg wrapper is `val|0`: "1"|0 === 1, "abc"|0 === 0.
      // @ts-expect-error - intentionally wrong argument types
      expect(res.symbols.add("1", "2")).toBe(3);
      // @ts-expect-error
      expect(res.symbols.add("abc", 5)).toBe(5);
    });

    it("treats a missing trailing argument as 0", () => {
      // The wrapper passes `undefined|0 === 0` for the absent argument.
      // @ts-expect-error - intentionally too few arguments
      expect(res.symbols.add(1)).toBe(1);
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

  // TinyCC now reports compile errors through its error-handler callback
  // (collected as deferred errors), so a syntax error surfaces as a thrown Error
  // instead of crashing. Still gated under ASan, where tcc's internal
  // longjmp on the error path trips the poisoning checker.
  it.skipIf(isASAN)("throws a compile error for a syntax error (does not crash)", () => {
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

describe.skipIf(isASAN || isFFIUnavailable)("given a ping(cstr) function", () => {
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

  it("given a valid CString, returns a CString with the same pointer", () => {
    const buf = Buffer.from("hello\0");
    const arr = new Uint8Array(buf);
    const cstr = new CString(ptr(arr));

    const result = library.symbols.ping(cstr);
    expect(result).toBeInstanceOf(CString);
    expect(result.ptr).toBe(cstr.ptr);
    expect(result.toString()).toBe("hello");
  });
}); // </given a ping(cstr) function>

describe.skipIf(isASAN || isFFIUnavailable)("given a strlen(cstring) function", () => {
  const library = makeValidCase(
    "strlen_impl",
    /* c */ `
      unsigned long long strlen_impl(char* str) {
        char* s = str;
        while (*s) s++;
        return (unsigned long long)(s - str);
      }
    `,
    {
      strlen_impl: {
        args: ["cstring"],
        returns: "uint64_t",
      },
    },
  );

  it("given a valid CString containing 'hello', returns the correct length", () => {
    const buf = Buffer.from("hello\0");
    const arr = new Uint8Array(buf);
    const cstr = new CString(ptr(arr));

    expect(library.symbols.strlen_impl(cstr)).toBe(5n);
  });

  it("given a JSString, throws", () => {
    // @ts-expect-error
    expect(() => library.symbols.strlen_impl("hello")).toThrow(TypeError);
  });
}); // </given a strlen(cstring) function>

// cc() previously read `options[key]` when wrapping symbols, but the symbol
// spec for cc() lives at `options.symbols[key]`. The result: cstring returns
// never became CString instances, and argument wrappers (integer clamps,
// pointer auto-conversion) never installed.
describe.skipIf(isASAN || isFFIUnavailable)("cc() wraps symbols correctly", () => {
  const library = makeValidCase(
    "hello",
    /* c */ `
      const char* hello() { return "world"; }
    `,
    {
      hello: { args: [], returns: "cstring" },
    },
  );

  it("a cstring return type yields a CString instance, not a raw number", () => {
    const result = library.symbols.hello();
    expect(result).toBeInstanceOf(CString);
    expect(result.toString()).toBe("world");
  });
}); // </cc() wraps symbols correctly>

// The int16_t arg wrapper used to clamp `>= 32768` to `32768`, then the C
// trampoline cast that to int16_t and wrapped to -32768. The clamp must be
// to INT16_MAX = 32767 so the cast is safe. (uint16_t is already clamped to
// 0xffff at the matching site.)
describe.skipIf(isASAN || isFFIUnavailable)("int16_t arg clamping", () => {
  const library = makeValidCase(
    "identity_int16",
    /* c */ `
      short identity_int16(short v) { return v; }
    `,
    {
      identity_int16: { args: ["int16_t"], returns: "int16_t" },
    },
  );

  it("clamps values above INT16_MAX to INT16_MAX (does not wrap to negative)", () => {
    expect(library.symbols.identity_int16(32767)).toBe(32767);
    // Previously: passed 32768 → C cast wrapped to -32768.
    expect(library.symbols.identity_int16(32768)).toBe(32767);
    expect(library.symbols.identity_int16(100000)).toBe(32767);
  });

  it("clamps values below INT16_MIN to INT16_MIN", () => {
    expect(library.symbols.identity_int16(-32768)).toBe(-32768);
    expect(library.symbols.identity_int16(-100000)).toBe(-32768);
  });
}); // </int16_t arg clamping>

// int8_t is the missed sibling of the int16_t/uint8_t clamps: without a clamp
// the C `(int8_t)` cast wraps (128 -> -128).
describe.skipIf(isASAN || isFFIUnavailable)("int8_t arg clamping", () => {
  const library = makeValidCase(
    "identity_int8",
    /* c */ `
      signed char identity_int8(signed char v) { return v; }
    `,
    {
      identity_int8: { args: ["int8_t"], returns: "int8_t" },
    },
  );

  it("clamps to [-128, 127] instead of wrapping", () => {
    expect(library.symbols.identity_int8(127)).toBe(127);
    expect(library.symbols.identity_int8(128)).toBe(127); // previously wrapped to -128
    expect(library.symbols.identity_int8(1000)).toBe(127);
    expect(library.symbols.identity_int8(-128)).toBe(-128);
    expect(library.symbols.identity_int8(-129)).toBe(-128);
  });
}); // </int8_t arg clamping>

// uint8_t is the third clamp sibling: without the [0, 255] clamp the C
// `(unsigned char)` cast wraps (256 -> 0, -1 -> 255).
describe.skipIf(isASAN || isFFIUnavailable)("uint8_t arg clamping", () => {
  const library = makeValidCase(
    "identity_uint8",
    /* c */ `
      unsigned char identity_uint8(unsigned char v) { return v; }
    `,
    {
      identity_uint8: { args: ["uint8_t"], returns: "uint8_t" },
    },
  );

  it("clamps to [0, 255] instead of wrapping", () => {
    expect(library.symbols.identity_uint8(255)).toBe(255);
    expect(library.symbols.identity_uint8(256)).toBe(255); // would wrap to 0
    expect(library.symbols.identity_uint8(1000)).toBe(255);
    expect(library.symbols.identity_uint8(0)).toBe(0);
    expect(library.symbols.identity_uint8(-1)).toBe(0); // would wrap to 255
  });
}); // </uint8_t arg clamping>

// uint16_t is the fourth clamp sibling: without the [0, 65535] clamp the C
// `(unsigned short)` cast wraps (65536 -> 0, -1 -> 65535).
describe.skipIf(isASAN || isFFIUnavailable)("uint16_t arg clamping", () => {
  const library = makeValidCase(
    "identity_uint16",
    /* c */ `
      unsigned short identity_uint16(unsigned short v) { return v; }
    `,
    {
      identity_uint16: { args: ["uint16_t"], returns: "uint16_t" },
    },
  );

  it("clamps to [0, 65535] instead of wrapping", () => {
    expect(library.symbols.identity_uint16(65535)).toBe(65535);
    expect(library.symbols.identity_uint16(65536)).toBe(65535); // would wrap to 0
    expect(library.symbols.identity_uint16(1000000)).toBe(65535);
    expect(library.symbols.identity_uint16(0)).toBe(0);
    expect(library.symbols.identity_uint16(-1)).toBe(0); // would wrap to 65535
  });
}); // </uint16_t arg clamping>

// The double arg wrapper (before #33122) used Math.abs() when converting a
// BigInt to double, silently flipping the sign of negative BigInts, and threw
// a TypeError for any BigInt with |val| >= Number.MAX_VALUE. Current main
// routes through Number(val); these tests guard that behavior.
describe.skipIf(isASAN || isFFIUnavailable)("double arg accepts BigInt with correct sign", () => {
  const library = makeValidCase(
    "identity_double",
    /* c */ `
      double identity_double(double v) { return v; }
    `,
    {
      identity_double: { args: ["double"], returns: "double" },
    },
  );

  it("preserves the sign of negative BigInts", () => {
    expect(library.symbols.identity_double(-5n)).toBe(-5);
    expect(library.symbols.identity_double(-1000n)).toBe(-1000);
    expect(library.symbols.identity_double(5n)).toBe(5);
    expect(library.symbols.identity_double(0n)).toBe(0);
  });

  it("converts BigInts above |Number.MAX_VALUE| to ±Infinity (does not throw)", () => {
    const huge = 10n ** 309n;
    expect(library.symbols.identity_double(huge)).toBe(Infinity);
    expect(library.symbols.identity_double(-huge)).toBe(-Infinity);
  });
}); // </double arg accepts BigInt with correct sign>

// The int32 fast-path in INT64_TO_JSVALUE used `val <= MAX_INT32` where
// A 64-bit return that fits in int32 is int32-tagged; 2^31..MAX_SAFE_INTEGER
// route to the Number (double) encoding, and only values above MAX_SAFE_INTEGER
// become BigInt. u64_fast and i64_fast must agree at every boundary.
describe.skipIf(isASAN || isFFIUnavailable)("int64_t/uint64_t return at the int32 and safe-integer boundaries", () => {
  const library = makeValidCase(
    "boundary_returns",
    /* c */ `
      long long give_2_to_31(void) { return 2147483648LL; }
      long long give_neg_2_to_31(void) { return -2147483648LL; }
      unsigned long long give_u_2_to_31(void) { return 2147483648ULL; }
      unsigned long long give_u_int32_max(void) { return 2147483647ULL; }
      long long give_i_max_safe(void) { return 9007199254740991LL; }
      unsigned long long give_u_max_safe(void) { return 9007199254740991ULL; }
      unsigned long long give_u_2_to_53(void) { return 9007199254740992ULL; }
    `,
    {
      give_2_to_31: { args: [], returns: "i64_fast" },
      give_neg_2_to_31: { args: [], returns: "i64_fast" },
      give_u_2_to_31: { args: [], returns: "u64_fast" },
      give_u_int32_max: { args: [], returns: "u64_fast" },
      give_i_max_safe: { args: [], returns: "i64_fast" },
      give_u_max_safe: { args: [], returns: "u64_fast" },
      give_u_2_to_53: { args: [], returns: "u64_fast" },
    },
  );

  it("returns 2^31 as the positive Number 2147483648, not -2147483648", () => {
    // Previously: 2147483648 cast to int32 → -2147483648.
    expect(library.symbols.give_2_to_31()).toBe(2147483648);
    expect(library.symbols.give_u_2_to_31()).toBe(2147483648); // uint64 path too
  });

  it("returns -2^31 as -2147483648 (this case was always correct)", () => {
    expect(library.symbols.give_neg_2_to_31()).toBe(-2147483648);
  });

  it("returns INT32_MAX (2^31-1) as an int32-encoded Number", () => {
    expect(library.symbols.give_u_int32_max()).toBe(2147483647);
  });

  it("u64_fast and i64_fast both return MAX_SAFE_INTEGER as a Number, not BigInt", () => {
    // Regression: u64_fast used a strict `< MAX_INT52`, so exactly
    // Number.MAX_SAFE_INTEGER came back as a BigInt while i64_fast returned a
    // Number. It is exactly representable as a double, so both must be a Number.
    expect(library.symbols.give_i_max_safe()).toBe(9007199254740991);
    expect(library.symbols.give_u_max_safe()).toBe(9007199254740991);
    expect(typeof library.symbols.give_u_max_safe()).toBe("number");
  });

  it("returns 2^53 (above MAX_SAFE_INTEGER) as a BigInt", () => {
    expect(library.symbols.give_u_2_to_53()).toBe(9007199254740992n);
  });
}); // </int64_t/uint64_t return at the int32 and safe-integer boundaries>

// FFIType.buffer is exposed as the numeric constant 20 but the integer ABI
// type bound check rejected anything > ABIType::NapiValue (19). Only the
// string label "buffer" was accepted.
describe.skipIf(isASAN || isFFIUnavailable)("FFIType.buffer numeric constant is accepted", () => {
  const library = makeValidCase(
    "first_byte",
    /* c */ `
      unsigned char first_byte(unsigned char* buf) { return buf[0]; }
    `,
    {
      first_byte: { args: [FFIType.buffer], returns: "uint8_t" },
    },
  );

  it("accepts FFIType.buffer (numeric constant 20) as an arg type", () => {
    const arr = new Uint8Array([42, 1, 2, 3]);
    expect(library.symbols.first_byte(arr)).toBe(42);
  });
}); // </FFIType.buffer numeric constant is accepted>

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

  // `library` is assigned later, inside beforeAll — returning it directly would
  // capture the current (undefined) value. Return a live view that forwards to
  // whatever beforeAll assigns by the time the `it` bodies run.
  return new Proxy({} as Library<Fns>, {
    get(_target, prop) {
      return library[prop];
    },
  });
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

    // Assert stdout/exitCode precisely; keep stderr in the object only for
    // diagnostics (ASAN/debug builds emit benign warnings, so don't require "").
    expect({ stdout, stderr, exitCode }).toMatchObject({ stdout: "ok\n", exitCode: 0 });
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

// A double outside an integer type's range is C undefined behavior when cast
// (`(int64_t)1e30`): x86 yields the "indefinite" value, arm64 saturates — so
// the same JS produced different results per arch. The FFI.h conversion helpers
// now clamp and map NaN to 0 so the result is defined and identical everywhere.
describe.skipIf(isASAN || isFFIUnavailable)("i64_fast / u64_fast out-of-range args saturate (no UB)", () => {
  const library = makeValidCase(
    "sat",
    /* c */ `
      long long idi(long long x) { return x; }
      unsigned long long idu(unsigned long long x) { return x; }
    `,
    {
      idi: { args: ["i64_fast"], returns: "i64_fast" },
      idu: { args: ["u64_fast"], returns: "u64_fast" },
    },
  );

  it("saturates out-of-range doubles instead of platform-divergent UB", () => {
    const { idi, idu } = library.symbols;
    expect(idi(1e30)).toBe(9223372036854775807n); // was INT64_MIN on x86
    expect(idi(-1e30)).toBe(-9223372036854775808n);
    expect(idu(1e30)).toBe(18446744073709551615n);
    expect(idi(NaN)).toBe(0);
    expect(idu(NaN)).toBe(0);
  });

  it("leaves in-range values unchanged", () => {
    const { idi, idu } = library.symbols;
    expect(idi(1000)).toBe(1000);
    expect(idi(-1000)).toBe(-1000);
    expect(idu(1000)).toBe(1000);
  });
});

// A callable Proxy / InternalFunction is `isCallable()` but is NOT a JSFunction
// subclass; the native side `uncheckedDowncast<JSFunction>`'d it (type confusion).
// It now rejects them (dynamicDowncast) while still accepting bound functions.
describe.skipIf(isASAN || isFFIUnavailable)("JSCallback rejects non-JSFunction callables", () => {
  it("rejects a callable Proxy and an InternalFunction with a clear error", () => {
    const proxy = new Proxy(function () {}, {});
    expect(() => new JSCallback(proxy, { returns: "int32_t", args: [] })).toThrow(/Expected callback to be a function/);
    // `Array` is an InternalFunction (callable, but not a JSFunction).
    // @ts-expect-error - intentionally passing a non-callback
    expect(() => new JSCallback(Array, { returns: "int32_t", args: [] })).toThrow(/Expected callback to be a function/);
  });

  it("still accepts ordinary and bound functions", () => {
    for (const fn of [
      () => 1,
      function named() {
        return 1;
      },
      (() => 1).bind(null),
    ]) {
      const cb = new JSCallback(fn, { returns: "int32_t", args: [] });
      expect(typeof cb.ptr).toBe("number");
      cb.close();
    }
  });
});

// `args.length` is the attacker-controlled JS array length (u32). Reserving it
// up front (`reserve_exact`) would request ~16 GB for `new Array(0xFFFFFFFF)`
// and abort the process; the reservation is now capped.
describe.skipIf(isASAN || isFFIUnavailable)("cc() does not pre-allocate on an attacker-sized args array", () => {
  it("rejects a 4-billion-length args array without OOM-aborting", () => {
    using dir = tempDir("bun-ffi-cc-dos", { "f.c": "int f(void){return 5;}" });
    expect(() =>
      cc({
        source: path.join(String(dir), "f.c"),
        // Sparse array: length is 0xFFFFFFFF but the first element is undefined.
        symbols: { f: { args: new Array(0xffffffff), returns: "int" } },
      }),
    ).toThrow();
  });
});

// A string `flags` used to replace the default flags entirely, dropping
// -Wl,--export-all-symbols so the compiled symbols never resolved. It now keeps
// the defaults and appends, matching the array form.
describe.skipIf(isASAN || isFFIUnavailable)("cc() string flags keep the default flags", () => {
  it("still exports symbols when a string `flags` is given", () => {
    using dir = tempDir("bun-ffi-cc-flags", { "a.c": "int add2(int x){return x+2;}" });
    const lib = cc({
      source: path.join(String(dir), "a.c"),
      flags: "-O1",
      symbols: { add2: { args: ["int"], returns: "int" } },
    });
    expect(lib.symbols.add2(40)).toBe(42);
    lib.close();
  });
});

// The buffer/ptr/cstring arg wrappers used $isTypedArrayView, which excludes
// DataView even though the public types list it. DataView is now accepted.
describe.skipIf(isASAN || isFFIUnavailable)("DataView is accepted as ptr and buffer args", () => {
  const library = makeValidCase(
    "dv",
    /* c */ `
      unsigned long long addr(void* p) { return (unsigned long long)p; }
      int first(unsigned char* b) { return b[0]; }
    `,
    {
      addr: { args: ["ptr"], returns: "u64_fast" },
      first: { args: ["buffer"], returns: "int" },
    },
  );

  it("passes a DataView's data pointer (respecting byteOffset)", () => {
    const ab = new ArrayBuffer(8);
    new Uint8Array(ab).fill(0);
    const dv0 = new DataView(ab, 0);
    const dv2 = new DataView(ab, 2);
    dv2.setUint8(0, 99); // writes ab[2]
    // The passed pointer must reflect the DataView's byteOffset, not just be
    // non-null — a regression that dropped byteOffset would give addr(dv2) == addr(dv0).
    expect(Number(library.symbols.addr(dv2))).toBe(Number(library.symbols.addr(dv0)) + 2);
    expect(library.symbols.first(dv2)).toBe(99); // reads ab[2] through the view's vector
    expect(library.symbols.first(dv0)).toBe(0); // reads ab[0]
  });
});

// An empty `source: []` used to reach Source::first() -> files[0] -> index panic
// -> process abort. Spawned so a regression is a child abort, not a runner abort.
describe.skipIf(isASAN || isFFIUnavailable)("cc() rejects an empty source array", () => {
  it("throws instead of panicking on cc({ source: [] })", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { cc } = require("bun:ffi");
        let threw = false;
        try { cc({ source: [], symbols: { add: { args: ["int", "int"], returns: "int" } } }); }
        catch (e) { threw = /at least one file/.test(e.message); }
        process.stdout.write(threw ? "THREW" : "NO_THROW");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode, signalCode: proc.signalCode }).toMatchObject({
      stdout: "THREW",
      exitCode: 0,
      signalCode: null,
    });
  });
});

// A `napi_value` return opens a NapiHandleScope in the generated wrapper (which
// references Bun__thisFFIModuleNapiEnv), but that symbol was only added for napi
// ARGS — so a napi_value return with no napi args failed to relocate / bind.
describe.skipIf(isASAN || isFFIUnavailable)("cc() binds a napi_value return with no napi args", () => {
  const library = makeValidCase(
    "napi_ret",
    /* c */ `
      typedef long long napi_value;
      napi_value get_val(void) { return (napi_value)0; }
    `,
    {
      get_val: { args: [], returns: "napi_value" },
    },
  );

  it("compiles and relocates (the handle-scope env symbol is resolved)", () => {
    expect(typeof library.symbols.get_val).toBe("function");
  });
}); // </cc() binds a napi_value return with no napi args>

// TCC::State has no Drop; CompileC::compile must destroy it on failure. Without
// the scopeguard, every failed cc() compile (here: a missing exported symbol)
// leaked a whole TinyCC context, growing RSS unbounded. Spawned so a regression
// is visible as RSS growth / an ASAN leak report in the child, not the runner.
describe.skipIf(isASAN || isFFIUnavailable)("cc() does not leak the TCC state on failed compilation", () => {
  it("keeps RSS bounded across many failed compiles", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { cc } = require("bun:ffi");
        const { writeFileSync } = require("node:fs");
        const src = require("node:os").tmpdir() + "/bun-ffi-leak-" + process.pid + ".c";
        writeFileSync(src, "int present(void){return 1;}");
        const start = process.memoryUsage().rss;
        for (let i = 0; i < 300; i++) {
          try { cc({ source: src, symbols: { absent: { args: [], returns: "int" } } }); } catch {}
        }
        Bun.gc(true);
        const grewMB = (process.memoryUsage().rss - start) / (1024 * 1024);
        // Fixed: a couple MB. Leaking 300 TCC contexts is tens of MB.
        process.stdout.write(grewMB < 15 ? "OK" : "LEAK:" + grewMB.toFixed(1));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode, signalCode: proc.signalCode }).toMatchObject({
      stdout: "OK",
      exitCode: 0,
      signalCode: null,
    });
  });
}); // </cc() does not leak the TCC state on failed compilation>
