import { $ } from "bun";
import { expect, test } from "bun:test";
import os from "node:os";
import { isLinux } from "harness";

test("which rlly long", async () => {
  const longstr = "a".repeat(100000);
  expect(async () => await $`${longstr}`.throws(true)).toThrow();
});

test("which PATH rlly long", async () => {
  const longstr = "a".repeat(100000);
  expect(async () => await $`PATH=${longstr} slkdfjlsdkfj`.throws(true)).toThrow();
});

test.if(isLinux)("which write failure exit code is positive errno", async () => {
  const { exitCode } = await $`which ls > /dev/full`.nothrow();
  expect(exitCode).toBe(os.constants.errno.ENOSPC);
});
