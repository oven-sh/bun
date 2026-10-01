import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

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
// Promise of the byte count instead of the count.
test("console.write resolves to the number of bytes written when stdout is backed up", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const wrote = await console.write(Buffer.alloc(8 * 1024 * 1024, "é").toString());
console.error(JSON.stringify({ wrote }));
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);

  expect({ stderr, stdoutLength: stdout.length }).toEqual({
    stderr: JSON.stringify({ wrote: 8 * 1024 * 1024 }) + "\n",
    stdoutLength: 8 * 1024 * 1024,
  });
  expect(exitCode).toBe(0);
});

// The results of several arguments are added together with `+`, and two Promises added that way
// make the string "[object Promise][object Promise]".
test.todo("console.write of several arguments resolves to the number of bytes written", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const wrote = await console.write(Buffer.alloc(8 * 1024 * 1024, "é").toString(), new Uint8Array(3));
console.error(JSON.stringify({ wrote }));
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);

  expect({ stderr, stdoutLength: stdout.length }).toEqual({
    stderr: JSON.stringify({ wrote: 8 * 1024 * 1024 + 3 }) + "\n",
    stdoutLength: 8 * 1024 * 1024 + 3,
  });
  expect(exitCode).toBe(0);
});

// The Promise a backed-up console.write() returns is where its write error arrives: a script that
// awaits it can handle a reader that hung up, instead of dying with an unhandled rejection.
test.skipIf(isWindows)("an awaited console.write rejects with EPIPE when the reader has hung up", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
try {
  await console.write(Buffer.alloc(8 * 1024 * 1024, "x").toString());
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
  // macOS fails the one write that the close lands in with ENOTCONN, and every later one with EPIPE.
  const codes = process.platform === "darwin" ? ["EPIPE", "ENOTCONN"] : ["EPIPE"];
  expect(stderr).toBeOneOf(codes.map(code => `caught ${code}\n`));
  expect(exitCode).toBe(0);
});

// With several arguments the caller gets that string and not the Promises: the script prints
// "resolved", then dies on an unhandled EPIPE rejection.
test.todo("an awaited console.write of several arguments rejects with EPIPE when the reader has hung up", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
try {
  await console.write(Buffer.alloc(8 * 1024 * 1024, "x").toString(), "tail");
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

  const reader = proc.stdout.getReader();
  await reader.read();
  await reader.cancel();

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const codes = process.platform === "darwin" ? ["EPIPE", "ENOTCONN"] : ["EPIPE"];
  expect(stderr).toBeOneOf(codes.map(code => `caught ${code}\n`));
  expect(exitCode).toBe(0);
});
