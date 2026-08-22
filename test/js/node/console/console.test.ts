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

describe("global console honors util.inspect.defaultOptions", () => {
  async function run(src: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: { ...bunEnv, NO_COLOR: "1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("depth / maxArrayLength / numericSeparator on console.log", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const util = require("node:util");
      util.inspect.defaultOptions.depth = 0;
      util.inspect.defaultOptions.maxArrayLength = 2;
      util.inspect.defaultOptions.numericSeparator = true;
      console.log({ a: { b: { c: { d: 1 } } } });
      console.log([1, 2, 3, 4, 5, 6]);
      console.log(1234567);
      console.warn("%O", { x: { y: 1 } });
    `);
    expect(stderr).toBe("{ x: [Object] }\n");
    expect(stdout).toBe("{ a: [Object] }\n" + "[ 1, 2, ... 4 more items ]\n" + "1_234_567\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("Object.defineProperty on defaultOptions", async () => {
    const { stdout, exitCode } = await run(`
      const util = require("node:util");
      Object.defineProperty(util.inspect.defaultOptions, "depth", { value: 0 });
      console.log({ a: { b: 1 } });
    `);
    expect(stdout).toBe("{ a: [Object] }\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("setter form and console.dir", async () => {
    const { stdout, exitCode } = await run(`
      const util = require("node:util");
      util.inspect.defaultOptions = { depth: 0 };
      console.log({ a: { b: 1 } });
      console.dir({ a: { b: { c: 1 } } }, { depth: 5 });
      console.dir({ a: { b: 1 } });
    `);
    expect(stdout).toBe("{ a: [Object] }\n" + "{ a: { b: { c: 1 } } }\n" + "{ a: [Object] }\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("console.timeLog extra args", async () => {
    const { stderr, exitCode } = await run(`
      const util = require("node:util");
      util.inspect.defaultOptions.depth = 0;
      console.time("t");
      console.timeLog("t", { a: { b: { c: 1 } } });
    `);
    expect(stderr).toContain("{ a: [Object] }");
    expect(exitCode).toBe(0);
  });

  test.concurrent("--console-depth still applies when an unrelated default is changed", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--console-depth=5",
        "-e",
        `const util = require("util");` +
          `util.inspect.defaultOptions.maxArrayLength = 5;` +
          `console.log({ a: { b: { c: { d: { e: 1 } } } } });` +
          `process.stdout.write(JSON.stringify({` +
          `  defaultDepth: util.inspect.defaultOptions.depth,` +
          `  inspected: util.inspect({ a: { b: { c: { d: 1 } } } }),` +
          `}));`,
      ],
      env: { ...bunEnv, NO_COLOR: "1" },
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const lastLine = stdout.trimEnd().split("\n").pop()!;
    expect(stdout).toContain("e: 1");
    expect(JSON.parse(lastLine)).toEqual({
      defaultDepth: 2,
      inspected: "{ a: { b: { c: [Object] } } }",
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("group indentation still applied", async () => {
    const { stdout, exitCode } = await run(`
      const util = require("node:util");
      util.inspect.defaultOptions.depth = 0;
      console.group("g");
      console.log({ a: { b: 1 } });
      console.groupEnd();
    `);
    expect(stdout).toBe("g\n  { a: [Object] }\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("defaultOptions remains sealed and stable", async () => {
    const { stdout, exitCode } = await run(`
      const util = require("node:util");
      const opts = util.inspect.defaultOptions;
      process.stdout.write(JSON.stringify({
        sealed: Object.isSealed(opts),
        same: opts === util.inspect.defaultOptions,
        hasDepth: Object.prototype.hasOwnProperty.call(opts, "depth"),
      }));
    `);
    expect(JSON.parse(stdout)).toEqual({ sealed: true, same: true, hasDepth: true });
    expect(exitCode).toBe(0);
  });

  test.concurrent("writes via an inheriting object do not leak into the shared defaults", async () => {
    const { stdout, exitCode } = await run(`
      const util = require("node:util");
      const my = Object.create(util.inspect.defaultOptions);
      my.depth = 10;
      process.stdout.write(JSON.stringify({
        sharedDepth: util.inspect.defaultOptions.depth,
        ownDepth: Object.hasOwn(my, "depth"),
      }) + "\\n");
      console.log({ a: { b: { c: { d: 1 } } } });
    `);
    const [json, ...rest] = stdout.split("\n");
    expect(JSON.parse(json)).toEqual({ sharedDepth: 2, ownDepth: true });
    expect(rest.join("\n")).not.toContain("[Object]");
    expect(exitCode).toBe(0);
  });
});
