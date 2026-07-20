// Regression: bun.sys.Error.name() panicked on Windows when from_libuv=true.
// The errno field holds the *negated* libuv code (e.g. 4058 for UV_ENOENT) at
// the from_libuv=true call sites in node_fs.zig, but name() passed it to
// translateUVErrorToE without re-negating, so the function saw a positive
// value, fell to `else => @enumFromInt(-code)`, and the negative-to-u16 cast
// panicked. @setRuntimeSafety(false) in name() doesn't help because it doesn't
// propagate into the callee.

import { sysErrorNameFromLibuv } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { isWindows } from "harness";

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
