import { describe, expect, test } from "bun:test";
import { Console } from "node:console";
import { bunEnv, bunExe } from "harness";

import { Writable } from "node:stream";

function writable() {
  let intoString = "";
  const { promise, resolve } = Promise.withResolvers();
  const stream = new Writable({
    write(chunk) {
      intoString += chunk.toString();
    },
    destroy() {
      resolve(intoString);
    },
    autoDestroy: true,
  });

  (stream as any).write = (chunk: any) => {
    intoString += Buffer.from(chunk).toString("utf-8");
  };

  return [stream, () => promise] as const;
}

describe("console.Console", () => {
  test("global instanceof Console", () => {
    expect(global.console).toBeInstanceOf(Console);
  });

  test("new Console instanceof Console", () => {
    const c = new Console({ stdout: process.stdout, stderr: process.stderr });
    expect(c).toBeInstanceOf(Console);
  });

  test("it can write to a stream", async () => {
    console.log();
    const [stream, value] = writable();
    const c = new Console({ stdout: stream, stderr: stream, colorMode: false });
    c.log("hello");
    c.log({ foo: "bar" });
    stream.end();
    expect(await value()).toBe("hello\n{ foo: 'bar' }\n");
  });

  test("can enable colors", async () => {
    const [stream, value] = writable();
    const c = new Console({ stdout: stream, stderr: stream, colorMode: true });
    c.log("hello");
    c.log({ foo: "bar" });
    stream.end();
    expect(await value()).toBe("hello\n{ foo: \u001B[32m'bar'\u001B[39m }\n");
  });

  test("stderr and stdout are separate", async () => {
    const [out, outValue] = writable();
    const [err, errValue] = writable();
    const c = new Console({ stdout: out, stderr: err });
    c.log("hello world!");
    c.error("uh oh!");
    out.end();
    err.end();
    expect(await outValue()).toBe("hello world!\n");
    expect(await errValue()).toBe("uh oh!\n");
  });
});

test("console._stdout", () => {
  // @ts-ignore
  expect(console._stdout).toBe(process.stdout);

  expect(Object.getOwnPropertyDescriptor(console, "_stdout")).toEqual({
    value: process.stdout,
    writable: true,
    enumerable: false,
    configurable: true,
  });
});

test("console._stderr", () => {
  // @ts-ignore
  expect(console._stderr).toBe(process.stderr);

  expect(Object.getOwnPropertyDescriptor(console, "_stderr")).toEqual({
    value: process.stderr,
    writable: true,
    enumerable: false,
    configurable: true,
  });
});

// console.trace writes to stderr with a "Trace:" prefix, matching Node.
// https://github.com/oven-sh/bun/issues/19952
describe("console.trace", () => {
  async function run(code: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("goes to stderr, not stdout", async () => {
    const { stdout, stderr, exitCode } = await run(`console.trace("hi")`);
    expect(stdout).toBe("");
    expect(stderr).toStartWith("Trace: hi\n");
    expect(stderr).toContain("at ");
    expect(exitCode).toBe(0);
  });

  test("no arguments prints bare 'Trace'", async () => {
    const { stdout, stderr, exitCode } = await run(`console.trace()`);
    expect(stdout).toBe("");
    expect(stderr).toStartWith("Trace\n");
    expect(stderr).toContain("at ");
    expect(exitCode).toBe(0);
  });

  test("applies format specifiers", async () => {
    const { stdout, stderr, exitCode } = await run(`console.trace("x=%d", 5)`);
    expect(stdout).toBe("");
    expect(stderr).toStartWith("Trace: x=5\n");
    expect(exitCode).toBe(0);
  });

  test("label goes after the console.group indent", async () => {
    const { stdout, stderr, exitCode } = await run(
      `console.group("G"); console.trace("x"); console.trace(); console.groupEnd(); console.trace("top");`,
    );
    // The group indent precedes the label, and the bare header is indented too.
    expect(stderr).toStartWith("  Trace: x\n");
    expect(stderr).toContain("\n  Trace\n");
    expect(stderr).toContain("\nTrace: top\n");
    expect(stdout).toBe("G\n");
    expect(exitCode).toBe(0);
  });
});
