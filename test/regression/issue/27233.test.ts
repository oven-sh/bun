import { $ } from "bun";
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/27233
// On Windows, `rm -rf` panics with "invalid enum value" when encountering a
// JUNCTION inside a directory. Junctions are directory reparse points
// (IO_REPARSE_TAG_MOUNT_POINT) that were incorrectly classified as symlinks,
// causing DeleteFileBun to be called with FILE_NON_DIRECTORY_FILE.
test.if(isWindows)("rm -rf removes directory containing a junction", async () => {
  using dir = tempDir("rm-junction");
  const target = join(String(dir), "target");
  const container = join(String(dir), "container");
  const junction = join(container, "J");

  mkdirSync(target);
  mkdirSync(container);
  // 'junction' type creates a Windows JUNCTION (IO_REPARSE_TAG_MOUNT_POINT)
  symlinkSync(target, junction, "junction");

  expect(existsSync(junction)).toBeTrue();

  const { exitCode, stderr } = await $`rm -rf ${container}`;

  expect(stderr.toString()).toBe("");
  expect(exitCode).toBe(0);
  expect(existsSync(container)).toBeFalse();
  // The junction target should still exist (rm should remove the junction, not the target)
  expect(existsSync(target)).toBeTrue();
});
