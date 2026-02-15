// https://github.com/oven-sh/bun/issues/18192
// Bun.file().slice().stream() should not hang for files larger than 640KB

import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

test("Bun.file().slice().stream() should not hang for large files", async () => {
  using tmpbase = tempDir("issue-18192", {});
  const path = join(tmpbase, "large-file.bin");

  const size = 1024 * 1024; // 1mb file
  await Bun.write(path, new Uint8Array(size).fill(69));

  const file = Bun.file(path);

  // tiny slice
  {
    const sliced = file.slice(0, 1);
    const bytes = await new Response(sliced.stream()).bytes();
    expect(bytes.length).toBe(1);
    expect(bytes).toEqual(new Uint8Array(1).fill(69));
  }

  // zero length slice
  {
    const sliced = file.slice(0, 0);
    const bytes = await new Response(sliced.stream()).bytes();
    expect(bytes.length).toBe(0);
  }

  // somewhere in the middle slice
  {
    const midStart = 500 * 1024;
    const midEnd = midStart + 10;
    const sliced = file.slice(midStart, midEnd);
    const bytes = await new Response(sliced.stream()).bytes();
    expect(bytes.length).toBe(10);
    expect(bytes).toEqual(new Uint8Array(10).fill(69));
  }
});
