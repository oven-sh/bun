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
import { getSystemErrorName } from "node:util";

test.skipIf(!isWindows)("Error.name() with from_libuv=true does not overflow", () => {
  // errno values as stored by node_fs.zig: @intCast(-rc) where rc is the
  // negative UV code.
  expect(sysErrorNameFromLibuv(4058)).toBe("ENOENT"); // -UV_ENOENT
  expect(sysErrorNameFromLibuv(4083)).toBe("EBADF"); // -UV_EBADF
  expect(sysErrorNameFromLibuv(4092)).toBe("EACCES"); // -UV_EACCES
  expect(sysErrorNameFromLibuv(4094)).toBe("UNKNOWN"); // -UV_UNKNOWN
});

// This name becomes err.code. libuv's uv_err_name(UV_UNKNOWN) is "UNKNOWN", and
// so is Bun's own util.getSystemErrorName(-4094); the Rust variant is EUNKNOWN.
test.skipIf(!isWindows)("Error.name() spells the unknown-errno fallback like node", () => {
  expect(sysErrorNameFromLibuv(4094)).toBe(getSystemErrorName(-4094)); // -UV_UNKNOWN
  // A code with no UV_E* constant folds to the same fallback.
  expect(sysErrorNameFromLibuv(4000)).toBe("UNKNOWN");
});

test.skipIf(isWindows)("sysErrorNameFromLibuv is a no-op off Windows", () => {
  expect(sysErrorNameFromLibuv(4058)).toBeUndefined();
});
