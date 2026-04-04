import { $ } from "bun";
import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26749
// mv command should report the correct illegal option character in error messages

const cases: [string, string][] = [
  ["-T", "T"],
  ["-X", "X"],
  ["-fX", "X"],
  ["-vZ", "Z"],
];

test.each(cases)("mv reports correct illegal option for %s", async (flag, expectedChar) => {
  $.throws(true);
  try {
    await Bun.$`mv ${flag} ./a ./b`;
    expect.unreachable("should have thrown");
  } catch (e: unknown) {
    const err = e as Bun.$.ShellError;
    const stderr = new TextDecoder().decode(err.stderr);
    expect(stderr).toContain(`mv: illegal option -- ${expectedChar}`);
    expect(err.exitCode).not.toBe(0);
  } finally {
    $.nothrow();
  }
});
