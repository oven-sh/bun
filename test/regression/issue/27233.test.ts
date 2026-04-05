import { $ } from "bun";
import { expect, test } from "bun:test";
import { isWindows, tempDirWithFiles } from "harness";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import path from "path";

// https://github.com/oven-sh/bun/issues/27233
// bun rm -rf crashes with "panic: invalid enum value" when a folder contains a JUNCTION on Windows.
// Junctions (and directory symlinks) should be removed without recursing into them.
test.if(isWindows)("rm -rf folder containing a junction does not crash", async () => {
  $.nothrow();

  const dir = tempDirWithFiles("rm-junction", {
    "target/file.txt": "do not delete me",
  });

  const junctionPath = path.join(dir, "folder");
  mkdirSync(junctionPath);

  const targetPath = path.join(dir, "target");
  const junctionLink = path.join(junctionPath, "J");

  // Create a junction: junctionLink -> targetPath
  symlinkSync(targetPath, junctionLink, "junction");
  expect(existsSync(junctionLink)).toBeTrue();

  // This should not crash
  const { exitCode, stderr } = await $`rm -rf ${junctionPath}`;
  expect(stderr.toString()).toBe("");
  expect(exitCode).toBe(0);

  // The folder containing the junction should be removed
  expect(existsSync(junctionPath)).toBeFalse();

  // The junction target and its contents should still exist (not recursed into)
  expect(existsSync(targetPath)).toBeTrue();
  expect(existsSync(path.join(targetPath, "file.txt"))).toBeTrue();
});

test.if(isWindows)("rm -rf directly on a junction does not crash", async () => {
  $.nothrow();

  const dir = tempDirWithFiles("rm-junction-direct", {
    "target/file.txt": "do not delete me",
  });

  const targetPath = path.join(dir, "target");
  const junctionPath = path.join(dir, "J");

  // Create a junction: junctionPath -> targetPath
  symlinkSync(targetPath, junctionPath, "junction");
  expect(existsSync(junctionPath)).toBeTrue();

  // This should not crash
  const { exitCode, stderr } = await $`rm -rf ${junctionPath}`;
  expect(stderr.toString()).toBe("");
  expect(exitCode).toBe(0);

  // The junction should be removed
  expect(existsSync(junctionPath)).toBeFalse();

  // The junction target and its contents should still exist
  expect(existsSync(targetPath)).toBeTrue();
  expect(existsSync(path.join(targetPath, "file.txt"))).toBeTrue();
});

test.if(isWindows)("rm -rf folder containing a junction with non-existent target", async () => {
  $.nothrow();

  const dir = tempDirWithFiles("rm-junction-broken", {});

  const folderPath = path.join(dir, "folder");
  mkdirSync(folderPath);

  const junctionLink = path.join(folderPath, "J");
  const nonExistentTarget = path.join(dir, "does-not-exist");

  // Create a junction pointing to a non-existent target
  symlinkSync(nonExistentTarget, junctionLink, "junction");

  // This should not crash
  const { exitCode, stderr } = await $`rm -rf ${folderPath}`;
  expect(stderr.toString()).toBe("");
  expect(exitCode).toBe(0);

  expect(existsSync(folderPath)).toBeFalse();
});
