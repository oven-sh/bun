import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

  test("an error from a forwarding write is dropped, like node: write after end and EPIPE", async () => {
    const afterEnd = await run(`
      const ow = process.stdout.write;
      process.stdout.write = function (c, ...r) { return ow.call(this, c, ...r); };
      process.stdout.end();
      console.log("after-end");
      process.stderr.write("alive\\n");
    `);
    expect(afterEnd.stderr).toBe("alive\n");
    expect(afterEnd.exitCode).toBe(0);

    // `head` closes the pipe after one line. Every later write fails with EPIPE.
    if (!isWindows) {
      await using proc = Bun.spawn({
        cmd: [
          "bash",
          "-c",
          `"$0" -e "$1" | head -1`,
          bunExe(),
          `
            const ow = process.stdout.write;
            process.stdout.write = function (c, ...r) { return ow.call(this, c, ...r); };
            for (let i = 0; i < 2000; i++) console.log("line " + i);
            process.stderr.write("done " + process.exitCode + "\\n");
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("line 0\n");
      expect(stderr).toBe("done undefined\n");
      expect(exitCode).toBe(0);
    }
  });

  test("a stack overflow in the replaced write is not dropped, like node", async () => {
    const { stdout, stderr, exitCode } = await run(`
      process.stdout.write = function () { console.log("again"); };
      console.log("x");
    `);
    expect(stdout).toBe("");
    expect(stderr).toContain("RangeError: Maximum call stack size exceeded");
    expect(exitCode).toBe(1);
  });

  test("console.clear and a coloured console.count reach the replaced write", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const out = [], err = [];
          const ew = process.stderr.write;
          process.stdout.write = function (chunk) { out.push(chunk); return true; };
          process.stderr.write = function (chunk) { err.push(chunk); return true; };
          console.clear();
          console.count("c");
          process.stderr.write = ew;
          process.stderr.write(JSON.stringify({ out, err }));
        `,
      ],
      env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toEqual({
      out: ["\x1b[2J\x1b[3J\x1b[H", "\x1b[0mc\x1b[2m: \x1b[0m\x1b[33m1\x1b[0m\n"],
      err: [],
    });
    expect(exitCode).toBe(0);
  });

  test("a stream whose structure JSC flattens keeps routing", async () => {
    // 200 added properties turn the stream into a dictionary. The deletes and the hot loop make JSC flatten it,
    // which renumbers its property offsets in place.
    const { stdout, stderr, exitCode } = await run(`
      const s = process.stdout;
      const ow = s.write;
      for (let i = 0; i < 200; i++) s["p" + i] = i;
      delete s.write;
      s.write = function (c) { return ow.call(this, "W:" + c); };
      for (let i = 0; i < 200; i++) delete s["p" + i];
      for (let i = 0; i < 2000; i++) console.log("x");
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("W:x\n".repeat(2000));
    expect(exitCode).toBe(0);
  });

  test("a Web Worker's console follows the worker's own process.stdout.write", async () => {
    using dir = tempDir("console-worker", {
      "main.js": `
        const w = new Worker(new URL("./worker.js", import.meta.url).href);
        w.onmessage = e => { console.log("seen=" + JSON.stringify(e.data)); w.terminate(); };
      `,
      "worker.js": `
        const seen = [];
        const ow = process.stdout.write;
        process.stdout.write = function (c) { seen.push(String(c)); return ow.call(this, c); };
        console.log("from-worker");
        console.count("c");
        process.stdout.write = ow;
        postMessage(seen);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe('from-worker\nc: 1\nseen=["from-worker\\n","c: 1\\n"]\n');
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
