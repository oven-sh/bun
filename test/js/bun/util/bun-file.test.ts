import { describe, expect, test } from "bun:test";
import fs from "fs";
import fsPromises from "fs/promises";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, MAX_PATH_BYTES, tempDir } from "harness";
import { join, sep } from "path";
import { pathToFileURL } from "url";

test("delete() and stat() should work with unicode paths", async () => {
  await using dir = tempDir("delete-stat-unicode-path", {
    "another-file.txt": "HEY",
  });
  const filename = join(dir, "🌟.txt");

  await expect(async () => {
    await Bun.file(filename).delete();
  }).toThrow(`ENOENT: no such file or directory, unlink '${filename}'`);

  await expect(async () => {
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

test("Bun.file() copies a Uint8Array path", async () => {
  using dir = tempDir("bun-file-buffer-path", { "a.txt": "a", "b.txt": "b" });
  const path = new TextEncoder().encode(join(String(dir), "a.txt"));
  const file = Bun.file(path);
  path[path.length - "a.txt".length] = "b".charCodeAt(0);
  expect({ name: file.name, text: await file.text() }).toEqual({ name: join(String(dir), "a.txt"), text: "a" });
});

test("a Uint8Array path can still be transferred after Bun.file()", async () => {
  using dir = tempDir("bun-file-buffer-path", { "a.txt": "a" });
  const path = new TextEncoder().encode(join(String(dir), "a.txt"));
  const file = Bun.file(path);
  path.buffer.transfer();
  expect({ byteLength: path.byteLength, text: await file.text() }).toEqual({ byteLength: 0, text: "a" });
});

test.concurrent.each([
  "Bun.file(path.slice())",
  "s3.file(path.slice())",
  'await Bun.write(path.slice(), new Blob(["x"]))',
])("%s doesn't keep the Uint8Array path alive", async call => {
  using dir = tempDir("bun-file-buffer-path", {});
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const path = new TextEncoder().encode(require("path").join(process.argv[1], "x"));
        const s3 = new Bun.S3Client({ accessKeyId: "a", secretAccessKey: "b", bucket: "c" });
        for (let i = 0; i < 200; i++) ${call};
        Bun.gc(true);
        console.log(require("bun:jsc").heapStats().objectTypeCounts.Uint8Array, path.length > 0);`,
      String(dir),
    ],
    env: bunEnv,
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const [live, pathIsAlive] = stdout.trim().split(" ");
  expect(pathIsAlive).toBe("true");
  expect(Number(live)).toBeWithin(1, 50);
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/49604
// No folder name is over NAME_MAX, so only the length of the whole path is at fault.
describe.each([MAX_PATH_BYTES, MAX_PATH_BYTES + 70_000, 1 << 20])("Bun.file() with a path of %d bytes", length => {
  const written = (start: string) =>
    (start + Buffer.alloc(length, "a" + sep).toString()).slice(0, length - 2) + sep + "b";
  const absolute = written(isWindows ? "C:\\" : "/");
  const paths: [string, () => string | Uint8Array | URL, string][] = [
    ["a string", () => absolute, absolute],
    ["a relative string", () => written(""), written("")],
    ["a Uint8Array", () => new TextEncoder().encode(absolute), absolute],
    ["a file: URL", () => pathToFileURL(absolute), absolute],
  ];

  test.each(paths)("given as %s, fails when the file is used", async (_, path, name) => {
    const file = Bun.file(path());
    // On Windows libuv does most of these, and what it answers for such a path is its own.
    const failed = (syscall: string) =>
      isWindows
        ? { code: expect.stringMatching(/^(ENAMETOOLONG|ENOENT|EINVAL)$/), syscall: expect.any(String), path: name }
        : { code: "ENAMETOOLONG", syscall, path: name };
    const failure = (promise: Promise<unknown>) =>
      promise.then(
        () => "resolved",
        ({ code, syscall, path }) => ({ code, syscall, path }),
      );
    expect({
      name: file.name,
      size: file.size,
      exists: await file.exists(),
      stat: await failure(file.stat()),
      text: await failure(file.text()),
      bytes: await failure(file.bytes()),
      arrayBuffer: await failure(file.arrayBuffer()),
      json: await failure(file.json()),
      unlink: await failure(file.unlink()),
      response: await failure(new Response(file).text()),
      // A file that has given its size gives a slice of that size.
      slice: await failure(Bun.file(path()).slice(0, 1).text()),
    }).toEqual({
      name,
      size: 0,
      exists: false,
      stat: failed("stat"),
      text: failed("open"),
      bytes: failed("open"),
      arrayBuffer: failed("open"),
      json: failed("open"),
      unlink: failed("unlink"),
      response: failed("open"),
      slice: failed("open"),
    });
  });

  test("fs.openAsBlob() and structuredClone() give a file that fails the same way", async () => {
    const blob = await fs.openAsBlob(absolute);
    const clone = structuredClone(Bun.file(absolute));
    const code = ({ code }: NodeJS.ErrnoException) => code;
    const refused = isWindows ? expect.stringMatching(/^(ENAMETOOLONG|ENOENT|EINVAL)$/) : "ENAMETOOLONG";
    expect({
      blob: await blob.text().catch(code),
      clone: await clone.text().catch(code),
      cloneName: clone.name,
    }).toEqual({ blob: refused, clone: refused, cloneName: absolute });
  });
});

test.skipIf(isWindows)("a path one byte under the limit still reaches the disk", async () => {
  using dir = tempDir("bun-file-long-path", {});
  const folder = "/" + Buffer.alloc(99, "a").toString();
  const path = (String(dir) + Buffer.alloc(MAX_PATH_BYTES, folder).toString()).slice(0, MAX_PATH_BYTES - 3) + "/b";
  expect(path.length).toBe(MAX_PATH_BYTES - 1);
  expect(await Bun.file(path).exists()).toBe(false);
  expect(
    await Bun.file(path)
      .stat()
      .catch(e => e.code),
  ).toBe("ENOENT");
  expect(await Bun.write(path, "under the limit")).toBe(15);
  expect(await Bun.file(path).text()).toBe("under the limit");
});

// The file keeps a copy of its path, and the collector has to know how much that is.
test("Bun.file() with a long path is collected under memory pressure", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const path = "/" + Buffer.alloc(1 << 20, "a/").toString();
        let peak = 0;
        for (let i = 0; i < 2000; i++) {
          Bun.file(path);
          if (i % 50 === 0) peak = Math.max(peak, process.memoryUsage.rss());
        }
        console.log(Math.round(peak / 1024 / 1024));`,
    ],
    env: bunEnv,
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  // 2000 copies are 2000 MiB.
  expect(Number(stdout)).toBeWithin(1, isASAN || isDebug ? 1100 : 600);
  expect(exitCode).toBe(0);
});
