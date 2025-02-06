import { test, expect } from "bun:test";
import { tmpdirSync } from "harness";
import { join } from "path";
import fsPromises from "fs/promises";

test("delete() and stat() should work with unicode paths", async () => {
  const testDir = tmpdirSync();
  const filename = join(testDir, "🌟.txt");

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
  const testDir = tmpdirSync();
  for (let i = 0; i < 30; i++) {
    const fileHandle = await fsPromises.open(testDir + "/tmp.txt", "w", 0o666);
    const fd = fileHandle.fd;

    await Bun.file(fd).writer().end();
    // @ts-ignore
    await fsPromises.close(fd);
    expect(await Bun.file(testDir + "/tmp.txt").text()).toBe("");
    await Bun.sleep(50);
  }
});
