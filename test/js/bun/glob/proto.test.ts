import { expect, test } from "bun:test";
import { symlink } from "fs/promises";
import { tempDir } from "harness";
import path from "path";

test("Object prototype followSymlinks", async () => {
  await using dir = tempDir("glob-follow", {
    "abc/def/file.txt": "file",
    "symed/file2.txt": "file",
  });

  await symlink(path.join(dir, "symed"), path.join(dir, "abc/def/sym"), "dir");
  const glob = new Bun.Glob("**/*.txt");

  const zero = glob.scanSync({
    "cwd": path.join(dir, "abc"),
    onlyFiles: true,
    followSymlinks: true,
  });
  expect([...zero].map(a => a.replaceAll("\\", "/")).sort()).toEqual(["def/file.txt", "def/sym/file2.txt"]);

  const first = glob.scanSync({
    "cwd": path.join(dir, "abc"),
    onlyFiles: true,
  });
  expect([...first].map(a => a.replaceAll("\\", "/"))).toEqual(["def/file.txt"]);

  Object.defineProperty(Object.prototype, "followSymlinks", {
    value: true,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  const second = glob.scanSync({
    "cwd": path.join(dir, "abc"),
    onlyFiles: true,
  });
  expect([...second].map(a => a.replaceAll("\\", "/"))).toEqual(["def/file.txt"]);
  delete Object.prototype.followSymlinks;

  const third = glob.scanSync({
    "cwd": path.join(dir, "abc"),
    onlyFiles: true,
  });
  expect([...third].map(a => a.replaceAll("\\", "/"))).toEqual(["def/file.txt"]);
});

test("builtin-implemented methods carry the same property attributes as native ones", () => {
  // `scan`/`scanSync` are JS builtins on a `configurable: false` class; they
  // used to be emitted without DontDelete while `match` (native) had it.
  for (const name of ["scan", "scanSync", "match"]) {
    expect(Object.getOwnPropertyDescriptor(Bun.Glob.prototype, name)?.configurable).toBe(false);
  }
});
