import { describe, expect, test } from "bun:test";
import { closeSync, openSync, writeSync } from "fs";
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
describe.skipIf(isWindows)("Bun.stdin asked for its size while bytes wait in it", () => {
  const first = "first,";
  const second = "second";

  // A byte on the READY FIFO says that `first` is in the child's stdin. The child prints the size on
  // a line of its own, and `second` is sent only after that line.
  const script = (ask: string, read: string) => `
    const fs = require("fs");
    fs.readSync(fs.openSync(process.env.READY, "r"), Buffer.alloc(1));
    ${ask}
    process.stdout.write(String(Bun.stdin.size) + "\\n");
    ${read}
    process.stdout.write(text);
  `;
  const asks = {
    ".size": "",
    "exists()": "await Bun.stdin.exists();",
  };
  const reads = {
    "text()": "const text = await Bun.stdin.text();",
    "stream()": 'let text = ""; for await (const chunk of Bun.stdin.stream()) text += Buffer.from(chunk).toString();',
  };
  const stdins = {
    // The stdin that Bun.spawn hands out is a socketpair. The test says when `first` is in it.
    socket: { cmd: (script: string) => [bunExe(), "-e", script], saysReady: false },
    // A shell pipeline is a kernel pipe. Its left side passes `first` on, says so, then passes the rest on.
    pipe: {
      cmd: () => ["sh", "-c", `{ head -c ${first.length}; echo >"$READY"; cat; } | "$BUN" -e "$SCRIPT"`],
      saysReady: true,
    },
  };

  for (const [stdinName, stdin] of Object.entries(stdins)) {
    for (const [askName, ask] of Object.entries(asks)) {
      for (const [readName, read] of Object.entries(reads)) {
        test.concurrent(`${stdinName}: ${askName}, then ${readName} reads to the end`, async () => {
          using dir = tempDir("bun-stdin-size-waiting", {});
          const ready = join(String(dir), "ready");
          expect(Bun.spawnSync({ cmd: ["mkfifo", ready] }).exitCode).toBe(0);
          // Open for both directions: no open of the FIFO blocks, and the byte stays in it until the child reads it.
          const readyFd = openSync(ready, "r+");
          try {
            const SCRIPT = script(ask, read);
            await using proc = Bun.spawn({
              cmd: stdin.cmd(SCRIPT),
              env: { ...bunEnv, BUN: bunExe(), SCRIPT, READY: ready },
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
            });
            // Drained from the start so a failing child can never block on a full stderr pipe.
            const stderr = proc.stderr.text();
            const reader = proc.stdout.getReader();
            const decoder = new TextDecoder();
            let stdout = "";

            proc.stdin.write(first);
            await proc.stdin.flush();
            if (!stdin.saysReady) writeSync(readyFd, "\n");
            for (let r; !stdout.includes("\n") && !(r = await reader.read()).done; ) {
              stdout += decoder.decode(r.value, { stream: true });
            }

            proc.stdin.write(second);
            await proc.stdin.end();
            for (let r; !(r = await reader.read()).done; ) stdout += decoder.decode(r.value, { stream: true });

            expect({ stdout, stderr: await stderr }).toEqual({ stdout: "Infinity\n" + first + second, stderr: "" });
            expect(await proc.exited).toBe(0);
          } finally {
            closeSync(readyFd);
          }
        });
      }
    }
  }
});
