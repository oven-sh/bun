import { CString, dlopen, linkSymbols, ptr, toArrayBuffer, toBuffer } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { isMusl } from "harness";

// Not `toThrow()`: it also accepts an Error that the function returns, which is
// what `ptr()`, `toBuffer()` and `toArrayBuffer()` did with their TypeError
// before they threw it.
function thrownBy(fn: () => unknown): any {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe.each([
  ["toBuffer", toBuffer],
  ["toArrayBuffer", toArrayBuffer],
] as const)("%s argument errors", (name, view) => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const address = ptr(bytes);
  const asArray = (result: Buffer | ArrayBuffer) => Array.from(new Uint8Array(result));

  test.each([
    ["a string ptr", () => view("x" as any), "ptr must be a number."],
    ["a negative ptr", () => view(-1 as any), "ptr must be a number."],
    ["a zero ptr", () => view(0 as any), "ptr cannot be zero, that would segfault Bun :("],
    ["a BigInt ptr past usize", () => view((2n ** 64n) as any), "ptr is out of range."],
    ["a sentinel ptr", () => view(0xdeadbeef as any), "ptr to invalid memory, that would segfault Bun :("],
    ["a string byteOffset", () => view(address, "garbage" as any, 8), "Expected number for byteOffset"],
    ["an object byteOffset", () => view(address, {} as any, 8), "Expected number for byteOffset"],
    ["an infinite byteOffset", () => view(address, Infinity, 8), "ptr must be a finite number."],
    ["a string byteLength", () => view(address, 0, "x" as any), "length must be a number."],
    ["a zero byteLength", () => view(address, 0, 0), "length must be > 0. This usually means a bug in your code."],
    ["a negative byteLength", () => view(address, 0, -1), "length must be > 0. This usually means a bug in your code."],
    ["a NaN byteLength", () => view(address, 0, NaN), "length must be > 0. This usually means a bug in your code."],
    [
      "a byteLength that truncates to zero",
      () => view(address, 0, 0.5),
      "length must be > 0. This usually means a bug in your code.",
    ],
    [
      "a string finalization callback",
      () => (view as any)(address, 0, 8, "x"),
      "Expected callback to be a C pointer (number or BigInt)",
    ],
    [
      "a string finalization callback after user data",
      () => (view as any)(address, 0, 8, 1, "x"),
      "Expected callback to be a C pointer (number or BigInt)",
    ],
    [
      "string user data",
      () => (view as any)(address, 0, 8, "x", 1),
      "Expected user data to be a C pointer (number or BigInt)",
    ],
  ])(`${name} throws a TypeError for %s`, (_, call, message) => {
    const err = thrownBy(call);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(err.message).toBe(message);
  });

  test(`${name} accepts an undefined or null byteOffset`, () => {
    // `bytes` stays referenced here so its storage outlives every test above.
    expect(asArray(view(address, undefined, 8))).toEqual(Array.from(bytes));
    expect(asArray(view(address, null as any, 8))).toEqual(Array.from(bytes));
    expect(asArray(view(address, 2, 4))).toEqual(Array.from(bytes.subarray(2, 6)));
  });
});

describe("CString argument errors", () => {
  test("CString throws a TypeError for a negative ptr", () => {
    const err = thrownBy(() => new CString(-1 as any));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(err.message).toBe("ptr must be a number.");
  });

  test("CString reads the bytes at ptr + byteOffset", () => {
    const bytes = new TextEncoder().encode("hello\0");
    expect(`${new CString(ptr(bytes), 1, 4)}`).toBe("ello");
    expect(`${new CString(ptr(bytes))}`).toBe("hello");
  });
});

describe("FFI error messages", () => {
  test.each([
    ["hello", "String"],
    [{}, "FinalObject"],
    [[1, 2, 3], "Array"],
    [() => {}, "JSFunction"],
    [10n, "HeapBigInt"],
    [new Date(0), "JSDate"],
  ])("ptr(%p) throws a TypeError that names the received type", (value, typeName) => {
    const err = thrownBy(() => ptr(value as any));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(err.message).toBe(`Expected ArrayBufferView but received ${typeName}`);
  });

  test("ptr() throws for an empty ArrayBufferView", () => {
    const err = thrownBy(() => ptr(new Uint8Array(0)));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe("ArrayBufferView must have a length > 0. A pointer to empty memory doesn't work");
  });

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
});
