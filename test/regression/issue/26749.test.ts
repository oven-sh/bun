import { $ } from "bun";
import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26749
// mv command should report the correct illegal option character in error messages

test("mv reports correct illegal option character for -T", async () => {
  $.throws(true);
  try {
    await Bun.$`mv -T ./a ./b`;
    expect.unreachable("should have thrown");
  } catch (e: unknown) {
    const err = e as Bun.$.ShellError;
    const stderr = new TextDecoder().decode(err.stderr);
    expect(stderr).toContain("mv: illegal option -- T");
    expect(err.exitCode).not.toBe(0);
  } finally {
    $.nothrow();
  }
});

test("mv reports correct illegal option character for -X", async () => {
  $.throws(true);
  try {
    await Bun.$`mv -X ./a ./b`;
    expect.unreachable("should have thrown");
  } catch (e: unknown) {
    const err = e as Bun.$.ShellError;
    const stderr = new TextDecoder().decode(err.stderr);
    expect(stderr).toContain("mv: illegal option -- X");
    expect(err.exitCode).not.toBe(0);
  } finally {
    $.nothrow();
  }
});

test("mv reports correct illegal option character when combined with valid flags", async () => {
  $.throws(true);
  try {
    await Bun.$`mv -fX ./a ./b`;
    expect.unreachable("should have thrown");
  } catch (e: unknown) {
    const err = e as Bun.$.ShellError;
    const stderr = new TextDecoder().decode(err.stderr);
    expect(stderr).toContain("mv: illegal option -- X");
    expect(err.exitCode).not.toBe(0);
  } finally {
    $.nothrow();
  }
});

test("mv reports correct illegal option character at end of combined flags", async () => {
  $.throws(true);
  try {
    await Bun.$`mv -vZ ./a ./b`;
    expect.unreachable("should have thrown");
  } catch (e: unknown) {
    const err = e as Bun.$.ShellError;
    const stderr = new TextDecoder().decode(err.stderr);
    expect(stderr).toContain("mv: illegal option -- Z");
    expect(err.exitCode).not.toBe(0);
  } finally {
    $.nothrow();
  }
});
