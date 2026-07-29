// On Windows, libuv fs calls (uv_fs_read etc.) can surface negative error codes
// that are not explicitly listed in translateUVErrorToE's switch. The fallback
// arm used @enumFromInt(-code) on the exhaustive `bun.sys.E` enum, which panics
// with "invalid enum value" in safe builds for any code that isn't a named tag.
// Windows release builds are ReleaseSafe, so this panicked in the wild via
// fs.readFile -> sys_uv.preadv -> ReturnCodeI64.errEnum -> translateUVErrorToE.

import { translateUVErrorToE, uvRawErrno, uvTranslatedErrno } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { isWindows } from "harness";

test.skipIf(!isWindows)("translateUVErrorToE falls back to UNKNOWN for unmapped libuv codes", () => {
  // Sanity: known mappings still work.
  expect(translateUVErrorToE(-4058)).toBe("NOENT"); // UV_ENOENT
  expect(translateUVErrorToE(-4083)).toBe("BADF"); // UV_EBADF
  expect(translateUVErrorToE(-4094)).toBe("UNKNOWN"); // UV_UNKNOWN

  // Unmapped codes must not panic; they fall back to UNKNOWN.
  expect(translateUVErrorToE(-4021)).toBe("UNKNOWN"); // one past UV_ENOEXEC (-4022)
  expect(translateUVErrorToE(-4097)).toBe("UNKNOWN"); // one past UV_ERRNO_MAX (-4096)
  expect(translateUVErrorToE(-4000)).toBe("UNKNOWN"); // gap no UV_E* constant occupies
  expect(translateUVErrorToE(-123456)).toBe("UNKNOWN"); // negation outside u16 range
  expect(translateUVErrorToE(-2147483648)).toBe("UNKNOWN"); // INT_MIN: wrapping negation, no overflow
});

test.skipIf(isWindows)("translateUVErrorToE is a no-op off Windows", () => {
  expect(translateUVErrorToE(-4058)).toBeUndefined();
});

// The async node:fs completion handlers (uv_open, uv_read, uv_write, ...)
// store the negated libuv result into the u16 `Error.errno` field. libuv's
// uv_translate_sys_error returns already-negative inputs unchanged, so
// req->result can carry system codes (NTSTATUS-shaped values) whose magnitude
// does not fit u16. The Zig implementation panicked on the narrowing cast
// ("integer does not fit in destination type" in uv_callback); a truncating
// cast instead aliases real errnos (-0x10002 would read back as ENOENT).
// `uvRawErrno` is that conversion, now clamping to |UV_UNKNOWN| = 4094.
test("uvRawErrno clamps out-of-range libuv results instead of truncating", () => {
  // In-range magnitudes pass through untouched.
  expect(uvRawErrno(-1)).toBe(1); // smallest magnitude
  expect(uvRawErrno(-4058)).toBe(4058); // UV_ENOENT
  expect(uvRawErrno(-65535)).toBe(65535); // largest magnitude that fits u16
  // Out of u16 range: clamp to |UV_UNKNOWN|. A truncating cast would have
  // produced 0, 2 (ENOENT), and 20 (ENOTDIR) respectively.
  expect(uvRawErrno(-65536)).toBe(4094);
  expect(uvRawErrno(-65538)).toBe(4094);
  expect(uvRawErrno(-1073741804)).toBe(4094); // NTSTATUS 0xC0000014 as i32
  expect(uvRawErrno(-(2 ** 53))).toBe(4094); // beyond c_int range
  // Non-negative results are success, not errors.
  expect(uvRawErrno(0)).toBeUndefined();
  expect(uvRawErrno(7)).toBeUndefined();
});

// Sibling conversion for the synchronous uv_fs_* call sites (futime, mkdtemp,
// realpath, ...): ReturnCode.errno() returned None for unmapped negative
// results, which every `if let Some(errno) = rc.errno()` caller treats as
// success - realpath then dereferences a req.ptr libuv never populated.
test.skipIf(!isWindows)("uvTranslatedErrno never swallows a negative result", () => {
  // Sanity: known mappings still translate.
  expect(uvTranslatedErrno(-4058)).toBe(2); // UV_ENOENT -> ENOENT
  expect(uvTranslatedErrno(-4094)).toBe(134); // UV_UNKNOWN -> EUNKNOWN
  // Unmapped negative codes resolve to EUNKNOWN (134) instead of undefined.
  expect(uvTranslatedErrno(-4021)).toBe(134); // one past UV_ENOEXEC (-4022)
  expect(uvTranslatedErrno(-123456)).toBe(134); // negation outside u16 range
  // Non-negative results stay success.
  expect(uvTranslatedErrno(0)).toBeUndefined();
  expect(uvTranslatedErrno(1)).toBeUndefined();
});

test.skipIf(isWindows)("uvTranslatedErrno is a no-op off Windows", () => {
  expect(uvTranslatedErrno(-4058)).toBeUndefined();
});
