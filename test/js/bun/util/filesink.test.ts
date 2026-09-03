import { createSocketPair, fileSinkInternals } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, fileDescriptorLeakChecker, isLinux, isPosix, isWindows, tmpdirSync } from "harness";
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

// end() called after a backpressured write() with the reader already gone:
// end_from_js's own flush() sees EPIPE synchronously. Throwing it would leave
// the write()'s outstanding promise orphaned (never settled here; in the spawn
// path on_attached_process_exit rejected it a second time as an unhandled
// rejection). Instead end() latches the error into that pending promise and
// returns it, so write()'s promise and end()'s return are the same object and
// the failure is reported exactly once.
it.skipIf(!isPosix)(
  "end() after a backpressured write() with the reader gone returns the write's promise, rejecting with EPIPE",
  async () => {
    const [readFd, writeFd] = createSocketPair();
    let readFdOpen = true;
    const sink = Bun.file(writeFd).writer();
    try {
      const writePromise = sink.write(Buffer.alloc(4 * 1024 * 1024, 0x61));
      expect(writePromise).toBeInstanceOf(Promise);

      fs.closeSync(readFd);
      readFdOpen = false;

      // end()'s flush() hits EPIPE synchronously. It must not throw and strand
      // writePromise; it hands back the same promise with the error latched.
      const endResult = sink.end();
      expect(endResult).toBe(writePromise);

      let caught: any;
      try {
        await endResult;
      } catch (e) {
        caught = e;
      }
      expect(caught?.code).toBe("EPIPE");

      // The pending slot is now settled; a follow-up end() short-circuits to
      // the written byte count, not another promise.
      expect(typeof sink.end()).toBe("number");
    } finally {
      try {
        fs.closeSync(writeFd);
      } catch {}
      if (readFdOpen) fs.closeSync(readFd);
    }
  },
);

// Sibling of the end() test above for sink.close() (js_close -> FileSink::end()).
// end()'s Err arm set done=true and tore down the writer without scheduling
// run_pending, so a backpressured write()'s promise was left pending forever
// while close() threw. Now close() routes the error to that promise and
// returns undefined.
it.skipIf(!isPosix)(
  "close() after a backpressured write() with the reader gone rejects the write's promise with EPIPE",
  async () => {
    const src = `
      const { createSocketPair } = require("bun:internal-for-testing");
      const fs = require("node:fs");
      const [readFd, writeFd] = createSocketPair();
      const sink = Bun.file(writeFd).writer();
      const p = sink.write(Buffer.alloc(4 * 1024 * 1024, 0x61));
      if (!(p instanceof Promise)) { console.log("not-backpressured"); process.exit(0); }
      fs.closeSync(readFd);
      let threw = false;
      try { sink.close(); } catch { threw = true; }
      if (threw) { console.log("close-threw"); process.exit(0); }
      try { await p; console.log("resolved"); }
      catch (e) { console.log(e?.code ?? "unknown"); }
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("EPIPE");
    expect(exitCode).toBe(0);
  },
);

// end()'s and end_from_js()'s Done/Wrote arms had the same orphan: when the
// reader drains between write() and end(), flush() pushes the whole remaining
// buffer through in one shot and returns Done/Wrote, and writer.end() only
// fires on_close (which never touches pending). Linux-only because the
// drain-flush-drain shape needs the AF_UNIX send buffer to hold the remainder
// (Linux default ~200KB; macOS is ~8KB, so flush() returns Pending there and
// the promise was already settled via on_write).
it.skipIf(!isLinux)(
  "end() after a backpressured write() with the reader drained returns the write's promise and resolves it",
  async () => {
    const [readFd, writeFd] = createSocketPair();
    const sink = Bun.file(writeFd).writer();
    const size = 300 * 1024;
    try {
      const writePromise = sink.write(Buffer.alloc(size, 0x61));
      expect(writePromise).toBeInstanceOf(Promise);

      const buf = Buffer.alloc(64 * 1024);
      const drain = () => {
        while (true)
          try {
            if (!fs.readSync(readFd, buf)) break;
          } catch {
            break;
          }
      };
      drain();

      // flush() now drains the sink's remaining buffer in one write; the
      // Done/Wrote arm hands back the write()'s promise and schedules
      // run_pending to resolve it with the bytes write() accepted.
      const endResult = sink.end();
      expect(endResult).toBe(writePromise);
      drain();
      expect(await writePromise).toBe(size);
    } finally {
      try {
        await Promise.resolve(sink.end()).catch(() => {});
      } catch {}
      try {
        fs.closeSync(writeFd);
      } catch {}
      fs.closeSync(readFd);
    }
  },
);

// The deferred auto-flush microtask runs at the first microtask checkpoint
// after write() backpressures. If its flush() hit EPIPE, it discarded the
// error and then let `run_pending_later()` resolve the pending write() promise
// with the `Owned(consumed)` result `to_result` had seeded, so `await write()`
// + `await end()` both succeeded even though the reader was already gone and
// nearly the whole chunk was still sitting in the sink's buffer.
it.skipIf(!isPosix)(
  "a backpressured write() rejects with EPIPE when the reader closes before the deferred flush",
  async () => {
    const [readFd, writeFd] = createSocketPair();
    let readFdOpen = true;
    const sink = Bun.file(writeFd).writer();
    const size = 4 * 1024 * 1024;

    try {
      const writePromise = sink.write(Buffer.alloc(size, 0x61));
      expect(writePromise).toBeInstanceOf(Promise);

      // Close the reader before the first await: the deferred auto-flush fires
      // as part of that await's microtask drain, and its flush() now sees EPIPE.
      fs.closeSync(readFd);
      readFdOpen = false;

      let caught: any;
      try {
        await writePromise;
      } catch (e) {
        caught = e;
      }
      expect(caught?.code).toBe("EPIPE");

      // The Err arm also moves the sink to its terminal state: further writes
      // short-circuit to Writable::Done (=> true).
      expect(sink.write("x")).toBe(true);

      // end() after the error reports the bytes that actually reached the fd;
      // the point is it doesn't claim the full chunk was delivered.
      const endRes = await sink.end();
      expect(typeof endRes).toBe("number");
      expect(endRes).toBeLessThan(size);
    } finally {
      try {
        await sink.end();
      } catch {}
      try {
        fs.closeSync(writeFd);
      } catch {}
      if (readFdOpen) fs.closeSync(readFd);
    }
  },
);

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

// The generated ${name}__doClose detached m_sinkPtr and then called __close,
// so the wrapper's destructor skipped __finalize and the wrapper's +1 on the
// native FileSink was never released.
it("close() does not leak the native FileSink", async () => {
  const dir = tmpdirSync();
  const baseline = fileSinkInternals.liveCount();
  const iterations = 8;
  for (let i = 0; i < iterations; i++) {
    const writer = Bun.file(join(dir, `close-leak-${i}.txt`)).writer();
    writer.write("hi");
    writer.close();
  }
  for (let i = 0; i < 50; i++) {
    Bun.gc(true);
    if (fileSinkInternals.liveCount() <= baseline) break;
    await Bun.sleep(10);
  }
  expect(fileSinkInternals.liveCount()).toBeLessThanOrEqual(baseline + 1);
});

// Now that __doClose runs finalize(), finalize() must not tear down state an
// in-flight write still needs: clearing `pending` here would drop the
// backpressure promise's Strong before on_write can settle it.
it.skipIf(isWindows)("close() while a write() promise is pending still settles it", async () => {
  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", "for await (const _ of process.stdin) {}"],
    env: bunEnv,
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
  });
  const writer = child.stdin;
  // 4 MiB overflows the default pipe capacity on Linux/macOS so write()
  // returns a promise.
  const p = writer.write(Buffer.alloc(4 * 1024 * 1024, 0x61));
  expect(p).toBeInstanceOf(Promise);
  writer.close();
  await expect(p).resolves.toBeGreaterThanOrEqual(0);
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(exitCode).toBe(0);
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

it("start() with a path/fd getter that closes the writer throws instead of crashing", async () => {
  const dir = tmpdirSync();
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { join } = require("node:path");
      for (const key of ["path", "fd"]) {
        const p = join(process.argv[1], "start-reentrant-" + key + ".txt");
        const w = Bun.file(p).writer();
        w.write("hello");
        let err;
        try {
          w.start({ get [key]() { w.close(); return key === "path" ? p : 1; } });
        } catch (e) { err = e; }
        console.log(key, /already been closed/.test(err?.message));
        try { w.write("x"); console.log("write ok"); } catch (e) { console.log("write", /already been closed/.test(e.message)); }
      }
      `,
      dir,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("path true\nwrite true\nfd true\nwrite true\n");
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(exitCode).toBe(0);
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

// Skipped on Windows: the Windows FileSink writer hands bytes to uv_fs_write on
// the libuv threadpool and never registers an AutoFlusher synchronously, so the
// on_exit drain this suite exercises is a no-op there and every process.exit()
// variant is a threadpool-vs-ExitProcess race rather than the POSIX buffered
// flush being tested here.
describe.skipIf(isWindows)("FileSink buffered data is flushed on process exit", () => {
  const line = "LAST-LOG-LINE:fatal error, exiting\n";
  async function check(tail: string, expected: string) {
    const dir = tmpdirSync();
    const out = join(dir, "sink.log");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const path = ${JSON.stringify(out)};
          const w = Bun.file(path).writer();
          w.write(${JSON.stringify(line)});
          ${tail}
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const contents = await Bun.file(out).text();
    expect({ stderr, contents, exitCode }).toEqual({ stderr: "", contents: expected, exitCode: 0 });
  }

  // write() then process.exit() in the same synchronous tick: the write is
  // buffered (below the auto-flush threshold) and the deferred auto-flush
  // task hasn't run yet. Previously this produced a 0-byte file.
  it.concurrent("same-tick process.exit()", () => check(`process.exit(0);`, line));
  // Control cases that already worked: after a tick, via process.exitCode,
  // and natural fall-through. Kept so a future change doesn't regress them.
  it.concurrent("next-tick process.exit()", () => check(`await Bun.sleep(0); process.exit(0);`, line));
  it.concurrent("process.exitCode then fall-through", () => check(`process.exitCode = 0;`, line));
  it.concurrent("natural fall-through", () => check(``, line));
  // A FileSink write performed inside a process.on('exit') listener should
  // also reach the file.
  it.concurrent("write inside 'exit' listener", () =>
    check(`process.on("exit", () => { w.write(${JSON.stringify(line)}); }); process.exit(0);`, line + line),
  );
});

// On a pipe or socket, a small write() parks the bytes in the sink's buffer and
// marks the event loop alive until they are flushed; the deferred auto-flush
// clears that once it has drained them. An explicit flush() that drained them
// itself (console.write is write()+flush()) used to leave the mark in place
// until that deferred task ran. 'beforeExit' is where this shows: it is
// re-emitted whenever a listener left the loop alive, so a listener doing
// write()+flush() got it a second time, and one writing on every emit kept the
// process alive forever. The fixtures below write on the first emit only and
// report on stderr, from 'exit', how many emits they saw.
describe("FileSink flush() from a 'beforeExit' listener", () => {
  const marker = "from beforeExit\n";

  function fixture(stream: "stdout" | "stderr") {
    return `
      let count = 0;
      let code = null;
      process.on("beforeExit", () => {
        count++;
        if (count !== 1) return;
        const sink = Bun.${stream}.writer();
        sink.write(${JSON.stringify(marker)});
        try {
          sink.flush();
        } catch (e) {
          code = e.code;
        }
      });
      process.on("exit", () => console.error(JSON.stringify({ count, code })));
    `;
  }

  // `stdio` replaces the child's stdin/stdout with raw fds; stdout is then not
  // captured and comes back as null.
  async function run(script: string, stdio: { stdin?: number; stdout?: number } = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      ...stdio,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      stdio.stdout === undefined ? (proc.stdout as ReadableStream).text() : null,
      (proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  const once = JSON.stringify({ count: 1, code: null }) + "\n";

  it.concurrent("Bun.stdout.writer() write()+flush() on a pipe emits 'beforeExit' once", async () => {
    expect(await run(fixture("stdout"))).toEqual({ stdout: marker, stderr: once, exitCode: 0 });
  });

  it.concurrent("Bun.stderr.writer() write()+flush() on a pipe emits 'beforeExit' once", async () => {
    expect(await run(fixture("stderr"))).toEqual({ stdout: "", stderr: marker + once, exitCode: 0 });
  });

  // flush() can also fail outright: the writer drops the buffered bytes and
  // flush() throws. Nothing is pending after that either, so this path must not
  // leave the loop marked alive any more than the success path does. The
  // child's stdout is a socket whose peer is already closed.
  it.concurrent.skipIf(!isPosix)("a flush() that fails with EPIPE emits 'beforeExit' once", async () => {
    const [readFd, writeFd] = createSocketPair();
    fs.closeSync(readFd);
    try {
      expect(await run(fixture("stdout"), { stdout: writeFd })).toEqual({
        stdout: null,
        stderr: JSON.stringify({ count: 1, code: "EPIPE" }) + "\n",
        exitCode: 0,
      });
    } finally {
      fs.closeSync(writeFd);
    }
  });

  // The other direction has to keep working: when flush() cannot drain the
  // buffer, the bytes are still pending and the process has to stay alive until
  // they go out. The child's stdout is a socket whose send buffer is already
  // full; its stdin is the other end. The unref'd timer that drains it does not
  // hold the process open by itself, it only gets to run because the pending
  // bytes do, so releasing the loop on this path would exit the child before
  // the timer fires and before flush()'s promise settles.
  it.concurrent.skipIf(!isPosix)("a flush() that could not drain keeps the process alive until it does", async () => {
    const [readFd, writeFd] = createSocketPair();
    try {
      // createSocketPair() hands out non-blocking fds: write until the kernel
      // refuses more.
      const filler = Buffer.alloc(64 * 1024, 0x61);
      let filled = 0;
      try {
        while (true) filled += fs.writeSync(writeFd, filler);
      } catch (e: any) {
        if (e.code !== "EAGAIN") throw e;
      }

      const result = await run(
        `
          const fs = require("node:fs");
          const sink = Bun.stdout.writer();
          const wrote = sink.write(${JSON.stringify(marker)});
          const flushed = sink.flush();
          let settled = "pending";
          Promise.resolve(flushed).then(
            () => { settled = "resolved"; },
            e => { settled = "rejected: " + e.code; },
          );

          setTimeout(() => {
            const buf = Buffer.alloc(64 * 1024);
            let drained = 0;
            while (drained < ${filled}) drained += fs.readSync(0, buf);
          }, 0).unref();

          let count = 0;
          process.on("beforeExit", () => { count++; });
          process.on("exit", () =>
            console.error(JSON.stringify({ wrote, flushReturnedPromise: flushed instanceof Promise, settled, count })),
          );
        `,
        { stdin: readFd, stdout: writeFd },
      );
      expect(result).toEqual({
        stdout: null,
        stderr:
          JSON.stringify({ wrote: marker.length, flushReturnedPromise: true, settled: "resolved", count: 1 }) + "\n",
        exitCode: 0,
      });
    } finally {
      fs.closeSync(readFd);
      fs.closeSync(writeFd);
    }
  });
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

it.skipIf(isWindows)("throws on invalid writer options instead of crashing", async () => {
  const stderr = Bun.stderr;
  const baseline = fileSinkInternals.liveCount();
  const iterations = 8;
  for (let i = 0; i < iterations; i++) {
    expect(() => stderr.writer({ path: 123 } as any)).toThrow(
      expect.objectContaining({
        code: "EINVAL",
        syscall: "write",
      }),
    );
    expect(() => stderr.writer({ fd: "not a number" } as any)).toThrow(
      expect.objectContaining({
        code: "EBADF",
        syscall: "write",
      }),
    );
    expect(() =>
      stderr.writer({
        get path() {
          throw new Error("boom");
        },
      } as any),
    ).toThrow("boom");
  }
  for (let i = 0; i < 50; i++) {
    Bun.gc(true);
    if (fileSinkInternals.liveCount() <= baseline) break;
    await Bun.sleep(10);
  }
  // Each early return in get_writer must release the sink's +1 ref; a missing
  // deref leaks one native FileSink per failed call.
  expect(fileSinkInternals.liveCount()).toBeLessThanOrEqual(baseline + 1);
});

it("start() with invalid options throws instead of silently ignoring them", async () => {
  const dir = tmpdirSync();
  const writer = Bun.file(join(dir, "start-invalid.txt")).writer();
  expect(() => writer.start({ path: 123 } as any)).toThrow(
    expect.objectContaining({
      code: "EINVAL",
      syscall: "write",
    }),
  );
  expect(() => writer.start({ fd: "not a number" } as any)).toThrow(
    expect.objectContaining({
      code: "EBADF",
      syscall: "write",
    }),
  );
  // Valid usage on the same writer still works after the failed start calls.
  writer.write("ok");
  await writer.end();
  expect(await Bun.file(join(dir, "start-invalid.txt")).text()).toBe("ok");
});
