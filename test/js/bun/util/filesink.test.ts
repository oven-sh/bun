import { createSocketPair, fileSinkInternals } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, fileDescriptorLeakChecker, isPosix, isWindows, tmpdirSync } from "harness";
import { mkfifo } from "mkfifo";
import { join } from "node:path";

describe("FileSink", () => {
  const fixturesInput = [
    [["abcdefghijklmnopqrstuvwxyz"], "abcdefghijklmnopqrstuvwxyz"],
    [
      ["abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    ],
    [["😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"], "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"],
    [
      ["abcdefghijklmnopqrstuvwxyz", "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"],
      "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      ["abcdefghijklmnopqrstuvwxyz", "😋", " Get Emoji — All Emojis", " to ✂️ Copy and 📋 Paste 👌"],
      "(rope) " + "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      [
        new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz"),
        "😋",
        " Get Emoji — All Emojis",
        " to ✂️ Copy and 📋 Paste 👌",
      ],
      "(array) " + "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
  ] as const;

  const fixtures = fixturesInput.map(([input, label]) => {
    let expected;

    if (Array.isArray(input)) {
      expected = Buffer.concat(input.map(str => Buffer.from(str)));
    } else {
      expected = Buffer.from(input as any);
    }

    return [input, expected, label] as const;
  });

  function getPath(label: string) {
    const path = join(tmpdirSync(), `${Bun.hash(label).toString(10)}.txt`);
    try {
      require("fs").unlinkSync(path);
    } catch (e) {}
    return path;
  }

  var activeFIFO: Promise<string>;
  var decoder = new TextDecoder();

  function getFd(label: string, byteLength = 0) {
    const path = join(tmpdirSync(), `${Bun.hash(label).toString(10)}.txt`);
    try {
      require("fs").unlinkSync(path);
    } catch (e) {}
    mkfifo(path, 0o666);
    activeFIFO = (async function (stream: ReadableStream<Uint8Array>, byteLength = 0) {
      var chunks: Uint8Array[] = [];
      const original = byteLength;
      var got = 0;
      for await (const chunk of stream) {
        chunks.push(chunk);
        got += chunk.byteLength;
      }
      if (got !== original) throw new Error(`Expected ${original} bytes, got ${got} (${label})`);
      return Buffer.concat(chunks).toString();
      // test it on a small chunk size
    })(Bun.file(path).stream(64), byteLength);
    return path;
  }

  for (let isPipe of [true, false] as const) {
    // TODO: fix the `mkfifo` function for windows. They do have an API but calling it from bun:ffi didn't get great results.
    // once #8166 is merged, this can be written using it's 'bun:iternals-for-testing' feature
    describe.skipIf(isPipe && isWindows)(isPipe ? "pipe" : "file", () => {
      fixtures.forEach(([input, expected, label]) => {
        const getPathOrFd = () => (isPipe ? getFd(label, expected.byteLength) : getPath(label));

        it(`${JSON.stringify(label)}`, async () => {
          const path = getPathOrFd();
          {
            using _ = fileDescriptorLeakChecker();

            const sink = Bun.file(path).writer();
            for (let i = 0; i < input.length; i++) {
              sink.write(input[i]);
            }
            await sink.end();

            // For the file descriptor leak checker.
            await Bun.sleep(10);
          }

          if (!isPipe) {
            const output = new Uint8Array(await Bun.file(path).arrayBuffer());
            for (let i = 0; i < expected.length; i++) {
              expect(output[i]).toBe(expected[i]);
            }
            expect(output.byteLength).toBe(expected.byteLength);
          } else {
            console.log("reading");
            const output = await activeFIFO;
            expect(output).toBe(decoder.decode(expected));
          }
        });

        it(`flushing -> ${JSON.stringify(label)}`, async () => {
          const path = getPathOrFd();

          {
            using _ = fileDescriptorLeakChecker();
            const sink = Bun.file(path).writer();
            for (let i = 0; i < input.length; i++) {
              sink.write(input[i]);
              await sink.flush();
            }
            await sink.end();

            // For the file descriptor leak checker.
            await Bun.sleep(10);
          }

          if (!isPipe) {
            const output = new Uint8Array(await Bun.file(path).arrayBuffer());
            for (let i = 0; i < expected.length; i++) {
              expect(output[i]).toBe(expected[i]);
            }
            expect(output.byteLength).toBe(expected.byteLength);
          } else {
            const output = await activeFIFO;
            expect(output).toBe(decoder.decode(expected));
          }
        });

        it(`highWaterMark -> ${JSON.stringify(label)}`, async () => {
          const path = getPathOrFd();
          {
            using _ = fileDescriptorLeakChecker();
            const sink = Bun.file(path).writer({ highWaterMark: 1 });
            for (let i = 0; i < input.length; i++) {
              sink.write(input[i]);
              await sink.flush();
            }
            await sink.end();
            await Bun.sleep(10); // For the file descriptor leak checker.
          }

          if (!isPipe) {
            const output = new Uint8Array(await Bun.file(path).arrayBuffer());
            for (let i = 0; i < expected.length; i++) {
              expect(output[i]).toBe(expected[i]);
            }
            expect(output.byteLength).toBe(expected.byteLength);
          } else {
            const output = await activeFIFO;
            expect(output).toBe(decoder.decode(expected));
          }
        });
      });
    });
  }
});

import fs from "node:fs";
import path from "node:path";
import util from "node:util";

it("end doesn't close when backed by a file descriptor", async () => {
  using _ = fileDescriptorLeakChecker();
  const x = tmpdirSync();
  const fd = await util.promisify(fs.open)(path.join(x, "test.txt"), "w");
  const chunk = Buffer.from("1 Hello, world!");
  const file = Bun.file(fd);
  const writer = file.writer();
  const written = await writer.write(chunk);
  await writer.end();
  await util.promisify(fs.ftruncate)(fd, written);
  await util.promisify(fs.close)(fd);
});

it("end does close when not backed by a file descriptor", async () => {
  using _ = fileDescriptorLeakChecker();
  const x = tmpdirSync();
  const file = Bun.file(path.join(x, "test.txt"));
  const writer = file.writer();
  await writer.write(Buffer.from("1 Hello, world!"));
  await writer.end();
  await Bun.sleep(10); // For the file descriptor leak checker.
});

it("write result is not cumulative", async () => {
  using _ = fileDescriptorLeakChecker();
  const x = tmpdirSync();
  const fd = await util.promisify(fs.open)(path.join(x, "test.txt"), "w");
  const file = Bun.file(fd);
  const writer = file.writer();
  expect(await writer.write("1 ")).toBe(2);
  expect(await writer.write("Hello, ")).toBe(7);
  expect(await writer.write("world!")).toBe(6);
  await writer.end();
  await util.promisify(fs.close)(fd);
});

// A backpressured write buffers everything `write(2)` would not take, so the
// Promise it returns has to resolve with the chunk's own byte count. It used to
// resolve with the partial `write(2)` return instead.
it.skipIf(!isPosix)("a backpressured write() resolves to the chunk's byte count", async () => {
  const [readFd, writeFd] = createSocketPair();
  const sink = Bun.file(writeFd).writer();
  const size = 4 * 1024 * 1024;
  const chunk = Buffer.alloc(size, 0x61);

  // Nothing drains `readFd` yet, so the socket buffers fill up and only part of
  // the chunk reaches the fd.
  const first = sink.write(chunk);

  let received = 0;
  const reader = (async () => {
    for await (const part of Bun.file(readFd).stream()) received += part.byteLength;
  })();

  try {
    expect(first).toBeInstanceOf(Promise);
    expect(await first).toBe(size);

    // The next backpressured write starts its own accounting.
    const second = sink.write(chunk);
    expect(second).toBeInstanceOf(Promise);
    expect(await second).toBe(size);
  } finally {
    await Promise.resolve(sink.end()).catch(() => {});
    fs.closeSync(writeFd);
    await reader;
    fs.closeSync(readFd);
  }

  expect(received).toBe(size * 2);
});

// Strings are buffered as UTF-8, so the count the Promise reports is the
// encoded byte count, which is what a non-pending write() returns too.
it.skipIf(!isPosix)("a backpressured string write() resolves to its encoded byte count", async () => {
  const [readFd, writeFd] = createSocketPair();
  const sink = Bun.file(writeFd).writer();
  // Latin-1 in JSC, two bytes per character once encoded.
  const text = Buffer.alloc(2 * 1024 * 1024, "é").toString();
  const size = Buffer.byteLength(text);
  expect(size).toBe(text.length * 2);

  const written = sink.write(text);

  let received = 0;
  const reader = (async () => {
    for await (const part of Bun.file(readFd).stream()) received += part.byteLength;
  })();

  try {
    expect(written).toBeInstanceOf(Promise);
    expect(await written).toBe(size);
  } finally {
    await Promise.resolve(sink.end()).catch(() => {});
    fs.closeSync(writeFd);
    await reader;
    fs.closeSync(readFd);
  }

  expect(received).toBe(size);
});

if (isWindows) {
  it("ENOENT, Windows", () => {
    expect(() => Bun.file("A:\\this-does-not-exist.txt").writer()).toThrow(
      expect.objectContaining({
        code: "ENOENT",
        path: "A:\\this-does-not-exist.txt",
        syscall: "open",
      }),
    );
  });
}

// When a write to a pollable fd returns `.pending`, FileSink takes a
// `must_be_kept_alive_until_eof` ref on itself so it survives until the
// buffered data is drained. If the write later fails (e.g. EPIPE because the
// reader closed), neither `onError` nor `onClose` released that ref, so the
// native FileSink (and its buffers) leaked for the rest of the process even
// after the JS wrapper was garbage-collected. `heapStats()` only counts JS
// wrappers, so we check the native live counter directly.
it.skipIf(!isPosix)("does not leak native FileSink when a pending write fails (EPIPE)", async () => {
  async function once() {
    const [readFd, writeFd] = createSocketPair();
    const sink = Bun.file(writeFd).writer();

    // Large enough to overflow the socket send buffer so the write returns
    // `.pending` and the keep-alive ref is taken.
    const writePromise = sink.write(Buffer.alloc(4 * 1024 * 1024, 0x61));
    expect(writePromise).toBeInstanceOf(Promise);

    // Close the reader so the buffered write fails with EPIPE.
    fs.closeSync(readFd);

    await Promise.resolve(writePromise).catch(() => {});
    await Promise.resolve(sink.end()).catch(() => {});

    // The writer may have already closed the fd after the error.
    try {
      fs.closeSync(writeFd);
    } catch {}
  }

  const baseline = fileSinkInternals.liveCount();
  const iterations = 8;

  for (let i = 0; i < iterations; i++) {
    await once();
  }

  // Allow finalizers to run.
  for (let i = 0; i < 50; i++) {
    Bun.gc(true);
    if (fileSinkInternals.liveCount() <= baseline) break;
    await Bun.sleep(10);
  }

  // Before the fix, every iteration leaked one native FileSink because the
  // `must_be_kept_alive_until_eof` ref was never released on error/close.
  // One straggler whose JS wrapper has not yet been finalized is acceptable;
  // more than that indicates a native leak.
  expect(fileSinkInternals.liveCount()).toBeLessThanOrEqual(baseline + 1);
});

it("start() without path/fd on an already-open writer does not crash", async () => {
  const path = join(tmpdirSync(), "filesink-restart.txt");
  const writer = Bun.file(path).writer();
  expect(() => writer.start({})).not.toThrow();
  expect(() => writer.start({ highWaterMark: 1024 })).not.toThrow();
  writer.write("hello");
  await writer.end();
  expect(await Bun.file(path).text()).toBe("hello");
});

// https://github.com/oven-sh/bun/issues/11553
// On POSIX, a FileSink on stdout/stderr buffered small writes (< page size) and
// only flushed them via a deferred task, so a large write through a *second*
// sink on the same fd reached the kernel first. Windows already forced stdout/
// stderr sinks into sync mode; POSIX now does the same.
describe.concurrent("stdout/stderr sinks write synchronously", () => {
  // A small write followed by a large write through separate FileSink
  // instances on fd 1/2 must appear in program order. Before the fix the
  // 4-byte write was buffered until the deferred auto-flush ran, landing
  // after the 64 KiB body.
  for (const expr of ["Bun.file(1)", "Bun.stdout", "Bun.file(2)", "Bun.stderr"] as const) {
    it(`${expr}.writer()`, async () => {
      const isStderr = expr.includes("2") || expr.includes("stderr");
      const src = `
        const header = Uint8Array.of(0xde, 0xad, 0xbe, 0xef);
        const body = new Uint8Array(64 * 1024).fill(0x2e);
        ${expr}.writer().write(header);
        ${expr}.writer().write(body);
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", src],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).arrayBuffer(),
        proc.exited,
      ]);
      const stdout = new Uint8Array(stdoutBuf);
      const stderr = new Uint8Array(stderrBuf);
      const out = isStderr ? stderr : stdout;
      expect(out.length).toBe(4 + 64 * 1024);
      expect(Array.from(out.subarray(0, 4))).toEqual([0xde, 0xad, 0xbe, 0xef]);
      expect(Array.from(out.subarray(-4))).toEqual([0x2e, 0x2e, 0x2e, 0x2e]);
      expect((isStderr ? stdout : stderr).length).toBe(0);
      expect(exitCode).toBe(0);
    });
  }
});

it.skipIf(!isPosix)("writing after end() fails during flush does not crash", async () => {
  const dir = tmpdirSync();
  const target = join(dir, "ro.txt");
  fs.writeFileSync(target, "");
  const writer = Bun.file(target).writer();
  // Re-point the writer at a read-only fd so the buffered flush in end() fails.
  const fd = fs.openSync(target, "r");
  try {
    writer.start({ fd });
  } finally {
    fs.closeSync(fd);
  }
  writer.write("x");
  let endErr: unknown;
  try {
    await writer.end();
  } catch (e) {
    endErr = e;
  }
  expect(endErr).toBeDefined();
  // Previously this would attempt to write to an invalid fd and crash with a
  // debug assertion; now it should behave as if the sink is closed.
  expect(() => writer.write("y")).not.toThrow();
  expect(() => writer.start({})).not.toThrow();
  expect(() => writer.write("z")).not.toThrow();
  expect(() => writer.flush()).not.toThrow();
  await Promise.resolve(writer.end()).catch(() => {});
  await 1;
});

// On Windows the libuv write completion path re-enters JS (promise resolution)
// while a `&mut WindowsStreamingWriter` is live, so without raw-ptr laundering
// LLVM `noalias` lets release builds cache stale `is_done`/`parent` and
// over-deref the FileSink. Spawn a subprocess so a crash there is observable
// here as a non-zero exit code.
it("Bun.file(fd).writer() write/end under GC pressure does not crash", async () => {
  const dir = tmpdirSync();
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const fs = require("fs");
        const fd = fs.openSync(${JSON.stringify(join(dir, "out.txt"))}, "w");
        const buf = Buffer.alloc(64 * 1024, 0x61);
        // A synchronous Bun.gc() costs ~18ms under debug+ASAN; 50 rounds keeps
        // this inside the default timeout there, and still reproduced the crash.
        for (let i = 0; i < 50; i++) {
          const w = Bun.file(fd).writer();
          const p = w.write(buf);
          if (p && typeof p.then === "function") await p;
          await w.end();
          Bun.gc(true);
        }
        fs.closeSync(fd);
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
});

it("fs.promises.writeFile with iterables under GC pressure does not crash", async () => {
  const dir = tmpdirSync();
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { writeFile } = require("fs/promises");
        const dest = ${JSON.stringify(join(dir, "out.txt"))};
        const big = { *[Symbol.iterator]() { yield Buffer.alloc(512 * 1024, 0x61); } };
        for (let i = 0; i < 50; i++) {
          await writeFile(dest, big);
          Bun.gc(true);
        }
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
});
