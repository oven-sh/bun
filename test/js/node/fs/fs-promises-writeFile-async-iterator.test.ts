import { expect, mock, test } from "bun:test";
import { writeFile } from "fs/promises";
import { bunEnv, bunExe, isASAN, tempDirWithFiles } from "harness";
import { devNull } from "os";
import { Readable } from "stream";
test("fs.promises.writeFile async iterator", async () => {
  const dir = tempDirWithFiles("fs-promises-writeFile-async-iterator", {
    "file1.txt": "0 Hello, world!",
  });
  const path = dir + "/file2.txt";

  const stream = async function* () {
    yield "1 ";
    yield "Hello, ";
    yield "world!";
  };

  await writeFile(path, stream());
  expect(await Bun.file(path).text()).toBe("1 Hello, world!");

  const bufStream = async function* () {
    yield Buffer.from("2 ");
    yield Buffer.from("Hello, ");
    yield Buffer.from("world!");
  };

  await writeFile(path, bufStream());

  expect(await Bun.file(path).text()).toBe("2 Hello, world!");
});

test("fs.promises.writeFile async iterator throws on invalid input", async () => {
  const dir = tempDirWithFiles("fs-promises-writeFile-async-iterator", {
    "file1.txt": "0 Hello, world!",
  });
  const symbolStream = async function* () {
    yield Symbol("lolwhat");
  };

  expect(() => writeFile(dir + "/file2.txt", symbolStream())).toThrow();
  expect(() =>
    writeFile(
      dir + "/file3.txt",
      (async function* () {
        yield "once";
        throw new Error("good");
      })(),
    ),
  ).toThrow("good");
  const fn = {
    [Symbol.asyncIterator]: mock(() => {}),
  };
  expect(() => writeFile(dir, fn)).toThrow();
  expect(fn[Symbol.asyncIterator]).not.toBeCalled();
});

// Draining a fast Readable into writeFile must not turn into a microtask-only
// spin: the consumer has to yield to the event loop so timers keep firing, and
// an unbounded producer must stay memory-bounded via backpressure (node
// behaviour).
test.concurrent("fs.promises.writeFile(Readable) yields to the event loop", async () => {
  let timerFired = false;
  const timer = setTimeout(() => (timerFired = true), 1);
  try {
    let pushed = 0;
    // 4 KB chunks keep the Readable's 16 KB default highWaterMark to a handful
    // of buffered chunks, so only a few fs.write round-trips run before read()
    // observes the fired timer.
    const chunk = Buffer.alloc(4096, "0");
    const limit = 200_000;
    const readable = new Readable({
      read() {
        // End the stream as soon as a macrotask has been observed, otherwise
        // keep pushing up to `limit` chunks. A well-behaved producer that
        // honours push()'s backpressure return; the old FileSink path still
        // drained this without a single macrotask, so `timerFired` stayed
        // false for the whole transfer.
        if (timerFired) return void this.push(null);
        while (pushed < limit) {
          pushed++;
          if (!this.push(chunk)) return;
        }
        this.push(null);
      },
    });
    await writeFile(devNull, readable);
    expect(timerFired).toBe(true);
    expect(pushed).toBeLessThan(limit);
  } finally {
    clearTimeout(timer);
  }
});

test.concurrent(
  "fs.promises.writeFile applies backpressure to an unbounded Readable",
  async () => {
    // A Readable that never ends: it pushes a 1 KB chunk on every read(). With
    // backpressure the drain is paced by fs.write's threadpool round-trip, so a
    // timeout timer can fire and memory stays flat. Without it the consumer
    // spins in microtasks, the timer never runs, and the subprocess grows
    // unbounded until it is killed.
    const fixture = `
      const { writeFile } = require("node:fs/promises");
      const { Readable } = require("node:stream");
      const { devNull } = require("node:os");
      const KB = Buffer.alloc(1024, 65);
      const rss0 = process.memoryUsage().rss;
      setTimeout(() => {
        console.log(JSON.stringify({ rssDeltaMB: Math.round((process.memoryUsage().rss - rss0) / 1048576) }));
        process.exit(0);
      }, 1000);
      writeFile(devNull, new Readable({ read() { this.push(KB); } })).catch(() => {});
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // The unfixed build never reaches the timer at all, so stdout is empty and
    // the spawn timeout kills the process.
    expect(stdout.trim()).not.toBe("");
    const report = JSON.parse(stdout.trim());
    // Growth over baseline: node/bounded is ~0, the old unbounded-buffering
    // path climbed 50-200+ MB/s. ASAN inflates jitter but not by this much.
    expect(report.rssDeltaMB).toBeLessThan(isASAN ? 128 : 64);
    expect(exitCode).toBe(0);
  },
  15_000,
);
