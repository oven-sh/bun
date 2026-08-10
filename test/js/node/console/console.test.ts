import { describe, expect, spyOn, test } from "bun:test";
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

// The global console binds its streams lazily through a get/set accessor pair
// (kBindStreamsLazy), so `_stdout` / `_stderr` are accessors, not data
// properties, and assigning them redirects the console:
// https://github.com/nodejs/node/blob/v24.0.0/lib/internal/console/constructor.js#L205-L234
test.each(["_stdout", "_stderr"] as const)("console.%s", key => {
  const stream = key === "_stdout" ? process.stdout : process.stderr;
  // @ts-ignore
  expect(console[key]).toBe(stream);

  const desc = Object.getOwnPropertyDescriptor(console, key)!;
  expect(desc.enumerable).toBe(false);
  expect(desc.configurable).toBe(true);
  expect(typeof desc.get).toBe("function");
  expect(typeof desc.set).toBe("function");
  expect("value" in desc).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// The global console writes through process.stdout / process.stderr the way
// Node's does (`this._stdout.write(chunk)`), so anything that observes those
// streams observes the console — while, unobserved, it never builds a JS string
// or enters JS at all. Each case runs in a fresh process so stream state does
// not leak between them.
// ─────────────────────────────────────────────────────────────────────────────
async function run(src: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("global console -> process.stdout / process.stderr", () => {
  test("a replaced process.stdout.write / process.stderr.write sees every console method, one write() per call", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const seen = { out: [], err: [] };
      const { write: ow } = process.stdout, { write: ew } = process.stderr;
      process.stdout.write = function (chunk, ...rest) { seen.out.push(String(chunk)); return true; };
      process.stderr.write = function (chunk, ...rest) { seen.err.push(String(chunk)); return true; };
      console.log("log %d", 1);
      console.info("info");
      console.debug("debug");
      console.dir({ dir: 1 });
      console.dirxml("dirxml");
      console.table([{ a: 1 }]);
      console.count("cnt"); console.count("cnt");
      console.group("grp"); console.log("in group"); console.groupEnd();
      console.time("t"); console.timeLog("t", "extra"); console.timeEnd("t");
      console.warn("warn");
      console.error("error", { e: 1 });
      console.assert(false, "assert %s", "msg");
      console.assert(false);
      console.trace("trace");
      process.stdout.write = ow; process.stderr.write = ew;
      // Restoring puts the native path back: this arrives, and is not seen.
      console.log("restored");
      process.stderr.write(JSON.stringify(seen));
    `);
    expect(stdout).toBe("restored\n");
    const seen = JSON.parse(stderr);
    // Elapsed times vary; the stack in trace() has a path.
    seen.out = seen.out.map((s: string) => s.replace(/: [\d.]+m?s/, ": <t>"));
    seen.err = seen.err.map((s: string) => (s.startsWith("trace\n") ? "trace\n<stack>" : s));
    expect(seen).toEqual({
      out: [
        "log 1\n",
        "info\n",
        "debug\n",
        "{\n  dir: 1,\n}\n",
        "dirxml\n",
        "┌───┬───┐\n│   │ a │\n├───┼───┤\n│ 0 │ 1 │\n└───┴───┘\n",
        "cnt: 1\n",
        "cnt: 2\n",
        "grp\n",
        "  in group\n",
        "t: <t> extra\n",
        "t: <t>\n",
      ],
      err: [
        "warn\n",
        "error {\n  e: 1,\n}\n",
        "Assertion failed: assert msg\n",
        "Assertion failed\n",
        "trace\n<stack>",
      ],
    });
    expect(exitCode).toBe(0);
  });

  test("console._stdout / console._stderr assignment redirects; assigning process.std* back restores", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const { Writable } = require("node:stream");
      const chunks = [];
      const sink = new Writable({ write(c, e, cb) { chunks.push(String(c)); cb(); } });
      console._stdout = sink;
      console._stderr = sink;
      console.log("to sink");
      console.error("err to sink");
      console._stdout = process.stdout;
      console._stderr = process.stderr;
      console.log("back");
      console.error(JSON.stringify(chunks));
    `);
    expect(stdout).toBe("back\n");
    expect(stderr).toBe('["to sink\\n","err to sink\\n"]\n');
    expect(exitCode).toBe(0);
  });

  test("like Node, the console binds process.stdout on first use: replacing it before that is honoured, after that is not", async () => {
    // https://github.com/nodejs/node/blob/v24.0.0/lib/internal/console/constructor.js#L205-L234
    const before = await run(`
      const { Writable } = require("node:stream");
      const chunks = [];
      Object.defineProperty(process, "stdout", { value: new Writable({ write(c, e, cb) { chunks.push(String(c)); cb(); } }), configurable: true, writable: true });
      console.log("first use");
      process.stderr.write(JSON.stringify(chunks));
    `);
    expect(before).toEqual({ stdout: "", stderr: '["first use\\n"]', exitCode: 0 });

    const after = await run(`
      const { Writable } = require("node:stream");
      const chunks = [];
      console.log("first use");
      Object.defineProperty(process, "stdout", { value: new Writable({ write(c, e, cb) { chunks.push(String(c)); cb(); } }), configurable: true, writable: true });
      console.log("second use");
      process.stderr.write(JSON.stringify(chunks));
    `);
    expect(after).toEqual({ stdout: "first use\nsecond use\n", stderr: "[]", exitCode: 0 });

    // An accessor (what spyOn(process, "stdout", "get") installs) is read
    // through its getter once, at bind time; a throwing one surfaces from that
    // first console call and binding is retried on the next.
    const accessor = await run(`
      const { Writable } = require("node:stream");
      const chunks = [];
      const sink = new Writable({ write(c, e, cb) { chunks.push(String(c)); cb(); } });
      let calls = 0, armed = true;
      Object.defineProperty(process, "stdout", { get() { calls++; if (armed) { armed = false; throw new Error("getter boom"); } return sink; }, configurable: true });
      let first;
      try { console.log("lost"); } catch (e) { first = e.message; }
      console.log("one"); console.info("two");
      process.stderr.write(JSON.stringify({ first, calls, chunks, same: console._stdout === sink }));
    `);
    expect(accessor.stdout).toBe("");
    expect(JSON.parse(accessor.stderr)).toEqual({
      first: "getter boom",
      calls: 2,
      chunks: ["one\n", "two\n"],
      same: true,
    });
    expect(accessor.exitCode).toBe(0);
  });

  test("cork() holds console output with the stream's other writes until uncork()", async () => {
    const { stdout, stderr, exitCode } = await run(`
      process.stdout.cork();
      console.log("1 (corked)");
      process.stdout.write("2 (corked)\\n");
      process.stderr.write("[stderr while stdout corked]");
      process.stdout.uncork();
      console.log("3");
    `);
    expect(stderr).toBe("[stderr while stdout corked]");
    expect(stdout).toBe("1 (corked)\n2 (corked)\n3\n");
    expect(exitCode).toBe(0);
  });

  test("a write() that throws is swallowed; a stack overflow is not (Node kWriteToConsole)", async () => {
    // A real runaway recursion takes minutes to overflow in debug/ASAN builds;
    // what the console keys on is the engine's stack-overflow RangeError.
    const { stdout, stderr, exitCode } = await run(`
      process.stdout.write = () => { throw new Error("nope"); };
      console.log("swallowed");
      let threw;
      process.stdout.write = () => { throw new RangeError("Maximum call stack size exceeded."); };
      try { console.log("overflow"); } catch (e) { threw = e.constructor.name; }
      process.stderr.write(String(threw));
    `);
    expect(stdout).toBe("");
    expect(stderr).toBe("RangeError");
    expect(exitCode).toBe(0);
  });

  test("adding unrelated own properties to process.stdout keeps the native path (structure re-cached), patching write leaves it", async () => {
    // Observable only indirectly: a patched write counts calls; an unpatched
    // stream with extra props must still print and must not be 'seen'.
    const { stdout, stderr, exitCode } = await run(`
      process.stdout._tag = 1;            // structure transition, no own write
      process.stdout.isTTY = false;
      console.log("a");
      let n = 0;
      const w = process.stdout.write;
      process.stdout.write = function () { n++; return w.apply(this, arguments); };
      console.log("b");
      delete process.stdout.write;         // back to the prototype's
      console.log("c");
      process.stderr.write(String(n));
    `);
    expect(stdout).toBe("a\nb\nc\n");
    expect(stderr).toBe("1");
    expect(exitCode).toBe(0);
  });

  test("console._ignoreErrors is true and console.clear() writes the escape through _stdout when it isTTY", async () => {
    // https://github.com/nodejs/node/blob/v24.0.0/lib/internal/console/constructor.js#L487-L501
    const { stdout, stderr, exitCode } = await run(`
      let buf = "";
      const w = process.stdout.write;
      process.stdout.isTTY = true;
      process.stdout.write = s => ((buf += s), true);
      console.clear();
      process.stdout.isTTY = false;
      console.clear();
      process.stdout.write = w;
      process.stderr.write(JSON.stringify({ buf, ignore: console._ignoreErrors }));
    `);
    expect(JSON.parse(stderr)).toEqual({ buf: "\x1b[1;1H\x1b[0J", ignore: true });
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });

  test("diagnostics_channel console.* channels publish the argument list before formatting, only while subscribed", async () => {
    // https://github.com/nodejs/node/blob/v24.0.0/lib/internal/console/constructor.js#L409-L443
    const { stdout, stderr, exitCode } = await run(`
      const dc = require("node:diagnostics_channel");
      const seen = [];
      const subs = {};
      for (const name of ["console.log", "console.info", "console.debug", "console.warn", "console.error"]) {
        dc.subscribe(name, (subs[name] = args => { seen.push([name, [...args]]); args[0] = "[" + args[0] + "]"; }));
      }
      console.log("l", 1); console.info("i"); console.debug("d"); console.warn("w"); console.error("e");
      console.dir("not published"); console.table(["nor this"]);
      for (const name in subs) dc.unsubscribe(name, subs[name]);
      console.log("unsubscribed");
      process.stderr.write("\\n" + JSON.stringify(seen));
    `);
    expect(stdout).toBe(
      "[l] 1\n[i]\n[d]\nnot published\n" +
        "┌───┬──────────┐\n│   │ Values   │\n├───┼──────────┤\n│ 0 │ nor this │\n└───┴──────────┘\n" +
        "unsubscribed\n",
    );
    const nl = stderr.indexOf("\n[[");
    expect(stderr.slice(0, nl)).toBe("[w]\n[e]\n");
    expect(JSON.parse(stderr.slice(nl + 1))).toEqual([
      ["console.log", ["l", 1]],
      ["console.info", ["i"]],
      ["console.debug", ["d"]],
      ["console.warn", ["w"]],
      ["console.error", ["e"]],
    ]);
    expect(exitCode).toBe(0);
  });
});

// In-process (serial, it patches this process's stdout): exactly what test
// suites (oclif, ink, ...) do.
test("bun:test spyOn(process.stdout, 'write') captures console.log", () => {
  const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
  let calls: string[];
  try {
    console.log("captured %s", "yes");
    console.info({ k: "v" });
    // The runner's own stdout may be a colour TTY; the capture is what matters.
    calls = spy.mock.calls.map((c: unknown[]) => Bun.stripANSI(String(c[0])));
  } finally {
    spy.mockRestore();
  }
  expect(calls).toEqual(["captured yes\n", '{\n  k: "v",\n}\n']);
});
