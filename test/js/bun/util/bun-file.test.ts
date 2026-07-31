import { describe, expect, test } from "bun:test";
import { randomBytes } from "crypto";
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

describe("Bun.file().text()", () => {
  test.each([
    ["ascii", Buffer.from(Buffer.alloc(1000, "hello world\n").toString())],
    ["utf8-multibyte", Buffer.from(Buffer.alloc(1000, "héllo wörld 🎉\n").toString())],
    ["utf8-bom", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello bom\n")])],
    ["utf16le-bom", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hello utf16\n", "utf16le")])],
    ["invalid-utf8", Buffer.from([0x80, 0x81, 0x82, 0xff, 0xfd, 0xc0, 0xc1])],
    ["bom-only", Buffer.from([0xef, 0xbb, 0xbf])],
    ["empty", Buffer.from([])],
  ])("decodes %s identically to in-memory Blob", async (name, bytes) => {
    using dir = tempDir("bun-file-text-decode", { "data.bin": bytes });
    const viaFile = await Bun.file(join(dir, "data.bin")).text();
    const viaBlob = await new Blob([bytes]).text();
    expect(viaFile).toBe(viaBlob);
  });

  // The POSIX ReadFile task runs the UTF-8 decode on the work pool; on
  // Windows ReadFileUV delivers bytes on the uv loop thread, so the decode
  // still happens inline there.
  test.skipIf(isWindows)("does not block the event loop while decoding", async () => {
    using dir = tempDir("bun-file-text-loop", {});
    // Random bytes force the invalid-UTF-8 slow path, which is where the
    // on-thread decode was most visible.
    const big = join(dir, "big.bin");
    await Bun.write(big, randomBytes(8 * 1024 * 1024));

    const probe = `
      let last = performance.now(), maxGap = 0;
      const iv = setInterval(() => {
        const n = performance.now();
        if (n - last > maxGap) maxGap = n - last;
        last = n;
      }, 1);
      await new Promise(r => setTimeout(r, 20));
      maxGap = 0;
      last = performance.now();
      const t0 = performance.now();
      const s = await Bun.file(process.env.BIG_FILE).text();
      const n = performance.now();
      if (n - last > maxGap) maxGap = n - last;
      clearInterval(iv);
      console.log(JSON.stringify({ dur: n - t0, maxGap, len: s.length }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", probe],
      env: { ...bunEnv, BIG_FILE: big },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { dur, maxGap, len } = JSON.parse(stdout);
    expect(len).toBeGreaterThan(0);
    expect(exitCode).toBe(0);
    // When the decode ran on the JS thread the heartbeat stalled for the
    // whole decode, so maxGap was essentially equal to dur. With the decode
    // on the work pool the loop keeps ticking throughout. Skip the ratio
    // check when the whole operation was faster than setInterval can
    // meaningfully sample.
    if (dur < 50) return;
    expect(maxGap).toBeLessThan(dur / 2);
  });
});
