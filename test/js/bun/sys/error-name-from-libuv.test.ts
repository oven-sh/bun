// Regression: bun.sys.Error.name() panicked on Windows when from_libuv=true.
// The errno field holds the *negated* libuv code (e.g. 4058 for UV_ENOENT) at
// the from_libuv=true call sites in node_fs.zig, but name() passed it to
// translateUVErrorToE without re-negating, so the function saw a positive
// value, fell to `else => @enumFromInt(-code)`, and the negative-to-u16 cast
// panicked. @setRuntimeSafety(false) in name() doesn't help because it doesn't
// propagate into the callee.

import { sysErrorNameFromLibuv } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Runs `Output.err(sys_error, "sysErrorOutputErr", ())` in a child bun. The
// line it prints is on stderr.
async function outputErr(errno: number, fromLibuv: boolean) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `require("bun:internal-for-testing").sysErrorOutputErr(${errno}, ${fromLibuv})`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("Output.err prints the errno label before the message", async () => {
  expect(await outputErr(2, false)).toEqual({
    stdout: "",
    stderr: "ENOENT: No such file or directory: sysErrorOutputErr (open)\n",
    exitCode: 0,
  });
});

// The label lookup must use the translated errno. With from_libuv=true the
// stored errno is the negated UV code, which names `UV_ENOENT` in the
// SystemErrno table, and that has no coreutils label.
test.concurrent.skipIf(!isWindows)("Output.err prints the errno label for a from_libuv error", async () => {
  // -UV_ENOENT
  expect(await outputErr(4058, true)).toEqual({
    stdout: "",
    stderr: "ENOENT: No such file or directory: sysErrorOutputErr (open)\n",
    exitCode: 0,
  });
  // -UV_EACCES
  expect(await outputErr(4092, true)).toEqual({
    stdout: "",
    stderr: "EACCES: Permission denied: sysErrorOutputErr (open)\n",
    exitCode: 0,
  });
});

test.skipIf(!isWindows)("Error.name() with from_libuv=true does not overflow", () => {
  // errno values as stored by node_fs.zig: @intCast(-rc) where rc is the
  // negative UV code.
  expect(sysErrorNameFromLibuv(4058)).toBe("ENOENT"); // -UV_ENOENT
  expect(sysErrorNameFromLibuv(4083)).toBe("EBADF"); // -UV_EBADF
  expect(sysErrorNameFromLibuv(4092)).toBe("EACCES"); // -UV_EACCES
  expect(sysErrorNameFromLibuv(4094)).toBe("EUNKNOWN"); // -UV_UNKNOWN
});

test.skipIf(isWindows)("sysErrorNameFromLibuv is a no-op off Windows", () => {
  expect(sysErrorNameFromLibuv(4058)).toBeUndefined();
});
