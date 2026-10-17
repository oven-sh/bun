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

  // Each expected table is the output of node v26.3.0 for the same call, not a capture of Bun's.
  describe("table pads cells on the right", () => {
    async function table(data: unknown, properties?: string[]) {
      const [stream, value] = writable();
      const c = new Console({ stdout: stream, stderr: stream, colorMode: false });
      c.table(data, properties);
      stream.end();
      return await value();
    }

    test("array of objects with absent cells", async () => {
      expect(
        await table([
          { aaaaa: 1, b: "x" },
          { aaaaa: 22222, c: true },
        ]),
      ).toMatchInlineSnapshot(`
        "┌─────────┬───────┬─────┬──────┐
        │ (index) │ aaaaa │ b   │ c    │
        ├─────────┼───────┼─────┼──────┤
        │ 0       │ 1     │ 'x' │      │
        │ 1       │ 22222 │     │ true │
        └─────────┴───────┴─────┴──────┘
        "
      `);
    });

    test("object of primitives", async () => {
      expect(await table({ a: 1, bbbb: "two" })).toMatchInlineSnapshot(`
        "┌─────────┬────────┐
        │ (index) │ Values │
        ├─────────┼────────┤
        │ a       │ 1      │
        │ bbbb    │ 'two'  │
        └─────────┴────────┘
        "
      `);
    });

    test("Map", async () => {
      expect(await table(new Map([["k", 1]]))).toMatchInlineSnapshot(`
        "┌───────────────────┬─────┬────────┐
        │ (iteration index) │ Key │ Values │
        ├───────────────────┼─────┼────────┤
        │ 0                 │ 'k' │ 1      │
        └───────────────────┴─────┴────────┘
        "
      `);
    });

    test("properties filter", async () => {
      expect(
        await table(
          [
            { a: 1, b: 2 },
            { a: 3, c: 4 },
          ],
          ["a", "c"],
        ),
      ).toMatchInlineSnapshot(`
        "┌─────────┬───┬───┐
        │ (index) │ a │ c │
        ├─────────┼───┼───┤
        │ 0       │ 1 │   │
        │ 1       │ 3 │ 4 │
        └─────────┴───┴───┘
        "
      `);
    });

    test("cells wider than their string length", async () => {
      expect(await table([{ name: "日本語" }, { name: "ab" }])).toMatchInlineSnapshot(`
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
