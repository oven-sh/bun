import { expect, test } from "bun:test";
import { closeSync, constants, openSync, readFileSync, writeFileSync, writeSync } from "fs";
import { isWindows, tempDir } from "harness";
import path from "path";

// On Windows, fs.constants exposes CRT-format flag values (e.g. O_CREAT=0x100),
// but Bun internally used Linux-style bun.O values (e.g. O_CREAT=0o100=64).
// Passing numeric flags from fs.constants to fs.openSync caused flags like
// O_CREAT to be silently dropped, leading to EINVAL.

test("fs.openSync with numeric O_CREAT | O_WRONLY | O_TRUNC flags creates file", () => {
  using dir = tempDir("issue-27974", {});
  const filePath = path.join(String(dir), "test-numeric-flags.txt");

  const fd = openSync(filePath, constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC, 0o666);
  expect(fd).toBeGreaterThan(0);
  writeSync(fd, "hello world");
  closeSync(fd);

  expect(readFileSync(filePath, "utf8")).toBe("hello world");
});

test("fs.openSync with numeric O_CREAT | O_EXCL flags throws on existing file", () => {
  using dir = tempDir("issue-27974", {});
  const filePath = path.join(String(dir), "test-excl.txt");

  writeFileSync(filePath, "existing");

  expect(() => {
    openSync(filePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o666);
  }).toThrow();
});

test("fs.openSync with numeric O_APPEND flag appends", () => {
  using dir = tempDir("issue-27974", {});
  const filePath = path.join(String(dir), "test-append.txt");

  writeFileSync(filePath, "hello");

  const fd = openSync(filePath, constants.O_APPEND | constants.O_WRONLY);
  writeSync(fd, " world");
  closeSync(fd);

  expect(readFileSync(filePath, "utf8")).toBe("hello world");
});

test("fs.openSync with string flags still works after numeric fix", () => {
  using dir = tempDir("issue-27974", {});
  const filePath = path.join(String(dir), "test-string.txt");

  const fd = openSync(filePath, "w");
  expect(fd).toBeGreaterThan(0);
  writeSync(fd, "string flags work");
  closeSync(fd);

  expect(readFileSync(filePath, "utf8")).toBe("string flags work");
});

test("UV_FS_O_FILEMAP constant has correct value", () => {
  if (isWindows) {
    expect(constants.UV_FS_O_FILEMAP).toBe(536870912);
  } else {
    expect(constants.UV_FS_O_FILEMAP).toBe(0);
  }
});
