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
// returns what it printed. The stderr line is the interesting part, so the
// caller asserts all three fields together.
async function outputErr(errno: number, fromLibuv: boolean) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `require("bun:internal-for-testing").sysErrorOutputErr(${errno}, ${fromLibuv})`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stderr, stdout, exitCode };
}

test.concurrent("Output.err prints the errno label before the message", async () => {
  expect(await outputErr(2, false)).toEqual({
    stderr: "ENOENT: No such file or directory: sysErrorOutputErr (open)\n",
    stdout: "",
    exitCode: 0,
  });
});

// An errno outside the SystemErrno table (524 is Linux ENOTSUPP, which some
// drivers and FUSE filesystems return) has no code name. The generic `error:`
// form is used, and the number stays so it can be looked up.
test.concurrent("Output.err prints the generic form and the number for an errno outside the table", async () => {
  expect(await outputErr(524, false)).toEqual({
    stderr: "error: sysErrorOutputErr (open, errno 524)\n",
    stdout: "",
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
