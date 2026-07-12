import { afterAll, describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isArm64, isGlibcVersionAtLeast, isWindows, tempDir } from "harness";
import { platform, tmpdir } from "os";

import {
  dlopen as _dlopen,
  CFunction,
  CString,
  JSCallback,
  ptr,
  read,
  suffix,
  toArrayBuffer,
  toBuffer,
  viewSource,
} from "bun:ffi";

const dlopen = (...args) => {
  try {
    return _dlopen(...args);
  } catch (err) {
    // Only a fixture load failing is noteworthy; several tests intentionally
    // dlopen a bad path (e.g. "nonexistent"), and those must not log this.
    if (args[0] === dlopenFixturePath) {
      console.error(`Failed to dlopen the ffi test fixture (${dlopenFixturePath}).`);
    }
    throw err;
  }
};

// The dlopen round-trip suite needs test/js/bun/ffi/ffi-test.c built into a
// shared library. `make compile-ffi-test` was removed, so build it here with
// the system C compiler into a temp file (it uses <stdint.h>, which tinycc
// can't find but a real toolchain can). If no compiler is available, the suite
// skips with a reason rather than silently never running.
const dlopenFixturePath = (() => {
  const src = import.meta.dir + "/ffi-test.c";
  const out = tmpdir() + `/bun-ffi-test-${process.pid}.${suffix}`;
  const sharedFlags = isWindows ? ["-shared"] : ["-shared", "-fPIC"];
  for (const compiler of ["cc", "clang", "gcc"]) {
    try {
      const proc = Bun.spawnSync({ cmd: [compiler, ...sharedFlags, "-o", out, src], stderr: "pipe", stdout: "ignore" });
      if (proc.exitCode === 0 && existsSync(out)) return out;
    } catch {}
  }
  return null;
})();
const ok = !!dlopenFixturePath;

it("ffi print", () => {
  // viewSource emits compilable C for a callback trampoline and a receiver.
  // (Previously this also wrote the output to git-tracked .c files that nothing
  // asserted against, dirtying the tree on every run.)
  const callbackSource = viewSource({ returns: "bool", args: ["ptr"] }, true);
  expect(typeof callbackSource).toBe("string");
  expect(callbackSource.length).toBeGreaterThan(0);

  const receiverSource = viewSource({ a: { returns: "int8_t", args: [] } }, false);
  expect(Array.isArray(receiverSource)).toBe(true);
  expect(receiverSource[0].length).toBeGreaterThan(0);
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
    } = dlopen(dlopenFixturePath, types);
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
      const buffer = toBuffer(cptr, 0, 4);
      expect(buffer.readInt32(0)).toBe(42);
      expect(new DataView(toArrayBuffer(cptr, 0, 4), 0, 4).getInt32(0, true)).toBe(42);
      expect(ptr(buffer)).toBe(cptr);
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

    it("toBuffer/toArrayBuffer run the finalizer exactly once on GC", () => {
      // Exercises the finalizer path (create_buffer_with_ctx with a real
      // deallocator) end to end: the C deallocator must fire exactly once when
      // the view is collected. getDeallocatorCallback()/Buffer() reset the counter.
      for (const wrap of [toBuffer, toArrayBuffer]) {
        const cb = getDeallocatorCallback();
        let view = wrap(getDeallocatorBuffer(), 0, 8, cb); // 4th arg alone = deallocator
        expect(view.byteLength).toBe(8);
        view = null;
        // Drive GC (not time) until the finalizer runs, bounded.
        for (let i = 0; i < 30 && getDeallocatorCalledCount() === 0; i++) Bun.gc(true);
        expect(getDeallocatorCalledCount()).toBe(1);
      }
    });

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

    // Threadsafe callbacks are invoked from a foreign thread; they are skipped
    // on Windows (matching cc.test.ts's "threadsafe JSCallback invoked from a
    // foreign thread"). Await the actual invocation via a promise instead of the
    // previous `await 1`, which returned before the callback fired — leaving the
    // in-callback assertion to run after the test as an "unhandled error".
    describe.skipIf(isWindows)("threadsafe callback", () => {
      // 1 arg, threadsafe
      for (let [name, value] of Object.entries(typeMap)) {
        it("fn(" + name + ") " + name, async () => {
          const { promise, resolve, reject } = Promise.withResolvers();
          const cb = new JSCallback(
            arg1 => {
              try {
                expect(arg1).toBe(value);
                resolve();
              } catch (e) {
                reject(e);
              }
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
          await promise;
          cb.close();
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

if (ok) {
  describe("run ffi", () => {
    ffiRunner(false);
    ffiRunner(true);
  });
} else {
  it.skip("run ffi", () => {});
}

it("dlopen throws an error instead of returning it", () => {
  let err;
  try {
    dlopen("nonexistent", { x: {} });
  } catch (error) {
    err = error;
  }
  expect(err).toBeTruthy();
});

// TinyCC, which implements JSCallback and CFunction, is unavailable on Windows ARM64.
const isFFIUnavailable = isWindows && isArm64;

// The INT64/UINT64_TO_JSVALUE return encoding (#7007 / #33340) through dlopen,
// which — unlike the cc() variants in cc.test.ts — runs under ASan.
describe.skipIf(!ok || isFFIUnavailable)("numeric-boundary returns encode consistently", () => {
  it("u64_fast and i64_fast agree at the int32 and MAX_SAFE_INTEGER boundaries", () => {
    const { symbols, close } = dlopen(dlopenFixturePath, {
      ffi_bound_i64_2p31: { args: [], returns: "i64_fast" },
      ffi_bound_u64_2p31: { args: [], returns: "u64_fast" },
      ffi_bound_u64_int32_max: { args: [], returns: "u64_fast" },
      ffi_bound_i64_max_safe: { args: [], returns: "i64_fast" },
      ffi_bound_u64_max_safe: { args: [], returns: "u64_fast" },
      ffi_bound_u64_2p53: { args: [], returns: "u64_fast" },
    });
    try {
      // 2^31 must reach JS as the Number 2147483648, not a wrapped -2147483648.
      expect(symbols.ffi_bound_i64_2p31()).toBe(2147483648);
      expect(symbols.ffi_bound_u64_2p31()).toBe(2147483648);
      expect(symbols.ffi_bound_u64_int32_max()).toBe(2147483647);
      // Exactly MAX_SAFE_INTEGER stays a Number for both signednesses (u64_fast
      // used a strict `<` and returned a BigInt here while i64_fast did not).
      expect(symbols.ffi_bound_i64_max_safe()).toBe(9007199254740991);
      expect(symbols.ffi_bound_u64_max_safe()).toBe(9007199254740991);
      // Above MAX_SAFE_INTEGER becomes a BigInt.
      expect(symbols.ffi_bound_u64_2p53()).toBe(9007199254740992n);
    } finally {
      close();
    }
  });
});

// Windows: dlopen must accept paths with non-ASCII characters. Previously the
// path was handed to LoadLibraryA as UTF-8, which the OS decodes as the system
// ANSI codepage, so any non-ASCII byte mangled the path.
it.skipIf(!isWindows || isFFIUnavailable)("dlopen accepts non-ASCII library paths on Windows", async () => {
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

describe.skipIf(isFFIUnavailable)("JSCallback validation", () => {
  // The native code rejected this earlier, but the constructor previously
  // destructured the error instance and silently assigned `ptr = undefined`.
  // Now the constructor throws on Error.isError(result).
  it("throws (does not silently succeed) on an unknown arg type", () => {
    expect(
      () =>
        new JSCallback(() => {}, {
          returns: "void",
          args: ["NOT_A_REAL_TYPE"],
        }),
    ).toThrow(/Unknown type NOT_A_REAL_TYPE/);
  });

  // buffer/napi_env args can't be reconstructed for a JS callback; they used to
  // generate invalid C, fail to compile, AND leak the FFICallbackFunctionWrapper
  // (+ its GC roots). Now rejected up front with a clear message.
  it("rejects buffer/napi_env as callback argument types", () => {
    for (const bad of ["buffer", "napi_env"]) {
      expect(() => new JSCallback(() => {}, { returns: "void", args: [bad] })).toThrow(/not a supported argument type/);
    }
  });

  // The scopeguard in compile_callback must free the FFICallbackFunctionWrapper
  // (a Strong<JSFunction> + Strong<GlobalObject> realm root) when compilation
  // fails after the wrapper is created. `args:["void"]` is NOT rejected early, so
  // it reaches compile_callback and fails to compile (`void arg0` is invalid C),
  // exercising the free-on-failure path — the ASAN leak checker catches a regression.
  it("does not leak the callback wrapper when compilation fails", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { JSCallback } = require("bun:ffi");
        for (let i = 0; i < 500; i++) {
          try { new JSCallback(() => {}, { returns: "void", args: ["void"] }); } catch {}
        }
        Bun.gc(true);
        process.stdout.write("OK");`,
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

  // The threadsafe-vs-non-void-return guard in the native helper used to read
  // a freshly-defaulted `function.threadsafe` (which was always false), making
  // the check dead code. Combined with the constructor swallowing errors,
  // this previously returned a half-baked callback whose return type was
  // ABI-incompatible with the threadsafe trampoline.
  it("throws on a threadsafe callback that declares a non-void return type", () => {
    expect(
      () =>
        new JSCallback(() => 42, {
          threadsafe: true,
          returns: "int32_t",
          args: [],
        }),
    ).toThrow(/[Tt]hreadsafe.+void/);
  });

  it("accepts a valid void-return threadsafe callback", () => {
    const cb = new JSCallback(() => {}, {
      threadsafe: true,
      returns: "void",
      args: ["int32_t"],
    });
    expect(typeof cb.ptr === "number" || typeof cb.ptr === "bigint").toBe(true);
    expect(cb.threadsafe).toBe(true);
    cb.close();
  });
});

describe("read.* rejects invalid byteOffset", () => {
  // `addr_from_args` used `usize::try_from(...).expect("int cast")`, which
  // panics the process on any negative offset. The fix returns a JS error.
  it("throws on a negative byteOffset (does not crash the process)", () => {
    const buf = new Uint8Array(64);
    for (let i = 0; i < buf.length; i++) buf[i] = i;
    const addr = ptr(buf);

    for (const fn of [
      read.u8,
      read.u16,
      read.u32,
      read.i8,
      read.i16,
      read.i32,
      read.u64,
      read.i64,
      read.f32,
      read.f64,
      read.ptr,
      read.intptr,
    ]) {
      expect(() => fn(addr, -1)).toThrow();
    }
  });

  it("still works for a valid non-negative byteOffset", () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    const addr = ptr(buf);
    expect(read.u8(addr, 0)).toBe(1);
    expect(read.u8(addr, 3)).toBe(4);
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

// ptr()/toArrayBuffer()/toBuffer()/new CString() with a byteOffset of -Infinity
// or exactly -(2**63) used to negate i64::MIN (integer-overflow panic → process
// abort — a one-line DoS from public API). Run in a subprocess: a hard abort is
// observable as a non-zero exit / signal, not just an exception.
it.skipIf(isFFIUnavailable)("byteOffset edge values never crash the process", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { ptr, toArrayBuffer, toBuffer, CString } = require("bun:ffi");
      const a = new Uint8Array(8);
      const p = ptr(a);
      for (const off of [-Infinity, -(2 ** 63), NaN, -1e300, 2 ** 63, Infinity]) {
        for (const f of [() => ptr(a, off), () => toArrayBuffer(p, off, 4), () => toBuffer(p, off, 4), () => new CString(p, off)]) {
          try { f(); } catch {}
        }
      }
      process.stdout.write("OK");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode, signalCode: proc.signalCode }).toMatchObject({
    stdout: "OK",
    exitCode: 0,
    signalCode: null,
  });
});

describe.skipIf(isFFIUnavailable)("toBuffer is a non-owning view (regression)", () => {
  it("returns a zero-copy view aliasing the source memory", () => {
    const src = new Uint8Array(16);
    src.fill(0xab);
    const buf = toBuffer(ptr(src), 0, 16);
    expect(buf[0]).toBe(0xab);
    src[1] = 0x11;
    expect(buf[1]).toBe(0x11);
    buf[2] = 0x22;
    expect(src[2]).toBe(0x22);
  });

  // toBuffer(ptr) with no finalizer used to install a deallocator that mi_free'd
  // the (foreign / interior) pointer on GC — a double free of the source
  // TypedArray's backing store.
  it("does not free foreign memory on GC (no invalid mi_free)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { toBuffer, ptr } = require("bun:ffi");
        for (let i = 0; i < 500; i++) {
          const a = new Uint8Array(64); a.fill(i & 0xff);
          const b = toBuffer(ptr(a), 0, 64);
          if (b[0] !== (i & 0xff)) throw new Error("view mismatch");
          if ((i % 50) === 0) Bun.gc(true);
        }
        Bun.gc(true);
        process.stdout.write("OK");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      stdout,
      invalidFree: stderr.includes("mi_free: invalid pointer"),
      exitCode,
      signalCode: proc.signalCode,
    }).toEqual({
      stdout: "OK",
      invalidFree: false,
      exitCode: 0,
      signalCode: null,
    });
  });
});

describe.skipIf(isFFIUnavailable)("read.* / toArrayBuffer reject bad size args gracefully", () => {
  // A non-number byteOffset used to reach JSC__JSValue__toInt64 (ASSERT abort in
  // debug / UB in release); a byteLength past the u32 ArrayBuffer max used to
  // panic in ArrayBuffer::from_bytes. Both must error, never crash the process.
  it("does not crash on a non-number read.* byteOffset or an oversized byteLength", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { read, toArrayBuffer, toBuffer, ptr } = require("bun:ffi");
        const p = ptr(new Uint8Array(8));
        for (const bad of [{}, "x", true, -1, -1e300]) { try { read.u8(p, bad); } catch {} }
        for (const f of [() => toArrayBuffer(p, 0, 2 ** 33), () => toBuffer(p, 0, 2 ** 33)]) { try { f(); } catch {} }
        process.stdout.write("OK");`,
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
});

// Runs in a subprocess: `bun test`'s exit path does not finalize the CFunction's native handle,
// which the ASan lane's leak checker then reports against this file.
it.skipIf(isFFIUnavailable)("JSCallback exceptions propagate out of the native call", async () => {
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
  // Don't require stderr to be exactly "" — ASAN/debug builds emit benign
  // warnings. Assert stdout + exitCode precisely; stderr stays in the object
  // only so it shows up on failure.
  expect({ stdout, stderr, exitCode }).toMatchObject({
    stdout: "caught boom\n",
    exitCode: 0,
  });
});

// worker.terminate() delivered inside a threadsafe JSCallback used to trip
// "ASSERTION FAILED: !isTerminationException(exception) || hasTerminationRequest()"
// in JSC::VM::setException on the worker thread and re-enter the terminated VM.
it.skipIf(isFFIUnavailable)("JSCallback tolerates worker.terminate() arriving inside the callback", async () => {
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
  // stdout/exitCode/signalCode are the contract; stderr stays for diagnostics
  // only (ASAN/debug builds emit benign warnings, so don't require it to be "").
  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toMatchObject({
    stdout: "done\n",
    exitCode: 0,
    signalCode: null,
  });
});

// Select the system libc by arch so the large-symbol-count test also runs on
// aarch64 Linux (it previously hardcoded the x86_64 glibc path and skipped
// everywhere else).
const libcCandidate = process.arch === "arm64" ? "/lib/aarch64-linux-gnu/libc.so.6" : "/lib/x86_64-linux-gnu/libc.so.6";
const libPath =
  platform() === "darwin"
    ? "/usr/lib/libSystem.B.dylib"
    : existsSync(libcCandidate) && isGlibcVersionAtLeast("2.36.0")
      ? libcCandidate
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
