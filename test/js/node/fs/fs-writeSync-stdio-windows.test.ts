// Regression: on Windows, `FD.fromJSValidated(0|1|2)` used to return the
// stdio HANDLE cached at process startup, forcing `sys_uv` to map that
// `.system` FD back to libuv fd 0/1/2 via `FD.uv()`. `FD.uv()` compared the
// handle against the *live* `GetStdHandle()` result, so a user-space
// `SetStdHandle` (or `AllocConsole`/`AttachConsole`) made the round-trip fail
// and `fs.writeSync(1, ...)` panicked with:
//   "Cast bun.FD.uv(N[handle]) makes closing impossible!"
// Now `fromJS`/`fromJSValidated` return `.fromUV(0|1|2)` directly, and
// `FD.uv()` checks the cached stdio handles before `GetStdHandle`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

describe.concurrent.skipIf(!isWindows)("fs.writeSync on Windows stdio/handles", () => {
  test("fs.writeSync(1, ...) does not panic after SetStdHandle swaps stdout", async () => {
    const fixture = `
      const fs = require("node:fs");
      const { dlopen } = require("bun:ffi");

      const k32 = dlopen("kernel32.dll", {
        SetStdHandle: { args: ["u32", "ptr"], returns: "i32" },
        GetStdHandle: { args: ["u32"], returns: "ptr" },
        CreateFileW: {
          args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"],
          returns: "ptr",
        },
      });

      const STD_OUTPUT_HANDLE = 0xfffffff5; // (DWORD)-11
      const GENERIC_WRITE = 0x40000000;
      const FILE_SHARE_READ = 0x00000001;
      const FILE_SHARE_WRITE = 0x00000002;
      const OPEN_EXISTING = 3;

      // Open NUL so we have a real HANDLE distinct from the original stdout.
      const nulPath = Buffer.from("NUL\\0", "utf16le");
      const nul = k32.symbols.CreateFileW(
        nulPath,
        GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        null,
        OPEN_EXISTING,
        0,
        null,
      );
      if (nul === null) {
        throw new Error("CreateFileW(NUL) failed");
      }

      const original = k32.symbols.GetStdHandle(STD_OUTPUT_HANDLE);
      if (k32.symbols.SetStdHandle(STD_OUTPUT_HANDLE, nul) === 0) {
        throw new Error("SetStdHandle failed");
      }
      if (k32.symbols.GetStdHandle(STD_OUTPUT_HANDLE) === original) {
        throw new Error("GetStdHandle did not change after SetStdHandle");
      }

      // Before the fix this panics: the cached stdout HANDLE no longer equals
      // the live GetStdHandle(STD_OUTPUT_HANDLE), so FD.uv() falls through to
      // the "makes closing impossible" panic.
      const n = fs.writeSync(1, "after-setstdhandle\\n");

      // fs.writeSync(1, ...) maps to libuv fd 1, which is the C runtime's
      // original stdout — SetStdHandle does not rewire CRT fds — so the write
      // should land on the parent-observed stdout.
      k32.symbols.SetStdHandle(STD_OUTPUT_HANDLE, original);
      process.stderr.write("wrote=" + n + "\\n");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("wrote=19\n");
    expect(stdout).toBe("after-setstdhandle\n");
    expect(exitCode).toBe(0);
  });

  test("fs.writeSync on an fd from fs.openSync works", async () => {
    using dir = tempDir("fs-writeSync-stdio-windows", {});
    const out = join(String(dir), "out.txt").replaceAll("\\", "/");

    const fixture = `
      const fs = require("node:fs");
      const fd = fs.openSync(${JSON.stringify(out)}, "w");
      const n = fs.writeSync(fd, "hello from writeSync");
      fs.closeSync(fd);
      process.stdout.write("wrote=" + n + " body=" + fs.readFileSync(${JSON.stringify(out)}, "utf8"));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("wrote=20 body=hello from writeSync");
    expect(exitCode).toBe(0);
  });
});
