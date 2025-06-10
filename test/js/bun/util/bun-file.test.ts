import { expect, test } from "bun:test";
import fsPromises from "fs/promises";
import { tempDirWithFiles } from "harness";
import { join } from "path";

test("delete() and stat() should work with unicode paths", async () => {
  const dir = tempDirWithFiles("delete-stat-unicode-path", {
    "another-file.txt": "HEY",
  });
  const filename = join(dir, "🌟.txt");

  expect(async () => {
    await Bun.file(filename).delete();
  }).toThrow(`ENOENT: no such file or directory, unlink '${filename}'`);

  expect(async () => {
    await Bun.file(filename).stat();
  }).toThrow(`ENOENT: no such file or directory, stat '${filename}'`);

  await Bun.write(filename, "HI");

  expect(await Bun.file(filename).stat()).toMatchObject({ size: 2 });
  expect(await Bun.file(filename).delete()).toBe(undefined);

  expect(await Bun.file(filename).exists()).toBe(false);
});

test("writer.end() should not close the fd if it does not own the fd", async () => {
  const dir = tempDirWithFiles("writer-end-fd", {
    "tmp.txt": "HI",
  });
  const filename = join(dir, "tmp.txt");

  for (let i = 0; i < 30; i++) {
    const fileHandle = await fsPromises.open(filename, "w", 0o666);
    const fd = fileHandle.fd;

    await Bun.file(fd).writer().end();
    // @ts-ignore
    await fsPromises.close(fd);
    expect(await Bun.file(filename).text()).toBe("");
  }
});

test("Bun.file() should show symlink target in error when symlink points to non-existent file", async () => {
  const dir = tempDirWithFiles("broken-symlink-test", {});
  const target = join(dir, "non-existent-target.txt");
  const symlink = join(dir, "broken-symlink.txt");

  await fsPromises.symlink(target, symlink);

  const symlinkStats = await fsPromises.lstat(symlink);
  expect(symlinkStats.isSymbolicLink()).toBe(true);

  try {
    await fsPromises.stat(target);
    throw new Error("Target should not exist");
  } catch {
    // Expected - target doesn't exist
  }

  // Test various file operations that should trigger the enhanced error
  const operations = [
    { name: "text()", fn: () => Bun.file(symlink).text() },
    { name: "arrayBuffer()", fn: () => Bun.file(symlink).arrayBuffer() },
    { name: "stream()", fn: () => Bun.file(symlink).stream() },
    { name: "bytes()", fn: () => Bun.file(symlink).bytes() },
  ];

  for (const { name, fn } of operations) {
    try {
      await fn();
    } catch (err: any) {
      expect(err.message).toContain(symlink);
      expect(err.message).toContain(target);
      expect(err.message).toContain("->");
      expect(err.code).toBe("ENOENT");
      expect(err.errno).toBe(-2);
      expect(err.dest).toBe(target);
    }
  }
});

test("Bun.file() should show relative symlink target correctly", async () => {
  const dir = tempDirWithFiles("relative-symlink-test", {});
  const subdir = join(dir, "subdir");
  await fsPromises.mkdir(subdir);

  const target = "../non-existent.txt";
  const symlink = join(subdir, "relative-link.txt");

  await fsPromises.symlink(target, symlink);

  try {
    await Bun.file(symlink).text();
  } catch (err: any) {
    expect(err.message).toContain(symlink);
    expect(err.message).toContain(target);
    expect(err.dest).toBe(target);
  }
});
