import { describe, expect, test } from "bun:test";
import fsPromises from "fs/promises";
import { bunEnv, bunExe, isASAN, isDebug, isPosix, tempDirWithFiles } from "harness";
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

// Before the fix the pollable read loop spun preadv2(RWF_NOWAIT) forever on
// the JS thread for /dev/urandom and /dev/zero (they never EAGAIN and never
// EOF), wedging the event loop and growing RSS without bound. Verify that a
// single read() resolves with a bounded chunk, that a timer scheduled across
// the read still fires, and that RSS stays flat while the stream sits idle.
//
// Sequential on purpose: on a regressed build each child grows RSS ~1 GB/s, so
// running them concurrently risks OOMing the fail-before step.
describe.skipIf(!isPosix)("Bun.file(<infinite chardev>).stream() yields to the event loop", () => {
  // Generous on debug/ASAN (subprocess startup dominates); the release lane
  // keeps the tight 4 s cap so a regressed build is killed quickly.
  const hangGuard = isASAN || isDebug ? 20_000 : 4_000;

  for (const [label, source] of [
    ["Bun.file(dev).stream() on /dev/urandom", `Bun.file("/dev/urandom").stream()`],
    ["new Response(Bun.file(dev)).body on /dev/zero", `new Response(Bun.file("/dev/zero")).body`],
  ] as const) {
    test(
      label,
      async () => {
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `
            const rss0 = process.memoryUsage.rss();
            let tickedAfterRead = false;
            setTimeout(() => { tickedAfterRead = true; }, 1).unref();
            const reader = (${source}).getReader();
            const first = await reader.read();
            await new Promise(r => setTimeout(r, 10));
            const second = await reader.read();
            const rssGrowthMB = (process.memoryUsage.rss() - rss0) / 1024 / 1024;
            await reader.cancel();
            process.stdout.write(JSON.stringify({
              firstLen: first.value?.length ?? -1,
              secondLen: second.value?.length ?? -1,
              tickedAfterRead,
              rssGrowthMB,
            }));
          `,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
          signal: AbortSignal.timeout(hangGuard),
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect({ stderr, exitCode, signalCode: proc.signalCode }).toEqual({
          stderr: "",
          exitCode: 0,
          signalCode: null,
        });
        const out = JSON.parse(stdout);
        expect(out.tickedAfterRead).toBe(true);
        expect(out.firstLen).toBeGreaterThan(0);
        expect(out.firstLen).toBeLessThanOrEqual(1024 * 1024);
        expect(out.secondLen).toBeGreaterThan(0);
        expect(out.secondLen).toBeLessThanOrEqual(1024 * 1024);
        expect(out.rssGrowthMB).toBeLessThan(isASAN || isDebug ? 256 : 128);
      },
      hangGuard + 5_000,
    );
  }

  test("Bun.file('/dev/null').stream() EOFs immediately", async () => {
    const r = await Bun.file("/dev/null").stream().getReader().read();
    expect(r).toEqual({ done: true, value: undefined });
  });
});
