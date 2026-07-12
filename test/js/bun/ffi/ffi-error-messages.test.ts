import { dlopen, linkSymbols } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isMusl, isWindows } from "harness";

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

  // A per-symbol wrapper that fails to compile (args:["void"] generates `void arg0`,
  // invalid C) lands in Step::Failed{msg}. The error message used to borrow that heap
  // `msg`, freed with its Function before JS reads `.message`, so cc()/dlopen()/
  // linkSymbols() returned freed/poisoned bytes (or abort under ASAN). Spawned so an
  // ASAN abort is contained; a fresh subprocess is required because the read is a UAF.
  test("cc/dlopen/linkSymbols compile-failure messages are not use-after-free garbage", async () => {
    const libName =
      process.platform === "win32"
        ? "kernel32.dll"
        : process.platform === "darwin"
          ? "libSystem.B.dylib"
          : isMusl
            ? process.arch === "arm64"
              ? "libc.musl-aarch64.so.1"
              : "libc.musl-x86_64.so.1"
            : "libc.so.6";
    const symName = process.platform === "win32" ? "GetCurrentProcessId" : "getpid";
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const ffi = require("bun:ffi");
        const os = require("node:os");
        const { writeFileSync } = require("node:fs");
        const ascii = s => typeof s === "string" && s.length > 0 && /^[\\x20-\\x7e\\s]*$/.test(s);
        const out = {};
        const run = (k, fn) => { try { fn(); out[k] = "NO_THROW"; } catch (e) { out[k] = ascii(e && e.message) ? "OK" : "GARBAGE"; } };
        const src = os.tmpdir() + "/bun-ffi-msg-" + process.pid + ".c";
        writeFileSync(src, "void present(void){}");
        run("cc", () => ffi.cc({ source: src, symbols: { present: { returns: "void", args: ["void"] } } }));
        run("link", () => ffi.linkSymbols({ fn: { ptr: 0x1234, returns: "void", args: ["void"] } }));
        run("dlopen", () => ffi.dlopen(${JSON.stringify(libName)}, { ${JSON.stringify(symName)}: { returns: "void", args: ["void"] } }));
        process.stdout.write(JSON.stringify(out));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let out: Record<string, string> = {};
    try {
      out = JSON.parse(stdout);
    } catch {}
    expect({ out, exitCode, signalCode: proc.signalCode }).toMatchObject({
      out: { cc: "OK", link: "OK", dlopen: "OK" },
      exitCode: 0,
      signalCode: null,
    });
  });
});
