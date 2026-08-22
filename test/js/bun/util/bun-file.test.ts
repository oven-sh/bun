import { describe, expect, test } from "bun:test";
import { closeSync, mkdirSync, openSync, unlinkSync } from "fs";
import fsPromises from "fs/promises";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

test("delete() and stat() should work with unicode paths", async () => {
  await using dir = tempDir("delete-stat-unicode-path", {
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
  await using dir = tempDir("writer-end-fd", {
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
  await using dir = tempDir("bun-write-async-stack", { "blocker.txt": "x" });
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

// A BunFile stats lazily. A stat that fails (the file does not exist yet) must
// not be cached as "empty file" on the handle. exists() must stat every time it
// is called, and must not turn the size it saw into a limit on later reads.
describe.concurrent("BunFile does not cache a failed stat", () => {
  test("exists() sees a file created after it answered false, and reads see the contents", async () => {
    await using dir = tempDir("bun-file-created-later", {});
    const path = join(dir, "f.txt");
    const file = Bun.file(path);

    expect(await file.exists()).toBe(false);

    await Bun.write(path, "hello world");

    expect(await file.exists()).toBe(true);
    expect(await file.text()).toBe("hello world");
    expect(await file.bytes()).toEqual(new TextEncoder().encode("hello world"));
    expect(await new Response(file.stream()).text()).toBe("hello world");
    expect(file.size).toBe(11);
  });

  test(".size of a missing file is 0 and does not cap reads once the file exists", async () => {
    await using dir = tempDir("bun-file-size-before-create", {});
    const path = join(dir, "f.txt");
    const file = Bun.file(path);

    expect(file.size).toBe(0);
    expect(await file.exists()).toBe(false);
    // A cached size of 0 used to turn this into an empty Blob with no file behind it.
    const sliceBeforeCreate = file.slice(0, 5);

    await Bun.write(path, "hello world");

    expect(file.size).toBe(11);
    expect(await file.text()).toBe("hello world");
    expect(await file.slice(0, 5).text()).toBe("hello");
    expect(await sliceBeforeCreate.text()).toBe("hello");
  });

  test("structuredClone() of a missing file does not empty the source handle or shrink a slice of it", async () => {
    await using dir = tempDir("bun-file-clone-before-create", {});
    const path = join(dir, "f.txt");
    const whole = Bun.file(path);
    const slice = Bun.file(path).slice(6, 11);

    const clones = [structuredClone(whole), structuredClone(slice)];
    expect([whole.size, slice.size]).toEqual([0, 5]);

    await Bun.write(path, "hello world");

    expect(await Promise.all([whole.text(), slice.text(), clones[0].text(), clones[1].text()])).toEqual([
      "hello world",
      "world",
      "hello world",
      "world",
    ]);
    expect([whole.size, slice.size]).toEqual([11, 5]);
  });

  // https://github.com/oven-sh/bun/issues/4930
  test("exists() on the destination does not make Bun.write(destination, Bun.file(source)) copy 0 bytes", async () => {
    await using dir = tempDir("bun-file-copy-after-exists", {
      "source.txt": "copied through Bun.write",
    });
    const destinationPath = join(dir, "destination.txt");
    const destination = Bun.file(destinationPath);

    expect(await destination.exists()).toBe(false);
    expect(destination.size).toBe(0);

    // The resolved byte count is not checked: on Windows the file-to-file copy
    // resolves with 0 whatever it copied. The content is what #4930 is about.
    await Bun.write(destination, Bun.file(join(dir, "source.txt")));

    expect(await Bun.file(destinationPath).text()).toBe("copied through Bun.write");
    expect(await destination.text()).toBe("copied through Bun.write");
    expect(await destination.exists()).toBe(true);
  });

  // https://github.com/oven-sh/bun/issues/22456: the same copy, with a
  // destination that already exists and is shorter than the source.
  test("exists() on a shorter existing destination does not cap Bun.write(destination, Bun.file(source)) at its old size", async () => {
    await using dir = tempDir("bun-file-copy-over-shorter", {
      "source.txt": "this is a long long long long line",
      "destination.txt": "short line",
    });
    const destinationPath = join(dir, "destination.txt");
    const destination = Bun.file(destinationPath);

    expect(await destination.exists()).toBe(true);

    await Bun.write(destination, Bun.file(join(dir, "source.txt")));

    expect(await Bun.file(destinationPath).text()).toBe("this is a long long long long line");
    expect(await destination.text()).toBe("this is a long long long long line");
  });

  // https://github.com/oven-sh/bun/issues/22484
  test("exists() and lastModified follow the file through delete and create again", async () => {
    await using dir = tempDir("bun-file-exists-live", { "f.txt": "first" });
    const path = join(dir, "f.txt");
    const file = Bun.file(path);
    // At every step the old handle must answer like a handle created right now.
    const observe = async () => ({
      exists: await file.exists(),
      lastModified: file.lastModified,
      freshLastModified: Bun.file(path).lastModified,
    });

    const created = await observe();
    unlinkSync(path);
    const deleted = await observe();
    // The failed stat also dropped the size exists() cached while the file was there.
    const sizeWhileDeleted = file.size;
    await Bun.write(path, "second");
    const recreated = await observe();

    expect([created.exists, deleted.exists, recreated.exists]).toEqual([true, false, true]);
    expect(created.lastModified).toBe(created.freshLastModified);
    expect(deleted.lastModified).toBe(deleted.freshLastModified);
    expect(recreated.lastModified).toBe(recreated.freshLastModified);
    expect({ sizeWhileDeleted, size: file.size, text: await file.text() }).toEqual({
      sizeWhileDeleted: 0,
      size: 6,
      text: "second",
    });
  });

  // A stat can fail for a reason other than ENOENT. That failure is not cached
  // either: reads keep reporting the real error, and once the path is usable
  // the same handle works.
  test("a stat that fails with ENOTDIR is not cached on the handle", async () => {
    await using dir = tempDir("bun-file-enotdir", { blocker: "not a directory" });
    const blocker = join(dir, "blocker");
    const path = join(blocker, "f.txt");
    const file = Bun.file(path);

    expect(file.size).toBe(0);
    expect(await file.exists()).toBe(false);
    const error = await file.text().catch(e => e);
    // Windows reports a path through a regular file as ENOENT.
    expect(error.code).toBe(isWindows ? "ENOENT" : "ENOTDIR");

    unlinkSync(blocker);
    mkdirSync(blocker);
    await Bun.write(path, "hello world");

    expect(await file.exists()).toBe(true);
    expect(await file.text()).toBe("hello world");
    expect(file.size).toBe(11);
  });

  // https://github.com/oven-sh/bun/issues/23902
  test("exists() on an existing file does not cap later reads at the size the file had then", async () => {
    await using dir = tempDir("bun-file-exists-then-grow", { "f.txt": "asdf" });
    const file = Bun.file(join(dir, "f.txt"));

    expect(await file.exists()).toBe(true);

    const read: string[] = [];
    for (const data of ["asdfasdf", "asdfasdfasdf", "as"]) {
      await file.write(data);
      read.push(await file.text());
    }
    expect(read).toEqual(["asdfasdf", "asdfasdfasdf", "as"]);
  });

  test("exists() on a slice stats the file and keeps the slice window", async () => {
    await using dir = tempDir("bun-file-slice-exists", { "f.txt": "hello world", "empty.txt": "" });

    expect(await Bun.file(join(dir, "f.txt")).slice(0, 5).exists()).toBe(true);
    expect(await Bun.file(join(dir, "missing.txt")).slice(0, 5).exists()).toBe(false);

    // The file is empty when exists() stats it, through the slice or through the
    // handle it is taken from. Both slices still span 5 bytes once the file has them.
    const emptyPath = join(dir, "empty.txt");
    const slice = Bun.file(emptyPath).slice(0, 5);
    expect(await slice.exists()).toBe(true);
    const whole = Bun.file(emptyPath);
    expect(await whole.exists()).toBe(true);
    const sliceAfterExists = whole.slice(0, 5);
    await Bun.write(emptyPath, "hello world");
    expect({ size: slice.size, text: await slice.text(), viaWhole: await sliceAfterExists.text() }).toEqual({
      size: 5,
      text: "hello",
      viaWhole: "hello",
    });
  });

  // Bun.file(fd) goes through the same stat cache, with fstat in place of stat.
  // Serial: a concurrent test could open a file and get the closed descriptor
  // number back before this test stats it again.
  test.serial.skipIf(isWindows)("Bun.file(fd) exists() follows the descriptor", async () => {
    await using dir = tempDir("bun-file-fd-exists", { "f.txt": "hello" });
    const path = join(dir, "f.txt");
    const fd = openSync(path, "r");
    const file = Bun.file(fd);
    let whileOpen: { exists: boolean; lastModified: number };
    try {
      whileOpen = { exists: await file.exists(), lastModified: file.lastModified };
    } finally {
      closeSync(fd);
    }
    const existsAfterClose = file.exists();
    const sizeAfterClose = file.size;

    expect(whileOpen).toEqual({ exists: true, lastModified: Bun.file(path).lastModified });
    expect({ exists: await existsAfterClose, size: sizeAfterClose }).toEqual({ exists: false, size: 0 });
  });
});

test("Bun.file().json() with UTF-8 BOM does not free an interior pointer", async () => {
  // When a file starts with EF BB BF, the BOM is stripped before parsing and
  // the temporary read buffer is freed. Previously the *post-strip* slice was
  // passed to the allocator, handing mimalloc `raw.ptr + 3` instead of `raw.ptr`.
  // In debug builds this surfaces as "mimalloc: error: mi_free: invalid
  // (unaligned) pointer" on stderr; in release it silently corrupts the heap.
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  await using dir = tempDir("bun-file-json-bom", {
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
