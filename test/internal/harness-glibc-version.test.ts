import { expect, test } from "bun:test";
import { getGlibcVersion, isGlibc, isGlibcVersionAtLeast } from "harness";

test.skipIf(!isGlibc)("isGlibcVersionAtLeast compares with the glibc of this process", () => {
  const [major, minor] = getGlibcVersion()!.split(".").map(Number);
  expect({
    same: isGlibcVersionAtLeast(`${major}.${minor}.0`),
    older: isGlibcVersionAtLeast(`${major}.${minor - 1}.0`),
    newer: isGlibcVersionAtLeast(`${major}.${minor + 1}.0`),
    // As decimal fractions, 2.9 is more than 2.39.
    olderWithFewerDigits: isGlibcVersionAtLeast(`${major}.9.0`),
  }).toEqual({ same: true, older: true, newer: false, olderWithFewerDigits: true });
});

test.skipIf(isGlibc)("isGlibcVersionAtLeast is false where there is no glibc", () => {
  expect(isGlibcVersionAtLeast("0.0.0")).toBe(false);
});
