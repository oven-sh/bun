// https://github.com/oven-sh/bun/issues/21175
// Bun.file().slice().stream() should not hang when consumed via iterator
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

test("Bun.file().slice().stream() iterator consumption", async () => {
  using tmpbase = tempDir("issue-21175", {});
  const path = join(tmpbase, "large-file.bin");

  const size = 1024 * 1024; // 1mb file
  await Bun.write(path, new Uint8Array(size).fill(69));
  const file = Bun.file(path);

  const sliced = file.slice(0, 16384);
  const stream = sliced.stream();

  let totalLen = 0;
  // @ts-expect-error: ReadableStream is async iterable
  for await (const chunk of stream) {
    totalLen += chunk.length;
  }
  expect(totalLen).toBe(16384);
});
