import { S3Client } from "bun";
import { deserialize, serialize } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { appendFileSync, closeSync, openAsBlob, openSync } from "fs";
import fsPromises from "fs/promises";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { pathToFileURL } from "url";
import v8 from "v8";

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

// slice(start) with no end of a Bun.file() that nothing has stat'd does not
// know where the file ends. slice() used to subtract the start from the marker
// for "size not known" and keep the result as a length: 4503599627370485 for
// slice(10). The size now stays unknown until something asks for it, as it does
// for the whole file.
describe("Bun.file().slice() with no end, before anything stats the file", () => {
  const content = "0123456789abcdef";

  test("size counts the bytes from the start to the end of the file", () => {
    using dir = tempDir("bun-file-open-slice", { "f.txt": content });
    const file = () => Bun.file(join(String(dir), "f.txt"));
    expect({
      "slice(10)": file().slice(10).size,
      "slice(10).slice(2)": file().slice(10).slice(2).size,
      "slice(10).slice()": file().slice(10).slice().size,
      "slice(10).slice(2, 4)": file().slice(10).slice(2, 4).size,
      "slice(10, Infinity)": file().slice(10, Infinity).size,
      "slice(10, undefined)": file().slice(10, undefined).size,
      "slice(10, 'text/plain')": file().slice(10, "text/plain").size,
      "slice(16)": file().slice(16).size,
      "slice(20)": file().slice(20).size,
      "slice(Infinity)": file().slice(Infinity).size,
    }).toEqual({
      "slice(10)": 6,
      "slice(10).slice(2)": 4,
      "slice(10).slice()": 6,
      "slice(10).slice(2, 4)": 2,
      "slice(10, Infinity)": 6,
      "slice(10, undefined)": 6,
      "slice(10, 'text/plain')": 6,
      "slice(16)": 0,
      "slice(20)": 0,
      "slice(Infinity)": 0,
    });
  });

  test("size is the same for a path, a file descriptor, a file: URL and fs.openAsBlob()", async () => {
    using dir = tempDir("bun-file-open-slice", { "f.txt": content });
    const path = join(String(dir), "f.txt");
    const fd = openSync(path, "r");
    try {
      expect({
        path: Bun.file(path).slice(10).size,
        fd: Bun.file(fd).slice(10).size,
        url: Bun.file(pathToFileURL(path)).slice(10).size,
        openAsBlob: (await openAsBlob(path)).slice(10).size,
      }).toEqual({ path: 6, fd: 6, url: 6, openAsBlob: 6 });
    } finally {
      closeSync(fd);
    }
  });

  // A BuildArtifact has its own slice() entry. An output that Bun.build() wrote
  // to disk is a Bun.file() that nothing has stat'd.
  test("size of a slice of a BuildArtifact on disk", async () => {
    using dir = tempDir("bun-file-open-slice", { "entry.js": `console.log(${JSON.stringify(content)});` });
    const { outputs } = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
      outdir: join(String(dir), "out"),
    });
    const [artifact] = outputs;
    // Before artifact.size: that stats the file, and a slice made after it has its size.
    const slice = artifact.slice(10).size;
    expect(artifact.size).toBeGreaterThan(content.length);
    expect(slice).toBe(artifact.size - 10);
  });

  test("size agrees with the bytes, whichever is asked first", async () => {
    using dir = tempDir("bun-file-open-slice", { "f.txt": content });
    const file = () => Bun.file(join(String(dir), "f.txt"));
    const sizeFirst = file().slice(10);
    const textFirst = file().slice(10);
    const bytesFirst = file().slice(10);
    const streamFirst = file().slice(10);
    const existsFirst = file().slice(10);
    const nested = file().slice(10).slice(2);
    expect({
      sizeFirst: [sizeFirst.size, await sizeFirst.text(), sizeFirst.size],
      textFirst: [await textFirst.text(), textFirst.size],
      bytesFirst: [Buffer.from(await bytesFirst.bytes()).toString(), bytesFirst.size],
      streamFirst: [await new Response(streamFirst.stream()).text(), streamFirst.size],
      existsFirst: [await existsFirst.exists(), existsFirst.size, await existsFirst.text()],
      nested: [nested.size, await nested.text()],
      pastTheEnd: [await file().slice(20).text(), await file().slice(Infinity).text()],
    }).toEqual({
      sizeFirst: [6, "abcdef", 6],
      textFirst: ["abcdef", 6],
      bytesFirst: ["abcdef", 6],
      streamFirst: ["abcdef", 6],
      existsFirst: [true, 6, "abcdef"],
      nested: [4, "cdef"],
      pastTheEnd: ["", ""],
    });
    expect(new Uint8Array(file().slice(10).size)).toHaveLength(6);
    expect(file().slice(10)).toHaveLength(6);
  });

  // A start that counts back from the end needs the real size of the file.
  // slice() must not take it for a slice with no end: its size is already n.
  test("size of slice(-n) is still n", () => {
    using dir = tempDir("bun-file-open-slice", { "f.txt": content });
    expect(Bun.file(join(String(dir), "f.txt")).slice(-4).size).toBe(4);
  });

  // A Bun.file() keeps one stat, and its slices share it. The first size of the
  // slice fills it, as the first size of the file does. A slice with an end has
  // its size with no stat.
  test("size comes from the stat that the Bun.file() keeps", () => {
    using dir = tempDir("bun-file-open-slice", { "f.txt": content });
    const path = join(String(dir), "f.txt");
    const asked = Bun.file(path);
    const askedSlice = asked.slice(10).size;
    const notAsked = Bun.file(path);
    const bounded = notAsked.slice(10, 12).size;
    appendFileSync(path, "XYZ");
    expect({
      askedSlice,
      asked: asked.size,
      nextSlice: asked.slice(10).size,
      bounded,
      notAsked: notAsked.size,
    }).toEqual({
      askedSlice: 6,
      asked: 16,
      nextSlice: 6,
      bounded: 2,
      notAsked: 19,
    });
  });

  test("a copy of the slice has the size of the slice", async () => {
    using dir = tempDir("bun-file-open-slice", { "f.txt": content });
    const file = () => Bun.file(join(String(dir), "f.txt"));
    const form = new FormData();
    form.append("file", file().slice(10));
    expect({
      "Response.blob()": (await new Response(file().slice(10)).blob()).size,
      "Request.blob()": (await new Request("http://localhost/", { method: "POST", body: file().slice(10) }).blob())
        .size,
      "new Blob([slice])": new Blob([file().slice(10)]).size,
      "new File([slice])": new File([file().slice(10)], "f.txt").size,
      "formData.get()": (form.get("file") as Blob).size,
      "structuredClone()": structuredClone(file().slice(10)).size,
    }).toEqual({
      "Response.blob()": 6,
      "Request.blob()": 6,
      "new Blob([slice])": 6,
      "new File([slice])": 6,
      "formData.get()": 6,
      "structuredClone()": 6,
    });
  });

  // A serialized Bun.file() is a path and a window. The window of this slice
  // has no end, so the copy finds the end of the file when it is asked.
  test.each([
    ["bun:jsc", serialize, deserialize],
    ["node:v8", v8.serialize, v8.deserialize],
  ] as const)("%s serialize() keeps the end of the slice open", async (_, write, read) => {
    using dir = tempDir("bun-file-open-slice", { "f.txt": content });
    const path = join(String(dir), "f.txt");
    const wire = write(Bun.file(path).slice(10));
    appendFileSync(path, "XYZ");
    const copy: Blob = read(wire as any);
    expect({ size: copy.size, text: await copy.text() }).toEqual({ size: 9, text: "abcdefXYZ" });
  });

  test("size is 0 when the file does not exist, as for the whole file", () => {
    using dir = tempDir("bun-file-open-slice", {});
    const missing = () => Bun.file(join(String(dir), "missing.txt"));
    expect({ whole: missing().size, slice: missing().slice(10).size }).toEqual({ whole: 0, slice: 0 });
  });

  describe("of a pipe", () => {
    async function withPipeOnStdin(script: string, input: string) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      if (input) proc.stdin.write(input);
      await proc.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    test.concurrent("size is the size of the whole pipe", async () => {
      const sizes = `console.log(JSON.stringify([String(Bun.stdin.size), String(Bun.stdin.slice(10).size)]))`;
      const result = await withPipeOnStdin(sizes, "");
      expect(result).toEqual({ stdout: expect.stringMatching(/^\["\w+","\w+"\]\n$/), stderr: "", exitCode: 0 });
      const [whole, slice] = JSON.parse(result.stdout);
      expect(slice).toBe(whole);
      // Bun.spawn gives the child a named pipe on Windows. Its size was not measured there.
      if (!isWindows) expect(whole).toBe("Infinity");
    });

    // bun-stdin-slice.test.ts reads Bun.stdin.slice(1) to have a size next to the
    // largest one: the read buffer capacity overflowed there, on POSIX only. That
    // slice has no size now. This one still has.
    test.concurrent.skipIf(isWindows)("a slice that ends next to the largest size is still read", async () => {
      const read = `process.stdout.write(await Bun.stdin.slice(1, 2 ** 52 - 2).text())`;
      expect(await withPipeOnStdin(read, "hello world")).toEqual({
        stdout: "hello world",
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // resolve_size() stores 0 for an S3 file, whose size no stat can give. A slice
  // of unknown size would take that 0 from a matcher, and its next read would ask
  // for one byte. So slice() leaves an S3 slice as it was.
  test("an S3 slice reads to the end after a matcher asked for its length", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        const [, start, end] = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "") ?? [];
        if (start === undefined) return new Response(content);
        const last = Math.min(end === "" ? Infinity : Number(end), content.length - 1);
        return new Response(content.slice(Number(start), last + 1), {
          status: 206,
          headers: { "content-range": `bytes ${start}-${last}/${content.length}` },
        });
      },
    });
    const client = new S3Client({
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "bucket",
      endpoint: server.url.href,
    });
    const slice = client.file("f.txt").slice(10);
    expect(slice).not.toBeEmpty();
    expect(await slice.text()).toBe("abcdef");
  });
});
