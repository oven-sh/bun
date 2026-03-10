import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { closeSync, constants, open as openCb, openSync, readFileSync, writeSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

test("fs.openSync with numeric O_CREAT | O_TRUNC | O_WRONLY flags", () => {
  const { O_CREAT, O_TRUNC, O_WRONLY } = constants;
  const flag = O_TRUNC | O_CREAT | O_WRONLY;

  using dir = tempDir("issue-27974", {});
  const file = join(String(dir), "test.txt");

  const fd = openSync(file, flag, 0o666);
  writeSync(fd, "hello world");
  closeSync(fd);

  expect(readFileSync(file, "utf8")).toBe("hello world");
});

test("fs.openSync with numeric O_CREAT | O_WRONLY flags (no O_TRUNC)", () => {
  const { O_CREAT, O_WRONLY } = constants;
  const flag = O_CREAT | O_WRONLY;

  using dir = tempDir("issue-27974", {});
  const file = join(String(dir), "test2.txt");

  const fd = openSync(file, flag, 0o666);
  writeSync(fd, "created");
  closeSync(fd);

  expect(readFileSync(file, "utf8")).toBe("created");
});

test.if(isWindows)("fs.openSync with UV_FS_O_FILEMAP | O_CREAT | O_TRUNC | O_WRONLY", () => {
  const { O_CREAT, O_TRUNC, O_WRONLY, UV_FS_O_FILEMAP } = constants;
  const flag = UV_FS_O_FILEMAP | O_TRUNC | O_CREAT | O_WRONLY;

  using dir = tempDir("issue-27974", {});
  const file = join(String(dir), "filemap.txt");

  const fd = openSync(file, flag, 0o666);
  writeSync(fd, "filemap content");
  closeSync(fd);

  expect(readFileSync(file, "utf8")).toBe("filemap content");
});

test("fs.openSync with numeric O_RDWR | O_CREAT | O_EXCL flags", () => {
  const { O_CREAT, O_RDWR, O_EXCL } = constants;
  const flag = O_CREAT | O_RDWR | O_EXCL;

  using dir = tempDir("issue-27974", {});
  const file = join(String(dir), "exclusive.txt");

  const fd = openSync(file, flag, 0o666);
  writeSync(fd, "exclusive");
  closeSync(fd);

  expect(readFileSync(file, "utf8")).toBe("exclusive");

  // Opening again with O_EXCL should fail since file exists.
  expect(() => openSync(file, flag, 0o666)).toThrow();
});

test("fs.promises.open with numeric O_CREAT | O_TRUNC | O_WRONLY flags", async () => {
  const { O_CREAT, O_TRUNC, O_WRONLY } = constants;
  const flag = O_TRUNC | O_CREAT | O_WRONLY;

  using dir = tempDir("issue-27974", {});
  const file = join(String(dir), "async.txt");

  await using fh = await open(file, flag, 0o666);
  await fh.write("async hello");

  expect(readFileSync(file, "utf8")).toBe("async hello");
});

test("fs.open (callback) with numeric O_CREAT | O_TRUNC | O_WRONLY flags", async () => {
  const { O_CREAT, O_TRUNC, O_WRONLY } = constants;
  const flag = O_TRUNC | O_CREAT | O_WRONLY;

  using dir = tempDir("issue-27974", {});
  const file = join(String(dir), "callback.txt");

  const { promise, resolve, reject } = Promise.withResolvers<number>();
  openCb(file, flag, 0o666, (err, fd) => {
    if (err) reject(err);
    else resolve(fd);
  });

  const fd = await promise;
  writeSync(fd, "callback hello");
  closeSync(fd);

  expect(readFileSync(file, "utf8")).toBe("callback hello");
});

test("fs.openSync with numeric O_APPEND | O_CREAT | O_WRONLY flags", () => {
  const { O_APPEND, O_CREAT, O_WRONLY } = constants;
  const flag = O_APPEND | O_CREAT | O_WRONLY;

  using dir = tempDir("issue-27974", {});
  const file = join(String(dir), "append.txt");

  const fd1 = openSync(file, flag, 0o666);
  writeSync(fd1, "first");
  closeSync(fd1);

  const fd2 = openSync(file, flag, 0o666);
  writeSync(fd2, "second");
  closeSync(fd2);

  expect(readFileSync(file, "utf8")).toBe("firstsecond");
});
