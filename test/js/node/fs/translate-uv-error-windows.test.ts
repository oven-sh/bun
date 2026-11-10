// On Windows, libuv fs calls (uv_fs_read etc.) can surface negative error codes
// that are not explicitly listed in translateUVErrorToE's switch. The fallback
// arm used @enumFromInt(-code) on the exhaustive `bun.sys.E` enum, which panics
// with "invalid enum value" in safe builds for any code that isn't a named tag.
// Windows release builds are ReleaseSafe, so this panicked in the wild via
// fs.readFile -> sys_uv.preadv -> ReturnCodeI64.errEnum -> translateUVErrorToE.

import { translateUVErrorToE } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { isWindows } from "harness";

test.skipIf(!isWindows)("translateUVErrorToE falls back to UNKNOWN for unmapped libuv codes", () => {
  // Sanity: known mappings still work. The hook prints the variant with
  // SystemErrno's spelling (`ENOENT`, not the Rust identifier `NOENT`).
  expect(translateUVErrorToE(-4058)).toBe("ENOENT"); // UV_ENOENT
  expect(translateUVErrorToE(-4083)).toBe("EBADF"); // UV_EBADF
  expect(translateUVErrorToE(-4094)).toBe("EUNKNOWN"); // UV_UNKNOWN

  // Unmapped codes must not panic; they fall back to E::UNKNOWN.
  expect(translateUVErrorToE(-4021)).toBe("EUNKNOWN"); // one past UV_ENOEXEC (-4022)
  expect(translateUVErrorToE(-4097)).toBe("EUNKNOWN"); // one past UV_ERRNO_MAX (-4096)
  expect(translateUVErrorToE(-4000)).toBe("EUNKNOWN"); // gap no UV_E* constant occupies
  expect(translateUVErrorToE(-2)).toBe("EUNKNOWN"); // a negated errno is not a libuv code
  expect(translateUVErrorToE(-123456)).toBe("EUNKNOWN"); // negation outside u16 range
  expect(translateUVErrorToE(-2147483648)).toBe("EUNKNOWN"); // INT_MIN: wrapping negation, no overflow
});

test.skipIf(isWindows)("translateUVErrorToE is a no-op off Windows", () => {
  expect(translateUVErrorToE(-4058)).toBeUndefined();
});
