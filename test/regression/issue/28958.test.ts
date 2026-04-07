// https://github.com/oven-sh/bun/issues/28958
//
// `fs.rmSync` / `fs.rm` / `fs.promises.rm` on a directory with
// `recursive: false` must throw a Node.js-compatible `SystemError`
// with code `ERR_FS_EISDIR`, not a raw `EFAULT`.
import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import fs from "node:fs";
import path from "node:path";

test("fs.rmSync on a directory without recursive throws ERR_FS_EISDIR", () => {
  const dir = tempDirWithFiles("issue-28958-sync", { ".keep": "" });
  const target = path.join(dir, "subdir");
  fs.mkdirSync(target);

  let err: any;
  try {
    fs.rmSync(target, { recursive: false, force: false });
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  expect(err.name).toBe("SystemError");
  expect(err.code).toBe("ERR_FS_EISDIR");
  expect(err.errno).toBe(21);
  expect(err.syscall).toBe("rm");
  expect(err.path).toBe(target);
  expect(err.message).toBe(`Path is a directory: rm returned EISDIR (is a directory) ${target}`);

  // Directory is still there.
  expect(fs.existsSync(target)).toBe(true);
  fs.rmdirSync(target);
});

test("fs.rm (callback) on a directory without recursive yields ERR_FS_EISDIR", async () => {
  const dir = tempDirWithFiles("issue-28958-cb", { ".keep": "" });
  const target = path.join(dir, "subdir");
  fs.mkdirSync(target);

  const err: any = await new Promise(resolve => {
    fs.rm(target, { recursive: false, force: false }, e => resolve(e));
  });
  expect(err).toBeTruthy();
  expect(err.name).toBe("SystemError");
  expect(err.code).toBe("ERR_FS_EISDIR");
  expect(err.errno).toBe(21);
  expect(err.syscall).toBe("rm");
  expect(err.path).toBe(target);
  expect(err.message).toBe(`Path is a directory: rm returned EISDIR (is a directory) ${target}`);

  expect(fs.existsSync(target)).toBe(true);
  fs.rmdirSync(target);
});

test("fs.promises.rm on a directory without recursive throws ERR_FS_EISDIR", async () => {
  const dir = tempDirWithFiles("issue-28958-promise", { ".keep": "" });
  const target = path.join(dir, "subdir");
  fs.mkdirSync(target);

  let err: any;
  try {
    await fs.promises.rm(target, { recursive: false, force: false });
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  expect(err.name).toBe("SystemError");
  expect(err.code).toBe("ERR_FS_EISDIR");
  expect(err.errno).toBe(21);
  expect(err.syscall).toBe("rm");
  expect(err.path).toBe(target);
  expect(err.message).toBe(`Path is a directory: rm returned EISDIR (is a directory) ${target}`);

  expect(fs.existsSync(target)).toBe(true);
  fs.rmdirSync(target);
});

test("fs.rmSync with recursive: true still removes a directory", () => {
  const dir = tempDirWithFiles("issue-28958-recursive", { "subdir/file.txt": "hello" });
  const target = path.join(dir, "subdir");
  expect(fs.existsSync(target)).toBe(true);
  fs.rmSync(target, { recursive: true });
  expect(fs.existsSync(target)).toBe(false);
});
