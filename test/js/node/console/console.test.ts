import { describe, expect, test } from "bun:test";
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

  describe("table", () => {
    test("pads cells on the right", async () => {
      const [stream, value] = writable();
      const c = new Console({ stdout: stream, stderr: stream, colorMode: false });
      c.table([
        { aaaaa: 1, b: "x" },
        { aaaaa: 22222, c: true },
      ]);
      c.table({ a: 1, bbbb: "two" });
      stream.end();
      expect(await value()).toMatchInlineSnapshot(`
        "┌─────────┬───────┬─────┬──────┐
        │ (index) │ aaaaa │ b   │ c    │
        ├─────────┼───────┼─────┼──────┤
        │ 0       │ 1     │ 'x' │      │
        │ 1       │ 22222 │     │ true │
        └─────────┴───────┴─────┴──────┘
        ┌─────────┬────────┐
        │ (index) │ Values │
        ├─────────┼────────┤
        │ a       │ 1      │
        │ bbbb    │ 'two'  │
        └─────────┴────────┘
        "
      `);
    });

    test("pads by visible width, not string length", async () => {
      const [stream, value] = writable();
      const c = new Console({ stdout: stream, stderr: stream, colorMode: false });
      c.table([{ name: "日本語" }, { name: "ab" }]);
      stream.end();
      expect(await value()).toMatchInlineSnapshot(`
        "┌─────────┬──────────┐
        │ (index) │ name     │
        ├─────────┼──────────┤
        │ 0       │ '日本語' │
        │ 1       │ 'ab'     │
        └─────────┴──────────┘
        "
      `);
    });
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
