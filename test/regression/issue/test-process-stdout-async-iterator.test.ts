import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("process.stdout and process.stderr have Symbol.asyncIterator for Node.js compatibility", () => {
  // This is needed for compatibility with tools like execa that check for async iterability
  // to determine stream capabilities
  expect(typeof process.stdout[Symbol.asyncIterator]).toBe("function");
  expect(typeof process.stderr[Symbol.asyncIterator]).toBe("function");
});

test("process.stdout and process.stderr async iterators work without throwing", async () => {
  // The iterators should work even though stdout/stderr are write-only
  // They should just complete immediately without yielding any values
  const stdoutIterator = process.stdout[Symbol.asyncIterator]();
  const stdoutResult = await stdoutIterator.next();
  expect(stdoutResult.done).toBe(true);
  expect(stdoutResult.value).toBeUndefined();

  const stderrIterator = process.stderr[Symbol.asyncIterator]();
  const stderrResult = await stderrIterator.next();
  expect(stderrResult.done).toBe(true);
  expect(stderrResult.value).toBeUndefined();
});

test("tty.WriteStream has Symbol.asyncIterator", () => {
  const tty = require("node:tty");
  // Create a WriteStream for stdout fd
  const stream = new tty.WriteStream(1);
  expect(typeof stream[Symbol.asyncIterator]).toBe("function");
});

test("tty.WriteStream has read() returning null, like Node's net.Socket", () => {
  const tty = require("node:tty");
  const stream = new tty.WriteStream(1);
  expect(typeof stream.read).toBe("function");
  expect(stream.read()).toBeNull();
});

test("piped process.stdout and process.stderr have read() returning null", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `console.log(JSON.stringify([typeof process.stdout.read, process.stdout.read(), typeof process.stderr.read, process.stderr.read()]))`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(["function", null, "function", null]);
  expect(exitCode).toBe(0);
});
