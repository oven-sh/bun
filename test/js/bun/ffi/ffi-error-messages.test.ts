import { dlopen, linkSymbols } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { isMusl } from "harness";

describe("FFI error messages", () => {
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
});
