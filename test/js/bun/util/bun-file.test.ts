import { describe, expect, test } from "bun:test";
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

// Bun.file(<chardev>).slice(a, b): the slice window must be enforced on
// sources whose stat size is unknown (character devices). Previously the
// buffered consumers rounded up to the internal read-chunk quantum and
// .stream() delivered the window but never closed.
describe.skipIf(!isPosix)("Bun.file().slice() on a character device", () => {
  const cases = [
    [0, 1],
    [0, 100_000],
    [0, 999_999],
    [0, 1_000_000],
    [500_000, 1_500_000],
  ] as const;

  test.concurrent.each(cases)(".arrayBuffer()/.bytes()/.text() return exactly the window [%i, %i)", async (a, b) => {
    const want = b - a;
    const sl = Bun.file("/dev/zero").slice(a, b);
    expect(sl.size).toBe(want);

    const buf = await sl.arrayBuffer();
    expect(buf.byteLength).toBe(want);

    const bytes = await Bun.file("/dev/zero").slice(a, b).bytes();
    expect(bytes.byteLength).toBe(want);

    const text = await Bun.file("/dev/zero").slice(a, b).text();
    expect(text.length).toBe(want);
  });

  test.concurrent("buffered read returns the window's contents", async () => {
    const bytes = await Bun.file("/dev/zero").slice(0, 100_000).bytes();
    expect(bytes.byteLength).toBe(100_000);
    expect(Buffer.from(bytes.buffer).equals(Buffer.alloc(100_000))).toBe(true);
  });

  test.concurrent("/dev/urandom .bytes() returns exactly the slice length", async () => {
    const bytes = await Bun.file("/dev/urandom").slice(0, 999_999).bytes();
    expect(bytes.byteLength).toBe(999_999);
  });

  test.concurrent.each(cases)(".stream() delivers exactly the window [%i, %i) and then closes", async (a, b) => {
    const want = b - a;
    let got = 0;
    for await (const chunk of Bun.file("/dev/zero").slice(a, b).stream()) {
      got += chunk.byteLength;
    }
    expect(got).toBe(want);
  });

  test.concurrent(".stream() getReader().read() resolves done after the window", async () => {
    const reader = Bun.file("/dev/zero").slice(0, 1_000_000).stream().getReader();
    let got = 0;
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      got += r.value.byteLength;
    }
    expect(got).toBe(1_000_000);
  });
});

// Same slice-window exhaustion applies to regular files larger than the
// streaming read buffer: the window is satisfied mid-read instead of at EOF,
// so the reader must close itself (https://github.com/oven-sh/bun/issues/31675).
test.concurrent("Bun.file().slice(start, end).stream() resolves on a file larger than the read buffer", async () => {
  const size = 1024 * 1024;
  const data = Buffer.alloc(size);
  for (let i = 0; i < size; i++) data[i] = i % 251;
  using dir = tempDir("bun-file-slice-stream", { "data.bin": data });
  const p = join(String(dir), "data.bin");

  const small = Buffer.from(await Bun.file(p).slice(100, 1124).stream().bytes());
  expect(small.equals(data.subarray(100, 1124))).toBe(true);

  const spanStart = 1000;
  const spanEnd = spanStart + 600 * 1024;
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.file(p).slice(spanStart, spanEnd).stream()) {
    chunks.push(chunk);
  }
  expect(Buffer.concat(chunks).equals(data.subarray(spanStart, spanEnd))).toBe(true);

  const empty = await Bun.file(p).slice(500, 500).stream().bytes();
  expect(empty.byteLength).toBe(0);
});
