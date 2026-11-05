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

// Node's global console writes through the live process.stdout.write and
// process.stderr.write, so a replaced `write` sees every message.
describe("global console writes through a replaced process.stdout.write", () => {
  async function run(source: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("the repro from the issue", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const orig = process.stdout.write;
      const seen = [];
      process.stdout.write = function (chunk, ...rest) {
        seen.push(String(chunk));
        return orig.call(this, chunk, ...rest);
      };
      console.log("hello");
      process.stdout.write = orig;
      console.log(seen.some(s => s.includes("hello")) ? "PASS" : "FAIL");
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("hello\nPASS\n");
    expect(exitCode).toBe(0);
  });

  test("every entry point reaches the replaced write once, as one string", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const out = [], err = [];
      const ow = process.stdout.write, ew = process.stderr.write;
      process.stdout.write = function (chunk) { out.push(chunk); return true; };
      process.stderr.write = function (chunk) { err.push(chunk); return true; };
      console.log("log", { a: 1 });
      console.info("info");
      console.debug("debug");
      console.log();
      console.count("c");
      console.count("c");
      console.table([{ a: 1 }]);
      console.group("grp");
      console.log("inner");
      console.groupEnd();
      console.dir({ d: 1 });
      console.error("error");
      console.warn("warn");
      console.error();
      console.assert(false);
      console.assert(false, "assert %s", "msg");
      console.time("t");
      console.timeLog("t", "extra", { b: 2 });
      console.timeEnd("t");
      process.stdout.write = ow;
      process.stderr.write = ew;
      console.log(JSON.stringify({ out, err: err.map(s => s.replace(/^\\[[\\d.]+m?s\\] /, "[T] ")) }));
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      out: [
        "log {\n  a: 1,\n}\n",
        "info\n",
        "debug\n",
        "\n",
        "c: 1\n",
        "c: 2\n",
        "┌───┬───┐\n│   │ a │\n├───┼───┤\n│ 0 │ 1 │\n└───┴───┘\n",
        "grp\n",
        "  inner\n",
        "{\n  d: 1,\n}\n",
      ],
      err: ["error\n", "warn\n", "\n", "Assertion failed\n", "assert msg\n", "[T] t extra {\n  b: 2,\n}\n", "[T] t\n"],
    });
    expect(exitCode).toBe(0);
  });

  test("console.trace goes to the replaced stdout write", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const ow = process.stdout.write;
      let seen = "";
      process.stdout.write = function (chunk) { seen += chunk; return true; };
      console.trace("tr");
      process.stdout.write = ow;
      console.log(JSON.stringify(seen.split("\\n")[0]));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe('"tr"\n');
    expect(exitCode).toBe(0);
  });

  test("a throwing or non-callable write is ignored, like node", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const ow = process.stdout.write;
      process.stdout.write = function () { throw new Error("boom"); };
      console.log("swallowed");
      console.count("swallowed");
      process.stdout.write = 42;
      console.log("dropped");
      process.stdout.write = ow;
      console.log("after");
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("after\n");
    expect(exitCode).toBe(0);
  });

  test("a write that logs again, an accessor write, and a deleted write", async () => {
    const source = `
      const ow = process.stdout.write;
      let depth = 0;
      process.stdout.write = function (chunk) {
        if (depth++ < 1) console.log("nested:" + String(chunk).trim());
        return ow.call(this, "W:" + chunk);
      };
      console.log("outer");
      process.stdout.write = ow;
      console.log("restored");
      Object.defineProperty(process.stdout, "write", {
        get() { return (chunk) => ow.call(process.stdout, "G:" + chunk); },
        configurable: true,
      });
      console.log("accessor");
      delete process.stdout.write;
      console.log("prototype");
    `;
    const { stdout, stderr, exitCode } = await run(source);
    expect(stderr).toBe("");
    expect(stdout).toBe("W:nested:outer\nW:outer\nrestored\nG:accessor\nprototype\n");
    expect(exitCode).toBe(0);
  });

  test("a stream with its own write keeps the native path, in order with process.stdout.write", async () => {
    const { stdout, stderr, exitCode } = await run(`
      process.stdout.write("a\\n"); console.log("b"); process.stdout.write("c\\n"); console.log("d");
      process.stderr.write("A\\n"); console.error("B"); process.stderr.write("C\\n"); console.error("D");
    `);
    expect(stdout).toBe("a\nb\nc\nd\n");
    expect(stderr).toBe("A\nB\nC\nD\n");
    expect(exitCode).toBe(0);
  });
});
