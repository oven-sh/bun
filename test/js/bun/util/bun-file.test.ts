import type { BunFile } from "bun";
import { describe, expect, test } from "bun:test";
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import fsPromises from "fs/promises";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

// A stat that fails because the file does not exist yet is not kept as "empty file": the same handle reads the file once it exists.
describe.concurrent("BunFile does not cache a failed stat", () => {
  // Each row asks a handle while its file is missing, then creates the file and reads it. Every row answers like the first one.
  const contents = "0123456789abcdef";
  const source = "from the source";
  const readers: Record<string, (file: BunFile, dir: string) => unknown> = {
    "size": file => file.size,
    "exists()": file => file.exists(),
    "text()": file => file.text(),
    "bytes()": async file => new TextDecoder().decode(await file.bytes()),
    "stream()": file => new Response(file.stream()).text(),
    "slice(0, 5).text()": file => file.slice(0, 5).text(),
    "slice().size": file => file.slice().size,
    "new Response(f).text()": file => new Response(file).text(),
    "new Response(f).body": file => new Response(new Response(file).body).text(),
    "FormData part": async file => {
      const form = new FormData();
      form.append("part", file, "part.txt");
      return ((await new Response(form).formData()).get("part") as Blob).text();
    },
    "structuredClone(f).text()": file => structuredClone(file).text(),
    "Bun.write(copy, f)": async (file, dir) => {
      await Bun.write(join(dir, "copy.txt"), file);
      return readFileSync(join(dir, "copy.txt"), "utf8");
    },
    "Bun.write(f, Bun.file(src))": async (file, dir) => {
      await Bun.write(file, Bun.file(join(dir, "source.txt")));
      return readFileSync(file.name!, "utf8");
    },
    "f.write(Bun.file(src))": async (file, dir) => {
      await file.write(Bun.file(join(dir, "source.txt")));
      return readFileSync(file.name!, "utf8");
    },
  };
  test.each<[string, (file: BunFile) => unknown]>([
    ["nothing", () => {}],
    // A poll: more than one answer of false before the file is there.
    ["exists()", async file => [await file.exists(), await file.exists(), await file.exists()]],
    [".size", file => file.size],
    ["structuredClone()", file => structuredClone(file)],
    ["expect().not.toHaveLength()", file => expect(file).not.toHaveLength(1)],
  ])("after %s on a missing file, every reader sees the file once it exists", async (_, ask) => {
    using dir = tempDir("bun-file-asked-while-missing", { "source.txt": source });
    const row: Record<string, unknown> = {};
    for (const [name, read] of Object.entries(readers)) {
      const path = join(String(dir), `${Object.keys(row).length}.txt`);
      const file = Bun.file(path);
      await ask(file);
      writeFileSync(path, contents);
      row[name] = await read(file, String(dir));
    }
    expect(row).toEqual({
      "size": 16,
      "exists()": true,
      "text()": contents,
      "bytes()": contents,
      "stream()": contents,
      "slice(0, 5).text()": "01234",
      "slice().size": 16,
      "new Response(f).text()": contents,
      "new Response(f).body": contents,
      "FormData part": contents,
      "structuredClone(f).text()": contents,
      "Bun.write(copy, f)": contents,
      "Bun.write(f, Bun.file(src))": source,
      "f.write(Bun.file(src))": source,
    });
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

  // A body stream is made from the blob when `.body` is read. That used to store the failed stat too.
  test("a body stream taken before the file exists reads the file once it exists", async () => {
    using dir = tempDir("bun-file-body-before-create", {});
    const read = async (name: string, body: (file: BunFile) => ReadableStream | null) => {
      const path = join(String(dir), name);
      const stream = body(Bun.file(path));
      writeFileSync(path, "hello world");
      return await new Response(stream).text();
    };
    expect({
      response: await read("a.txt", file => new Response(file).body),
      responseSlice: await read("b.txt", file => new Response(file.slice(0, 5)).body),
      responseOpenSlice: await read("c.txt", file => new Response(file.slice(6)).body),
      request: await read("d.txt", file => new Request("http://localhost/", { method: "POST", body: file }).body),
    }).toEqual({
      response: "hello world",
      responseSlice: "hello",
      responseOpenSlice: "world",
      request: "hello world",
    });
  });

  // A stat that fails for another reason than ENOENT is not kept either: reads report the real error until the path is usable.
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

  // expect().toHaveLength() and Bun.inspect() print a size. After a failed stat they leave nothing on the handle.
  test("a look that prints the size of a missing file does not place later slices", async () => {
    using dir = tempDir("bun-file-printed-while-missing", {});
    const path = join(String(dir), "f.txt");
    const file = Bun.file(path);
    const response = new Response(file);
    expect(file).not.toHaveLength(1);
    expect(Bun.inspect(response)).toStartWith("Response {");

    writeFileSync(path, "0123456789");
    expect(file.lastModified).toBeGreaterThan(0);
    appendFileSync(path, "abcdefghij");

    const body = await response.blob();
    expect({
      slice: await file.slice(0, 15).text(),
      clone: await structuredClone(file).text(),
      bodySlice: await body.slice(0, 15).text(),
      bodyClone: await structuredClone(body).text(),
    }).toEqual({
      slice: "0123456789abcde",
      clone: "0123456789abcdefghij",
      bodySlice: "0123456789abcde",
      bodyClone: "0123456789abcdefghij",
    });
  });

  // Bun.file(fd) takes the same path with fstat. No process has this many descriptors, so the number is never open.
  test("a failed fstat is not cached on a Bun.file(fd)", async () => {
    const code = (read: Promise<unknown>) =>
      read.then(
        () => "no error",
        e => e.code,
      );
    const unasked = await code(Bun.file(1_000_000).text());
    expect(unasked).not.toBe("no error");
    for (const ask of [
      (file: BunFile) => file.size,
      (file: BunFile) => file.exists(),
      (file: BunFile) => structuredClone(file),
    ]) {
      const file = Bun.file(1_000_000);
      await ask(file);
      const slice = file.slice(0, 5);
      expect({
        size: file.size,
        exists: await file.exists(),
        sliceSize: slice.size,
        slice: await code(slice.text()),
        whole: await code(file.text()),
      }).toEqual({ size: 0, exists: false, sliceSize: 5, slice: unasked, whole: unasked });
    }
  });

  // Served from a fetch handler once the file was there, the asked handle came back as 206 with no bytes.
  test("Bun.serve sends a file that did not exist when its handle was first asked", async () => {
    using dir = tempDir("bun-file-serve-asked-while-missing", {});
    const path = join(String(dir), "later.txt");
    const file = Bun.file(path);

    await using server = Bun.serve({
      port: 0,
      development: false,
      fetch: async () => ((await file.exists()) ? new Response(file) : new Response("not yet", { status: 404 })),
    });

    const before = await fetch(server.url);
    expect({ status: before.status, body: await before.text() }).toEqual({ status: 404, body: "not yet" });

    writeFileSync(path, "hello world");

    const get = await fetch(server.url);
    const head = await fetch(server.url, { method: "HEAD" });
    expect({
      status: get.status,
      contentLength: get.headers.get("content-length"),
      contentRange: get.headers.get("content-range"),
      body: await get.text(),
      headStatus: head.status,
      headContentLength: head.headers.get("content-length"),
    }).toEqual({
      status: 200,
      contentLength: "11",
      contentRange: null,
      body: "hello world",
      headStatus: 200,
      headContentLength: "11",
    });
  });

  // A static route reads the size of its blob too.
  test("Bun.serve static routes built from a handle that was asked while its file was missing serve the file", async () => {
    using dir = tempDir("bun-file-route-asked-while-missing", {});
    const path = join(String(dir), "later.txt");
    const asked = Bun.file(path);
    expect([await asked.exists(), asked.size]).toEqual([false, 0]);

    await using server = Bun.serve({
      port: 0,
      development: false,
      routes: { "/handle": asked, "/response": new Response(asked), "/slice": new Response(asked.slice(0, 5)) },
      fetch: () => new Response("fallback", { status: 404 }),
    });
    const hit = async (route: string, init?: RequestInit) => {
      const res = await fetch(new URL(route, server.url), init);
      return { status: res.status, length: res.headers.get("content-length"), body: await res.text() };
    };

    const fallback = { status: 404, length: "8", body: "fallback" };
    expect([await hit("/handle"), await hit("/response"), await hit("/slice")]).toEqual([fallback, fallback, fallback]);

    writeFileSync(path, "hello world");

    expect({
      handle: await hit("/handle"),
      response: await hit("/response"),
      slice: await hit("/slice"),
      head: await hit("/handle", { method: "HEAD" }),
      range: await hit("/handle", { headers: { Range: "bytes=0-4" } }),
    }).toEqual({
      handle: { status: 200, length: "11", body: "hello world" },
      response: { status: 200, length: "11", body: "hello world" },
      slice: { status: 200, length: "5", body: "hello" },
      head: { status: 200, length: "11", body: "" },
      range: { status: 206, length: "5", body: "hello" },
    });
  });
});

// https://github.com/oven-sh/bun/issues/4930
describe.concurrent("a Bun.file() destination that was asked for its size takes the whole copy", () => {
  const content = "0123456789";
  const setup = (existing?: string) => {
    const dir = tempDir("bun-file-copy-dest", {
      "src.txt": content,
      ...(existing === undefined ? {} : { "dest.txt": existing }),
    });
    return { dir, src: Bun.file(join(String(dir), "src.txt")), dest: join(String(dir), "dest.txt") };
  };
  const asks: [string, (file: BunFile) => unknown][] = [
    [".size", file => file.size],
    ["exists()", file => file.exists()],
    ["structuredClone()", file => structuredClone(file)],
  ];
  const destinations: [string, string | undefined][] = [
    ["does not exist yet", undefined],
    ["is empty", ""],
    ["is shorter than the source", "abc"],
  ];

  describe.each(asks)("%s", (_ask, ask) => {
    test.each(destinations)("the destination %s", async (_name, existing) => {
      const { dir, src, dest } = setup(existing);
      using _ = dir;
      const out = Bun.file(dest);
      await ask(out);
      expect([await Bun.write(out, src), readFileSync(dest, "utf8")]).toEqual([10, content]);
      expect({ exists: await out.exists(), text: await out.text() }).toEqual({ exists: true, text: content });
    });
  });

  test(".size of a shorter destination that is a file descriptor", async () => {
    const { dir, src, dest } = setup("abc");
    using _ = dir;
    const fd = openSync(dest, "r+");
    try {
      const out = Bun.file(fd);
      expect(out.size).toBe(3);
      expect([await Bun.write(out, src), readFileSync(dest, "utf8")]).toEqual([10, content]);
    } finally {
      closeSync(fd);
    }
  });

  test("file.write(source) and a Response source after exists()", async () => {
    const { dir, src, dest } = setup();
    using _ = dir;
    const out = Bun.file(dest);
    const other = Bun.file(dest + ".response");
    expect([await out.exists(), await other.exists()]).toEqual([false, false]);
    expect({
      method: [await out.write(src), readFileSync(dest, "utf8")],
      response: [await Bun.write(other, new Response(src)), readFileSync(dest + ".response", "utf8")],
    }).toEqual({ method: [10, content], response: [10, content] });
  });

  test("a slice() of the destination is still the limit", async () => {
    const { dir, src, dest } = setup("abc");
    using _ = dir;
    expect([await Bun.write(Bun.file(dest).slice(0, 4), src), readFileSync(dest, "utf8")]).toEqual([4, "0123"]);
  });

  // https://github.com/oven-sh/bun/issues/23902
  test("text() returns what write() wrote, on one handle", async () => {
    const { dir, dest } = setup();
    using _ = dir;
    const file = Bun.file(dest);
    expect(await file.exists()).toBe(false);
    const seen = [];
    const written = [];
    for (let i = 1; i <= 8; i++) {
      const data = Buffer.alloc(i * 4, "asdf").toString();
      await file.write(data);
      written.push(data);
      seen.push(await file.text());
    }
    expect(seen).toEqual(written);
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
