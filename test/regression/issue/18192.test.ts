import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/18192
// .stream() on a sliced Bun.file() hangs when the underlying file is larger than 640KB.

test("sliced Bun.file stream works for files larger than 640KB", async () => {
  using dir = tempDir("issue-18192", {});
  const filePath = join(String(dir), "large_file");

  // Create a file larger than 640KB (the threshold that triggered the bug)
  const size = 768 * 1024;
  await Bun.write(filePath, Buffer.alloc(size, 0x41));

  // Streaming a slice of the large file should not hang
  const slice = Bun.file(filePath).slice(0, 1);
  const text = await Bun.readableStreamToText(slice.stream());
  expect(text.length).toBe(1);
  expect(text).toBe("A");
});

test("sliced Bun.file stream works at exact 640KB boundary", async () => {
  using dir = tempDir("issue-18192", {});
  const filePath = join(String(dir), "boundary_file");

  // 640KB + 1 byte, the smallest size that triggered the bug
  const size = 640 * 1024 + 1;
  await Bun.write(filePath, Buffer.alloc(size, 0x42));

  const slice = Bun.file(filePath).slice(0, 10);
  const text = await Bun.readableStreamToText(slice.stream());
  expect(text.length).toBe(10);
  expect(text).toBe("B".repeat(10));
});

test("sliced Bun.file stream reads correct content from middle of large file", async () => {
  using dir = tempDir("issue-18192", {});
  const filePath = join(String(dir), "content_file");

  // Create a 1MB file with identifiable content
  const size = 1024 * 1024;
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    buf[i] = i % 256;
  }
  await Bun.write(filePath, buf);

  // Read a slice from the middle
  const offset = 500_000;
  const length = 1000;
  const slice = Bun.file(filePath).slice(offset, offset + length);
  const result = new Uint8Array(await slice.arrayBuffer());
  expect(result.length).toBe(length);

  // Also test via stream
  const streamResult = await Bun.readableStreamToArrayBuffer(slice.stream());
  expect(new Uint8Array(streamResult)).toEqual(result);
});
