import { dlopen, ptr } from "bun:ffi";
import { createSocketPair } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { closeSync, constants, fstatSync, openSync, statSync, symlinkSync, writeSync } from "fs";
import fsPromises from "fs/promises";
import { bunEnv, bunExe, isLinux, isWindows, libcPathForDlopen, tempDir } from "harness";
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

// A pipe and a socket have no length. macOS and the BSDs report the bytes that wait in one as its
// st_size, and a Bun.file() that takes that count for its size stops every later read there.
describe.skipIf(isWindows)("Bun.file() of a pipe or a socket that has bytes waiting", () => {
  const first = "first,";
  const second = "second";
  // The st_size of a descriptor that has `first` in it. Linux reports 0 for a pipe and a socket.
  const waiting = isLinux ? 0 : first.length;

  const openLibc = () => dlopen(libcPathForDlopen(), { pipe: { args: ["ptr"], returns: "i32" } });
  let libc: ReturnType<typeof openLibc> | undefined;
  // Each gives [read end, write end].
  const kinds = {
    socket: (): number[] => createSocketPair(),
    pipe: (): number[] => {
      libc ??= openLibc();
      const fds = new Int32Array(2);
      if (libc.symbols.pipe(ptr(fds)) !== 0) throw new Error("pipe() failed");
      return [...fds];
    },
  };
  // Every descriptor is closed once, also when an expectation throws first.
  function open(kind: keyof typeof kinds) {
    const fds = new Set(kinds[kind]());
    const [readFd, writeFd] = fds;
    const close = (fd: number) => void (fds.delete(fd) && closeSync(fd));
    return { readFd, writeFd, close, [Symbol.dispose]: () => fds.forEach(close) };
  }

  for (const kind of ["socket", "pipe"] as const) {
    test(`${kind}: Bun.file(fd).size, then text() reads to the end`, async () => {
      using fds = open(kind);
      writeSync(fds.writeFd, first);
      const file = Bun.file(fds.readFd);
      const asked = { st_size: fstatSync(fds.readFd).size, size: file.size };
      writeSync(fds.writeFd, second);
      fds.close(fds.writeFd);

      expect({ ...asked, text: await file.text() }).toEqual({ st_size: waiting, size: Infinity, text: first + second });
    });
  }

  describe("as the stdin of a child", () => {
    // `first` is in the child's stdin before the child starts. The child asks, then prints what `fstat`
    // reported on a line of its own. `second` is sent only after that line.
    type Case = { file?: string; stat?: string; ask: string; read: string };
    const script = ({ file = "Bun.stdin", stat = "fs.fstatSync(0)", ask, read }: Case) => `
      const fs = require("fs");
      const stdin = ${file};
      const st_size = ${stat}.size;
      ${ask}
      process.stdout.write(st_size + "\\n");
      let text = "";
      ${read}
      process.stdout.write(JSON.stringify({ size: String(stdin.size), text }));
    `;

    async function readsToTheEnd(kind: keyof typeof kinds, parts: Case) {
      using fds = open(kind);
      writeSync(fds.writeFd, first);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script(parts)],
        env: bunEnv,
        stdin: fds.readFd,
        stdout: "pipe",
        stderr: "pipe",
      });
      fds.close(fds.readFd);
      // Drained from the start so a failing child can never block on a full stderr pipe.
      const stderr = proc.stderr.text();
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let stdout = "";

      for (let r; !stdout.includes("\n") && !(r = await reader.read()).done;) {
        stdout += decoder.decode(r.value, { stream: true });
      }
      try {
        writeSync(fds.writeFd, second);
      } catch {
        // A child that stopped reading early is gone by now. Its output below is the better report.
      }
      fds.close(fds.writeFd);
      for (let r; !(r = await reader.read()).done;) stdout += decoder.decode(r.value, { stream: true });

      expect({ stdout, stderr: await stderr }).toEqual({
        stdout: waiting + "\n" + JSON.stringify({ size: "Infinity", text: first + second }),
        stderr: "",
      });
      expect(await proc.exited).toBe(0);
    }

    const text = "text = await stdin.text();";
    const stream = "for await (const chunk of stdin.stream()) text += Buffer.from(chunk);";
    const cases: Record<string, Case> = {
      ".size, then text()": { ask: "stdin.size;", read: text },
      ".size, then stream()": { ask: "stdin.size;", read: stream },
      "exists(), then text()": { ask: "await stdin.exists();", read: text },
      "exists(), then stream()": { ask: "await stdin.exists();", read: stream },
    };
    for (const kind of ["socket", "pipe"] as const) {
      for (const [caseName, parts] of Object.entries(cases)) {
        test.concurrent(`${kind}: ${caseName} reads to the end`, () => readsToTheEnd(kind, parts));
      }
    }

    // The kind of stdin makes no difference to these, so only the pipe runs them.
    describe("asked or read another way", () => {
      const otherCases: Record<string, Case> = {
        "lastModified, then text()": { ask: "stdin.lastModified;", read: text },
        "structuredClone(), then text()": { ask: "structuredClone(stdin);", read: text },
        "Bun.inspect(new Response(Bun.stdin)), then its text()": {
          ask: "const response = new Response(stdin); Bun.inspect(response);",
          read: "text = await response.text();",
        },
        ".size, then slice(0, 100).text()": { ask: "stdin.size;", read: "text = await stdin.slice(0, 100).text();" },
        ".size, then process.stdin": {
          ask: "stdin.size;",
          read: "for await (const chunk of process.stdin) text += chunk;",
        },
        "new Response(Bun.stdin).body": {
          ask: "const body = new Response(stdin).body;",
          read: "for await (const chunk of body) text += Buffer.from(chunk);",
        },
        "Bun.file(0).size, then text()": { file: "Bun.file(0)", ask: "stdin.size;", read: text },
        // The same pipe through `stat()` of a path.
        'Bun.file("/dev/stdin").size, then text()': {
          file: 'Bun.file("/dev/stdin")',
          stat: 'fs.statSync("/dev/stdin")',
          ask: "stdin.size;",
          read: text,
        },
      };
      for (const [caseName, parts] of Object.entries(otherCases)) {
        test.concurrent(`pipe: ${caseName} reads to the end`, () => readsToTheEnd("pipe", parts));
      }
    });
  });
});

// `fstat` of a symlink gives the length of its target. Linux can show the same rule with it, without a pipe.
test.skipIf(!isLinux)("Bun.file(fd of a symlink).size is Infinity", () => {
  using dir = tempDir("bun-file-symlink-size", { "target.txt": "hello" });
  const target = join(String(dir), "target.txt");
  const link = join(String(dir), "link");
  symlinkSync(target, link);
  const O_PATH = 0o10000000;
  const fd = openSync(link, O_PATH | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    expect({ isSymbolicLink: stat.isSymbolicLink(), st_size: stat.size }).toEqual({
      isSymbolicLink: true,
      st_size: Buffer.byteLength(target),
    });
    expect({ fd: Bun.file(fd).size, path: Bun.file(`/proc/self/fd/${fd}`).size }).toEqual({
      fd: Infinity,
      path: Infinity,
    });
  } finally {
    closeSync(fd);
  }
});

// `stat` gives most directories a size, and Bun.file() reports that number.
test.skipIf(isWindows)("Bun.file(directory).size is the st_size of the directory", () => {
  using dir = tempDir("bun-file-directory-size", { "file.txt": "hello" });
  const { size } = statSync(String(dir));
  const fd = openSync(String(dir), "r");
  try {
    expect(size).toBeGreaterThan(0);
    expect({ path: Bun.file(String(dir)).size, fd: Bun.file(fd).size }).toEqual({ path: size, fd: size });
  } finally {
    closeSync(fd);
  }
});

// `stat` gives 0 for a directory of procfs and for every directory on Windows. That is not a size.
test.skipIf(!isLinux && !isWindows)(
  "Bun.file(directory).size is Infinity when the st_size of the directory is 0",
  () => {
    using dir = tempDir("bun-file-directory-size-0", {});
    const directory = isLinux ? "/proc" : String(dir);
    expect({ st_size: statSync(directory).size, size: Bun.file(directory).size }).toEqual({
      st_size: 0,
      size: Infinity,
    });
    if (isLinux) {
      const fd = openSync(directory, "r");
      try {
        expect(Bun.file(fd).size).toBe(Infinity);
      } finally {
        closeSync(fd);
      }
    }
  },
);
