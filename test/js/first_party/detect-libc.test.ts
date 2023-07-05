import { test, expect } from "bun:test";
// @ts-ignore: @types/detect-libc is not accurate
import { GLIBC, MUSL, version, versionSync, family, familySync, isNonGlibcLinux, isNonGlibcLinuxSync } from "detect-libc";

test("detect-libc", () => {
  expect(GLIBC).toBe("glibc");
  expect(MUSL).toBe("musl");
  if (process.platform === "linux") {
    expect(versionSync()).toMatch(/^\d+\.\d+/);
    expect(familySync()).toBe(GLIBC);
    expect(isNonGlibcLinuxSync()).toBeFalse();
  } else {
    expect(versionSync()).toBeNull();
    expect(familySync()).toBeNull();
    expect(isNonGlibcLinuxSync()).toBeFalse();
  }
  expect(version()).resolves.toBe(versionSync());
  expect(family()).resolves.toBe(familySync());
  expect(isNonGlibcLinux()).resolves.toBe(isNonGlibcLinuxSync());
});
