import { dlopen, FFIType, ptr } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

// `CreateProcessW` with `bInheritHandles` copies every inheritable handle of the parent into the child, unless the
// parent lists the handles to pass on with PROC_THREAD_ATTRIBUTE_HANDLE_LIST. libuv's `uv_spawn` gave no list, so a
// child got every inheritable handle that was open at that moment: the stdio pipes of a child that another thread
// spawned at the same time, or a handle a native addon made inheritable. That child then held those pipes open until
// it exited, and the reader of the other child saw EOF only then.
//
// The fixture reports the path behind a handle value. Its stdin is a file the parent passes on purpose, so the same
// check on stdin proves that the check works.
describe.skipIf(!isWindows)("Bun.spawn on Windows", () => {
  test("the child inherits only the handles it is given", async () => {
    const kernel32 = dlopen("kernel32.dll", {
      CreateFileW: {
        args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
        returns: FFIType.u64,
      },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    });

    using dir = tempDir("spawn-inherit-only-stdio", {
      "stdin.txt": "",
      "extra.txt": "",
    });

    // An inheritable handle that has nothing to do with the child, like one a native addon or another thread's
    // spawn holds open while this spawn runs.
    const inheritable = new DataView(new ArrayBuffer(24)); // SECURITY_ATTRIBUTES
    inheritable.setUint32(0, inheritable.byteLength, true); // nLength
    inheritable.setUint32(16, 1, true); // bInheritHandle
    const GENERIC_READ = 0x80000000;
    const FILE_SHARE_ALL = 0x1 | 0x2 | 0x4;
    const OPEN_EXISTING = 3;
    const FILE_ATTRIBUTE_NORMAL = 0x80;
    const extraPath = Buffer.from(join(String(dir), "extra.txt") + "\0", "utf16le");
    const extra = kernel32.symbols.CreateFileW(
      ptr(extraPath),
      GENERIC_READ,
      FILE_SHARE_ALL,
      ptr(new Uint8Array(inheritable.buffer)),
      OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL,
      null,
    );
    expect(BigInt(extra)).not.toBe(0xffffffffffffffffn); // INVALID_HANDLE_VALUE

    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, "spawn-windows-inherit-only-stdio-fixture.ts"), String(extra)],
        env: bunEnv,
        stdin: Bun.file(join(String(dir), "stdin.txt")),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const [stdinLine, extraLine] = stdout
        .trim()
        .split("\n")
        .map(line => line.toLowerCase());
      expect(stdinLine).toEndWith("\\stdin.txt");
      // The handle value may be in use for something else in the child. It must not be our file.
      expect(extraLine).toStartWith("extra: ");
      expect(extraLine).not.toEndWith("\\extra.txt");
      expect(exitCode).toBe(0);
    } finally {
      kernel32.symbols.CloseHandle(extra);
    }
  });
});
