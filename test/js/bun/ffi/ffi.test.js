import { afterAll, describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import {
  bunEnv,
  bunExe,
  compileFixture,
  isDebug,
  isGlibcVersionAtLeast,
  isMacOS,
  isMusl,
  isWindows,
  tempDir,
} from "harness";
import { platform } from "os";

import {
  cc,
  CFunction,
  CString,
  dlopen,
  JSCallback,
  linkSymbols,
  ptr,
  read,
  suffix,
  toArrayBuffer,
  toBuffer,
  viewSource,
} from "bun:ffi";

let FFI_FIXTURE_PATH = null;
let ABI_FIXTURE_PATH = null;
try {
  FFI_FIXTURE_PATH = compileFixture(import.meta.dir + "/ffi-test.c");
  ABI_FIXTURE_PATH = compileFixture(import.meta.dir + "/ffi-abi-fixture.c");
} catch (e) {
  if (!String(e?.message ?? e).includes("no C compiler")) throw e;
  console.warn(`[ffi.test] fixture-dependent tests skipped: ${e?.message ?? e}`);
}

it("ffi print", async () => {
  await Bun.write(
    import.meta.dir + "/ffi.test.fixture.callback.c",
    viewSource(
      {
        returns: "bool",
        args: ["ptr"],
      },
      true,
    ),
  );
  await Bun.write(
    import.meta.dir + "/ffi.test.fixture.receiver.c",
    viewSource(
      {
        not_a_callback: {
          returns: "float",
          args: ["float"],
        },
      },
      false,
    )[0],
  );
  expect(
    viewSource(
      {
        returns: "int8_t",
        args: [],
      },
      true,
    ).length > 0,
  ).toBe(true);
  expect(
    viewSource(
      {
        a: {
          returns: "int8_t",
          args: [],
        },
      },
      false,
    ).length > 0,
  ).toBe(true);
});

function getTypes(fast) {
  const int64_t = fast ? "i64_fast" : "int64_t";
  const uint64_t = fast ? "u64_fast" : "uint64_t";
  return {
    returns_true: {
      returns: "bool",
      args: [],
    },
    returns_false: {
      returns: "bool",
      args: [],
    },
    returns_42_char: {
      returns: "char",
      args: [],
    },
    returns_42_float: {
      returns: "float",
      args: [],
    },
    returns_42_double: {
      returns: "double",
      args: [],
    },
    returns_42_uint8_t: {
      returns: "uint8_t",
      args: [],
    },
    returns_neg_42_int8_t: {
      returns: "int8_t",
      args: [],
    },
    returns_42_uint16_t: {
      returns: "uint16_t",
      args: [],
    },
    returns_42_uint32_t: {
      returns: "uint32_t",
      args: [],
    },
    returns_42_uint64_t: {
      returns: uint64_t,
      args: [],
    },
    returns_neg_42_int16_t: {
      returns: "int16_t",
      args: [],
    },
    returns_neg_42_int32_t: {
      returns: "int32_t",
      args: [],
    },
    returns_neg_42_int64_t: {
      returns: int64_t,
      args: [],
    },

    identity_char: {
      returns: "char",
      args: ["char"],
    },
    identity_float: {
      returns: "float",
      args: ["float"],
    },
    identity_bool: {
      returns: "bool",
      args: ["bool"],
    },
    identity_double: {
      returns: "double",
      args: ["double"],
    },
    identity_int8_t: {
      returns: "int8_t",
      args: ["int8_t"],
    },
    identity_int16_t: {
      returns: "int16_t",
      args: ["int16_t"],
    },
    identity_int32_t: {
      returns: "int32_t",
      args: ["int32_t"],
    },
    returns_cstring: {
      returns: "cstring",
      args: [],
    },
    returns_null_cstring: {
      returns: "cstring",
      args: [],
    },
    echoes_cstring: {
      returns: "cstring",
      args: ["cstring"],
    },
    strlen_cstring: {
      returns: "uint64_t",
      args: ["cstring"],
    },
    identity_int64_t: {
      returns: int64_t,
      args: [int64_t],
    },
    identity_uint8_t: {
      returns: "uint8_t",
      args: ["uint8_t"],
    },
    identity_uint16_t: {
      returns: "uint16_t",
      args: ["uint16_t"],
    },
    identity_uint32_t: {
      returns: "uint32_t",
      args: ["uint32_t"],
    },
    identity_uint64_t: {
      returns: uint64_t,
      args: [uint64_t],
    },

    add_char: {
      returns: "char",
      args: ["char", "char"],
    },
    add_float: {
      returns: "float",
      args: ["float", "float"],
    },
    add_double: {
      returns: "double",
      args: ["double", "double"],
    },
    add_int8_t: {
      returns: "int8_t",
      args: ["int8_t", "int8_t"],
    },
    add_int16_t: {
      returns: "int16_t",
      args: ["int16_t", "int16_t"],
    },
    add_int32_t: {
      returns: "int32_t",
      args: ["int32_t", "int32_t"],
    },
    add_int64_t: {
      returns: int64_t,
      args: [int64_t, int64_t],
    },
    add_uint8_t: {
      returns: "uint8_t",
      args: ["uint8_t", "uint8_t"],
    },
    add_uint16_t: {
      returns: "uint16_t",
      args: ["uint16_t", "uint16_t"],
    },
    add_uint32_t: {
      returns: "uint32_t",
      args: ["uint32_t", "uint32_t"],
    },

    is_null: {
      returns: "bool",
      args: ["ptr"],
    },

    does_pointer_equal_42_as_int32_t: {
      returns: "bool",
      args: ["ptr"],
    },

    ptr_should_point_to_42_as_int32_t: {
      returns: "ptr",
      args: [],
    },
    identity_ptr: {
      returns: "ptr",
      args: ["ptr"],
    },
    add_uint64_t: {
      returns: uint64_t,
      args: [uint64_t, uint64_t],
    },

    cb_identity_true: {
      returns: "bool",
      args: ["ptr"],
    },
    cb_identity_false: {
      returns: "bool",
      args: ["ptr"],
    },
    cb_identity_42_char: {
      returns: "char",
      args: ["ptr"],
    },
    cb_identity_42_float: {
      returns: "float",
      args: ["ptr"],
    },
    cb_identity_42_double: {
      returns: "double",
      args: ["ptr"],
    },
    cb_identity_42_uint8_t: {
      returns: "uint8_t",
      args: ["ptr"],
    },
    cb_identity_neg_42_int8_t: {
      returns: "int8_t",
      args: ["ptr"],
    },
    cb_identity_42_uint16_t: {
      returns: "uint16_t",
      args: ["ptr"],
    },
    cb_identity_42_uint32_t: {
      returns: "uint32_t",
      args: ["ptr"],
    },
    cb_identity_42_uint64_t: {
      returns: uint64_t,
      args: ["ptr"],
    },
    cb_identity_neg_42_int16_t: {
      returns: "int16_t",
      args: ["ptr"],
    },
    cb_identity_neg_42_int32_t: {
      returns: "int32_t",
      args: ["ptr"],
    },
    cb_identity_neg_42_int64_t: {
      returns: int64_t,
      args: ["ptr"],
    },

    return_a_function_ptr_to_function_that_returns_true: {
      returns: "ptr",
      args: [],
    },

    getDeallocatorCalledCount: {
      returns: "int32_t",
      args: [],
    },
    getDeallocatorCallback: {
      returns: "ptr",
      args: [],
    },
    getDeallocatorBuffer: {
      returns: "ptr",
      args: [],
    },
  };
}

function ffiRunner(fast) {
  describe("FFI runner" + (fast ? " (fast int)" : ""), () => {
    const types = getTypes(fast);
    const {
      symbols: {
        returns_true,
        returns_false,
        return_a_function_ptr_to_function_that_returns_true,
        returns_42_char,
        returns_42_float,
        returns_42_double,
        returns_42_uint8_t,
        returns_neg_42_int8_t,
        returns_42_uint16_t,
        returns_42_uint32_t,
        returns_42_uint64_t,
        returns_neg_42_int16_t,
        returns_neg_42_int32_t,
        returns_neg_42_int64_t,
        identity_char,
        identity_float,
        identity_bool,
        identity_double,
        identity_int8_t,
        identity_int16_t,
        identity_int32_t,
        identity_int64_t,
        identity_uint8_t,
        identity_uint16_t,
        identity_uint32_t,
        identity_uint64_t,
        add_char,
        add_float,
        add_double,
        add_int8_t,
        add_int16_t,
        add_int32_t,
        add_int64_t,
        add_uint8_t,
        add_uint16_t,
        identity_ptr,
        add_uint32_t,
        add_uint64_t,
        is_null,
        does_pointer_equal_42_as_int32_t,
        ptr_should_point_to_42_as_int32_t,
        cb_identity_true,
        cb_identity_false,
        cb_identity_42_char,
        cb_identity_42_float,
        cb_identity_42_double,
        cb_identity_42_uint8_t,
        cb_identity_neg_42_int8_t,
        cb_identity_42_uint16_t,
        cb_identity_42_uint32_t,
        cb_identity_42_uint64_t,
        cb_identity_neg_42_int16_t,
        cb_identity_neg_42_int32_t,
        cb_identity_neg_42_int64_t,
        getDeallocatorCalledCount,
        getDeallocatorCallback,
        getDeallocatorBuffer,
      },
      close,
    } = dlopen(FFI_FIXTURE_PATH, types);
    it("primitives", () => {
      Bun.gc(true);
      expect(returns_true()).toBe(true);
      Bun.gc(true);
      expect(returns_false()).toBe(false);

      expect(returns_42_char()).toBe(42);
      if (fast) expect(returns_42_uint64_t().valueOf()).toBe(42);
      else expect(returns_42_uint64_t().valueOf()).toBe(42n);
      Bun.gc(true);
      expect(Math.fround(returns_42_float())).toBe(Math.fround(42.41999804973602));
      expect(returns_42_double()).toBe(42.42);
      expect(returns_42_uint8_t()).toBe(42);
      expect(returns_neg_42_int8_t()).toBe(-42);
      expect(returns_42_uint16_t()).toBe(42);
      expect(returns_42_uint32_t()).toBe(42);
      if (fast) expect(returns_42_uint64_t()).toBe(42);
      else expect(returns_42_uint64_t()).toBe(42n);
      expect(returns_neg_42_int16_t()).toBe(-42);
      expect(returns_neg_42_int32_t()).toBe(-42);
      expect(identity_int32_t(10)).toBe(10);
      Bun.gc(true);
      if (fast) expect(returns_neg_42_int64_t()).toBe(-42);
      else expect(returns_neg_42_int64_t()).toBe(-42n);

      expect(identity_char(10)).toBe(10);

      expect(identity_float(10.199999809265137)).toBe(10.199999809265137);

      expect(identity_bool(true)).toBe(true);

      expect(identity_bool(false)).toBe(false);
      expect(identity_double(10.100000000000364)).toBe(10.100000000000364);

      expect(identity_int8_t(10)).toBe(10);
      expect(identity_int16_t(10)).toBe(10);

      if (fast) expect(identity_int64_t(10)).toBe(10);
      else expect(identity_int64_t(10)).toBe(10n);
      expect(identity_uint8_t(10)).toBe(10);
      expect(identity_uint16_t(10)).toBe(10);
      expect(identity_uint32_t(10)).toBe(10);
      if (fast) expect(identity_uint64_t(10)).toBe(10);
      else expect(identity_uint64_t(10)).toBe(10n);
      Bun.gc(true);
      var bigArray = new BigUint64Array(8);
      new Uint8Array(bigArray.buffer).fill(255);
      var bigIntArray = new BigInt64Array(bigArray.buffer);
      expect(identity_uint64_t(bigArray[0])).toBe(bigArray[0]);
      expect(identity_uint64_t(bigArray[0] - BigInt(1))).toBe(bigArray[0] - BigInt(1));
      if (fast) {
        expect(add_uint64_t(BigInt(-1) * bigArray[0], bigArray[0])).toBe(0);
        expect(add_uint64_t(BigInt(-1) * bigArray[0] + BigInt(10), bigArray[0])).toBe(10);
      } else {
        expect(add_uint64_t(BigInt(-1) * bigArray[0], bigArray[0])).toBe(0n);
        expect(add_uint64_t(BigInt(-1) * bigArray[0] + BigInt(10), bigArray[0])).toBe(10n);
      }
      if (fast) {
        expect(identity_uint64_t(0)).toBe(0);
        expect(identity_uint64_t(100)).toBe(100);
        expect(identity_uint64_t(BigInt(100))).toBe(100);

        expect(identity_int64_t(bigIntArray[0])).toBe(-1);
        expect(identity_int64_t(bigIntArray[0] - BigInt(1))).toBe(-2);
      } else {
        expect(identity_uint64_t(0)).toBe(0n);
        expect(identity_uint64_t(100)).toBe(100n);
        expect(identity_uint64_t(BigInt(100))).toBe(100n);

        expect(identity_int64_t(bigIntArray[0])).toBe(bigIntArray[0]);
        expect(identity_int64_t(bigIntArray[0] - BigInt(1))).toBe(bigIntArray[0] - BigInt(1));
      }
      Bun.gc(true);
      expect(add_char.native(1, 1)).toBe(2);

      expect(add_float(2.4, 2.8)).toBe(Math.fround(5.2));
      expect(add_double(4.2, 0.1)).toBe(4.3);
      expect(add_int8_t(1, 1)).toBe(2);
      expect(add_int16_t(1, 1)).toBe(2);
      expect(add_int32_t(1, 1)).toBe(2);
      if (fast) expect(add_int64_t(1, 1)).toBe(2);
      else expect(add_int64_t(1n, 1n)).toBe(2n);
      expect(add_uint8_t(1, 1)).toBe(2);
      expect(add_uint16_t(1, 1)).toBe(2);
      expect(add_uint32_t(1, 1)).toBe(2);
      Bun.gc(true);
      expect(is_null(null)).toBe(true);
      const cptr = ptr_should_point_to_42_as_int32_t();
      expect(cptr != 0).toBe(true);
      expect(typeof cptr === "number").toBe(true);
      expect(does_pointer_equal_42_as_int32_t(cptr)).toBe(true);
      {
        // No finalizer: both views borrow `cptr` (static storage in the fixture),
        // so the GC below must not free it. See oven-sh/bun#35405.
        const buffer = toBuffer(cptr, 0, 4);
        expect(buffer.readInt32(0)).toBe(42);
        expect(new DataView(toArrayBuffer(cptr, 0, 4), 0, 4).getInt32(0, true)).toBe(42);
        expect(ptr(buffer)).toBe(cptr);
      }
      Bun.gc(true);
      expect(new CString(cptr, 0, 1).toString()).toBe("*");
      expect(identity_ptr(cptr)).toBe(cptr);
      const second_ptr = ptr(new Buffer(8));
      expect(identity_ptr(second_ptr)).toBe(second_ptr);
      expect(new CString(ptr(Buffer.from([97, 97, 97, 0, 97, 98, 99, 0, 0])), 4).toString()).toBe("abc");
      expect(new CString(ptr(Buffer.from([97, 97, 97, 0, 97, 98, 99, 0, 0])), 4, 2).toString()).toBe("ab");
    });

    it("CFunction", () => {
      var myCFunction = new CFunction({
        ptr: return_a_function_ptr_to_function_that_returns_true(),
        returns: "bool",
      });
      expect(myCFunction()).toBe(true);
    });

    const typeMap = {
      int8_t: -8,
      int16_t: -16,
      int32_t: -32,
      int64_t: -64n,
      uint8_t: 8,
      uint16_t: 16,
      uint32_t: 32,
      uint64_t: 64n,
      float: 32.5,
      double: 64.5,
      ptr: 0xdeadbeef,
      "void*": null,
    };

    it("JSCallback", () => {
      var toClose = new JSCallback(
        input => {
          return input;
        },
        {
          returns: "bool",
          args: ["bool"],
        },
      );
      expect(toClose.ptr > 0).toBe(true);
      toClose.close();
      expect(toClose.ptr === null).toBe(true);
    });

    describe("callbacks", () => {
      // Return types, 1 argument
      for (let [returnName, returnValue] of Object.entries(typeMap)) {
        it("fn(" + returnName + ") " + returnName, () => {
          var roundtripFunction = new CFunction({
            ptr: new JSCallback(
              input => {
                return input;
              },
              {
                returns: returnName,
                args: [returnName],
              },
            ).ptr,
            returns: returnName,
            args: [returnName],
          });
          expect(roundtripFunction(returnValue)).toBe(returnValue);
        });
      }
      // Return types, no args
      for (let [name, value] of Object.entries(typeMap)) {
        it("fn() " + name, () => {
          var roundtripFunction = new CFunction({
            ptr: new JSCallback(() => value, {
              returns: name,
            }).ptr,
            returns: name,
          });
          expect(roundtripFunction()).toBe(value);
        });
      }
    });

    describe("threadsafe callback", done => {
      // 1 arg, threadsafe
      for (let [name, value] of Object.entries(typeMap)) {
        it("fn(" + name + ") " + name, async () => {
          const cb = new JSCallback(
            arg1 => {
              expect(arg1).toBe(value);
            },
            {
              args: [name],
              threadsafe: true,
            },
          );
          var roundtripFunction = new CFunction({
            ptr: cb.ptr,
            returns: "void",
            args: [name],
          });
          roundtripFunction(value);
          await 1;
        });
      }
    });

    describe("integer identities work for all possible values", () => {
      const cases = [
        { type: "int8_t", min: -128, max: 127, fn: identity_int8_t },
        { type: "int16_t", min: -32768, max: 32767, fn: identity_int16_t },
        { type: "int32_t", min: -2147483648, max: 2147483647, fn: identity_int32_t },
        { type: "int64_t", min: -9223372036854775808n, max: 9223372036854775807n, fn: identity_int64_t },
        { type: "uint8_t", min: 0, max: 255, fn: identity_uint8_t },
        { type: "uint16_t", min: 0, max: 65535, fn: identity_uint16_t },
        { type: "uint32_t", min: 0, max: 4294967295, fn: identity_uint32_t },
        { type: "uint64_t", min: 0n, max: 18446744073709551615n, fn: identity_uint64_t },
      ];

      for (const { type, min, max, fn } of cases) {
        const bigint = typeof min === "bigint";
        const inc = bigint
          ? //
            (max - min) / 32768n
          : Math.ceil((max - min) / 32768);
        it(type, () => {
          expect(bigint ? BigInt(fn(min)) : fn(min)).toBe(min);
          expect(bigint ? BigInt(fn(max)) : fn(max)).toBe(max);
          expect(bigint ? BigInt(fn(0n)) : fn(0)).toBe(bigint ? 0n : 0);

          for (let i = min; i <= max; i += inc) {
            expect(bigint ? BigInt(fn(i)) : fn(i)).toBe(i);
          }
        });
      }
    });

    afterAll(() => {
      close();
    });
  });
}

it("read", () => {
  // The usage of globalThis is a GC thing we should really fix
  globalThis.buffer = new BigInt64Array(16);
  const dataView = new DataView(buffer.buffer);
  const addr = ptr(buffer);

  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = BigInt(i);
    expect(read.intptr(addr, i * 8)).toBe(Number(dataView.getBigInt64(i * 8, true)));
    expect(read.ptr(addr, i * 8)).toBe(Number(dataView.getBigUint64(i * 8, true)));
    expect(read.f64(addr, i + 8)).toBe(dataView.getFloat64(i + 8, true));
    expect(read.i64(addr, i * 8)).toBe(dataView.getBigInt64(i * 8, true));
    expect(read.u64(addr, i * 8)).toBe(dataView.getBigUint64(i * 8, true));
  }

  for (let i = 0; i < buffer.byteLength - 4; i++) {
    // read is intended to behave like DataView
    // but instead of doing
    //    new DataView(toArrayBuffer(myPtr)).getInt8(0, true)
    // you can do
    //    read.i8(myPtr, 0)
    expect(read.i8(addr, i)).toBe(dataView.getInt8(i, true));
    expect(read.i16(addr, i)).toBe(dataView.getInt16(i, true));
    expect(read.i32(addr, i)).toBe(dataView.getInt32(i, true));
    expect(read.u8(addr, i)).toBe(dataView.getUint8(i, true));
    expect(read.u16(addr, i)).toBe(dataView.getUint16(i, true));
    expect(read.u32(addr, i)).toBe(dataView.getUint32(i, true));
    expect(read.f32(addr, i)).toBe(dataView.getFloat32(i, true));
  }

  delete globalThis.buffer;
});

describe.skipIf(!FFI_FIXTURE_PATH)("run ffi", () => {
  if (!FFI_FIXTURE_PATH) return;
  ffiRunner(false);
  ffiRunner(true);
});

it("dlopen throws an error instead of returning it", () => {
  let err;
  try {
    dlopen("nonexistent", { x: {} });
  } catch (error) {
    err = error;
  }
  expect(err).toBeTruthy();
});

// Windows: dlopen must accept paths with non-ASCII characters. Previously the
// path was handed to LoadLibraryA as UTF-8, which the OS decodes as the system
// ANSI codepage, so any non-ASCII byte mangled the path.
it.skipIf(!isWindows)("dlopen accepts non-ASCII library paths on Windows", async () => {
  const fixture = `
    const { dlopen, FFIType } = require("bun:ffi");
    const { mkdirSync, copyFileSync } = require("node:fs");
    const { join } = require("node:path");

    const src = join(process.env.SystemRoot || "C:\\\\Windows", "System32", "version.dll");
    const results = {};
    for (const name of ["caf\\u00e9", "\\u65e5\\u672c\\u8a9e"]) {
      const dir = join(process.env.FIXTURE_DIR, "bun-ffi-" + name);
      mkdirSync(dir, { recursive: true });
      const dll = join(dir, "version.dll");
      copyFileSync(src, dll);
      const lib = dlopen(dll, {
        GetFileVersionInfoSizeW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
      });
      results[name] = typeof lib.symbols.GetFileVersionInfoSizeW;
      lib.close();
    }
    console.log(JSON.stringify(results));
  `;
  using dir = tempDir("ffi-dlopen-unicode", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, FIXTURE_DIR: String(dir) },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;
  expect({ results, stderr, exitCode }).toMatchObject({
    results: { "caf\u00e9": "function", "\u65e5\u672c\u8a9e": "function" },
    exitCode: 0,
  });
});

it('suffix does not start with a "."', () => {
  expect(suffix).not.toMatch(/^\./);
});

it(".ptr is not leaked", () => {
  for (let fn of [Bun.password.hash, Bun.password.verify, it]) {
    expect(fn).not.toHaveProperty("ptr");
    expect(fn.ptr).toBeUndefined();
  }
});

describe.skipIf(!FFI_FIXTURE_PATH)("engine-native cstring", () => {
  it("dlopen returns:'cstring' yields a string primitive; NULL yields null", () => {
    const {
      symbols: { returns_cstring, returns_null_cstring },
    } = dlopen(FFI_FIXTURE_PATH, {
      returns_cstring: { returns: "cstring", args: [] },
      returns_null_cstring: { returns: "cstring", args: [] },
    });
    const value = returns_cstring();
    expect(typeof value).toBe("string");
    expect(value).toBe("engine cstring");
    expect(returns_null_cstring()).toBe(null);
  });

  it("args:['cstring'] accepts a JS string, a TypedArray, and a pointer", () => {
    const {
      symbols: { echoes_cstring, strlen_cstring },
    } = dlopen(FFI_FIXTURE_PATH, {
      echoes_cstring: { returns: "cstring", args: ["cstring"] },
      strlen_cstring: { returns: "uint64_t", args: ["cstring"] },
    });
    expect(echoes_cstring("round trip")).toBe("round trip");
    expect(strlen_cstring("héllo")).toBe(6n);
    const bytes = Buffer.from("bytes\0", "utf8");
    expect(strlen_cstring(bytes)).toBe(5n);
    expect(strlen_cstring(ptr(bytes))).toBe(5n);
  });

  it("a JSCallback receiving a cstring parameter gets a string", () => {
    const {
      symbols: { echoes_cstring },
    } = dlopen(FFI_FIXTURE_PATH, {
      echoes_cstring: { returns: "cstring", args: ["cstring"] },
    });
    let received;
    const cb = new JSCallback(s => (received = s), { args: ["cstring"], returns: "void" });
    try {
      const call = CFunction({ ptr: cb.ptr, args: ["cstring"], returns: "void" });
      call("hello from js");
    } finally {
      cb.close();
    }
    expect(received).toBe("hello from js");
    expect(typeof received).toBe("string");
    expect(echoes_cstring(received)).toBe("hello from js");
  });
});

describe("read edge cases", () => {
  it("a negative byteOffset does not abort the process", () => {
    const buf = new Uint8Array([9, 8, 7, 6]);
    const base = ptr(buf) + 2;
    expect(read.u8(base, -1)).toBe(8);
    expect(read.u8(base, -2)).toBe(9);
    expect(() => read.u8(1, -5)).toThrow("ptr cannot be zero");
    expect(() => read.u8(0)).toThrow("ptr cannot be zero");
  });

  it("read.* and toArrayBuffer accept a BigInt pointer", () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const address = BigInt(ptr(buf));
    expect(read.u8(address, 0)).toBe(1);
    expect(read.u8(address, 3)).toBe(4);
    expect(new Uint8Array(toArrayBuffer(address, 0, 8))).toEqual(buf);
    expect(() => read.u8(-1n, 0)).toThrow("Expected a pointer");
    expect(() => CFunction({ ptr: -1n, args: [], returns: "void" })).toThrow(/out of range/);
  });
});

describe("CString", () => {
  it("call and construct forms are identical for falsy pointers", () => {
    for (const falsy of [null, undefined, 0]) {
      expect(CString(falsy)).toBe("");
      expect(new CString(falsy)).toBe("");
    }
  });
  it("accepts a BigInt pointer", () => {
    const buf = Buffer.from("bigint ok\0", "utf8");
    const address = BigInt(ptr(buf));
    expect(new CString(address)).toBe("bigint ok");
    expect(CString(address)).toBe("bigint ok");
  });
  it("throws (not stringifies) on an invalid pointer", () => {
    expect(() => new CString(-1)).toThrow("ptr must be a number");
    expect(() => CString(-1)).toThrow("ptr must be a number");
    expect(() => new CString(-1n)).toThrow(/out of range/);
    expect(() => CString(-1n)).toThrow(/out of range/);
  });
  const hello = Buffer.from("Hello, world!\0", "utf8");
  (globalThis.__ffiTestPinnedBuffers ??= []).push(hello);
  const helloPtr = ptr(hello);

  it("yields a string primitive", () => {
    const cs = new CString(helloPtr);
    expect(typeof cs).toBe("string");
    expect(cs).toBe("Hello, world!");
    expect(cs === "Hello, world!").toBe(true);
    expect(cs.length).toBe(13);
    expect(cs.slice(7)).toBe("world!");
    expect(JSON.stringify(cs)).toBe('"Hello, world!"');
  });

  it("takes byteOffset and byteLength", () => {
    expect(new CString(helloPtr, 7, 5)).toBe("world");
    expect(new CString(helloPtr, 0, 5)).toBe("Hello");
  });

  it("a falsy pointer yields an empty string", () => {
    for (const value of [0, null, undefined]) {
      const cs = new CString(value);
      expect(typeof cs).toBe("string");
      expect(cs).toBe("");
    }
  });

  it("Bun.FFI.CString is the same constructor, callable with and without new", () => {
    expect(Bun.FFI.CString).toBe(CString);
    expect(new Bun.FFI.CString(helloPtr, 0, 5)).toBe("Hello");
    expect(Bun.FFI.CString(helloPtr, 0, 5)).toBe("Hello");
    expect(CString(helloPtr, 0, 5)).toBe("Hello");
    expect(CString.name).toBe("CString");
  });
});

describe("CFunction", () => {
  it("returns the engine-native callable with a working .close()", () => {
    const callback = new JSCallback(() => 42, { returns: "int32_t", args: [] });
    try {
      const fn = new CFunction({ ptr: callback.ptr, returns: "int32_t", args: [] });
      expect(typeof fn).toBe("function");
      expect(fn()).toBe(42);
      expect(fn()).toBe(42);
      expect(fn.close).toBeFunction();
      expect(fn.close()).toBeUndefined();
      expect(fn.close()).toBeUndefined();
    } finally {
      callback.close();
    }
  });

  it("passes arguments and marshals the return value", () => {
    const add = new JSCallback((a, b) => a + b, { returns: "int32_t", args: ["int32_t", "int32_t"] });
    try {
      const fn = new CFunction({ ptr: add.ptr, returns: "int32_t", args: ["int32_t", "int32_t"] });
      expect(fn(40, 2)).toBe(42);
      expect(fn(-1, 1)).toBe(0);
      fn.close();
    } finally {
      add.close();
    }
  });

  it("reports a missing ptr the same way linkSymbols() does", () => {
    expect(() => new CFunction({ returns: "int32_t", args: [] })).toThrow(/CFunction.*ptr.*(linkSymbols|CFunction)/);
  });
});

// Runs in a subprocess: `bun test`'s exit path does not finalize the CFunction's native handle,
// which the ASan lane's leak checker then reports against this file.
it("JSCallback exceptions propagate out of the native call", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { CFunction, JSCallback } from "bun:ffi";
      const callback = new JSCallback(
        () => {
          throw new Error("boom");
        },
        { returns: "int32_t", args: [] },
      );
      const call = new CFunction({ ptr: callback.ptr, returns: "int32_t", args: [] });
      try {
        call();
        console.log("did not throw");
      } catch (e) {
        console.log("caught", e.message);
      }
      call.close();
      callback.close();`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "caught boom\n",
    stderr: "",
    exitCode: 0,
  });
});

// A `ptr` argument that is a cell but not a typed array view (here: a plain ArrayBuffer) must convert
// correctly in FTL-compiled callers too. The optimizing tier used to read JSArrayBufferView::m_mode from
// any cell before checking its type; when the ArrayBuffer was the last cell in its MarkedBlock and the
// following page was not committed, that read faulted. Allocating many small ArrayBuffers per round makes
// block-final cells common; the check itself is that every call returns the buffer's data pointer.
it.skipIf(!FFI_FIXTURE_PATH)("ptr argument: ArrayBuffer cells through an FTL-compiled call site", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { dlopen, read } from "bun:ffi";
      const { symbols } = dlopen(process.env.FFI_FIXTURE_PATH, { identity_ptr: { args: ["ptr"], returns: "ptr" } });
      function callIt(value) { return symbols.identity_ptr(value); }
      const view = new Uint8Array(16);
      for (let i = 0; i < 300_000; i++) callIt(view);
      const rounds = ${isDebug ? 3 : 60};
      const perRound = ${isDebug ? 100_000 : 200_000};
      let mismatches = 0;
      for (let round = 0; round < rounds; round++) {
        const buffers = [];
        for (let i = 0; i < perRound; i++) buffers.push(new ArrayBuffer(8));
        for (let i = 0; i < buffers.length; i++) if (i % 10 !== 0) buffers[i] = null;
        Bun.gc(true);
        for (let i = 0; i < buffers.length; i += 10) {
          const buffer = buffers[i];
          new Uint8Array(buffer)[0] = i & 0xff;
          const address = callIt(buffer);
          if (read.u8(address, 0) !== (i & 0xff)) mismatches++;
        }
      }
      console.log("mismatches", mismatches);`,
    ],
    env: { ...bunEnv, FFI_FIXTURE_PATH },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "mismatches 0\n", stderr: "", exitCode: 0 });
});

it("worker teardown drops queued threadsafe JSCallback invocations without crashing", async () => {
  using dir = tempDir("ffi-jscallback-terminate-queued", {
    "main.js": `
      import { join } from "node:path";
      import { Worker } from "node:worker_threads";

      const sab = new SharedArrayBuffer(4);
      const queued = new Int32Array(sab);

      const worker = new Worker(join(import.meta.dir, "worker.js"), { workerData: sab });
      worker.on("error", err => {
        console.error("worker error:", err);
        process.exit(1);
      });

      // Wait until the worker has queued a batch of threadsafe invocations that its blocked
      // event loop cannot drain, then tear it down with those tasks still pending.
      await Atomics.waitAsync(queued, 0, 0).value;
      await worker.terminate();
      console.log("done");
    `,
    "worker.js": `
      import { CFunction, JSCallback } from "bun:ffi";
      import { workerData } from "node:worker_threads";

      const queued = new Int32Array(workerData);
      let ran = 0;
      const callback = new JSCallback(() => { ran++; }, { returns: "void", args: [], threadsafe: true });
      const fire = new CFunction({ ptr: callback.ptr, returns: "void", args: [] });

      // Each call enqueues an invocation onto this worker's event loop; none can run while
      // this module keeps the loop occupied, so they are all still queued at terminate().
      for (let i = 0; i < 200; i++) fire();

      Atomics.store(queued, 0, 1);
      Atomics.notify(queued, 0);
      while (true) {}
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "done\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

// worker.terminate() delivered inside a threadsafe JSCallback used to trip
// "ASSERTION FAILED: !isTerminationException(exception) || hasTerminationRequest()"
// in JSC::VM::setException on the worker thread and re-enter the terminated VM.
it("JSCallback tolerates worker.terminate() arriving inside the callback", async () => {
  using dir = tempDir("ffi-jscallback-terminate", {
    "main.js": `
      import { join } from "node:path";
      import { Worker } from "node:worker_threads";

      const sab = new SharedArrayBuffer(4);
      const flag = new Int32Array(sab);

      const worker = new Worker(join(import.meta.dir, "worker.js"), { workerData: sab });
      let terminating = false;
      worker.on("error", err => {
        console.error("worker error:", err);
        process.exit(1);
      });
      worker.on("exit", code => {
        if (!terminating) {
          console.error("worker exited early:", code);
          process.exit(1);
        }
      });

      // Wait until the worker thread is inside the native -> JS callback frame.
      await Atomics.waitAsync(flag, 0, 0).value;

      terminating = true;
      await worker.terminate();
      console.log("done");
    `,
    "worker.js": `
      import { CFunction, JSCallback } from "bun:ffi";
      import { workerData } from "node:worker_threads";

      const flag = new Int32Array(workerData);

      const callback = new JSCallback(
        () => {
          // Tell the parent we are inside the native -> JS callback frame, then
          // spin until worker.terminate() delivers the TerminationException.
          Atomics.store(flag, 0, 1);
          Atomics.notify(flag, 0);
          while (true) {}
        },
        { returns: "void", args: [], threadsafe: true },
      );

      // CFunction makes the callback's native function pointer callable from JS. A threadsafe
      // JSCallback enqueues a task instead of running synchronously, so the callback runs at
      // the top of the worker's event loop once this module finishes evaluating.
      const fire = new CFunction({ ptr: callback.ptr, returns: "void", args: [] });
      fire();

      // Keep the worker alive until the queued callback task runs.
      setInterval(() => {}, 1000);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "done\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

const libPath =
  platform() === "darwin"
    ? "/usr/lib/libSystem.B.dylib"
    : existsSync("/lib/x86_64-linux-gnu/libc.so.6") && isGlibcVersionAtLeast("2.36.0")
      ? "/lib/x86_64-linux-gnu/libc.so.6"
      : null;

const libSymbols = {
  memchr: {
    returns: "ptr",
    args: ["ptr", "int", "usize"],
  },
  strcpy: {
    returns: "ptr",
    args: ["ptr", "ptr"],
  },
  strcat: {
    returns: "ptr",
    args: ["ptr", "ptr"],
  },
  strncat: {
    returns: "ptr",
    args: ["ptr", "ptr", "usize"],
  },
  strcmp: {
    returns: "int",
    args: ["ptr", "ptr"],
  },
  strncmp: {
    returns: "int",
    args: ["ptr", "ptr", "usize"],
  },
  strcoll: {
    returns: "int",
    args: ["ptr", "ptr"],
  },
  strxfrm: {
    returns: "int",
    args: ["ptr", "ptr", "usize"],
  },
  strchr: {
    returns: "ptr",
    args: ["ptr", "int"],
  },
  strrchr: {
    returns: "ptr",
    args: ["ptr", "int"],
  },
  strcspn: {
    returns: "usize",
    args: ["ptr", "ptr"],
  },
  strspn: {
    returns: "usize",
    args: ["ptr", "ptr"],
  },
  strpbrk: {
    returns: "ptr",
    args: ["ptr", "ptr"],
  },
  strstr: {
    returns: "ptr",
    args: ["ptr", "ptr"],
  },
  strtok: {
    returns: "ptr",
    args: ["ptr", "ptr"],
  },
  strerror: {
    returns: "ptr",
    args: ["int"],
  },
  strerror_r: {
    returns: "ptr",
    args: ["int", "ptr", "usize"],
  },
  strsep: {
    returns: "ptr",
    args: ["ptr", "ptr"],
  },
  strsignal: {
    returns: "ptr",
    args: ["int"],
  },
  stpcpy: {
    returns: "ptr",
    args: ["ptr", "ptr"],
  },
  stpncpy: {
    returns: "ptr",
    args: ["ptr", "ptr", "usize"],
  },
  basename: {
    returns: "ptr",
    args: ["ptr"],
  },
  bcmp: {
    returns: "int",
    args: ["ptr", "ptr", "usize"],
  },
  getdate: {
    returns: "ptr",
    args: ["ptr"],
  },
  gmtime: {
    returns: "ptr",
    args: ["ptr"],
  },
  localtime: {
    returns: "ptr",
    args: ["ptr"],
  },
  ctime: {
    returns: "ptr",
    args: ["ptr"],
  },
  asctime: {
    returns: "ptr",
    args: ["ptr"],
  },
  strftime: {
    returns: "usize",
    args: ["ptr", "usize", "ptr", "ptr"],
  },
  strptime: {
    returns: "ptr",
    args: ["ptr", "ptr", "ptr"],
  },
  asctime_r: {
    returns: "ptr",
    args: ["ptr", "ptr"],
  },
  ctime_r: {
    returns: "ptr",
    args: ["ptr", "ptr"],
  },
  gmtime_r: {
    returns: "ptr",
    args: ["ptr", "ptr"],
  },
  localtime_r: {
    returns: "ptr",
    args: ["ptr", "ptr"],
  },
  bcopy: {
    returns: "int",
    args: ["ptr", "ptr", "usize"],
  },
  bzero: {
    returns: "void",
    args: ["ptr", "usize"],
  },
  index: {
    returns: "ptr",
    args: ["ptr", "int"],
  },
  rindex: {
    returns: "ptr",
    args: ["ptr", "int"],
  },
  ffs: {
    returns: "int",
    args: ["int"],
  },
  strcasecmp: {
    returns: "int",
    args: ["ptr", "ptr"],
  },
  strncasecmp: {
    returns: "int",
    args: ["ptr", "ptr", "usize"],
  },
  pthread_attr_init: {
    returns: "int",
    args: ["ptr"],
  },
  pthread_attr_destroy: {
    returns: "int",
    args: ["ptr"],
  },
  pthread_attr_getdetachstate: {
    returns: "int",
    args: ["ptr", "ptr"],
  },
  pthread_attr_setdetachstate: {
    returns: "int",
    args: ["ptr", "int"],
  },
  pthread_attr_getguardsize: {
    returns: "int",
    args: ["ptr", "ptr"],
  },
  pthread_attr_setguardsize: {
    returns: "int",
    args: ["ptr", "usize"],
  },
  pthread_attr_getschedparam: {
    returns: "int",
    args: ["ptr", "ptr"],
  },
  pthread_attr_setschedparam: {
    returns: "int",
    args: ["ptr", "ptr"],
  },
  pthread_attr_getschedpolicy: {
    returns: "int",
    args: ["ptr", "ptr"],
  },
  pthread_attr_setschedpolicy: {
    returns: "int",
    args: ["ptr", "int"],
  },
  pthread_attr_getinheritsched: {
    returns: "int",
    args: ["ptr", "ptr"],
  },
  pthread_attr_setinheritsched: {
    returns: "int",
    args: ["ptr", "int"],
  },
  pthread_attr_getscope: {
    returns: "int",
    args: ["ptr", "ptr"],
  },
  pthread_attr_setscope: {
    returns: "int",
    args: ["ptr", "int"],
  },
  pthread_attr_getstackaddr: {
    returns: "int",
    args: ["ptr", "ptr"],
  },
  pthread_attr_setstackaddr: {
    returns: "int",
    args: ["ptr", "ptr"],
  },
  pthread_attr_getstacksize: {
    returns: "int",
    args: ["ptr", "ptr"],
  },
  pthread_attr_setstacksize: {
    returns: "int",
    args: ["ptr", "usize"],
  },
  pthread_attr_getstack: {
    returns: "int",
    args: ["ptr", "ptr", "ptr"],
  },
  pthread_attr_setstack: {
    returns: "int",
    args: ["ptr", "ptr", "usize"],
  },
  login_tty: {
    returns: "int",
    args: ["int"],
  },
  login: {
    returns: "int",
    args: ["ptr"],
  },
  logout: {
    returns: "int",
    args: ["ptr"],
  },
  strlen: {
    returns: "usize",
    args: ["ptr"],
  },
};

describe.if(!!libPath)("can open more than 63 symbols via", () => {
  for (const [description, libFn] of [
    // For file: URLs since one might do import.meta.resolve()
    ["URL", () => Bun.pathToFileURL(libPath)],

    // file: URLs as a string
    ["file: URL", () => Bun.pathToFileURL(libPath).href],

    // For embedding files since one might do Bun.file(embeddedFile)
    ["Bun.file", () => Bun.file(libPath)],

    // For file path strings
    ["string", () => libPath],
  ]) {
    it(description, () => {
      const libPath = libFn();
      const lib = dlopen(libPath, libSymbols);
      expect(Object.keys(lib.symbols).length).toBe(Object.keys(libSymbols).length);
      expect(lib.symbols.strcasecmp(Buffer.from("ciro\0"), Buffer.from("CIRO\0"))).toBe(0);
      expect(lib.symbols.strlen(Buffer.from("bunbun\0", "ascii"))).toBe(6n);
    });
  }
});

// A symbol name that is a canonical array index ("0") has to land in the
// indexed storage of `symbols`. A named property of the same spelling shows up
// in Object.keys() but `symbols[0]` cannot find it.
describe("symbols named like an array index", () => {
  // A `ptr` field skips the dlsym lookup, so any loadable library works for dlopen.
  const systemLib = isWindows
    ? "kernel32.dll"
    : isMacOS
      ? "libSystem.B.dylib"
      : isMusl
        ? process.arch === "arm64"
          ? "libc.musl-aarch64.so.1"
          : "libc.musl-x86_64.so.1"
        : "libc.so.6";

  it.each([
    ["linkSymbols()", map => linkSymbols(map)],
    ["dlopen()", map => dlopen(systemLib, map)],
  ])("%s stores the function under the index", (_, open) => {
    let calls = 0;
    const callback = new JSCallback(() => ++calls, { args: [], returns: "int32_t" });
    try {
      const fn = { ptr: callback.ptr, args: [], returns: "int32_t" };
      // 4294967294 is the last array index. 4294967295 (2^32 - 1) is the first name that is not one.
      const lib = open({ "0": fn, named: fn, "4294967294": fn, "4294967295": fn });
      try {
        const { symbols } = lib;
        // Index keys come first, in ascending order. The rest keep insertion order.
        expect(Object.keys(symbols)).toEqual(["0", "4294967294", "named", "4294967295"]);
        expect([typeof symbols[0], typeof symbols[4294967294], typeof symbols[4294967295]]).toEqual([
          "function",
          "function",
          "function",
        ]);
        expect(symbols["0"]).toBe(symbols[0]);
        expect([0 in symbols, 4294967294 in symbols, Object.hasOwn(symbols, "0")]).toEqual([true, true, true]);
        expect([symbols[0](), symbols[4294967294](), symbols.named(), symbols[4294967295]()]).toEqual([1, 2, 3, 4]);
      } finally {
        lib.close();
      }
    } finally {
      callback.close();
    }
  });
});

// oven-sh/bun#35405: toBuffer without a finalizer used to mi_free caller-owned
// memory on GC. Subprocess because unpatched builds crash.
describe("toBuffer borrowed-pointer ownership (no bad-free on GC)", () => {
  async function runsClean(script) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const gcLoop = `for (let i = 0; i < 20; i++) { Bun.gc(true); Buffer.alloc(1024 * 1024); }`;

  // Drops the borrowed view first, then the owner, so an invalid free shows up as
  // corrupted caller memory rather than only as a crash.
  const originalSurvives = (index, expected) => `
      adopted = null;
      ${gcLoop}
      if (original[${index}] !== ${expected}) throw new Error("caller memory corrupted after adopted GC: " + original[${index}]);
      original[${index}] = 0x55;
      if (original[${index}] !== 0x55) throw new Error("caller memory not writable after adopted GC");
      original = null;
      ${gcLoop}
  `;

  it.concurrent("toBuffer(ptr(buffer)) does not free caller-owned memory on GC", async () => {
    expect(
      await runsClean(`
      import { ptr, toBuffer } from "bun:ffi";
      let original = Buffer.alloc(64, 0x41);
      let adopted = toBuffer(ptr(original), 0, 64);
      if (adopted[0] !== 0x41) throw new Error("expected a zero-copy view");
      adopted[0] = 0x42;
      if (original[0] !== 0x42) throw new Error("expected an aliasing view");
      ${originalSurvives(0, "0x42")}
      console.log("survived-gc");
    `),
    ).toEqual({ stdout: "survived-gc\n", stderr: "", exitCode: 0 });
  });

  it.concurrent("toBuffer(ptr(buffer), offset) does not free an interior pointer on GC", async () => {
    expect(
      await runsClean(`
      import { ptr, toBuffer } from "bun:ffi";
      let original = Buffer.alloc(64, 0x41);
      let adopted = toBuffer(ptr(original), 8, 48);
      if (adopted[0] !== 0x41) throw new Error("expected a zero-copy view");
      adopted[0] = 0x42;
      if (original[8] !== 0x42) throw new Error("expected a view aliasing original[8]");
      ${originalSurvives(8, "0x42")}
      console.log("survived-gc");
    `),
    ).toEqual({ stdout: "survived-gc\n", stderr: "", exitCode: 0 });
  });

  it.concurrent("toBuffer(ptr(typedArray)) does not free caller-owned memory on GC", async () => {
    expect(
      await runsClean(`
      import { ptr, toBuffer } from "bun:ffi";
      let original = new Uint8Array(64).fill(0x41);
      let adopted = toBuffer(ptr(original), 0, 64);
      if (adopted[0] !== 0x41) throw new Error("expected a zero-copy view");
      adopted[0] = 0x42;
      if (original[0] !== 0x42) throw new Error("expected an aliasing view");
      ${originalSurvives(0, "0x42")}
      console.log("survived-gc");
    `),
    ).toEqual({ stdout: "survived-gc\n", stderr: "", exitCode: 0 });
  });

  // Regression guard: an explicit finalizer still controls disposal and runs exactly
  // once on GC. getDeallocatorBuffer/getDeallocatorCallback each reset the counter.
  it.skipIf(!FFI_FIXTURE_PATH)(
    "toBuffer with an explicit finalizer calls the deallocator exactly once on GC",
    async () => {
      const {
        symbols: { getDeallocatorCallback, getDeallocatorBuffer, getDeallocatorCalledCount },
      } = dlopen(FFI_FIXTURE_PATH, {
        getDeallocatorCallback: { args: [], returns: "ptr" },
        getDeallocatorBuffer: { args: [], returns: "ptr" },
        getDeallocatorCalledCount: { args: [], returns: "int" },
      });
      (() => {
        const bufPtr = getDeallocatorBuffer();
        let buf = toBuffer(bufPtr, 0, 128, getDeallocatorCallback());
        expect(buf.length).toBe(128);
        expect(getDeallocatorCalledCount()).toBe(0);
        buf = null;
      })();
      for (let i = 0; i < 100 && getDeallocatorCalledCount() === 0; i++) {
        Bun.gc(true);
        Buffer.alloc(1024 * 1024);
        await Bun.sleep(0);
      }
      expect(getDeallocatorCalledCount()).toBe(1);
      Bun.gc(true);
      expect(getDeallocatorCalledCount()).toBe(1);
    },
  );
});

// toBuffer hands an arbitrary (pointer, byteLength) pair straight to the Buffer
// hand-off that spawnSync, Bun.$ and others use for their output. That makes it
// the one way to reach the hand-off with a byteLength above kMaxLength (2^32)
// without 4 GiB of real bytes; the views below never touch the memory they
// describe. Subprocess because unpatched builds abort inside JSC.
describe("toBuffer at the Buffer length limit", () => {
  it.concurrent("throws a RangeError above 2^32 bytes and still creates a view of exactly 2^32 bytes", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { ptr, toBuffer } from "bun:ffi";
        const backing = new Uint8Array(16);
        let aboveLimit;
        try {
          aboveLimit = { length: toBuffer(ptr(backing), 0, 2 ** 32 + 1).length };
        } catch (e) {
          aboveLimit = { isRangeError: e instanceof RangeError };
        }
        const atLimit = { length: toBuffer(ptr(backing), 0, 2 ** 32).length };
        console.log(JSON.stringify({ aboveLimit, atLimit }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ result: JSON.parse(stdout.trim() || "null"), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      result: { aboveLimit: { isRangeError: true }, atLimit: { length: 2 ** 32 } },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});

describe.skipIf(!FFI_FIXTURE_PATH)("engine-native FFI (single implementation)", () => {
  const lib = FFI_FIXTURE_PATH;
  it("linkSymbols() binds and calls symbols from raw pointers", () => {
    const {
      symbols: { returns_true, add_int32_t, identity_ptr },
    } = dlopen(lib, {
      returns_true: { args: [], returns: "bool" },
      add_int32_t: { args: ["i32", "i32"], returns: "i32" },
      identity_ptr: { args: ["ptr"], returns: "ptr" },
    });
    const linked = linkSymbols({
      isTrue: { ptr: returns_true.ptr, args: [], returns: "bool" },
      sum: { ptr: add_int32_t.ptr, args: ["i32", "i32"], returns: "i32" },
      echoPtr: { ptr: identity_ptr.ptr, args: ["ptr"], returns: "ptr" },
    });
    expect(linked.symbols.isTrue()).toBe(true);
    expect(linked.symbols.sum(40, 2)).toBe(42);
    expect(linked.symbols.sum(-1, -2)).toBe(-3);
    expect(linked.symbols.echoPtr(1234)).toBe(1234);
    expect(typeof linked.symbols.sum.ptr).toBe("number");
    linked.close();
  });

  it("buffer_length passes the view's byteLength, atomically paired with the pointer", () => {
    const {
      symbols: { bl_echo_len, bl_last_byte },
    } = dlopen(lib, {
      bl_echo_len: { args: ["buffer", "buffer_length"], returns: "u64" },
      bl_last_byte: { args: ["buffer", "buffer_length"], returns: "u32" },
    });
    const u8 = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(bl_echo_len(u8, u8)).toBe(8n);
    const sub = u8.subarray(2, 5);
    expect(bl_echo_len(sub, sub)).toBe(3n);
    expect(bl_last_byte(sub, sub)).toBe(50);
    const dv = new DataView(u8.buffer, 1, 4);
    expect(bl_echo_len(dv, dv)).toBe(4n);
    expect(bl_last_byte(dv, dv)).toBe(50);
    expect(bl_echo_len(new Float64Array(3), new Float64Array(3))).toBe(24n);
    expect(bl_echo_len(new Uint8Array(0), new Uint8Array(0))).toBe(0n);
    expect(() => bl_echo_len(u8, 8)).toThrow(TypeError);
    expect(() => bl_echo_len(u8, "8")).toThrow(TypeError);
    expect(() =>
      cc({
        source: import.meta.dir + "/ffi-test.c",
        symbols: { bl_echo_len: { args: ["ptr", "buffer_length"], returns: "u64" } },
      }),
    ).toThrow(/buffer_length/);
    expect(() => viewSource({ f: { args: ["buffer_length"], returns: "void" } })).toThrow(/buffer_length/);
    expect(() => viewSource({ f: { args: [], returns: "buffer_length" } })).toThrow(/buffer_length/);
    expect(() => dlopen(lib, { f: { args: [], returns: "buffer_length" } })).toThrow(/buffer_length/);
    expect(() => new JSCallback(() => {}, { args: ["buffer_length"], returns: "void" })).toThrow(/buffer_length/);
  });

  it("u32 arguments >= 2^31 are not sign-flipped (#7007)", () => {
    const {
      symbols: { identity_uint32_t },
    } = dlopen(lib, { identity_uint32_t: { args: ["u32"], returns: "u32" } });
    expect(identity_uint32_t(2 ** 31)).toBe(2 ** 31);
    expect(identity_uint32_t(2 ** 32 - 1)).toBe(2 ** 32 - 1);
    expect(identity_uint32_t(0)).toBe(0);
  });

  it("integer parameters WRAP to width instead of clamping", () => {
    const {
      symbols: { identity_uint8_t },
    } = dlopen(lib, { identity_uint8_t: { args: ["u8"], returns: "u8" } });
    expect(identity_uint8_t(256)).toBe(0);
    expect(identity_uint8_t(257)).toBe(1);
    expect(identity_uint8_t(-1)).toBe(255);
  });

  it("pointers above 2^53 round-trip as exact BigInt (#28068) and BigInt addresses are accepted (#22751)", () => {
    const {
      symbols: { identity_ptr },
    } = dlopen(lib, { identity_ptr: { args: ["ptr"], returns: "ptr" } });
    const big = (1n << 60n) + 7n;
    const round = identity_ptr(big);
    expect(typeof round).toBe("bigint");
    expect(round).toBe(big);
    expect(identity_ptr(1024)).toBe(1024);
    expect(identity_ptr(null)).toBe(null);
  });

  it("numeric strings for numeric parameters throw (intentional behavior change)", () => {
    const {
      symbols: { identity_int32_t },
    } = dlopen(lib, { identity_int32_t: { args: ["i32"], returns: "i32" } });
    expect(() => identity_int32_t("42")).toThrow(TypeError);
    expect(identity_int32_t(42)).toBe(42);
  });

  it("dlopen symbols expose intrinsic .ptr (a real address) and .native", () => {
    const {
      symbols: { returns_true },
    } = dlopen(lib, { returns_true: { args: [], returns: "bool" } });
    expect(typeof returns_true.ptr).toBe("number");
    expect(returns_true.ptr).toBeGreaterThan(0);
    expect(returns_true.native).toBe(returns_true);
    expect(returns_true()).toBe(true);
  });

  it("CFunction returns the engine cell itself with a callable close()", () => {
    const {
      symbols: { returns_42_char },
    } = dlopen(lib, { returns_42_char: { args: [], returns: "char" } });
    const fn = new CFunction({ ptr: returns_42_char.ptr, args: [], returns: "char" });
    expect(fn()).toBe(42);
    expect(typeof fn.close).toBe("function");
    fn.close();
    expect(fn()).toBe(42);
  });

  it("passing a JSCallback OBJECT (not .ptr) as a function-typed argument works", () => {
    const {
      symbols: { cb_identity_42_double },
    } = dlopen(lib, { cb_identity_42_double: { args: ["callback"], returns: "double" } });
    const cb = new JSCallback(() => 42.42, { returns: "double", args: [] });
    try {
      expect(cb_identity_42_double(cb.ptr)).toBe(42.42);
      expect(cb_identity_42_double(cb)).toBe(42.42);
    } finally {
      cb.close();
    }
  });

  it("a JSCallback instance is the engine cell (instanceof + own ptr) and close() is idempotent", () => {
    const cb = new JSCallback(a => a * 2, { args: ["i32"], returns: "i32" });
    expect(cb instanceof JSCallback).toBe(true);
    expect(typeof cb.ptr).toBe("number");
    expect(cb.threadsafe).toBe(false);
    cb.close();
    cb.close();
  });

  it("an omitted callback argument throws instead of calling through NULL", () => {
    const {
      symbols: { cb_identity_true },
    } = dlopen(lib, { cb_identity_true: { args: ["callback"], returns: "bool" } });
    expect(() => cb_identity_true(undefined)).toThrow(TypeError);
  });

  it("napi_env / napi_value are rejected outside cc()", () => {
    expect(() => dlopen(lib, { returns_true: { args: ["napi_env"], returns: "napi_value" } })).toThrow(
      /napi_env \/ napi_value are only supported in bun:ffi cc\(\)/,
    );
    expect(() => new CFunction({ ptr: 1, args: ["napi_env"], returns: "void" })).toThrow(
      /napi_env \/ napi_value are only supported in bun:ffi cc\(\)/,
    );
    expect(() => new JSCallback(() => {}, { args: ["napi_env"], returns: "void" })).toThrow(
      /napi_env \/ napi_value are only supported in bun:ffi cc\(\)/,
    );
    expect(() => linkSymbols({ f: { ptr: 1, args: ["napi_env"], returns: "void" } })).toThrow(
      /napi_env \/ napi_value are only supported in bun:ffi cc\(\)/,
    );
  });

  it("a hot polymorphic call site stays correct across tiers (CallFFI)", () => {
    const {
      symbols: { identity_int32_t },
    } = dlopen(lib, { identity_int32_t: { args: ["i32"], returns: "i32" } });
    const wrappers = [() => identity_int32_t(7), () => identity_int32_t(9)];
    let sum = 0;
    for (let i = 0; i < 400000; ++i) sum += wrappers[i & 1]();
    expect(sum).toBe(200000 * 7 + 200000 * 9);
  });
});

describe.skipIf(!ABI_FIXTURE_PATH)("ABI conformance", () => {
  if (!ABI_FIXTURE_PATH) return;
  const w = (vals, big = false) =>
    big ? vals.reduce((s, v, i) => s + BigInt(v) * BigInt(i + 1), 0n) : vals.reduce((s, v, i) => s + v * (i + 1), 0);

  it("integer widths and signedness at their boundaries", () => {
    const { symbols: s } = dlopen(ABI_FIXTURE_PATH, {
      abi_i8: { args: ["i8"], returns: "i8" },
      abi_u8: { args: ["u8"], returns: "u8" },
      abi_i16: { args: ["i16"], returns: "i16" },
      abi_u16: { args: ["u16"], returns: "u16" },
      abi_i32: { args: ["i32"], returns: "i32" },
      abi_u32: { args: ["u32"], returns: "u32" },
      abi_i64: { args: ["i64"], returns: "i64" },
      abi_u64: { args: ["u64"], returns: "u64" },
      abi_bool: { args: ["bool"], returns: "bool" },
      abi_char: { args: ["char"], returns: "char" },
      abi_f32: { args: ["f32"], returns: "f32" },
      abi_f64: { args: ["f64"], returns: "f64" },
    });
    for (const v of [-128, -1, 0, 1, 127]) expect(s.abi_i8(v)).toBe(v);
    for (const v of [0, 1, 127, 128, 255]) expect(s.abi_u8(v)).toBe(v);
    for (const v of [-32768, -1, 0, 32767]) expect(s.abi_i16(v)).toBe(v);
    for (const v of [0, 32767, 32768, 65535]) expect(s.abi_u16(v)).toBe(v);
    for (const v of [-2147483648, -1, 0, 2147483647]) expect(s.abi_i32(v)).toBe(v);
    for (const v of [0, 2147483647, 2147483648, 4294967295]) expect(s.abi_u32(v)).toBe(v);
    for (const v of [-(2n ** 63n), -1n, 0n, 2n ** 63n - 1n]) expect(s.abi_i64(v)).toBe(v);
    for (const v of [0n, 2n ** 63n, 2n ** 64n - 1n]) expect(s.abi_u64(v)).toBe(v);
    expect(s.abi_bool(true)).toBe(false);
    expect(s.abi_bool(false)).toBe(true);
    for (const v of [0, 65, 127]) expect(s.abi_char(v)).toBe(v);
    for (const v of [0, 1.5, -2.25, 3.4028234663852886e38]) expect(s.abi_f32(v)).toBeCloseTo(v, 6);
    for (const v of [0, 1e-300, 1.7976931348623157e308, -Number.EPSILON, Math.PI]) expect(s.abi_f64(v)).toBe(v);
  });

  it("i32 args past the register count (stack spill, all ABIs)", () => {
    const {
      symbols: { abi_sum_i32_x10 },
    } = dlopen(ABI_FIXTURE_PATH, { abi_sum_i32_x10: { args: Array(10).fill("i32"), returns: "i64" } });
    const cases = [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [-1, -2, -3, -4, -5, -6, -7, -8, -9, -10],
      [2147483647, -2147483648, 0, 1, -1, 7, 7, 7, 7, 7],
      [100000, 4, 5, -1, 6, 8, 1, 2, 2, 3],
    ];
    for (const a of cases) expect(abi_sum_i32_x10(...a)).toBe(w(a, true));
  });

  it("i64 args past the register count", () => {
    const {
      symbols: { abi_sum_i64_x10 },
    } = dlopen(ABI_FIXTURE_PATH, { abi_sum_i64_x10: { args: Array(10).fill("i64"), returns: "i64" } });
    const a = [1n, -2n, 3n, 2n ** 40n, -(2n ** 40n), 5n, 6n, -7n, 8n, 9n];
    expect(abi_sum_i64_x10(...a)).toBe(w(a, true));
  });

  it("f64 args past the FP register count", () => {
    const {
      symbols: { abi_sum_f64_x10 },
    } = dlopen(ABI_FIXTURE_PATH, { abi_sum_f64_x10: { args: Array(10).fill("f64"), returns: "f64" } });
    const a = [0.5, 1.25, -2.5, 3.125, 4, -5.5, 6.75, 7, 8.5, -9.25];
    expect(abi_sum_f64_x10(...a)).toBeCloseTo(w(a), 9);
  });

  it("f32 args past the FP register count (single-precision handling)", () => {
    const {
      symbols: { abi_sum_f32_x10 },
    } = dlopen(ABI_FIXTURE_PATH, { abi_sum_f32_x10: { args: Array(10).fill("f32"), returns: "f64" } });
    const a = [0.5, 1.25, -2.5, 3.125, 4, -5.5, 6.75, 7, 8.5, -9.25];
    expect(abi_sum_f32_x10(...a)).toBeCloseTo(w(a), 5);
  });

  it("mixed alternating int/float, 12 args (Win64 positional vs SysV/AAPCS64 separate)", () => {
    const args = ["i32", "f64", "i32", "f64", "i32", "f64", "i32", "f64", "i32", "f64", "i32", "f64"];
    const {
      symbols: { abi_mix12 },
    } = dlopen(ABI_FIXTURE_PATH, { abi_mix12: { args, returns: "f64" } });
    const a = [1, 0.5, -3, 1.5, 5, -2.5, 7, 3.5, -9, 4.5, 11, -5.5];
    expect(abi_mix12(...a)).toBeCloseTo(w(a), 9);
    const b = [2147483647, 1e-3, -2147483648, 1e6, 3, 4.25, -6, 7.75, 8, -9.5, 10, 0.125];
    expect(abi_mix12(...b)).toBeCloseTo(w(b), 6);
  });

  it("mixed i64/f64 past the register count", () => {
    const args = ["i64", "f64", "i64", "f64", "i64", "f64", "i64", "f64", "i64", "f64"];
    const {
      symbols: { abi_mix_i64f64 },
    } = dlopen(ABI_FIXTURE_PATH, { abi_mix_i64f64: { args, returns: "i64" } });
    const a = [10n, 2, 30n, 4, 50n, 6, 70n, 8, 90n, 10];
    const expected = a.reduce((s, v, i) => s + (typeof v === "bigint" ? v * BigInt(i + 1) : BigInt(v * (i + 1))), 0n);
    expect(abi_mix_i64f64(...a)).toBe(expected);
  });

  it("u8 args past the register count (sub-word stack packing / Darwin natural alignment)", () => {
    const {
      symbols: { abi_sum_u8_x12 },
    } = dlopen(ABI_FIXTURE_PATH, { abi_sum_u8_x12: { args: Array(12).fill("u8"), returns: "i64" } });
    const a = [255, 1, 128, 0, 200, 3, 17, 254, 99, 42, 7, 250];
    expect(abi_sum_u8_x12(...a)).toBe(w(a, true));
  });

  it("i8 args past the register count (stacked byte sign-extension)", () => {
    const {
      symbols: { abi_sum_i8_x12 },
    } = dlopen(ABI_FIXTURE_PATH, { abi_sum_i8_x12: { args: Array(12).fill("i8"), returns: "i64" } });
    const a = [-128, 127, -1, 0, -100, 3, 17, -2, 99, -42, 7, -50];
    expect(abi_sum_i8_x12(...a)).toBe(w(a, true));
  });

  it("i16 args past the register count", () => {
    const {
      symbols: { abi_sum_i16_x12 },
    } = dlopen(ABI_FIXTURE_PATH, { abi_sum_i16_x12: { args: Array(12).fill("i16"), returns: "i64" } });
    const a = [-32768, 32767, -1, 0, -1000, 3, 1717, -2, 9999, -4242, 7, -50];
    expect(abi_sum_i16_x12(...a)).toBe(w(a, true));
  });

  it("bool args past the register count (each exactly 0/1)", () => {
    const {
      symbols: { abi_bools_x10 },
    } = dlopen(ABI_FIXTURE_PATH, { abi_bools_x10: { args: Array(10).fill("bool"), returns: "i32" } });
    const bits = [true, false, true, true, false, false, true, false, true, true];
    expect(abi_bools_x10(...bits)).toBe(bits.reduce((s, b, i) => s + (b ? 1 << i : 0), 0));
  });

  it("callback direction: C invokes JS callbacks with many-arg shapes", () => {
    const { symbols: s } = dlopen(ABI_FIXTURE_PATH, {
      abi_cb_i32_x10: { args: ["callback", "i32"], returns: "i64" },
      abi_cb_f64_x10: { args: ["callback", "f64"], returns: "f64" },
      abi_cb_mix12: { args: ["callback", "i32", "f64"], returns: "f64" },
      abi_cb_i64_x10: { args: ["callback", "i64"], returns: "i64" },
    });
    const cbI = new JSCallback((...a) => a.reduce((t, v, i) => t + BigInt(v) * BigInt(i + 1), 0n), {
      args: Array(10).fill("i32"),
      returns: "i64",
    });
    const cbF = new JSCallback((...a) => a.reduce((t, v, i) => t + v * (i + 1), 0), {
      args: Array(10).fill("f64"),
      returns: "f64",
    });
    const cbM = new JSCallback((...a) => a.reduce((t, v, i) => t + v * (i + 1), 0), {
      args: ["i32", "f64", "i32", "f64", "i32", "f64", "i32", "f64", "i32", "f64", "i32", "f64"],
      returns: "f64",
    });
    const cbL = new JSCallback((...a) => a.reduce((t, v, i) => t + BigInt(v) * BigInt(i + 1), 0n), {
      args: Array(10).fill("i64"),
      returns: "i64",
    });
    try {
      const ki = 5;
      const ai = Array.from({ length: 10 }, (_, i) => ki + i);
      expect(s.abi_cb_i32_x10(cbI, ki)).toBe(w(ai, true));
      const kf = 1.5;
      const af = Array.from({ length: 10 }, (_, i) => kf + i * 0.5);
      expect(s.abi_cb_f64_x10(cbF, kf)).toBeCloseTo(w(af), 9);
      const i0 = 7,
        d0 = 2.5;
      const am = [i0, d0, i0 + 1, d0 + 1, i0 + 2, d0 + 2, i0 + 3, d0 + 3, i0 + 4, d0 + 4, i0 + 5, d0 + 5];
      expect(s.abi_cb_mix12(cbM, i0, d0)).toBeCloseTo(w(am), 9);
      const kl = 2n ** 40n;
      const al = Array.from({ length: 10 }, (_, i) => kl + BigInt(i));
      expect(s.abi_cb_i64_x10(cbL, kl)).toBe(w(al, true));
    } finally {
      cbI.close();
      cbF.close();
      cbM.close();
      cbL.close();
    }
  });
});
