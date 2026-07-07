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

describe("BunFile exists()/size/lastModified reflect the current filesystem state", () => {
  test("exists() sees a file deleted after the first call", async () => {
    using dir = tempDir("bunfile-stat-deleted", {});
    const p = join(String(dir), "a");
    fs.writeFileSync(p, "abc");
    const f = Bun.file(p);
    expect(await f.exists()).toBe(true);
    expect(f.size).toBe(3);
    fs.unlinkSync(p);
    expect({ exists: await f.exists(), size: f.size, truth: fs.existsSync(p) }).toEqual({
      exists: false,
      size: 0,
      truth: false,
    });
  });

  test("exists() sees a file created after the first call, and reads its contents", async () => {
    using dir = tempDir("bunfile-stat-created", {});
    const p = join(String(dir), "b");
    const f = Bun.file(p);
    expect(await f.exists()).toBe(false);
    fs.writeFileSync(p, "content");
    expect({ exists: await f.exists(), size: f.size, text: await f.text() }).toEqual({
      exists: true,
      size: 7,
      text: "content",
    });
  });

  test("size and lastModified track changes to the underlying file", async () => {
    using dir = tempDir("bunfile-stat-changed", {});
    const p = join(String(dir), "c");
    fs.writeFileSync(p, "0123456789");
    const f = Bun.file(p);
    expect(f.size).toBe(10);
    const firstMtime = f.lastModified;
    fs.appendFileSync(p, "0123456789");
    fs.utimesSync(p, 1000, 2000);
    expect({ size: f.size, lastModified: f.lastModified }).toEqual({
      size: fs.statSync(p).size,
      lastModified: fs.statSync(p).mtimeMs,
    });
    expect(f.lastModified).not.toBe(firstMtime);
  });

  test("polling exists() observes create and delete", async () => {
    using dir = tempDir("bunfile-stat-poll", {});
    const p = join(String(dir), "d");
    const f = Bun.file(p);
    const seen: boolean[] = [];
    seen.push(await f.exists());
    fs.writeFileSync(p, "x");
    seen.push(await f.exists());
    fs.unlinkSync(p);
    seen.push(await f.exists());
    fs.writeFileSync(p, "y");
    seen.push(await f.exists());
    expect(seen).toEqual([false, true, false, true]);
    expect(await f.text()).toBe("y");
  });

  test("slice() size is preserved across re-stat", async () => {
    using dir = tempDir("bunfile-stat-slice", {});
    const p = join(String(dir), "e");
    fs.writeFileSync(p, "0123456789");
    const f = Bun.file(p);
    const s = f.slice(0, 5);
    expect(s.size).toBe(5);
    expect(await s.exists()).toBe(true);
    fs.appendFileSync(p, "0123456789");
    expect({ whole: f.size, slice: s.size }).toEqual({ whole: 20, slice: 5 });
  });

  test("slice() size is preserved for non-seekable and missing files", () => {
    using dir = tempDir("bunfile-stat-slice-edge", {});
    // A slice bound must survive a re-stat that cannot produce a regular-file
    // size: a missing file has no stat, and a char device has no st_size.
    expect(Bun.file(join(String(dir), "missing")).slice(0, 5).size).toBe(5);
    if (isPosix) {
      expect(Bun.file("/dev/null").slice(0, 5).size).toBe(5);
    }
  });
});
