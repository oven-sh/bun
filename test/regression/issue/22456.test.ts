// https://github.com/oven-sh/bun/issues/22456
// Bun.write() should not be truncated by destination's cached size

import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

test("Bun.write() file-to-file copy should not be truncated by cached size", async () => {
  using tmpbase = tempDir("issue-22456", {});

  const content1 = "this is a long long long long line";
  const file1 = Bun.file(join(tmpbase, "file1.txt")); // not exists yet
  await Bun.write(file1, content1);
  const file2 = Bun.file(join(tmpbase, "file2.txt")); // not exists yet
  await Bun.write(file2, "short line");
  const file3 = Bun.file(join(tmpbase, "file3.txt")); // not exists yet

  // comment these 3 lines everything works
  if (await file2.exists()) {
    await Bun.write(file3, file2); // backup
  }

  await Bun.write(file2, file1);
  await file1.delete();
  const content2 = await file2.text();
  if (await file3.exists()) {
    await Bun.write(file2, file3);
    await file3.delete();
  }

  expect(content2).toBe(content1);
});
