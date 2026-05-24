import { cc, CString, JSCallback, ptr, type FFIFunction, type Library } from "bun:ffi";
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

describe.skipIf(isWindows || isASAN || isFFIUnavailable)("threadsafe JSCallback", () => {
  const source = /* c */ `
    typedef void (*callback_t)(int);

    #ifdef __APPLE__
    typedef struct _opaque_pthread_t* pthread_t;
    #else
    typedef unsigned long pthread_t;
    #endif

    extern int pthread_create(pthread_t*, const void*, void* (*)(void*), void*);
    extern int pthread_detach(pthread_t);

    static callback_t active_callback;
    static int active_count;
    static _Atomic int callbacks_finished;

    static void* run_callbacks(void* unused) {
      (void)unused;
      for (int i = 0; i < active_count; i++) {
        active_callback(i);
      }
      callbacks_finished = 1;
      return (void*)0;
    }

    int start_threadsafe_callbacks(callback_t callback, int count) {
      pthread_t thread;
      active_callback = callback;
      active_count = count;
      callbacks_finished = 0;
      if (pthread_create(&thread, (void*)0, run_callbacks, (void*)0) != 0) {
        return -1;
      }
      pthread_detach(thread);
      return count;
    }

    int threadsafe_callbacks_finished(void) {
      return callbacks_finished;
    }
  `;

  let dir: string;
  let library: Library<{
    start_threadsafe_callbacks: { args: ["ptr", "int"]; returns: "int" };
    threadsafe_callbacks_finished: { args: []; returns: "int" };
  }>;

  beforeAll(() => {
    dir = tempDirWithFiles("bun-ffi-threadsafe-callback-test", {
      "callback.c": source,
    });
    library = cc({
      source: path.join(dir, "callback.c"),
      library: "pthread",
      symbols: {
        start_threadsafe_callbacks: {
          returns: "int",
          args: ["ptr", "int"],
        },
        threadsafe_callbacks_finished: {
          returns: "int",
          args: [],
        },
      },
    });
  });

  afterAll(async () => {
    library?.close();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("can be called repeatedly from a native thread while the JS thread runs GC", async () => {
    const count = 4096;
    const values: number[] = [];
    const callback = new JSCallback(
      value => {
        values.push(value);
      },
      {
        args: ["int"],
        returns: "void",
        threadsafe: true,
      },
    );

    try {
      expect(library.symbols.start_threadsafe_callbacks(callback.ptr, count)).toBe(count);

      for (let i = 0; i < 4096 && values.length < count; i++) {
        Bun.gc(true);
        await Bun.sleep(0);
        if (library.symbols.threadsafe_callbacks_finished() && values.length === count) {
          break;
        }
      }

      expect(library.symbols.threadsafe_callbacks_finished()).toBe(1);
      expect(values).toHaveLength(count);
      expect(values).toEqual(Array.from({ length: count }, (_, i) => i));
    } finally {
      callback.close();
    }
  });
});

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
