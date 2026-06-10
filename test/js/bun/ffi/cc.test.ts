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

    it("when passed numeric strings, coerces them like the dlopen wrappers do", () => {
      // int arguments go through the same `val|0` coercion as dlopen'd symbols
      // @ts-expect-error
      expect(res.symbols.add("1", "2")).toBe(3);
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

// Successful compiles are fine under ASan; the setjmp/longjmp conflict only
// affects TinyCC's error handling, which these tests never reach.
describe.skipIf(isFFIUnavailable)("given a ping(cstr) function", () => {
  const holder = makeValidCase(
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

  it("given a valid CString, returns a CString wrapping the same pointer", () => {
    const buf = Buffer.from("hello\0");
    const arr = new Uint8Array(buf);
    const cstr = new CString(ptr(arr));

    const result = holder.library.symbols.ping(cstr);
    expect(result).toBeInstanceOf(CString);
    expect(result.ptr).toBe(cstr.ptr);
    expect(result.toString()).toBe("hello");
  });
}); // </given a ping(cstr) function>

// Successful compiles are fine under ASan; the setjmp/longjmp conflict only
// affects TinyCC's error handling, which these tests never reach.
describe.skipIf(isFFIUnavailable)("given a strlen(cstring) function", () => {
  const holder = makeValidCase(
    "strlen",
    /* c */ `
      unsigned long long strlen(char* str) {
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

    expect(holder.library.symbols.strlen(cstr)).toBe(5n);
  });

  it("given a JSString, throws", () => {
    // @ts-expect-error
    expect(() => holder.library.symbols.strlen("hello")).toThrow(TypeError);
  });
}); // </given a strlen(cstring) function>

// These conversions are shared with dlopen(), but `cc` used to skip them
// entirely because it looked up symbol definitions on the options object
// instead of options.symbols.
// Successful compiles are fine under ASan; the setjmp/longjmp conflict only
// affects TinyCC's error handling, which these tests never reach.
describe.skipIf(isFFIUnavailable)("cc applies the same conversions as dlopen", () => {
  const holder = makeValidCase(
    "conversions",
    /* c */ `
      const char* greet() { return "hello"; }
      unsigned int identity_u32(unsigned int value) { return value; }
      void* identity_ptr(void* value) { return value; }
      int invoke(int (*callback)(int), int value) { return callback(value); }
      long long napi_echo(void* env, long long value) { return value; }
    `,
    {
      greet: {
        args: [],
        returns: "cstring",
      },
      identity_u32: {
        args: ["u32"],
        returns: "u32",
      },
      identity_ptr: {
        args: ["ptr"],
        returns: "ptr",
      },
      invoke: {
        args: ["function", "int"],
        returns: "int",
      },
      napi_echo: {
        args: ["napi_env", "napi_value"],
        returns: "napi_value",
      },
    },
  );

  it("wraps cstring return values in a CString", () => {
    const result = holder.library.symbols.greet();
    expect(result).toBeInstanceOf(CString);
    expect(result.toString()).toBe("hello");
  });

  it("converts large uint32_t arguments correctly", () => {
    expect(holder.library.symbols.identity_u32(0xffffffff)).toBe(0xffffffff);
    expect(holder.library.symbols.identity_u32(0)).toBe(0);
  });

  it("converts ArrayBuffer pointer arguments", () => {
    const buf = new ArrayBuffer(8);
    expect(holder.library.symbols.identity_ptr(buf)).toBe(ptr(buf));
  });

  it("throws when a pointer argument cannot be converted", () => {
    // @ts-expect-error
    expect(() => holder.library.symbols.identity_ptr({})).toThrow(TypeError);
  });

  it("accepts a JSCallback object for function arguments", () => {
    const callback = new JSCallback((value: number) => value * 3, {
      args: ["int"],
      returns: "int",
    });
    try {
      expect(holder.library.symbols.invoke(callback, 14)).toBe(42);
    } finally {
      callback.close();
    }
  });

  it("passes napi_value arguments through untouched", () => {
    const object = { hello: "napi" };
    expect(holder.library.symbols.napi_echo(null, object)).toBe(object);
  });
}); // </cc applies the same conversions as dlopen>

// =============================================================================

function makeValidCase<Fns extends Record<string, FFIFunction>>(
  name: string,
  source: string,
  symbols: Fns,
): { library: Library<Fns> } {
  const filename = `${name}.c`;

  // The library only exists once `beforeAll` has run, so hand tests a holder
  // instead of a value captured at describe time.
  const holder = {} as { library: Library<Fns> };

  beforeAll(() => {
    try {
      var dir = tempDirWithFiles(`bun-ffi-cc-${name}`, {
        [filename]: source,
      });

      holder.library = cc({
        source: path.join(dir, filename),
        symbols,
      });
    } finally {
      // @ts-ignore -- `var` gets hoisted
      if (dir) fs.rm(dir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    holder.library?.close();
  });

  return holder;
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
