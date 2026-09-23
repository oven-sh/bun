import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, libcPathForDlopen, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { closeSync, constants, openSync, readSync } from "node:fs";
import { join } from "node:path";

test("console.write rejects a non-object this", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
for (const value of [1766, true, "str", Symbol("s"), 10n, undefined, null]) {
  let code;
  try {
    console.write.call(value);
  } catch (e) {
    code = e.code;
  }
  if (code !== "ERR_INVALID_THIS") {
    throw new Error(\`expected ERR_INVALID_THIS for \${String(value)}, got \${code}\`);
  }
}

console.write.call({}, "x");
console.write("ok");
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "xok",
    exitCode: 0,
    signalCode: null,
  });
});

// console.write() is a FileSink write() + flush(). With stdout on a pipe the
// write() parks the bytes in the sink's buffer and marks the event loop alive
// until they are flushed; the flush() drained them right away but used to leave
// that mark in place, so a console.write() from a 'beforeExit' listener looked
// like newly scheduled work and 'beforeExit' was emitted again. A listener that
// writes on every emit kept the process alive forever; this one writes once, so
// the broken behavior shows up as a count of 2.
test("console.write inside a 'beforeExit' listener does not re-emit 'beforeExit'", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
let count = 0;
process.on("beforeExit", () => {
  count++;
  if (count === 1) console.write("from beforeExit\\n");
});
process.on("exit", () => console.log("beforeExit emitted " + count + " time(s)"));
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "from beforeExit\nbeforeExit emitted 1 time(s)\n",
    stderr: "",
    exitCode: 0,
  });
});

// A write larger than the pipe buffer leaves the sink backed up, and its write() then returns a
// Promise of the byte count instead of the count. With several arguments those Promises used to be
// added together with `+`, which made the string "[object Promise][object Promise]".
test("console.write resolves to the number of bytes written when stdout is backed up", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const big = Buffer.alloc(8 * 1024 * 1024, "é").toString();
const one = await console.write(big);
const two = await console.write(big, new Uint8Array(3));
console.error(JSON.stringify({ one, two }));
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);

  expect({ stderr, stdoutLength: stdout.length }).toEqual({
    stderr: JSON.stringify({ one: 8 * 1024 * 1024, two: 8 * 1024 * 1024 + 3 }) + "\n",
    stdoutLength: 2 * 8 * 1024 * 1024 + 3,
  });
  expect(exitCode).toBe(0);
});

// The Promise a backed-up console.write() returns is where its write error arrives: a script that
// awaits it can handle a reader that hung up, instead of dying with an unhandled rejection.
//
// Not on Windows: a write to a pipe whose reader is alive is accepted whole there and returns its byte
// count, so whether this script sees a Promise at all depends on whether the reader is already gone.
test.skipIf(isWindows).each([
  ["one argument", ""],
  ["several arguments", ', "tail"'],
])("an awaited console.write rejects with EPIPE when the reader has hung up (%s)", async (_label, extra) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
try {
  await console.write(Buffer.alloc(8 * 1024 * 1024, "x").toString()${extra});
  console.error("resolved");
} catch (e) {
  console.error("caught " + e.code);
}
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Take one chunk, then close the read end while most of the write is still pending.
  const reader = proc.stdout.getReader();
  await reader.read();
  await reader.cancel();

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("caught EPIPE\n");
  expect(exitCode).toBe(0);
});

// Every write to a pipe that is already broken fails on the spot, with a rejected Promise of its own.
// console.write() kept the last one, and lost that too when a short argument's flush threw or a later argument
// was not something to write. A script that awaited it and caught the error still died of the unhandled rejection
// of a Promise it was never given.
//
// The child blocks in a synchronous read of stdin until the parent has closed its end of stdout, and checks with
// a writer of its own that the pipe really is broken, so the test cannot pass by the writes simply being queued.
//
// A later console.write() to the broken pipe fails too.
const big = `Buffer.alloc(1024 * 1024, "a").toString()`;
test.concurrent.each([
  ["two large arguments", `${big}, ${big}`, "EPIPE"],
  ["a large argument, then a short one", `${big}, "\\n"`, "EPIPE"],
  ["a short argument, then a large one", `"\\n", ${big}`, "EPIPE"],
  ["a large argument, then one that is not something to write", `${big}, 123`, "ERR_INVALID_ARG_TYPE"],
])("an awaited console.write to a broken pipe fails once: %s", async (_label, args, code) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
process.on("unhandledRejection", e => {
  console.error("unhandledRejection " + e?.code);
});
require("node:fs").readSync(0, Buffer.alloc(1));
const probe = Bun.stdout.writer().write(${big});
console.error("pipe already broken: " + (probe instanceof Promise && Bun.peek.status(probe) === "rejected"));
if (probe instanceof Promise) probe.catch(() => {});
try {
  await console.write(${args});
  console.error("resolved");
} catch (e) {
  console.error("caught " + e.code);
}
await new Promise(resolve => setImmediate(resolve));
try {
  console.error("later: " + (await console.write("later")));
} catch (e) {
  console.error("later: caught " + e.code);
}
`,
    ],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.stdout.cancel();
  proc.stdin.write("x");
  await proc.stdin.end();

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toBe(`pipe already broken: true\ncaught ${code}\nlater: caught EPIPE\n`);
  expect(exitCode).toBe(0);
});

// console.write(a, "s", b): `a` overflows the pipe by a little and is pending; the short "s" beside it settles that
// write's Promise early, and `b` then starts a pending write of its own. Only the last Promise was kept, so the
// call resolved to a total without `a`.
//
// Linux, because the first argument has to be sized from the pipe's capacity (F_GETPIPE_SZ). stdout is a FIFO that
// this test does not read until the child has made the call.
test.concurrent.skipIf(!isLinux)("console.write counts a write that settled before the call was over", async () => {
  using dir = tempDir("console-write-total", {});
  const fifo = join(String(dir), "stdout.fifo");
  mkfifo(fifo, 0o600);
  const readEnd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  const writeEnd = openSync(fifo, constants.O_WRONLY);
  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const { dlopen } = require("bun:ffi");
const F_GETPIPE_SZ = 1032;
const libc = ${JSON.stringify(libcPathForDlopen())};
const capacity = dlopen(libc, { fcntl: { args: ["int", "int"], returns: "int" } }).symbols.fcntl(1, F_GETPIPE_SZ);
const a = Buffer.alloc(capacity + 100, "a").toString();
const b = Buffer.alloc(1024 * 1024, "b").toString();
const total = console.write(a, "s", b);
console.error("expected " + (a.length + 1 + b.length));
console.error("resolved " + (await total));
`,
      ],
      env: bunEnv,
      stdout: writeEnd,
      stderr: "pipe",
    });
    closeSync(writeEnd);

    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let stderr = "";
    while (!stderr.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      stderr += decoder.decode(value, { stream: true });
    }
    const expected = Number(/expected (\d+)/.exec(stderr)?.[1]);

    const chunk = Buffer.alloc(1024 * 1024);
    let arrived = 0;
    while (arrived < expected) {
      try {
        const n = readSync(readEnd, chunk);
        if (n === 0) break;
        arrived += n;
      } catch (e: any) {
        if (e.code !== "EAGAIN") throw e;
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      stderr += decoder.decode(value, { stream: true });
    }

    expect({ stderr, arrived }).toEqual({ stderr: `expected ${expected}\nresolved ${expected}\n`, arrived: expected });
    expect(await proc.exited).toBe(0);
  } finally {
    closeSync(readEnd);
  }
});

// What is not a Promise is added up as released: the first write's result, then `+=` each later one. A sink that
// has finished after a failure returns `true` from write(), so one argument gives `true` and two give 2. Not a
// count of anything, but it is what these calls return, and scripts that keep writing after their reader has gone
// see it.
//
// stdout is a FIFO whose read end this test holds open without reading, then closes. The child fills the pipe and
// leaves one short chunk buffered, whose flush cannot finish. When the read end goes, the sink finishes, and the
// one sign of it a script gets is the unhandled rejection of that flush's Promise, which console.write() dropped.
// (A script that writes before the event loop has seen the hang-up gets EPIPE thrown from every call instead.)
test.concurrent.skipIf(isWindows)("console.write to a finished sink adds up what write() returns", async () => {
  using dir = tempDir("console-write-finished", {});
  const fifo = join(String(dir), "stdout.fifo");
  mkfifo(fifo, 0o600);
  const readEnd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  const writeEnd = openSync(fifo, constants.O_WRONLY);
  let readEndOpen = true;
  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const fs = require("node:fs");
const finished = new Promise(resolve => process.on("unhandledRejection", resolve));
console.write("0");
for (const size of [1024, 1]) {
  try {
    for (;;) fs.writeSync(1, Buffer.alloc(size, "f"));
  } catch {}
}
console.write("short");
console.error("READY");
fs.readSync(0, Buffer.alloc(1));
await finished;
console.error(JSON.stringify([console.write("x"), console.write("x", "y"), console.write("x", "y", "z"), console.write(""), console.write("", "x")]));
`,
      ],
      env: bunEnv,
      stdin: "pipe",
      stdout: writeEnd,
      stderr: "pipe",
    });
    closeSync(writeEnd);

    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let stderr = "";
    while (!stderr.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      stderr += decoder.decode(value, { stream: true });
    }
    closeSync(readEnd);
    readEndOpen = false;
    proc.stdin.write("x");
    await proc.stdin.end();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      stderr += decoder.decode(value, { stream: true });
    }

    expect(stderr).toBe("READY\n" + JSON.stringify([true, 2, 3, 0, 1]) + "\n");
    expect(await proc.exited).toBe(0);
  } finally {
    if (readEndOpen) closeSync(readEnd);
  }
});
