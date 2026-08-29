// bun_sys::Error::from_libuv(rc).name() on Windows: a libuv return code decodes
// to the errno name Node reports, and a code libuv does not define to EUNKNOWN.

import { sysErrorNameFromLibuv } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { isWindows } from "harness";

test.skipIf(!isWindows)("Error::from_libuv decodes libuv codes to errno names", () => {
  expect(sysErrorNameFromLibuv(4058)).toBe("ENOENT"); // -UV_ENOENT
  expect(sysErrorNameFromLibuv(4083)).toBe("EBADF"); // -UV_EBADF
  expect(sysErrorNameFromLibuv(4092)).toBe("EACCES"); // -UV_EACCES
  expect(sysErrorNameFromLibuv(4094)).toBe("EUNKNOWN"); // -UV_UNKNOWN
  expect(sysErrorNameFromLibuv(4000)).toBe("EUNKNOWN"); // not a libuv code
});

test.skipIf(isWindows)("sysErrorNameFromLibuv is a no-op off Windows", () => {
  expect(sysErrorNameFromLibuv(4058)).toBeUndefined();
});
