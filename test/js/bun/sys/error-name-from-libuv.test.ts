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

// Runs `Output.err(sys_error, "sysErrorOutputErr", ())` in a child bun and
// returns the stderr line it printed.
async function outputErr(errno: number, fromLibuv: boolean): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `require("bun:internal-for-testing").sysErrorOutputErr(${errno}, ${fromLibuv})`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
  return stderr;
}

test.concurrent("Output.err prints the errno label before the message", async () => {
  expect(await outputErr(2, false)).toBe("ENOENT: No such file or directory: sysErrorOutputErr (open)\n");
});

// The label lookup must use the translated errno. With from_libuv=true the
// stored errno is the negated UV code, which names `UV_ENOENT` in the
// SystemErrno table, and that has no coreutils label.
test.concurrent.skipIf(!isWindows)("Output.err prints the errno label for a from_libuv error", async () => {
  expect(await outputErr(4058, true)).toBe("ENOENT: No such file or directory: sysErrorOutputErr (open)\n"); // -UV_ENOENT
  expect(await outputErr(4092, true)).toBe("EACCES: Permission denied: sysErrorOutputErr (open)\n"); // -UV_EACCES
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
