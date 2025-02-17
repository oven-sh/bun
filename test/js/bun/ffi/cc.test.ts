import { describe, beforeAll, afterAll, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import path from "path";
import { promises as fs } from "fs";
import { cc, type Library, CString, Pointer, ptr } from "bun:ffi";

// TODO: we need to install build-essential and Apple SDK in CI.
// It can't find includes. It can on machines with that enabled.
it.todoIf(isWindows)("can run a .c file", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), path.join(__dirname, "cc-fixture.js")],
    cwd: __dirname,
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });

  expect(result.exitCode).toBe(0);
});

describe("given an add(a, b) function", () => {
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

  it("compiling with an incorrect signature is U.B. but doesn't crash", () => {
    const ret = cc({
      source: path.join(dir, "add.c"),
      symbols: {
        add: {
          returns: "void",
          args: ["int", "int"],
        },
      },
    });
    expect(ret.symbols).toHaveProperty("add");
    // shouldn't crash or throw
    expect(() => ret.symbols.add(1, 2)).not.toThrow();
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
  // set a runtime error handler, but but we need to upgrade in order to get it.
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

describe("given a strlen(cstring) function", () => {
  let dir: string;
  let strlenPath: string;

  beforeAll(() => {
    dir = tempDirWithFiles("bun-ffi-cc-test", {
      "strlen.c": /* c */ `
        unsigned int strlen(char* str) {
          char* s = str;
          while (*s != '\0') s++;
          return s - str;
        }
      `,
    });
    strlenPath = path.join(dir, "strlen.c");
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe.skip("when compiled", () => {
    let lib: Library<{ strlen: { args: ["cstring"]; returns: "int" } }>;

    beforeAll(() => {
      lib = cc({
        source: strlenPath,
        symbols: {
          strlen: {
            args: ["cstring"],
            // FIXME: u32, u64 fails
            returns: "int",
          },
        },
      });
    });

    afterAll(() => {
      lib.close();
    });

    it("returns the correct length", () => {
      const buf = Buffer.from("hello\0");
      const arr = new Uint8Array(buf);
      const cstr = new CString(ptr(arr));

      // @ts-ignore
      expect(lib.symbols.strlen(cstr)).toBe(5);
    });
  }); // </when compiled>
}); // </given a strlen(cstring) function>
