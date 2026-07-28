import { describe, expect, test } from "bun:test";
import fs from "fs";
import fsPromises from "fs/promises";
import { bunEnv, bunExe, isPosix, tempDir, tempDirWithFiles } from "harness";
import { join } from "path";

test("delete() and stat() should work with unicode paths", async () => {
  const dir = tempDirWithFiles("delete-stat-unicode-path", {
    "another-file.txt": "HEY",
  });
  const filename = join(dir, "🌟.txt");

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
  const dir = tempDirWithFiles("writer-end-fd", {
    "tmp.txt": "HI",
  });
  const filename = join(dir, "tmp.txt");

  for (let i = 0; i < 30; i++) {
    const fileHandle = await fsPromises.open(filename, "w", 0o666);
    const fd = fileHandle.fd;

    await Bun.file(fd).writer().end();
    await fileHandle.close();
    expect(await Bun.file(filename).text()).toBe("");
  }
});

test("Bun.file() read errors include async stack frames", async () => {
  async function level2() {
    await Bun.file("/nonexistent-path/does-not-exist.txt").text();
  }
  async function level1() {
    await level2();
  }

  let caught: any;
  try {
    await level1();
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeDefined();
  expect(caught.code).toBe("ENOENT");
  expect(caught.stack).toContain("at async level2");
  expect(caught.stack).toContain("at async level1");
});

test("Bun.write() errors include async stack frames", async () => {
  // Use a file-as-directory-component path so it fails on both POSIX and
  // Windows. Bun.write recursively creates directories, so a plain
  // /nonexistent-path/ would succeed on Windows where / is the drive root.
  const dir = tempDirWithFiles("bun-write-async-stack", { "blocker.txt": "x" });
  const badPath = join(dir, "blocker.txt", "cannot-write.txt");
  // Bun.write uses a sync fast path for inputs under 256KB on POSIX — use
  // 512KB to force the async (threadpool) path so we're actually testing the
  // rejected-from-native-callback stack attachment.
  const bigData = Buffer.alloc(512 * 1024, 0x78);

  async function level2() {
    await Bun.write(badPath, bigData);
  }
  async function level1() {
    await level2();
  }

  let caught: any;
  try {
    await level1();
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeDefined();
  expect(["ENOTDIR", "ENOENT", "EEXIST"]).toContain(caught.code);
  expect(caught.stack).toContain("at async level2");
  expect(caught.stack).toContain("at async level1");
});

test("Bun.file().arrayBuffer() errors include async stack frames", async () => {
  async function caller() {
    await Bun.file("/nonexistent-path/x.bin").arrayBuffer();
  }

  let caught: any;
  try {
    await caller();
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeDefined();
  expect(caught.code).toBe("ENOENT");
  expect(caught.stack).toContain("at async caller");
});

test("Bun.file().json() with UTF-8 BOM does not free an interior pointer", async () => {
  // When a file starts with EF BB BF, the BOM is stripped before parsing and
  // the temporary read buffer is freed. Previously the *post-strip* slice was
  // passed to the allocator, handing mimalloc `raw.ptr + 3` instead of `raw.ptr`.
  // In debug builds this surfaces as "mimalloc: error: mi_free: invalid
  // (unaligned) pointer" on stderr; in release it silently corrupts the heap.
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const dir = tempDirWithFiles("bun-file-json-bom", {
    // pure-ASCII body: exercises the direct ZigString path
    "ascii.json": Buffer.concat([bom, Buffer.from(JSON.stringify({ a: 1, b: "two" }))]),
    // non-ASCII body: exercises the toUTF16Alloc path
    "utf8.json": Buffer.concat([bom, Buffer.from(JSON.stringify({ s: "wörld" }))]),
    // BOM only: exercises the empty-after-strip rejection path
    "empty.json": Buffer.from(bom),
    "read.js": `
      const { join } = require("path");
      const dir = process.argv[2];
      const ascii = await Bun.file(join(dir, "ascii.json")).json();
      const utf8 = await Bun.file(join(dir, "utf8.json")).json();
      let emptyErr;
      try {
        await Bun.file(join(dir, "empty.json")).json();
      } catch (e) {
        emptyErr = e.message;
      }
      console.log(JSON.stringify({ ascii, utf8, emptyErr }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "read.js"), dir],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    ascii: { a: 1, b: "two" },
    utf8: { s: "wörld" },
    emptyErr: "Unexpected end of JSON input",
  });
  expect(exitCode).toBe(0);
});

// A `Bun.file(p).slice(a, b)` keeps the parent's pathlike store, so
// `.delete()` unlinked the whole file and `.writer()`/`.write()` truncated
// it and wrote at offset 0, ignoring the [a, b) window. A byte-range view
// has no sensible whole-file mutation semantics, so these now throw.
describe("Bun.file().slice() is a read-only view", () => {
  async function tryOp(fn: () => unknown) {
    try {
      return { err: null, result: await fn() };
    } catch (err) {
      return { err, result: null };
    }
  }

  test.concurrent.each([
    ["slice(2, 5)", (f: ReturnType<typeof Bun.file>) => f.slice(2, 5)],
    ["slice(5)", (f: ReturnType<typeof Bun.file>) => f.slice(5)],
    ["slice(0, 3)", (f: ReturnType<typeof Bun.file>) => f.slice(0, 3)],
    ["slice(-3)", (f: ReturnType<typeof Bun.file>) => f.slice(-3)],
    ["slice().slice(2, 5)", (f: ReturnType<typeof Bun.file>) => f.slice().slice(2, 5)],
  ] as const)("%s: delete()/writer()/write()/Bun.write() throw and leave the file intact", async (_label, slicer) => {
    using dir = tempDir("bun-file-slice-mutate", { "f.txt": "0123456789" });
    const p = join(String(dir), "f.txt");

    // .delete() / .unlink()
    {
      const { err } = await tryOp(() => slicer(Bun.file(p)).delete());
      expect({ err, after: fs.readFileSync(p, "utf8") }).toEqual({
        err: expect.any(TypeError),
        after: "0123456789",
      });
      expect((err as Error).message).toContain("sliced Bun.file()");
    }

    // .writer()
    {
      const { err } = await tryOp(() => slicer(Bun.file(p)).writer());
      expect({ err, after: fs.readFileSync(p, "utf8") }).toEqual({
        err: expect.any(TypeError),
        after: "0123456789",
      });
      expect((err as Error).message).toContain("sliced Bun.file()");
    }

    // .write()
    {
      const { err } = await tryOp(() => slicer(Bun.file(p)).write("XY"));
      expect({ err, after: fs.readFileSync(p, "utf8") }).toEqual({
        err: expect.any(TypeError),
        after: "0123456789",
      });
      expect((err as Error).message).toContain("sliced Bun.file()");
    }

    // Bun.write(dest=slice, ...)
    {
      const { err } = await tryOp(() => Bun.write(slicer(Bun.file(p)), "XY"));
      expect({ err, after: fs.readFileSync(p, "utf8") }).toEqual({
        err: expect.any(TypeError),
        after: "0123456789",
      });
      expect((err as Error).message).toContain("sliced Bun.file()");
    }
  });

  test.concurrent("un-sliced Bun.file() can still delete()/writer()/write() after reading .size", async () => {
    using dir = tempDir("bun-file-unsliced-ops", { "f.txt": "0123456789" });
    const p = join(String(dir), "f.txt");

    // Reading .size resolves the stat size into blob.size (so it is no
    // longer MAX_SIZE); this must not be mistaken for a slice.
    {
      const f = Bun.file(p);
      expect(f.size).toBe(10);
      await f.write("abc");
      expect(fs.readFileSync(p, "utf8")).toBe("abc");
    }
    {
      fs.writeFileSync(p, "0123456789");
      const f = Bun.file(p);
      expect(f.size).toBe(10);
      await Bun.write(f, "xyz");
      expect(fs.readFileSync(p, "utf8")).toBe("xyz");
    }
    {
      fs.writeFileSync(p, "0123456789");
      const f = Bun.file(p);
      expect(f.size).toBe(10);
      const w = f.writer();
      w.write("hello world");
      await w.end();
      expect(fs.readFileSync(p, "utf8")).toBe("hello world");
    }
    {
      fs.writeFileSync(p, "0123456789");
      const f = Bun.file(p);
      expect(f.size).toBe(10);
      await f.delete();
      expect(fs.existsSync(p)).toBe(false);
    }
  });

  test.concurrent("structuredClone of a slice is also a read-only view", async () => {
    using dir = tempDir("bun-file-slice-clone", { "f.txt": "0123456789" });
    const p = join(String(dir), "f.txt");

    const clone = structuredClone(Bun.file(p).slice(2, 5));
    expect(await clone.text()).toBe("234");

    const { err } = await tryOp(() => clone.delete());
    expect({ err, after: fs.readFileSync(p, "utf8") }).toEqual({
      err: expect.any(TypeError),
      after: "0123456789",
    });
    expect(() => Bun.write(clone, "XY")).toThrow(TypeError);
    expect(fs.readFileSync(p, "utf8")).toBe("0123456789");
  });

  test.concurrent("structuredClone of an un-sliced Bun.file() can still write after .size was read", async () => {
    using dir = tempDir("bun-file-unsliced-clone", { "f.txt": "0123456789" });
    const p = join(String(dir), "f.txt");
    const f = Bun.file(p);
    expect(f.size).toBe(10);
    const clone = structuredClone(f);
    await Bun.write(clone, "abc");
    expect(fs.readFileSync(p, "utf8")).toBe("abc");
  });

  // `exists()` reads `file.mode` from the store, which is only populated by
  // `resolve_size()`. A slice's `size` is concrete so `resolve_size()` was
  // skipped and `exists()` returned false while `stat()` succeeded.
  test.concurrent("slice().exists() agrees with slice().stat()", async () => {
    using dir = tempDir("bun-file-slice-exists", { "f.txt": "0123456789" });
    const p = join(String(dir), "f.txt");
    const sl = Bun.file(p).slice(2, 5);
    expect({
      exists: await sl.exists(),
      statSize: (await sl.stat()).size,
      text: await sl.text(),
    }).toEqual({
      exists: true,
      statSize: 10,
      text: "234",
    });
  });
});

// The threadpool ReadFile loop caps each read by `max_length - read_off`, but
// `read_off` was never advanced on POSIX, so a character-device slice kept
// reading whole 64 KiB stack-buffer chunks and returned the next multiple of
// 64 KiB above the requested length (1_000_000 -> 1_048_576).
describe.skipIf(!isPosix)("Bun.file(chardev).slice().bytes() returns exactly the requested length", () => {
  test.concurrent.each([1, 4095, 4096, 4097, 65535, 65536, 65537, 1_000_000])("%d bytes", async n => {
    const bytes = await Bun.file("/dev/zero").slice(0, n).bytes();
    expect(bytes.length).toBe(n);
    expect(bytes[0]).toBe(0);
    expect(bytes[n - 1]).toBe(0);
  });
});
