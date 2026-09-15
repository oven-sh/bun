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
});

describe("console.Console#table", () => {
  function table(tabularData: unknown, properties?: string[]) {
    let out = "";
    const sink = () =>
      new Writable({
        decodeStrings: false,
        write(chunk, _encoding, callback) {
          out += chunk;
          callback();
        },
      });
    const c = new Console({ stdout: sink(), stderr: sink(), colorMode: false });
    c.table(tabularData, properties);
    expect(out).not.toBe("");
    return out;
  }

  test("rows with an object cell", () => {
    expect(table([{ a: { x: 1 } }, { a: 2 }])).toMatchInlineSnapshot(`
      "┌─────────┬──────────┐
      │ (index) │    a     │
      ├─────────┼──────────┤
      │    0    │ { x: 1 } │
      │    1    │    2     │
      └─────────┴──────────┘
      "
    `);
  });

  test("array rows with an object cell", () => {
    expect(table([[1, { y: 2 }]])).toMatchInlineSnapshot(`
      "┌─────────┬───┬──────────┐
      │ (index) │ 0 │    1     │
      ├─────────┼───┼──────────┤
      │    0    │ 1 │ { y: 2 } │
      └─────────┴───┴──────────┘
      "
    `);
  });

  test("Map with an object key and an object value", () => {
    expect(
      table(
        new Map<unknown, unknown>([
          ["k1", { a: 1 }],
          [{ k: 2 }, 2],
        ]),
      ),
    ).toMatchInlineSnapshot(`
      "┌───────────────────┬──────────┬──────────┐
      │ (iteration index) │   Key    │  Values  │
      ├───────────────────┼──────────┼──────────┤
      │         0         │   'k1'   │ { a: 1 } │
      │         1         │ { k: 2 } │    2     │
      └───────────────────┴──────────┴──────────┘
      "
    `);
  });

  test("Set with an object value", () => {
    expect(table(new Set([1, "two", { x: 3 }]))).toMatchInlineSnapshot(`
      "┌───────────────────┬──────────┐
      │ (iteration index) │  Values  │
      ├───────────────────┼──────────┤
      │         0         │    1     │
      │         1         │  'two'   │
      │         2         │ { x: 3 } │
      └───────────────────┴──────────┘
      "
    `);
  });

  test("Buffer cell", () => {
    expect(table([{ a: Buffer.from([1, 2, 3]) }])).toMatchInlineSnapshot(`
      "┌─────────┬───────────────────┐
      │ (index) │         a         │
      ├─────────┼───────────────────┤
      │    0    │ <Buffer 01 02 03> │
      └─────────┴───────────────────┘
      "
    `);
  });

  test("properties filter with an object cell", () => {
    expect(table([{ a: { x: 1 }, b: 2 }], ["a"])).toMatchInlineSnapshot(`
      "┌─────────┬──────────┐
      │ (index) │    a     │
      ├─────────┼──────────┤
      │    0    │ { x: 1 } │
      └─────────┴──────────┘
      "
    `);
  });

  test("object cell with more than two keys collapses to [Object]", () => {
    expect(table([{ a: { p: 1, q: 2, r: 3 } }])).toMatchInlineSnapshot(`
      "┌─────────┬──────────┐
      │ (index) │    a     │
      ├─────────┼──────────┤
      │    0    │ [Object] │
      └─────────┴──────────┘
      "
    `);
  });

  test("primitive cells", () => {
    expect(table([{ a: 1, b: "x" }])).toMatchInlineSnapshot(`
      "┌─────────┬───┬─────┐
      │ (index) │ a │  b  │
      ├─────────┼───┼─────┤
      │    0    │ 1 │ 'x' │
      └─────────┴───┴─────┘
      "
    `);
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
