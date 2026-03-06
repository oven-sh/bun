import { expect, test } from "bun:test";
import { tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

// Regression test for https://github.com/oven-sh/bun/issues/27854
// On Windows, uv_fs_realpath can return success with a null ptr in edge cases
// (ramdisk volumes, substituted drives, standalone executables). The fix adds a
// null check so Bun returns ENOENT instead of panicking.

test("fs.realpathSync does not crash on non-existent path", () => {
  expect(() => fs.realpathSync("/this/path/definitely/does/not/exist")).toThrow();
});

test("fs.realpath does not crash on non-existent path", async () => {
  const err = await new Promise<NodeJS.ErrnoException>((resolve, reject) => {
    fs.realpath("/this/path/definitely/does/not/exist", err => {
      if (err) resolve(err);
      else reject(new Error("expected an error"));
    });
  });
  expect(err.code).toBe("ENOENT");
});

test("fs.realpathSync works for valid paths", () => {
  using dir = tempDir("realpath-test", {
    "file.txt": "hello",
  });
  const resolved = fs.realpathSync(path.join(String(dir), "file.txt"));
  expect(resolved).toContain("file.txt");
});

test("fs.realpath works for valid paths", async () => {
  using dir = tempDir("realpath-test", {
    "file.txt": "hello",
  });
  const resolved = await new Promise<string>((resolve, reject) => {
    fs.realpath(path.join(String(dir), "file.txt"), (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
  expect(resolved).toContain("file.txt");
});
