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
  }).toThrow(
    process.platform === "linux"
      ? `ENOENT: no such file or directory, statx '${filename}'`
      : `ENOENT: no such file or directory, stat '${filename}'`,
  );

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
