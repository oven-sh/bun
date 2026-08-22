import { describe, expect, test } from "bun:test";
import { getGlibcVersion, isGlibc, isGlibcVersionAtLeast } from "harness";

describe("isGlibcVersionAtLeast", () => {
  // gnu_get_libc_version() reports two components ("2.41"), while callers pass "2.36.0".
  test.if(isGlibc)("compares against the major.minor version glibc reports", () => {
    const version = getGlibcVersion()!;
    expect(version).toMatch(/^\d+\.\d+/);
    const [major, minor] = version.split(".").map(Number);

    expect({
      olderMajor: isGlibcVersionAtLeast(`${major - 1}.0.0`),
      same: isGlibcVersionAtLeast(`${major}.${minor}`),
      sameWithPatch: isGlibcVersionAtLeast(`${major}.${minor}.0`),
      newerMinor: isGlibcVersionAtLeast(`${major}.${minor + 1}.0`),
      newerMajor: isGlibcVersionAtLeast(`${major + 1}.0.0`),
    }).toEqual({
      olderMajor: true,
      same: true,
      sameWithPatch: true,
      newerMinor: false,
      newerMajor: false,
    });
  });

  test.if(!isGlibc)("is false when the runtime libc is not glibc", () => {
    expect(getGlibcVersion()).toBeUndefined();
    expect(isGlibcVersionAtLeast("2.0.0")).toBe(false);
  });
});
