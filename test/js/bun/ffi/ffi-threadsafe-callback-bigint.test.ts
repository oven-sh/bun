import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import path from "node:path";

// TinyCC / bun:ffi are not available on Windows ARM64, and there is no
// system `cc` on Windows x64 in CI. The bug being covered — heap-allocating
// a JSBigInt off the JS thread without the JS lock — is platform-independent,
// so exercising it on POSIX is sufficient.
const canRun = !isWindows;

// A threadsafe JSCallback with int64_t / uint64_t arguments used to convert
// those arguments to JSBigInt inside the TCC-generated trampoline, *before*
// posting to the JS thread. When the callback was invoked from a real OS
// thread that meant calling JSBigInt::createFrom without holding the JS
// lock, corrupting the GC heap. The trampoline now marshals the raw 64-bit
// bits and FFI_Callback_threadsafe_call converts them on the JS thread.
test.skipIf(!canRun)(
  "threadsafe JSCallback with int64_t/uint64_t args invoked from a native thread",
  async () => {
    const srcDir = import.meta.dir;
    const libName = isMacOS ? "libtscbbigint.dylib" : "libtscbbigint.so";

    using dir = tempDir("ffi-threadsafe-cb-bigint", {});
    const outDir = String(dir);
    const libPath = path.join(outDir, libName);

    {
      const cmd = ["cc", "-shared", "-fPIC", "-o", libPath];
      if (!isMacOS) cmd.push("-pthread");
      cmd.push(path.join(srcDir, "threadsafe-callback-bigint.c"));
      await using cc = Bun.spawn({ cmd, stderr: "pipe", stdout: "pipe" });
      const [stderr, exitCode] = await Promise.all([cc.stderr.text(), cc.exited]);
      if (exitCode !== 0) {
        throw new Error("failed to compile threadsafe-callback-bigint.c: " + stderr);
      }
    }

    const fixture = /* js */ `
    const { dlopen, JSCallback } = require("bun:ffi");

    const lib = dlopen(${JSON.stringify(libPath)}, {
      call_i64_from_thread: { args: ["ptr", "int64_t", "int32_t"], returns: "void" },
      call_u64_from_thread: { args: ["ptr", "uint64_t", "int32_t"], returns: "void" },
      call_mixed_from_thread: { args: ["ptr", "int32_t"], returns: "void" },
    });

    const count = 50;
    const errors = [];

    const cases = [
      // [label, abiType, caller, value, expected]
      // Values outside the safe-integer range so the old trampoline would
      // have to allocate a JSBigInt on the calling (non-JS) thread.
      ["int64_t", "int64_t", "call_i64_from_thread", -9007199254740993n, -9007199254740993n],
      ["uint64_t", "uint64_t", "call_u64_from_thread", 18446744073709551615n, 18446744073709551615n],
      // i64_fast / u64_fast should return a number when the value fits in a
      // double, and a BigInt otherwise.
      ["i64_fast big", "i64_fast", "call_i64_from_thread", -9007199254740993n, -9007199254740993n],
      ["i64_fast small", "i64_fast", "call_i64_from_thread", 123n, 123],
      ["u64_fast big", "u64_fast", "call_u64_from_thread", 18446744073709551615n, 18446744073709551615n],
      ["u64_fast small", "u64_fast", "call_u64_from_thread", 123n, 123],
    ];

    for (const [label, abiType, caller, value, expected] of cases) {
      let received = 0;
      const cb = new JSCallback(
        (v) => {
          if (v !== expected) {
            errors.push(label + ": got " + String(v) + " (" + typeof v + "), expected " + String(expected) + " (" + typeof expected + ")");
          }
          received++;
        },
        { args: [abiType], returns: "void", threadsafe: true },
      );

      lib.symbols[caller](cb.ptr, value, count);

      while (received < count) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      cb.close();
    }

    // Mixed args: verify non-64-bit args are still decoded as normal JSValues
    // alongside deferred 64-bit conversions.
    {
      let received = 0;
      const cb = new JSCallback(
        (a, b, c, d) => {
          if (a !== 42) errors.push("mixed a: " + String(a));
          if (b !== -9007199254740993n) errors.push("mixed b: " + String(b));
          if (c !== 18446744073709551615n) errors.push("mixed c: " + String(c));
          if (d !== 3.5) errors.push("mixed d: " + String(d));
          received++;
        },
        { args: ["int32_t", "int64_t", "uint64_t", "double"], returns: "void", threadsafe: true },
      );
      lib.symbols.call_mixed_from_thread(cb.ptr, count);
      while (received < count) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      cb.close();
    }

    // Force a full GC so a corrupted MarkedBlock free list (from off-thread
    // JSBigInt allocation) is detected before the process exits cleanly.
    Bun.gc(true);

    lib.close();

    if (errors.length > 0) {
      console.error(errors.slice(0, 10).join("\\n"));
      process.exit(1);
    }

    console.log("OK");
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  },
  30_000,
);
