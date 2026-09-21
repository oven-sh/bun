import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { closeSync, constants, openSync } from "node:fs";
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

// Every write to a pipe that is already broken fails on the spot. console.write() called the sink's write() once
// per argument and kept the last Promise it got back, so a script that awaited it and caught the error still died
// of the unhandled rejection of another argument's write (or, with a short last argument, of the flush throwing
// past the Promise it had).
//
// The child blocks in a synchronous read of stdin until the parent has closed its end of stdout, and checks with
// a writer of its own that the pipe really is broken, so the test cannot pass by the writes simply being queued.
//
// A later console.write() still fails. With a short argument left in the buffer by the failed call, the sink was
// marked finished when that was flushed, and later writes reported 0 bytes and no error.
const big = `Buffer.alloc(1024 * 1024, "a").toString()`;
test.concurrent.each([
  ["two large arguments", `${big}, ${big}`],
  ["a large argument, then a short one", `${big}, "\\n"`],
  ["a short argument, then a large one", `"\\n", ${big}`],
])("an awaited console.write to a broken pipe fails once: %s", async (_label, args) => {
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
  expect(stderr).toBe("pipe already broken: true\ncaught EPIPE\nlater: caught EPIPE\n");
  expect(exitCode).toBe(0);
});

// The reader has stalled and the pipe is full, so a short console.write() is buffered and its flush cannot push
// the buffer out. That left the sink with a pending Promise while console.write() returned the byte count: when
// the reader then hung up, the Promise was rejected with nobody holding it, and a script that awaited every
// console.write() still died of an unhandled rejection.
//
// stdout is a FIFO whose read end this test holds open and never reads. Another writer on the same pipe fills
// it and stays backed up, so console's own writer has nothing pending when the short write happens.
test.concurrent.skipIf(isWindows)(
  "an awaited console.write to a full pipe fails when the stalled reader hangs up",
  async () => {
    using dir = tempDir("console-write-stalled", {});
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
process.on("unhandledRejection", e => {
  console.error("unhandledRejection " + e?.code);
});
const filler = Bun.stdout.writer().write(Buffer.alloc(4 * 1024 * 1024, "f").toString());
filler.catch(() => {});
const result = console.write("line\\n");
console.error("READY " + (result instanceof Promise ? "Promise" : result));
try {
  await result;
  console.error("resolved");
} catch (e) {
  console.error("caught " + e.code);
}
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
      while (!stderr.includes("READY")) {
        const { value, done } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value, { stream: true });
      }
      closeSync(readEnd);
      readEndOpen = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value, { stream: true });
      }

      expect(stderr).toBe("READY Promise\ncaught EPIPE\n");
      expect(await proc.exited).toBe(0);
    } finally {
      if (readEndOpen) closeSync(readEnd);
    }
  },
);

// console.write(big, 123) throws for the argument that is not something to write, after the first one has become
// the sink's pending write. That write's Promise was made inside the call and never reaches the caller, so when
// the write later fails nobody can have handled it: it must not be reported as an unhandled rejection.
//
// stdout is a FIFO whose read end this test holds open and never reads, then closes.
test.concurrent.skipIf(isWindows)(
  "console.write that throws for a later argument leaves no unhandled rejection",
  async () => {
    using dir = tempDir("console-write-bad-argument", {});
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
process.on("unhandledRejection", e => {
  console.error("unhandledRejection " + e?.code);
});
try {
  console.write(Buffer.alloc(4 * 1024 * 1024, "x").toString(), 123);
  console.error("no throw");
} catch (e) {
  console.error("caught " + e.code);
}
console.error("READY");
process.stdin.once("data", () => console.error("end"));
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
      // The child's event loop sees the hang-up before it sees this byte on stdin.
      proc.stdin.write("x");
      await proc.stdin.end();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value, { stream: true });
      }

      expect(stderr).toBe("caught ERR_INVALID_ARG_TYPE\nREADY\nend\n");
      expect(await proc.exited).toBe(0);
    } finally {
      if (readEndOpen) closeSync(readEnd);
    }
  },
);
