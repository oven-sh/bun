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

// Stress the threadpool `ReadFile` path that calls `StoreRef::data_mut` off
// the JS thread (`resolve_size_and_last_modified` on each worker). Every
// `Bun.file(p).bytes()` clones the backing `StoreRef` into a fresh
// `ReadFile` task that the worker pool runs concurrently; the test asserts
// each task sees its own `Store` payload (no interleaved `last_modified`
// writes) and runs cleanly under ASAN (`bun bd`). Regression guard for
// oven-sh/bun#30800 — `StoreRef` soundness (dropped `Sync`, `data_mut` is
// now `unsafe fn`).
test("Bun.file().bytes() is safe under high concurrency", async () => {
  const dir = tempDirWithFiles(
    "bun-blob-concurrent",
    Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [`f${i}.txt`, `content-${i}-${Buffer.alloc(1024, 65 + (i % 26)).toString()}`]),
    ),
  );
  // Many overlapping reads per file; each goes through a distinct `ReadFile`
  // task on the threadpool, all derived from a `Blob` whose `StoreRef` is
  // cloned into the task. If `data_mut` were wired to share state across
  // tasks, ASAN would flag the racing writes to `file.last_modified`.
  const results = await Promise.all(
    Array.from({ length: 16 }, (_, i) => {
      const file = Bun.file(path.join(dir, `f${i}.txt`));
      return Promise.all(Array.from({ length: 8 }, () => file.bytes()));
    }),
  );
  for (let i = 0; i < results.length; i++) {
    const expected = `content-${i}-${Buffer.alloc(1024, 65 + (i % 26)).toString()}`;
    for (const bytes of results[i]) {
      expect(new TextDecoder().decode(bytes)).toBe(expected);
    }
  }
});
