import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
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

it("console.dir treats a BigInt depth like the same number", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let o = {}, c = o; for (let i = 0; i < 40; i++) { c.n = {}; c = c.n; }
       for (const depth of [7n, 7, -1n, -1]) {
         console.dir(o, { depth, colors: false });
         console.log("--");
       }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const [big7, num7, bigNegative, numNegative] = stdout.split("--\n");
  expect(big7).toBe(num7);
  expect(bigNegative).toBe(numNegative);
  expect(exitCode).toBe(0);
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

it("console.groupCollapsed starts a group, as console.group does", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `console.groupCollapsed("Collapsed");
       console.log("in collapsed");
       console.warn("warn in collapsed");
       console.groupCollapsed();
       console.log("in collapsed with no label");
       console.groupEnd();
       console.group("Group in collapsed");
       console.log("in group in collapsed");
       console.groupEnd();
       console.groupEnd();
       console.group("Group");
       console.groupCollapsed("Collapsed in group");
       console.log("in collapsed in group");
       console.error("error in collapsed in group");
       console.groupEnd();
       console.groupCollapsed(undefined);
       console.log("in collapsed with an undefined label");
       console.groupEnd();
       console.log("back in group");
       console.groupEnd();
       console.groupCollapsed("%s has %d args", "label", 3);
       console.groupEnd();
       console.groupCollapsed();
       console.groupEnd();
       console.log("after");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: stdout.replaceAll("\r\n", "\n"),
    stderr: stderr.replaceAll("\r\n", "\n"),
    exitCode,
  }).toEqual({
    stdout: [
      "Collapsed",
      "  in collapsed",
      "    in collapsed with no label",
      "  Group in collapsed",
      "    in group in collapsed",
      "Group",
      "  Collapsed in group",
      "    in collapsed in group",
      "  undefined",
      "    in collapsed with an undefined label",
      "  back in group",
      "label has 3 args",
      "after",
      "",
    ].join("\n"),
    stderr: ["  warn in collapsed", "    error in collapsed in group", ""].join("\n"),
    exitCode: 0,
  });
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
  ])("prints a Symbol, and an object that String() cannot convert (%s)", async (_, env) => {
    const { stdout, exitCode } = await run(
      `
      import util from "node:util";
      import * as namespace from "data:text/javascript,export const a = 1;";
      const revocable = Proxy.revocable({}, {});
      revocable.revoke();
      const values = [
        Symbol("id"),
        /(?<year>[0-9]{4})-(?<month>[0-9]{2})/.exec("2026-10").groups,
        util.parseArgs({ args: ["--port", "80"], options: { port: { type: "string" } } }).values,
        Object.groupBy([1, 2, 3], n => (n % 2 ? "odd" : "even")),
        Object.assign(Object.create(null), { nested: { a: 1 }, list: [2], text: "it's" }),
        JSON.parse('{"toString":1}'),
        namespace,
        revocable.proxy,
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
          `v [Object: null prototype] { nested: [Object ...], list: [Array ...], text: "it's" }`,
          "v { toString: 1 }",
          "v Module { a: 1 }",
          "v <Revoked Proxy>",
        ].join("\n") + "\n",
      exitCode: 0,
    });
  });

  it("prints an object that String() cannot convert as Bun.inspect(value, { compact: true, depth: 0 }) returns it", async () => {
    const { stdout, exitCode } = await run(`
      import util from "node:util";
      const dictionary = properties => Object.assign(Object.create(null), properties);
      const cyclic = Object.create(null);
      cyclic.self = cyclic;
      const values = [
        dictionary({ error: new RangeError("boom") }),
        dictionary({ response: new Response("body"), date: new Date(0), map: new Map([[1, { a: 1 }]]) }),
        dictionary({ [Symbol("key")]: 1, text: 'two\\nlines and "quotes"' }),
        dictionary({ [util.inspect.custom](depth, options) { return "hook " + depth + " " + options.depth + " " + options.colors; } }),
        Object.create(null, { getter: { get() { return 1; }, enumerable: true } }),
        cyclic,
      ];
      console.log(JSON.stringify(values.map(value => Bun.inspect(value, { compact: true, depth: 0 }))));
      for (const value of values) console.log("%s", value);
    `);
    const newline = stdout.indexOf("\n");
    const inspected: string[] = JSON.parse(stdout.slice(0, newline));
    expect({ printed: stdout.slice(newline + 1), exitCode }).toEqual({
      printed: inspected.map(text => text + "\n").join(""),
      exitCode: 0,
    });
    expect(inspected.slice(3)).toEqual([
      "hook 0 0 false",
      "[Object: null prototype] { getter: [Getter] }",
      "[Object: null prototype] { self: [Circular] }",
    ]);
  });

  it("prints String(value) for every value that String() converts, and runs the same code", async () => {
    const { stdout, exitCode } = await run(`
      import util from "node:util";
      const log = [];
      const counted = (name, text) => ({ toString() { log.push(name); return text; } });
      class Money { toString() { return "$12.34"; } }
      const trapped = () => new Proxy({}, {
        get(target, key) { log.push("get " + String(key)); return key === "toString" ? () => "from the trap" : undefined; },
      });
      const values = () => [
        "a string", 42, 1.5, -0, 42n, true, null, undefined, Symbol("id"), function named() {}, class Named {},
        { a: 1 }, [1, 2], [[1, 2], [3, 4]], [new URL("http://a/"), new URL("http://b/")],
        new Date(1700000000000), new Map([[1, 2]]), new Set([1]), new (class Point { x = 1 })(), process.env,
        new URL("http://example.com/a"), Buffer.from("ab"), new Uint8Array([1, 2]), new ArrayBuffer(2),
        new RangeError("boom"), new DOMException("gone", "AbortError"), [new RangeError("in an array")],
        /re/g, new Number(-0), new Boolean(false), Object(10n),
        new Money(), { [Symbol.toPrimitive]() { return "primitive"; } },
        Object.assign(Object.create(null), { valueOf: () => "from valueOf" }),
        Object.assign(Object.create(null), { [Symbol.toPrimitive]: () => "from Symbol.toPrimitive" }),
        Object.create(null, { valueOf: { get() { log.push("valueOf getter"); return () => "from a valueOf getter"; } } }),
        { get toString() { log.push("getter"); return () => "from a getter"; } },
        counted("first", "1st"), counted("second", "2nd"),
        trapped(), Object.create(trapped()), new Proxy(new Money(), {}), new Proxy(function target() {}, {}),
        { [util.inspect.custom]() { log.push("custom inspect"); return "custom"; } },
        (function () { return arguments; })(1, 2), new Set([1, 2]).values(), new Response("body"), new Event("type"),
        new ReadableStream(), Promise.resolve(1), { $$typeof: Symbol.for("react.element"), type: "div", props: {} },
      ];
      const expected = values().map(value => String(value));
      const expectedLog = log.splice(0);
      // Without the fix this line throws, so the test fails before it compares anything.
      console.log("%s", Symbol("start"));
      for (const value of values()) console.log("<%s>", value);
      // The string printer has its own text for a String object.
      console.log("<%s>", new String("text"));
      console.log(JSON.stringify({ expected, sameCode: JSON.stringify(log) === JSON.stringify(expectedLog), calls: log.length }));
    `);
    const lines = stdout.trimEnd().split("\n");
    const { expected, sameCode, calls } = JSON.parse(lines.pop()!);
    expect(lines.join("\n")).toBe(
      ["Symbol(start)", ...expected.map((text: string) => `<${text}>`), '<[String: "text"]>'].join("\n"),
    );
    expect({ sameCode, calls, exitCode }).toEqual({ sameCode: true, calls: 8, exitCode: 0 });
  });

  it("passes on what a conversion throws, and prints an accessor of an object that has none as [Getter]", async () => {
    const { stdout, exitCode } = await run(`
      let calls = 0;
      try {
        console.log("%s", { toString() { throw new Error("from toString"); } });
      } catch (e) {
        console.log("caught " + e.message);
      }
      const record = Object.create(null, {
        secret: { get() { calls++; return 1; }, enumerable: true },
        constructor: { get() { calls++; return Object; }, enumerable: false },
      });
      console.log("%s, calls: %s", record, calls);
    `);
    expect({ stdout, exitCode }).toEqual({
      stdout: "caught from toString\n[Object: null prototype] { secret: [Getter] }, calls: 0\n",
      exitCode: 0,
    });
  });

  it("prints the same text from every console method", async () => {
    const { stdout, stderr, exitCode } = await run(`
      import vm from "node:vm";
      const values = () => [Symbol("id"), /(?<year>[0-9]{4})/.exec("2026").groups];
      const format = name => "<" + name + ": %s %s>";
      for (const name of ["log", "info", "debug", "warn", "error", "trace", "dirxml", "group", "groupCollapsed"]) {
        console[name](format(name), ...values());
        if (name.startsWith("group")) console.groupEnd();
      }
      Reflect.apply(console.log, undefined, [format("Reflect.apply"), ...values()]);
      require("node:console").log(format("node:console"), ...values());
      vm.runInNewContext("console.log(format, Symbol('id'), /(?<year>[0-9]{4})/.exec('2026').groups)", { console, format: format("vm") });
      const source = "const values = " + values + "; console.log(" + JSON.stringify(format("worker")) + ", ...values()); postMessage(0);";
      const worker = new Worker(URL.createObjectURL(new Blob([source])));
      await new Promise(resolve => (worker.onmessage = resolve));
      worker.terminate();
    `);
    const printed = [...(stdout + stderr).matchAll(/<([\w:. ]+): (.*)>/g)].map(([, name, text]) => [name, text]);
    const text = 'Symbol(id) [Object: null prototype] { year: "2026" }';
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
      "Reflect.apply",
      "node:console",
      "vm",
      "worker",
    ];
    expect(printed.sort()).toEqual(names.map(name => [name, text]).sort());
    expect(exitCode).toBe(0);
  });

  it("prints on one line, one level deep, loads no module, and leaves the arguments after it alone", async () => {
    const { stdout, exitCode } = await run(`
      import { heapStats } from "bun:jsc";
      const functionExecutables = () => {
        Bun.gc(true);
        return heapStats().objectTypeCounts.FunctionExecutable ?? 0;
      };
      const record = () => Object.assign(Object.create(null), { a: { b: 1 }, c: [[1]] });
      console.log("warm %s", "up");
      functionExecutables();
      const before = functionExecutables();
      console.group("%s", Symbol("label"));
      console.log("%s then %o and", record(), { d: 1 }, "a string", { e: 1 });
      console.groupEnd();
      console.log("%s | %O", record(), { g: 1 });
      console.log("new functions: %s", functionExecutables() - before);
    `);
    expect({ stdout, exitCode }).toEqual({
      stdout:
        [
          "warm up",
          "Symbol(label)",
          "  [Object: null prototype] { a: [Object ...], c: [Array ...] } then {",
          "    d: 1,",
          "  } and a string {",
          "    e: 1,",
          "  }",
          "[Object: null prototype] { a: [Object ...], c: [Array ...] } | {",
          "  g: 1,",
          "}",
          "new functions: 0",
        ].join("\n") + "\n",
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

it("an object past the depth has one space before it on one line", () => {
  expect(Bun.inspect({ a: { b: 1 }, z: 1 }, { compact: true, depth: 0 })).toBe("{ a: [Object ...], z: 1 }");
  expect(Bun.inspect([{ b: 1 }, { c: 2 }], { compact: true, depth: 0 })).toBe("[ [Object ...], [Object ...] ]");
  expect(Bun.inspect(new Map([["k", { b: 1 }]]), { compact: true, depth: 0 })).toBe('Map(1) { "k": [Object ...] }');
});

it("an object on one line gives back the indent that it takes", () => {
  const alone = Bun.inspect({ r: new Response("") }, { compact: true });
  expect(alone).toContain("\n    ok: true,\n");
  expect(Bun.inspect({ a: { x: 1 }, b: { y: 2 }, r: new Response("") }, { compact: true })).toBe(
    alone.replace("{ r:", "{ a: { x: 1 }, b: { y: 2 }, r:"),
  );
});
