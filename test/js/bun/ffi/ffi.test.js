import { afterAll, describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import {
  CFunction,
  CString,
  dlopen as _dlopen,
  JSCallback,
  ptr,
  read,
  toArrayBuffer,
  toBuffer,
  viewSource,
} from "bun:ffi";

const dlopen = (...args) => {
  try {
    return _dlopen(...args);
  } catch (err) {
    console.error("To enable this test, run `make compile-ffi-test`.");
    throw err;
  }
};
const ok = existsSync("/tmp/bun-ffi-test.dylib");

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
    } = dlopen("/tmp/bun-ffi-test.dylib", types);
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

    afterAll(() => {
      close();
    });
  });
}

it("read", () => {
  const buffer = new BigInt64Array(16);
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
