import { expect, test } from "bun:test";
import { expectMaxObjectTypeCount, tempDir, tempDirWithFiles } from "harness";
import path from "path";

test("blob.write() throws for data-backed blob", () => {
  const blob = new Blob(["Hello, world!"]);
  expect(() => blob.write("test.txt")).toThrowErrorMatchingInlineSnapshot(
    `"Cannot write to a Blob backed by bytes, which are always read-only"`,
  );
});

test("Bun.write() throws for a data-backed blob destination", () => {
  const blob = new Blob(["Hello, world!"]) as any;
  expect(() => Bun.write(blob, "x")).toThrowErrorMatchingInlineSnapshot(
    `"Cannot write to a Blob backed by bytes, which are always read-only"`,
  );
  // The destination is checked before the data argument is.
  // @ts-expect-error the data argument is left out on purpose
  expect(() => Bun.write(blob)).toThrowErrorMatchingInlineSnapshot(
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
  await using dir = tempDir("bun-unlink", { a: "Hello, world!" });
  const file = Bun.file(path.join(dir, "a"));
  expect(file.unlink()).resolves.toBeUndefined();
  expect(await Bun.file(path.join(dir, "a")).exists()).toBe(false);
});

test("Bun.file(path).delete() does not throw", async () => {
  await using dir = tempDir("bun-unlink", { a: "Hello, world!" });
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
  await using dir = tempDir("bun-stat", { a: "Hello, world!" });
  const file = Bun.file(path.join(dir, "a"));
  const stat = await file.stat();
  expect(stat).toBeDefined();
  expect(stat.size).toBe(13); // "Hello, world!" is 13 bytes
});

// Bun.file().write() accepts an options.type override: non-strings throw,
// valid types are stored lowercased (through the mime table when known), and
// invalid blob types are silently ignored.
test("Bun.file(path).write() rejects a non-string options.type", async () => {
  const dir = tempDirWithFiles("blob-write-type", { "a.txt": "hello" });
  const file = Bun.file(path.join(dir, "a.txt"));
  let err: any;
  try {
    await file.write("x", { type: 123 as any });
  } catch (e) {
    err = e;
  }
  expect(err).toMatchObject({
    code: "ERR_INVALID_ARG_TYPE",
    message: "Expected options.type to be a string for 'write'.",
  });
});

test("Bun.file(path).write() lowercases and applies a valid options.type", async () => {
  const dir = tempDirWithFiles("blob-write-type", { "a.txt": "hello" });
  const file = Bun.file(path.join(dir, "a.txt"));
  await file.write("x", { type: "TEXT/PLAIN; CHARSET=UTF-8" });
  expect(file.type).toBe("text/plain; charset=utf-8");
});

test("Bun.file(path).write() resolves a known options.type through the mime table", async () => {
  const dir = tempDirWithFiles("blob-write-type", { "a.txt": "hello" });
  const file = Bun.file(path.join(dir, "a.txt"));
  await file.write("x", { type: "APPLICATION/JSON" });
  expect(file.type).toBe("application/json");
});

test("Bun.file(path).write() silently ignores an invalid options.type", async () => {
  const dir = tempDirWithFiles("blob-write-type", { "a.txt": "hello" });
  const file = Bun.file(path.join(dir, "a.txt"));
  await file.write("x", { type: "bad\r\ntype" });
  // the .txt default is kept
  expect(file.type).toBe("text/plain;charset=utf-8");
});

// Stress the threadpool `ReadFile` path that reaches into the backing
// `Store` off the JS thread (`resolve_size_and_last_modified` on each
// worker). `do_read_file` clones the backing `RefPtr<Store>` into each
// spawned `ReadFile` task, so N concurrent `file.bytes()` calls on the
// *same* `Blob` schedule N workers that all observe the same `Store`
// allocation. The write-target (`file.last_modified`) is `AtomicU64` on
// Rust's memory model and the only worker-thread write, so the race is
// idempotent (every task stores the same `fstat`-derived mtime). Shared
// (not exclusive) borrow through `RefPtr: Deref` is what keeps the
// `&mut` aliasing hazard away under `bun bd` (ASAN + Rust's UB rules).
// Regression guard for oven-sh/bun#30800 (`Store::data_mut` is now an
// `unsafe fn`; `last_modified` converted to atomic to match the
// threading reality).
test("Bun.file().bytes() is safe under high concurrency", async () => {
  const dir = tempDirWithFiles(
    "bun-blob-concurrent",
    Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [
        `f${i}.txt`,
        `content-${i}-${Buffer.alloc(1024, 65 + (i % 26)).toString()}`,
      ]),
    ),
  );
  // Many overlapping reads per file; each goes through a distinct `ReadFile`
  // task on the threadpool, and all 8 per file share ONE `Store` (the
  // `Blob` is constructed once and its `RefPtr<Store>` cloned per task).
  // The test asserts every task returns the full, uncorrupted file bytes.
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
