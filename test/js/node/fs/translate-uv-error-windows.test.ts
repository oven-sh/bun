// On Windows, libuv fs calls (uv_fs_read etc.) can surface negative error codes
// that are not explicitly listed in translateUVErrorToE's switch. The fallback
// arm used @enumFromInt(-code) on the exhaustive `bun.sys.E` enum, which panics
// with "invalid enum value" in safe builds for any code that isn't a named tag.
// Windows release builds are ReleaseSafe, so this panicked in the wild via
// fs.readFile -> sys_uv.preadv -> ReturnCodeI64.errEnum -> translateUVErrorToE.
//
// This test feeds out-of-range codes directly and asserts we get UNKNOWN
// instead of a crash.

import { translateUVErrorToE } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { isWindows } from "harness";

test.skipIf(!isWindows)("translateUVErrorToE falls back to UNKNOWN for unmapped libuv codes", () => {
  // Sanity: known mappings still work.
  expect(translateUVErrorToE(-4058)).toBe("NOENT"); // UV_ENOENT
  expect(translateUVErrorToE(-4083)).toBe("BADF"); // UV_EBADF
  expect(translateUVErrorToE(-4094)).toBe("UNKNOWN"); // UV_UNKNOWN

  // Out-of-range / unmapped codes must not panic; they fall back to UNKNOWN.
  // -4021 is one past UV_ENOEXEC (-4022), the lowest-magnitude UV_E* constant
  // on Windows, so nothing maps there.
  expect(translateUVErrorToE(-4021)).toBe("UNKNOWN");
  // -4097 is one past UV_ERRNO_MAX (-4096).
  expect(translateUVErrorToE(-4097)).toBe("UNKNOWN");
  // Gap inside the -4000s that no UV_E* constant occupies.
  expect(translateUVErrorToE(-4000)).toBe("UNKNOWN");
  // A value whose negation is well outside u16 range.
  expect(translateUVErrorToE(-123456)).toBe("UNKNOWN");
});

test.skipIf(isWindows)("translateUVErrorToE is a no-op off Windows", () => {
  expect(translateUVErrorToE(-4058)).toBeUndefined();
});
