import { dlopen, linkSymbols } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMusl } from "harness";

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

  // dlopen falls back to FileSystem::abs() when the direct open fails; abs()
  // writes into a thread-local buffer that was 4096 bytes on every platform.
  // A library path longer than that used to abort with
  //   panic: range end index 5003 out of range for slice of length 4095
  // instead of reporting the ordinary dlopen error. The "relative" row joins
  // against cwd, so the overflow point is roughly MAX_PATH_BYTES - cwd.len().
  test.concurrent.each([
    ["absolute", 5000],
    ["absolute", 100_000],
    ["relative", 4090],
    ["relative", 100_000],
  ] as const)("dlopen with a %s %d-byte library path reports an error instead of aborting", async (kind, len) => {
    const prefix = kind === "relative" ? "" : process.platform === "win32" ? "C:\\" : "/";
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { dlopen } = require("bun:ffi");` +
          `const name = ${JSON.stringify(prefix)} + Buffer.alloc(${len}, "a").toString() + ".so";` +
          `try { dlopen(name, { f: { args: [], returns: "void" } }); }` +
          `catch (e) { const m = String(e.message);` +
          `  console.log("CAUGHT", e.code || e.name, m.slice(0, 30), "|", m.slice(-25)); }`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({
      stdout: expect.stringMatching(/^CAUGHT ERR_DLOPEN_FAILED Failed to open library/),
      stderr: "",
    });
    // 100k exceeds every platform's MAX_PATH_BYTES: the fallback is skipped
    // and the reported reason is the ENAMETOOLONG from DynLib::open, not a
    // stale dlerror()/GetLastError() ("unknown error" / "error code 0").
    if (len === 100_000) expect(stdout).toContain("file name too long");
    expect(exitCode).toBe(0);
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
