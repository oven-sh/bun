import { expect, test } from "bun:test";
import { join } from "path";
import { tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/25851
// Blob constructor ignoring File parts in multi-part construction

test("Blob constructor with multiple File/Blob parts", async () => {
  using dir = tempDir("blob-file-parts", {
    "test.txt": "Hello World",
  });

  const file = Bun.file(join(String(dir), "test.txt"));
  const fileSize = file.size;
  const buffer = new ArrayBuffer(100);

  // Test single File
  const blob1 = new Blob([file]);
  expect(blob1.size).toBe(fileSize);

  // Test single buffer
  const blob2 = new Blob([buffer]);
  expect(blob2.size).toBe(100);

  // Test multiple buffers
  const blob3 = new Blob([buffer, buffer]);
  expect(blob3.size).toBe(200);

  // Test File + buffer (bug case)
  const blob4 = new Blob([file, buffer]);
  expect(blob4.size).toBe(fileSize + 100);

  // Test buffer + File (bug case)
  const blob5 = new Blob([buffer, file]);
  expect(blob5.size).toBe(100 + fileSize);

  // Test multiple Files (bug case)
  const blob6 = new Blob([file, file]);
  expect(blob6.size).toBe(fileSize * 2);

  // Test File + buffer + File
  const blob7 = new Blob([file, buffer, file]);
  expect(blob7.size).toBe(fileSize + 100 + fileSize);

  // Test text() method works correctly
  const blob8 = new Blob([file, "extra text"]);
  const text = await blob8.text();
  expect(text).toContain("extra text");
  expect(blob8.size).toBe(file.size + 10);
});

test("Blob constructor handles sliced File parts correctly", async () => {
  // Test that blob.offset is respected when reading file-backed blobs
  using dir = tempDir("blob-sliced-file", {
    "test.txt": "Hello World",
  });

  const file = Bun.file(join(String(dir), "test.txt"));

  // Slice the file to get "World"
  const sliced = file.slice(6, 11);
  expect(await sliced.text()).toBe("World");

  // Create a new blob from the sliced part
  const blob = new Blob([sliced, "!"]);
  const text = await blob.text();

  // Should be "World!" not "Hello!" (which would happen if offset was ignored)
  expect(text).toBe("World!");
  expect(blob.size).toBe(6); // "World" (5) + "!" (1)
});

test("Blob constructor handles multiple sliced Files", async () => {
  using dir = tempDir("blob-multi-sliced", {
    "test.txt": "Hello World",
  });

  const file = Bun.file(join(String(dir), "test.txt"));

  // Create slices
  const hello = file.slice(0, 5); // "Hello"
  const world = file.slice(6, 11); // "World"

  // Combine them
  const blob = new Blob([hello, " ", world, "!"]);
  const text = await blob.text();

  expect(text).toBe("Hello World!");
});
