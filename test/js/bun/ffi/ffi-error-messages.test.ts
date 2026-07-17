import { dlopen, JSCallback, linkSymbols } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { isArm64, isMusl, isWindows } from "harness";

// TinyCC (and all of bun:ffi) is disabled on Windows ARM64
const isFFIUnavailable = isWindows && isArm64;

describe.skipIf(isFFIUnavailable)("FFI error messages", () => {
  test("dlopen shows library name when library cannot be opened", () => {
    // Try to open a non-existent library
    try {
      dlopen("libnonexistent12345.so", {
        test: {
          args: [],
          returns: "int",
        },
      });
      expect.unreachable("Should have thrown an error");
    } catch (err: any) {
      // Error message should include the library name
      expect(err.message).toContain("libnonexistent12345.so");
      expect(err.message).toMatch(/Failed to open library/i);
    }
  });

  test("dlopen shows which symbol is missing when symbol not found", () => {
    // Use appropriate system library for the platform
    const libName =
      process.platform === "win32"
        ? "kernel32.dll" // Windows system library
        : process.platform === "darwin"
          ? "libSystem.B.dylib" // macOS system library
          : isMusl
            ? process.arch === "arm64"
              ? "libc.musl-aarch64.so.1" // ARM64 musl
              : "libc.musl-x86_64.so.1" // x86_64 musl
            : "libc.so.6"; // glibc

    // Try to load a non-existent symbol
    try {
      dlopen(libName, {
        this_symbol_definitely_does_not_exist_in_the_system_library: {
          args: [],
          returns: "int",
        },
      });
      expect.unreachable("Should have thrown an error");
    } catch (err: any) {
      // Error message should include the symbol name
      expect(err.message).toMatch(/this_symbol_definitely_does_not_exist_in_the_system_library/);
      // Error message should include some reference to the library or symbol not found
      expect(err.message).toMatch(/Symbol.*not found|symbol.*not found/i);
    }
  });

  test("linkSymbols shows helpful error when ptr is missing", () => {
    // Try to use linkSymbols without providing a valid ptr
    expect(() => {
      linkSymbols({
        myFunction: {
          args: [],
          returns: "int",
          // Missing 'ptr' field - this should give a helpful error
        },
      });
    }).toThrow(/myFunction.*ptr.*(linkSymbols|CFunction)/);
  });

  test("linkSymbols with non-object property values throws TypeError", () => {
    expect(() => {
      linkSymbols({ foo: 42 });
    }).toThrow("Expected an object");

    expect(() => {
      linkSymbols({ a: "hello", b: 123, c: true });
    }).toThrow("Expected an object");
  });

  test("linkSymbols with non-number ptr does not crash", () => {
    expect(() => {
      linkSymbols({
        fn: {
          // @ts-expect-error
          ptr: "not a number",
        },
      });
    }).toThrow('you must provide a "ptr" field with the memory address of the native function.');
  });

  describe("JSCallback", () => {
    // A threadsafe callback is dispatched to the JS thread asynchronously, so
    // it has no return-value channel: the trampoline would otherwise hand the
    // native caller an uninitialized EncodedJSValue.
    test.each(["u64", "int", "i64", "bool", "f64", "ptr", "cstring"] as const)(
      "threadsafe: true with returns: %s throws at construction",
      returns => {
        expect(() => {
          new JSCallback(() => 0, { args: ["i64"], returns, threadsafe: true });
        }).toThrow("Threadsafe functions must return void");
      },
    );

    test("threadsafe: true with an omitted return type still constructs", () => {
      using cb = new JSCallback(() => {}, { args: ["i64"], threadsafe: true });
      expect(cb.ptr).toBeGreaterThan(0);
    });

    test("threadsafe: true with returns: 'void' still constructs", () => {
      using cb = new JSCallback(() => {}, { args: ["i64"], returns: "void", threadsafe: true });
      expect(cb.ptr).toBeGreaterThan(0);
    });

    test("non-threadsafe callbacks may still return non-void", () => {
      using cb = new JSCallback(x => x, { args: ["u64"], returns: "u64" });
      expect(cb.ptr).toBeGreaterThan(0);
    });

    // JSCallback must throw native validation errors, like dlopen/cc/linkSymbols.
    test.each([
      ["returns: buffer", { returns: "buffer" }, "Cannot return a buffer to JavaScript"],
      ["returns: napi_env", { returns: "napi_env" }, "Cannot return napi_env to JavaScript"],
      ["unknown arg type", { args: ["not_a_real_type"] }, "Unknown type not_a_real_type"],
      ["unknown return type", { returns: "not_a_real_type" }, "Unknown return type not_a_real_type"],
    ])("%s throws at construction", (_name, options, message) => {
      expect(() => {
        new JSCallback(() => {}, options as any);
      }).toThrow(message);
    });
  });
});
