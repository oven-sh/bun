import { cc, CString, FFIType, JSCallback, ptr, type FFIFunction, type Library } from "bun:ffi";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { promises as fs } from "fs";
import { bunEnv, bunExe, isArm64, isASAN, isWindows, tempDirWithFiles } from "harness";
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

// The double arg wrapper used Math.abs() when converting a BigInt to double,
// which silently flipped the sign of negative BigInts. It also threw a
// TypeError ("Cannot mix BigInt and other types") for any BigInt with
// |val| >= Number.MAX_VALUE, because the fallback path did `val + 0`.
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
    // Math.abs was the bug — would return 5 instead of -5.
    expect(library.symbols.identity_double(-5n)).toBe(-5);
    expect(library.symbols.identity_double(-1000n)).toBe(-1000);
    expect(library.symbols.identity_double(5n)).toBe(5);
    expect(library.symbols.identity_double(0n)).toBe(0);
  });

  it("converts BigInts above |Number.MAX_VALUE| to ±Infinity (does not throw)", () => {
    const huge = 10n ** 309n;
    // Previously: TypeError "Cannot mix BigInt and other types".
    expect(library.symbols.identity_double(huge)).toBe(Infinity);
    expect(library.symbols.identity_double(-huge)).toBe(-Infinity);
  });
}); // </double arg accepts BigInt with correct sign>

// The int32 fast-path in INT64_TO_JSVALUE used `val <= MAX_INT32` where
// MAX_INT32 is 2^31 (not INT32_MAX). So returning the value 2^31 from a
// 64-bit C function would cast to int32_t and wrap to -2^31 in JS.
describe.skipIf(isASAN || isFFIUnavailable)("int64_t return at the int32 boundary", () => {
  const library = makeValidCase(
    "give_2_to_31",
    /* c */ `
      long long give_2_to_31(void) { return 2147483648LL; }
      long long give_neg_2_to_31(void) { return -2147483648LL; }
    `,
    {
      give_2_to_31: { args: [], returns: "i64_fast" },
      give_neg_2_to_31: { args: [], returns: "i64_fast" },
    },
  );

  it("returns 2^31 as the positive Number 2147483648, not -2147483648", () => {
    // Previously: 2147483648 cast to int32 → -2147483648.
    expect(library.symbols.give_2_to_31()).toBe(2147483648);
  });

  it("returns -2^31 as -2147483648 (this case was always correct)", () => {
    expect(library.symbols.give_neg_2_to_31()).toBe(-2147483648);
  });
}); // </int64_t return at the int32 boundary>

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
