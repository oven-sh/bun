import { expect, test } from "bun:test";
import fsPromises from "fs/promises";
import { bunEnv, bunExe, tempDir } from "harness";
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

test("Bun.file() with a Buffer/Uint8Array path survives GC of the blobs", async () => {
  // The file store used to protect() the path's JS buffer and never release
  // it, and unpinned it from the Blob's GC destructor (touching a JS cell
  // mid-sweep). Now it holds the backing store directly: the blobs and the
  // buffers are both collectable, and reads still see the path.
  await using dir = tempDir("bun-file-buffer-path-gc", {
    "hello.txt": "hello",
    "run.js": `
      const { join } = require("path");
      const { heapStats } = require("bun:jsc");
      const existing = join(process.argv[2], "hello.txt");
      // A Buffer over 1000 bytes starts out without an ArrayBuffer behind it. Pad
      // with "./" by hand (join() would normalize it away) to just past that,
      // staying under macOS's 1024-byte PATH_MAX. Not on Windows: Bun.write hands
      // libuv the raw path, and 1000 un-normalized chars is past MAX_PATH there.
      const pad = process.platform === "win32" ? "" : Buffer.alloc(Math.ceil((1004 - process.argv[2].length) / 2) * 2, "./").toString();
      const longDir = process.argv[2] + "/" + pad;
      const existingLong = longDir + "hello.txt";
      const protectedBefore = heapStats().protectedObjectCount;
      const uint8Before = heapStats().objectTypeCounts.Uint8Array ?? 0;
      for (let i = 0; i < 2000; i++) {
        Bun.file(Buffer.from(join(process.argv[2], "missing-" + i)));
        Bun.file(new TextEncoder().encode(join(process.argv[2], "missing-u8-" + i)));
        Bun.file(new TextEncoder().encode(join(process.argv[2], "missing-ab-" + i)).buffer);
        if (i % 8 === 0) Bun.file(Buffer.from(longDir + "no-" + (i % 10)));
      }
      const keep = [
        Bun.file(Buffer.from(existing)),
        Bun.file(new TextEncoder().encode(existing)),
        Bun.file(new TextEncoder().encode(existing).buffer),
        Bun.file(Buffer.from(existingLong)),
      ];
      Bun.gc(true);
      Bun.gc(true);
      const stats = heapStats();
      // The threadpool open/copy paths read the store's path off the JS thread.
      await Bun.write(Bun.file(Buffer.from(longDir + "sub/out.txt")), Buffer.alloc(300 * 1024, "x").toString());
      await Bun.write(Bun.file(new TextEncoder().encode(longDir + "copy.txt")), keep[3]);
      console.log(JSON.stringify({
        longPathBytes: pad === "" || (Buffer.from(existingLong).length > 1000 && Buffer.from(existingLong).length < 1024),
        exists: await Promise.all(keep.map(f => f.exists())),
        text: await Promise.all(keep.map(f => f.text())),
        written: [(await Bun.file(longDir + "sub/out.txt").text()).length, await Bun.file(longDir + "copy.txt").text()],
        missing: await Bun.file(Buffer.from(join(process.argv[2], "missing-0"))).exists(),
        leakedProtects: stats.protectedObjectCount - protectedBefore > 100,
        leakedBuffers: (stats.objectTypeCounts.Uint8Array ?? 0) - uint8Before > 100,
      }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(dir, "run.js"), dir],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    longPathBytes: true,
    exists: [true, true, true, true],
    text: ["hello", "hello", "hello", "hello"],
    written: [300 * 1024, "hello"],
    missing: false,
    leakedProtects: false,
    leakedBuffers: false,
  });
  expect(exitCode).toBe(0);
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
