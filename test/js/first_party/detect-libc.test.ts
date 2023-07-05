import { test, expect } from "bun:test";
// @ts-ignore: @types/detect-libc is not accurate
import { GLIBC, MUSL, version, versionAsync, family, familyAsync, isNonGlibcLinux, isNonGlibcLinuxSync } from "detect-libc";

test("detect-libc", () => {
  expect(GLIBC).toBe("glibc");
  expect(MUSL).toBe("musl");
  if (process.platform === "linux") {
    expect(version()).toMatch(/^\d+\.\d+/);
    expect(family()).toBe(GLIBC);
    expect(isNonGlibcLinuxSync()).toBeFalse();
  } else {
    expect(version()).toBeNull();
    expect(family()).toBeNull();
    expect(isNonGlibcLinuxSync()).toBeFalse();
  }
  expect(versionAsync()).resolves.toBe(version());
  expect(familyAsync()).resolves.toBe(family());
  expect(isNonGlibcLinux()).resolves.toBe(isNonGlibcLinuxSync());
});
