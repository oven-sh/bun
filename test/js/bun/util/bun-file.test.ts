import { describe, expect, test } from "bun:test";
import { closeSync, openSync, writeFileSync } from "fs";
import fsPromises from "fs/promises";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";

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

describe("Bun.file().text()", () => {
  const utf8Bom = [0xef, 0xbb, 0xbf];
  const utf16leBom = [0xff, 0xfe];
  const fixtures: [name: string, bytes: Buffer, text: string][] = [
    ["empty", Buffer.alloc(0), ""],
    ["ASCII", Buffer.from("plain ascii"), "plain ascii"],
    ["multibyte UTF-8", Buffer.from("wörld 世界 😀"), "wörld 世界 😀"],
    ["0xFF bytes", Buffer.alloc(4, 0xff), "\ufffd\ufffd\ufffd\ufffd"],
    ["a truncated sequence", Buffer.from([0x61, 0xe2, 0x82]), "a\ufffd"],
    ["a UTF-8 BOM alone", Buffer.from(utf8Bom), ""],
    ["a UTF-8 BOM and ASCII", Buffer.from([...utf8Bom, ...Buffer.from("hello")]), "hello"],
    ["a UTF-8 BOM and multibyte UTF-8", Buffer.from([...utf8Bom, ...Buffer.from("héllo 🎉")]), "héllo 🎉"],
    ["FF FE alone", Buffer.from(utf16leBom), "\ufffd\ufffd"],
    ["a UTF-16LE BOM and one byte", Buffer.from([...utf16leBom, 0x41]), ""],
    [
      "a UTF-16LE BOM, code units and an odd byte",
      Buffer.from([...utf16leBom, ...Buffer.from("hé🎉", "utf16le"), 0x41]),
      "hé🎉",
    ],
    ["FE FF and bytes", Buffer.from([0xfe, 0xff, 0x00, 0x41]), "\ufffd\ufffd\u0000A"],
  ];

  test.concurrent.each(fixtures)("decodes %s by path, by fd and as a Response body", async (_, bytes, text) => {
    using dir = tempDir("bun-file-text", { "data.bin": bytes });
    const path = join(String(dir), "data.bin");
    const fd = openSync(path, "r");
    try {
      expect({
        blob: await new Blob([bytes]).text(),
        path: await Bun.file(path).text(),
        fd: await Bun.file(fd).text(),
        response: await new Response(Bun.file(path)).text(),
      }).toEqual({ blob: text, path: text, fd: text, response: text });
    } finally {
      closeSync(fd);
    }
  });

  test.concurrent.each(fixtures.filter(([, bytes]) => bytes.length > 1))(
    "decodes a slice of %s like the same bytes in memory",
    async (_, bytes) => {
      using dir = tempDir("bun-file-text-slice", { "data.bin": bytes });
      const file = Bun.file(join(String(dir), "data.bin"));
      const end = bytes.length;
      expect({
        tail: await file.slice(1, end).text(),
        head: await file.slice(0, end - 1).text(),
      }).toEqual({
        tail: await new Blob([bytes.subarray(1)]).text(),
        head: await new Blob([bytes.subarray(0, end - 1)]).text(),
      });
    },
  );

  test.concurrent.each(
    fixtures.filter(([name]) =>
      ["multibyte UTF-8", "a UTF-8 BOM and ASCII", "a UTF-16LE BOM, code units and an odd byte"].includes(name),
    ),
  )("decodes %s from a pipe", async (_, bytes, text) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "process.stdout.write(JSON.stringify(await Bun.stdin.text()))"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const middle = bytes.length >> 1;
    proc.stdin.write(bytes.subarray(0, middle));
    await proc.stdin.flush();
    proc.stdin.write(bytes.subarray(middle));
    await proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toBe(text);
    expect(exitCode).toBe(0);
  });

  test("decodes the content a file has now, not what an earlier read saw", async () => {
    using dir = tempDir("bun-file-text-rewrite", { "data.txt": "plain ascii" });
    const path = join(String(dir), "data.txt");
    const file = Bun.file(path);
    const before = await file.text();
    writeFileSync(path, "wörld 世界");
    expect({ before, after: await file.text() }).toEqual({ before: "plain ascii", after: "wörld 世界" });
  });

  // 0xFF bytes take the replacement path, the slowest decode, so the decode is
  // most of the CPU time of the read. Thread CPU time advances in 4 ms ticks
  // on Linux: an optimized build needs the larger file to spend several.
  const size = (isDebug ? 1 : 8) * 1024 * 1024;
  const read = {
    path: "Bun.file(process.argv[1]).text()",
    fd: 'Bun.file(openSync(process.argv[1], "r")).text()',
    slice: "Bun.file(process.argv[1]).slice(1).text()",
    response: "new Response(Bun.file(process.argv[1])).text()",
    stdin: "Bun.stdin.text()",
  };

  // The POSIX read job decodes where it has the bytes, on the work pool: about
  // 2% of the process CPU time is then on the JS thread, against 98% when the
  // completion decodes. Windows reads through ReadFileUV on the event loop and
  // decodes there until #42819 removes it.
  test.concurrent.todoIf(isWindows).each(Object.keys(read) as (keyof typeof read)[])(
    "decodes on the work pool, not on the JS thread: %s",
    async route => {
      const bytes = Buffer.alloc(size, 0xff);
      using dir = tempDir("bun-file-text-thread", { "data.bin": bytes });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import { openSync } from "fs";
          const all = process.cpuUsage();
          const thread = process.threadCpuUsage();
          const text = await ${read[route]};
          const p = process.cpuUsage(all);
          const t = process.threadCpuUsage(thread);
          console.log(JSON.stringify({ length: text.length, jsThread: t.user + t.system, process: p.user + p.system }));`,
          join(String(dir), "data.bin"),
        ],
        env: bunEnv,
        stdin: route === "stdin" ? "pipe" : "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      if (route === "stdin") {
        proc.stdin!.write(bytes);
        await proc.stdin!.end();
      }
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const { length, jsThread, process: all } = JSON.parse(stdout);
      expect(length).toBe(route === "slice" ? size - 1 : size);
      expect(jsThread / all).toBeLessThan(0.5);
      expect(exitCode).toBe(0);
    },
  );
});
