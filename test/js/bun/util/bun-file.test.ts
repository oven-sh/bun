import { describe, expect, test } from "bun:test";
import fsPromises from "fs/promises";
import { bunEnv, bunExe, expectRssDeltaBelow, tempDir } from "harness";
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

// formData() over a file reads the file into a buffer of its own and parses that buffer. The
// FormData copies what it keeps, so the buffer belongs to the call on each of the three ways out:
// no form Content-Type, a body that parses, a body that does not.
describe("Bun.file().formData() frees the bytes it read", () => {
  const size = 2 * 1024 * 1024;
  const multipart = "multipart/form-data; boundary=zz";
  const part = '--zz\r\nContent-Disposition: form-data; name="a"\r\n\r\n' + Buffer.alloc(size, "x").toString();
  const shapes = {
    "a multipart file": { type: multipart, body: part + "\r\n--zz--\r\n", outcome: size },
    "a urlencoded file": {
      type: "application/x-www-form-urlencoded",
      body: "a=" + Buffer.alloc(size, "x").toString(),
      outcome: size,
    },
    "a multipart file without its last boundary": {
      type: multipart,
      body: part,
      outcome: "FormData encoding failed: missing final boundary",
    },
    "a file without a form type": {
      type: undefined,
      body: Buffer.alloc(size, "x").toString(),
      outcome: "Invalid encoding",
    },
  };

  test.concurrent.each(Object.entries(shapes))("%s", async (_, { type, body, outcome }) => {
    using dir = tempDir("bun-file-formdata-leak", { "form.txt": body });
    const code = /* js */ `
      const file = () => Bun.file(${JSON.stringify(join(String(dir), "form.txt"))}, ${JSON.stringify({ type })});
      async function once() {
        let outcome;
        try {
          outcome = (await file().formData()).get("a").length;
        } catch (e) {
          outcome = e.message;
        }
        if (outcome !== ${JSON.stringify(outcome)}) throw new Error("unexpected outcome: " + outcome);
      }
      // A collection after each call, so that the values of the last calls do not count as growth.
      async function rssAfter(calls) {
        for (let i = 0; i < calls; i++) {
          await once();
          Bun.gc(true);
        }
        return process.memoryUsage.rss();
      }
      const before = await rssAfter(2);
      const after = await rssAfter(8);
      console.log(JSON.stringify({ deltaMiB: (after - before) / 1024 / 1024 }));
    `;

    // Unfixed: 16 MiB (8 x 2 MiB). Fixed: under 2 MiB.
    await expectRssDeltaBelow(["--smol", "-e", code], { release: 6, debug: 6 });
  });
});
