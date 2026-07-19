import { afterAll, describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isArm64, isGlibcVersionAtLeast, isMusl, isWindows, tempDir } from "harness";
import { platform } from "os";

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
    console.error("To enable this test, run `make compile-ffi-test`.");
    throw err;
  }
};
const ok = existsSync("/tmp/bun-ffi-test." + suffix);

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

it('suffix does not start with a "."', () => {
  expect(suffix).not.toMatch(/^\./);
});

it(".ptr is not leaked", () => {
  for (let fn of [Bun.password.hash, Bun.password.verify, it]) {
    expect(fn).not.toHaveProperty("ptr");
    expect(fn.ptr).toBeUndefined();
  }
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
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "caught boom\n",
    stderr: "",
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
  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "done\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

// bun:ffi (TinyCC) is unavailable on Windows ARM64.
// Each case runs in a subprocess: the bug is a wild jump into freed TinyCC
// executable memory, which takes the whole process down.
describe.skipIf(isWindows && isArm64)("JSCallback.close() from inside the callback", () => {
  it.concurrent("does not free the trampoline under the native caller", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { CFunction, JSCallback } from "bun:ffi";
         let cb;
         cb = new JSCallback(() => { cb.close(); return 7; }, { args: [], returns: "i32" });
         const call = new CFunction({ ptr: cb.ptr, args: [], returns: "i32" });
         console.log("result", call());
         console.log("closed", cb.ptr);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stderr is drained but not asserted: ASAN/debug builds emit benign warnings.
    expect({ stdout, exitCode }).toEqual({ stdout: "result 7\nclosed null\n", exitCode: 0 });
  });

  // qsort keeps invoking the comparator after the callback closes itself, so
  // this also covers re-entry into the trampoline after close(). musl has no
  // libc.so.6 soname and Windows has no qsort in a predictable DLL, so skip.
  it.concurrent.skipIf(isWindows || isMusl)(
    "keeps working for the rest of the native call that triggered it",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import { dlopen, ptr, read, JSCallback } from "bun:ffi";
           const name = process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6";
           const libc = dlopen(name, { qsort: { args: ["ptr", "u64", "u64", "function"], returns: "void" } });
           let n = 0;
           let cb;
           cb = new JSCallback(
             (a, b) => {
               if (++n === 1) cb.close();
               return read.i32(a, 0) - read.i32(b, 0);
             },
             { args: ["ptr", "ptr"], returns: "i32" },
           );
           const arr = new Int32Array([5, 3, 9, 1, 7, 2, 8, 4, 6, 0]);
           libc.symbols.qsort(ptr(arr), arr.length, 4, cb.ptr);
           console.log(Array.from(arr).join(","), n > 1);`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, exitCode }).toEqual({ stdout: "0,1,2,3,4,5,6,7,8,9 true\n", exitCode: 0 });
    },
  );

  // drainMicrotasks() runs a full event-loop tick, so the deferred drop must
  // not be in the task queue while the trampoline is still on the stack.
  it.concurrent("survives a nested event-loop tick from inside the callback", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { drainMicrotasks } from "bun:jsc";
         import { CFunction, JSCallback } from "bun:ffi";
         let cb;
         cb = new JSCallback(() => { cb.close(); drainMicrotasks(); return 7; }, { args: [], returns: "i32" });
         const call = new CFunction({ ptr: cb.ptr, args: [], returns: "i32" });
         console.log("result", call());
         console.log("closed", cb.ptr);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "result 7\nclosed null\n", exitCode: 0 });
  });

  // Once the drop has been scheduled (after the first invocation unwound), a
  // nested tick from a LATER invocation of the same callback must not run it.
  it.concurrent.skipIf(isWindows || isMusl)("survives a nested event-loop tick from a later invocation", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { drainMicrotasks } from "bun:jsc";
           import { dlopen, ptr, read, JSCallback } from "bun:ffi";
           const name = process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6";
           const libc = dlopen(name, { qsort: { args: ["ptr", "u64", "u64", "function"], returns: "void" } });
           let n = 0;
           let cb;
           cb = new JSCallback(
             (a, b) => {
               n++;
               if (n === 1) cb.close();
               else drainMicrotasks();
               return read.i32(a, 0) - read.i32(b, 0);
             },
             { args: ["ptr", "ptr"], returns: "i32" },
           );
           const arr = new Int32Array([5, 3, 9, 1, 7, 2, 8, 4, 6, 0]);
           libc.symbols.qsort(ptr(arr), arr.length, 4, cb.ptr);
           console.log(Array.from(arr).join(","), n > 1);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "0,1,2,3,4,5,6,7,8,9 true\n", exitCode: 0 });
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
