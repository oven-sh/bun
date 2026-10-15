import { file, spawn } from "bun";
import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

it("should log to console correctly", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), join(import.meta.dir, "console-log.js")],
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await exited;
  const err = (await stderr.text()).replaceAll("\r\n", "\n");
  const out = (await stdout.text()).replaceAll("\r\n", "\n");
  const expected = (await new Response(file(join(import.meta.dir, "console-log.expected.txt"))).text()).replaceAll(
    "\r\n",
    "\n",
  );

  const errMatch = err === "uh oh\n";
  const outmatch = out === expected;

  if (errMatch && outmatch && exitCode === 0) {
    expect().pass();
    return;
  }

  console.error(err);
  console.log("Length of output:", out.length);
  console.log("Length of expected:", expected.length);
  console.log("Exit code:", exitCode);

  expect(out).toBe(expected);
  expect(err).toBe("uh oh\n");
  expect(exitCode).toBe(0);
});

it("long arrays get cutoff", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(Array(1000).fill(0))).toEqual(
    "[\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  ... 900 more items\n" +
      "]",
  );
});

it("long arrays get cutoff at a nested indent", () => {
  const row = "          4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,\n";
  expect(Bun.inspect([[[[Array(1000).fill(4)]]]], { depth: 5 })).toEqual(
    "[\n  [\n    [\n      [\n        [\n" +
      row +
      row +
      row +
      row +
      "          4, 4, 4, 4,\n" +
      "          ... 900 more items\n" +
      "        ]\n      ]\n    ]\n  ]\n]",
  );
});

it("console.group", async () => {
  const filepath = join(import.meta.dir, "console-group.fixture.js").replaceAll("\\", "/");
  const proc = Bun.spawnSync({
    cmd: [bunExe(), filepath],
    env: { ...bunEnv, "BUN_JSC_showPrivateScriptsInStackTraces": "0" },
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(proc.exitCode).toBe(0);
  let stdout = proc.stdout
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\\", "/")
    .trim()
    .replaceAll(filepath, "<file>");
  let stderr = proc.stderr
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\\", "/")
    .trim()
    .replaceAll(filepath, "<file>")
    // Normalize line numbers for consistency between debug and release builds
    .replace(/\(\d+:\d+\)/g, "(N:NN)")
    .replace(/<file>:\d+:\d+/g, "<file>:NN:NN");
  expect(stdout).toMatchInlineSnapshot(`
"Basic group
  Inside basic group
Outer group
  Inside outer group
  Inner group
    Inside inner group
  Back to outer group
Level 1
  Level 2
    Level 3
      Deep inside
undefined
Empty nested
Test extra end
  Inside
Different logs
  Regular log
  Info log
  Debug log
Complex types
  {
    a: 1,
    b: 2,
  }
  [ 1, 2, 3 ]
null
  undefined
    0
      false
        
          Inside falsy groups
🎉 Unicode!
  Inside unicode group
  Tab\tNewline
Quote"Backslash
    Special chars"
`);
  expect(stderr).toMatchInlineSnapshot(`
"Warning log
  warn: console.warn an error
      at <file>:NN:NN

  52 | console.group("Different logs");
53 | console.log("Regular log");
54 | console.info("Info log");
55 | console.warn("Warning log");
56 | console.warn(new Error("console.warn an error"));
57 | console.error(new Error("console.error an error"));
                       ^
error: console.error an error
      at <file>:NN:NN

  53 | console.log("Regular log");
54 | console.info("Info log");
55 | console.warn("Warning log");
56 | console.warn(new Error("console.warn an error"));
57 | console.error(new Error("console.error an error"));
58 | console.error(new NamedError("console.error a named error"));
                   ^
NamedError: console.error a named error
      at <file>:NN:NN

  NamedError: console.warn a named error
      at <file>:NN:NN

  Error log"
`);
});

it("console.log with SharedArrayBuffer", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(new ArrayBuffer(0))).toBe("ArrayBuffer(0) []");
  expect(Bun.inspect(new SharedArrayBuffer(0))).toBe("SharedArrayBuffer(0) []");
  expect(Bun.inspect(new ArrayBuffer(3))).toBe("ArrayBuffer(3) [ 0, 0, 0 ]");
  expect(Bun.inspect(new SharedArrayBuffer(3))).toBe("SharedArrayBuffer(3) [ 0, 0, 0 ]");
});

describe.concurrent("console %s", () => {
  async function run(script: string, env: NodeJS.Dict<string> = bunEnv) {
    await using proc = spawn({ cmd: [bunExe(), "-e", script], env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it.each([
    ["NO_COLOR", bunEnv],
    ["FORCE_COLOR", { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" }],
  ])("prints a Symbol, -0, a BigInt and an object with no string conversion of its own (%s)", async (_, env) => {
    const { stdout, exitCode } = await run(
      `
      import util from "node:util";
      const revocable = Proxy.revocable({}, {});
      revocable.revoke();
      const values = [
        Symbol("id"),
        /(?<year>[0-9]{4})-(?<month>[0-9]{2})/.exec("2026-10").groups,
        util.parseArgs({ args: ["--port", "80"], options: { port: { type: "string" } } }).values,
        Object.groupBy([1, 2, 3], n => (n % 2 ? "odd" : "even")),
        [Symbol("in array")],
        JSON.parse('{"toString":1}'),
        revocable.proxy,
        { a: 1, nested: { b: 2 }, list: [3], text: "it's" },
        [1, "two"],
        new Proxy([1], {}),
        new (class Point { x = 1 })(),
        [new RangeError("boom"), new TypeError("bad")],
        -0,
        42n,
        new Date(1700000000000),
        new Map([["key", { a: 1 }]]),
        new Set(["a"]),
        Promise.resolve(1),
        new ArrayBuffer(2),
      ];
      for (const value of values) console.log("v %s", value);
    `,
      env,
    );
    expect({ stdout, exitCode }).toEqual({
      stdout:
        [
          "v Symbol(id)",
          'v [Object: null prototype] { year: "2026", month: "10" }',
          'v [Object: null prototype] { port: "80" }',
          "v [Object: null prototype] { odd: [Array ...], even: [Array ...] }",
          "v [ Symbol(in array) ]",
          "v { toString: 1 }",
          "v <Revoked Proxy>",
          `v { a: 1, nested: [Object ...], list: [Array ...], text: "it's" }`,
          'v [ 1, "two" ]',
          "v [ 1 ]",
          "v Point { x: 1 }",
          "v [ [RangeError: boom], [TypeError: bad] ]",
          "v -0",
          "v 42n",
          "v 2023-11-14T22:13:20.000Z",
          'v Map(1) { "key": [Object ...] }',
          'v Set(1) { "a" }',
          "v Promise { <resolved> }",
          "v ArrayBuffer(2) [ 0, 0 ]",
        ].join("\n") + "\n",
      exitCode: 0,
    });
  });

  it("keeps String(value) for a value with a conversion of its own, and runs it once", async () => {
    const { stdout, exitCode } = await run(`
      import util from "node:util";
      class Money { toString() { return "$12.34"; } }
      const order = [];
      const counted = name => ({ toString() { order.push(name); return name; } });
      console.log("%s|%s|%s|%s|%s|%s|%s", "a string", 42, 1.5, true, null, undefined, function named() {});
      console.log("%s|%s|%s", new URL("http://example.com/a"), Buffer.from("ab"), new Uint8Array([1, 2]));
      console.log("%s|%s|%s", new Money(), new Proxy(new Money(), {}), { [Symbol.toPrimitive]() { return "primitive"; } });
      console.log("%s|%s", new RangeError("boom"), new DOMException("gone", "AbortError"));
      console.log("%s %s", counted("first"), counted("second"));
      console.log(order.join(","));
      try {
        console.log("%s", { toString() { throw new Error("from toString"); } });
      } catch (e) {
        console.log("caught " + e.message);
      }
      // The first line of this test fails without the fix. The lines above print the same text.
      console.log("%s", Symbol("the next call works"));
    `);
    expect({ stdout, exitCode }).toEqual({
      stdout:
        [
          "a string|42|1.5|true|null|undefined|function named() {}",
          "http://example.com/a|ab|1,2",
          "$12.34|$12.34|primitive",
          "RangeError: boom|AbortError: gone",
          "first second",
          "first,second",
          "caught from toString",
          "Symbol(the next call works)",
        ].join("\n") + "\n",
      exitCode: 0,
    });
  });

  it("keeps String(value) for an object that the formatter would run or use up to print", async () => {
    const { stdout, exitCode } = await run(`
      import util from "node:util";
      let calls = 0;
      const hooked = () => ({ [util.inspect.custom]() { calls++; return "hook"; } });
      class EndlessMap extends Map {
        *[Symbol.iterator]() { for (;;) { calls++; yield [1, 2]; } }
      }
      const iterator = new Set([1, 2]).values();
      const args = (function () { return arguments; })(1, 2);
      console.log("%s|%s|%s", hooked(), new Proxy(hooked(), {}), new ReadableStream());
      console.log("%s|%s|%s|%s", new EndlessMap(), iterator, args, new Response("body"));
      console.log("%s|%s", new Event("type"), { $$typeof: Symbol.for("react.element"), type: "div", props: {} });
      // Inside a value that is inspected, a custom inspect function is not called.
      console.log("%s|%s", [hooked(), new Proxy(hooked(), {})], new Map([[1, new Proxy(hooked(), {})]]));
      console.log("calls: %s, left in the iterator: %s", calls, [...iterator].length);
    `);
    expect({ stdout, exitCode }).toEqual({
      stdout:
        [
          "[object Object]|[object Object]|[object ReadableStream]",
          "[object Map]|[object Set Iterator]|[object Arguments]|[object Response]",
          "[object Event]|[object Object]",
          "[ [Object ...], [Object ...] ]|Map(1) { 1: [Object ...] }",
          "calls: 0, left in the iterator: 2",
        ].join("\n") + "\n",
      exitCode: 0,
    });
  });

  it("reads a wrapper object, a RegExp and a Proxy target without running code", async () => {
    const { stdout, exitCode } = await run(`
      const calls = [];
      const spy = (owner, key) => {
        const original = owner[key];
        owner[key] = function (...args) {
          calls.push(String(key));
          return Reflect.apply(original, this, args);
        };
      };
      spy(Array.prototype, "join");
      spy(Array.prototype, "toString");
      spy(Object.prototype, "toString");
      spy(String.prototype, "toString");
      spy(Number.prototype, "toString");
      spy(Boolean.prototype, "toString");
      spy(RegExp.prototype, "toString");
      const trap = name => () => { calls.push("trap " + name); throw new Error("trap " + name); };
      const traps = Object.fromEntries(Reflect.ownKeys(Reflect).map(name => [name, trap(name)]));
      const withoutPrototype = value => Object.setPrototypeOf(value, null);
      const accessors = Object.create(null, {
        constructor: { get() { calls.push("constructor"); return Object; }, enumerable: false },
      });
      console.log("%s|%s|%s|%s|%s", [1, 2], { a: 1 }, new Proxy({ b: 2 }, traps), accessors, Object(Symbol("wrapped")));
      console.log("%s|%s|%s|%s|%s", new String("text"), new Number(-0), new Boolean(false), Object(10n), /re/g);
      console.log("%s|%s|%s|%s", ...[new String("text"), new Number(1), new Boolean(true), /re/g].map(withoutPrototype));
      let deep = { c: 3 };
      for (let i = 0; i < 100_000; i++) deep = new Proxy(deep, traps);
      console.log("%s|%s", deep, [deep]);
      console.log("calls: %s", calls.length);
    `);
    expect({ stdout, exitCode }).toEqual({
      stdout:
        [
          "[ 1, 2 ]|{ a: 1 }|{ b: 2 }|[Object: null prototype] {}|Symbol(wrapped)",
          '[String: "text"]|-0|false|10n|/re/g',
          '[String: "text"]|1|true|/re/g',
          "{ c: 3 }|[ [Object ...] ]",
          "calls: 0",
        ].join("\n") + "\n",
      exitCode: 0,
    });
  });

  it("prints the same text from every console method", async () => {
    const { stdout, stderr, exitCode } = await run(`
      import vm from "node:vm";
      const values = () => [Symbol("id"), /(?<year>[0-9]{4})/.exec("2026").groups, [Symbol("a")], { a: 1 }, -0, 42n];
      const format = name => "<" + name + ": %s %s %s %s %s %s>";
      for (const name of ["log", "info", "debug", "warn", "error", "trace", "dirxml", "group", "groupCollapsed"]) {
        console[name](format(name), ...values());
        if (name.startsWith("group")) console.groupEnd();
      }
      console.table("<table: %s>", [Symbol("a")]);
      console.log(0, format("second argument"), ...values());
      Reflect.apply(console.log, undefined, [format("Reflect.apply"), ...values()]);
      require("node:console").log(format("node:console"), ...values());
      vm.runInNewContext("console.log(format, ...values)", { console, format: format("vm"), values: values() });
      const source = "const values = " + values + "; console.log(" + JSON.stringify(format("worker")) + ", ...values()); postMessage(0);";
      const worker = new Worker(URL.createObjectURL(new Blob([source])));
      await new Promise(resolve => (worker.onmessage = resolve));
      worker.terminate();
    `);
    const printed = [...(stdout + stderr).matchAll(/<([\w:. ]+): (.*)>/g)].map(([, name, text]) => [name, text]);
    const text = 'Symbol(id) [Object: null prototype] { year: "2026" } [ Symbol(a) ] { a: 1 } -0 42n';
    const names = [
      "log",
      "info",
      "debug",
      "warn",
      "error",
      "trace",
      "dirxml",
      "group",
      "groupCollapsed",
      "second argument",
      "Reflect.apply",
      "node:console",
      "vm",
      "worker",
    ];
    expect(printed.sort()).toEqual([...names.map(name => [name, text]), ["table", "[ Symbol(a) ]"]].sort());
    expect(exitCode).toBe(0);
  });

  it("inspects on one line, one level deep, and leaves the arguments after it alone", async () => {
    const { stdout, exitCode } = await run(`
      console.group("%s", Symbol("label"));
      console.log("%s then %o and", { a: { b: 1 }, c: [[1]] }, { d: 1 }, "a string", { e: 1 });
      console.log("%s", Array.from({ length: 102 }, (_, i) => i % 10));
      console.groupEnd();
      console.log("%s | %O", new Map([["key", { f: 1 }]]), { g: 1 });
    `);
    expect({ stdout, exitCode }).toEqual({
      stdout:
        [
          "Symbol(label)",
          "  { a: [Object ...], c: [Array ...] } then {",
          "    d: 1,",
          "  } and a string {",
          "    e: 1,",
          "  }",
          "  [ " + Array.from({ length: 100 }, (_, i) => i % 10).join(", ") + ", ... 2 more items ]",
          'Map(1) { "key": [Object ...] } | {',
          "  g: 1,",
          "}",
        ].join("\n") + "\n",
      exitCode: 0,
    });
  });

  it("loads no module, and console.error keeps its color after the value", async () => {
    const { stdout, stderr, exitCode } = await run(
      `
      import { heapStats } from "bun:jsc";
      const functionExecutables = () => {
        Bun.gc(true);
        return heapStats().objectTypeCounts.FunctionExecutable ?? 0;
      };
      console.log("warm %s", "up");
      functionExecutables();
      const before = functionExecutables();
      console.log("%s %s %s", { a: 1 }, [Symbol("s")], new Map([[1, 2]]));
      console.log("new functions: %s", functionExecutables() - before);
      console.error("before %s after", /re/g);
    `,
      { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
    );
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "warm up\n{ a: 1 } [ Symbol(s) ] Map(1) { 1: 2 }\nnew functions: 0\n",
      stderr: "\x1b[0m\x1b[31mbefore /re/g after\x1b[0m\n",
      exitCode: 0,
    });
  });

  it("prints the params of a Bun.serve route", async () => {
    const { stdout, exitCode } = await run(`
      await using server = Bun.serve({
        port: 0,
        routes: {
          "/users/:id": req => {
            console.log("params %s", req.params);
            return new Response("ok");
          },
        },
      });
      console.log(await (await fetch(new URL("/users/7", server.url))).text());
    `);
    expect({ stdout, exitCode }).toEqual({ stdout: 'params RequestParams { id: "7" }\nok\n', exitCode: 0 });
  });
});

// The printer of an error's properties turns custom inspect functions off.
it("does not call a custom inspect function for the property of an error", () => {
  const custom = jest.fn(() => "custom");
  const hooked = { [Symbol.for("nodejs.util.inspect.custom")]: custom };
  const searchParams = new URLSearchParams("a=1");
  searchParams.toJSON = () => hooked;
  const error = Object.assign(new Error("boom"), { hooked, proxy: new Proxy(hooked, {}), searchParams });
  Bun.inspect(error);
  expect(custom).not.toHaveBeenCalled();
});
