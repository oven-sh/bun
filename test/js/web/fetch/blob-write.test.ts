import { expect, test } from "bun:test";
import { expectMaxObjectTypeCount, tempDirWithFiles } from "harness";
import path from "path";

test("blob.write() throws for data-backed blob", () => {
  const blob = new Blob(["Hello, world!"]);
  expect(() => blob.write("test.txt")).toThrowErrorMatchingInlineSnapshot(
    `"Cannot write to a Blob backed by bytes, which are always read-only"`,
  );
});

test("Bun.file(path).write() does not throw", async () => {
  const file = Bun.file(path.join(tempDirWithFiles("bun-write", { a: "Hello, world!" }), "a"));
  expect(() => file.write(new Blob(["Hello, world!!"]))).not.toThrow();
  expect(await file.text()).toBe("Hello, world!!");
});

test("blob.unlink() throws for data-backed blob", () => {
  const blob = new Blob(["Hello, world!"]);
  expect(() => blob.unlink()).toThrowErrorMatchingInlineSnapshot(
    `"Cannot write to a Blob backed by bytes, which are always read-only"`,
  );
});

test("blob.delete() throws for data-backed blob", () => {
  const blob = new Blob(["Hello, world!"]);
  expect(() => blob.delete()).toThrowErrorMatchingInlineSnapshot(
    `"Cannot write to a Blob backed by bytes, which are always read-only"`,
  );
});

test("Bun.file(path).unlink() does not throw", async () => {
  const dir = tempDirWithFiles("bun-unlink", { a: "Hello, world!" });
  const file = Bun.file(path.join(dir, "a"));
  expect(file.unlink()).resolves.toBeUndefined();
  expect(await Bun.file(path.join(dir, "a")).exists()).toBe(false);
});

test("Bun.file(path).delete() does not throw", async () => {
  const dir = tempDirWithFiles("bun-unlink", { a: "Hello, world!" });
  const file = Bun.file(path.join(dir, "a"));
  expect(file.delete()).resolves.toBeUndefined();
  expect(await Bun.file(path.join(dir, "a")).exists()).toBe(false);
});

test("blob.writer() throws for data-backed blob", () => {
  const blob = new Blob(["Hello, world!"]);
  expect(() => blob.writer()).toThrowErrorMatchingInlineSnapshot(
    `"Cannot write to a Blob backed by bytes, which are always read-only"`,
  );
});

test("Bun.file(path).writer() does not throw", async () => {
  async function iterate() {
    const dir = tempDirWithFiles("bun-writer", {});
    const file = Bun.file(path.join(dir, "test.txt"));
    const writer = file.writer();
    expect(writer).toBeDefined();
    writer.write("New content");
    await writer.end();
    expect(await file.text()).toBe("New content");
  }
  await iterate();
  // Force GC before capturing baseline to ensure first iteration's FileSink is collected
  Bun.gc(true);
  const initialObjectTypeCount = require("bun:jsc").heapStats().objectTypeCounts.FileSink || 0;
  for (let i = 0; i < 5; i++) {
    await iterate();
  }
  Bun.gc(true);
  await expectMaxObjectTypeCount(expect, "FileSink", initialObjectTypeCount);
});

test("blob.stat() returns undefined for data-backed blob", async () => {
  const blob = new Blob(["Hello, world!"]);
  const stat = await blob.stat();
  expect(stat).toBeUndefined();
});

test("Bun.file(path).stat() returns stats", async () => {
  const dir = tempDirWithFiles("bun-stat", { a: "Hello, world!" });
  const file = Bun.file(path.join(dir, "a"));
  const stat = await file.stat();
  expect(stat).toBeDefined();
  expect(stat.size).toBe(13); // "Hello, world!" is 13 bytes
});

test("Bun.write() with a native constructor as data stringifies it", async () => {
  // Hits the generic toSlice fallback in Blob.fromJSWithoutDeferGC; BunString__fromJS
  // must never return Dead without a pending exception or the debug assert in
  // String.fromJS trips.
  const dir = tempDirWithFiles("bun-write-ctor", {});
  const file = Bun.file(path.join(dir, "out.txt"));
  await Bun.write(file, ArrayBuffer as any);
  expect(await file.text()).toBe(ArrayBuffer.toString());
});

test("S3Client.write() with a native constructor as data does not assert", async () => {
  const s3 = new Bun.S3Client();
  // Missing credentials, so the upload itself rejects — we only care that the
  // Blob conversion of `ArrayBuffer` (a JSFunction) did not trip a debug
  // assertion in String.fromJS on the way there.
  await expect(s3.write("key", ArrayBuffer as any)).rejects.toThrow();
});
