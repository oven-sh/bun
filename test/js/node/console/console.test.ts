import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { Console } from "node:console";

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

// Node performs every console write through process.stdout.write /
// process.stderr.write, so replacing those methods has to be observed by the
// global console too — that is what test/common/hijackstdio.js relies on.
test("the global console writes through a replaced process.stdout.write", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const out = [];
       const err = [];
       const realOut = process.stdout.write.bind(process.stdout);
       process.stdout.write = s => { out.push(s); return true; };
       process.stderr.write = s => { err.push(s); return true; };
       console.log("to stdout", 1);
       console.error("to stderr");
       console.warn("also stderr");
       console.count();
       delete process.stdout.write;
       delete process.stderr.write;
       realOut(JSON.stringify({ out, err }));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({
    stdout: { out: ["to stdout 1\n", "default: 1\n"], err: ["to stderr\n", "also stderr\n"] },
    stderr: "",
    exitCode: 0,
  });
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/console/constructor.js#L379-L385
test("console.assert prefixes the message with 'Assertion failed: '", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `console.assert(false, "%s should", "console.assert", "not throw");
       console.assert(false);
       console.assert(true, "not printed");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "",
    stderr: "Assertion failed: console.assert should not throw\nAssertion failed\n",
    exitCode: 0,
  });
});
