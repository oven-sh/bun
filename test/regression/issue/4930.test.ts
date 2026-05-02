// https://github.com/oven-sh/bun/issues/4930
// Calling Bun.file().exists() before Bun.write() must not poison size

import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

test("Bun.file() exists() before write does not break write or size", async () => {
  using tmpbase = tempDir("bun-file-exists-before-write", {});

  const inFile = Bun.file(join(tmpbase, "in.txt"));
  await Bun.write(inFile, "content");

  const outFile = Bun.file(join(tmpbase, "out.txt"));

  // This used to poison the Blob size cache
  expect(await outFile.exists()).toBe(false);

  await Bun.write(outFile, inFile);

  expect(outFile.size).toBe(7);
  expect(await outFile.text()).toBe("content");
});
