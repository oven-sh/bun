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

describe("non-enumerable keys", () => {
  const hide = `const hide = (v, key = "hidden", value = 2) => Object.defineProperty(v, key, { value, enumerable: false });`;

  async function run(script: string, env: Record<string, string | undefined> = bunEnv) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", hide + script],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it.concurrent("`%o` and `console.dir(v, { showHidden: true })` list them as [key]", async () => {
    const result = await run(`
      class Box { shown = 1; }
      for (const make of [() => ({ shown: 1 }), () => new Box(), () => [1]]) {
        const v = hide(make());
        console.log("%o", v);
        console.dir(v, { showHidden: true });
        console.log("%O", v);
        console.log(v);
        console.dir(v);
      }`);
    const listed = (name: string) => [`${name}{`, "  shown: 1,", "  [hidden]: 2,", "}"];
    const plain = (name: string) => [`${name}{`, "  shown: 1,", "}"];
    expect(result).toEqual({
      stdout: [
        ...listed(""),
        ...listed(""),
        ...plain(""),
        ...plain(""),
        ...plain(""),
        ...listed("Box "),
        ...listed("Box "),
        ...plain("Box "),
        ...plain("Box "),
        ...plain("Box "),
        "[ 1, [hidden]: 2 ]",
        "[ 1, [hidden]: 2 ]",
        "[ 1 ]",
        "[ 1 ]",
        "[ 1 ]",
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  it.concurrent("are listed wherever the key is and whatever it holds", async () => {
    const { stdout, stderr, exitCode } = await run(`
      class Inherits { get x() { return "inherited"; } method() {} }
      const accessor = descriptor => Object.defineProperty({ shown: 1 }, "hidden", { ...descriptor, enumerable: false });
      const rows = {
        "a null-prototype object": hide(Object.assign(Object.create(null), { shown: 1 })),
        "a frozen object": Object.freeze(hide({ shown: 1 })),
        "the target of a Proxy": new Proxy(hide({ shown: 1 }), {}),
        "an object with no other key": hide({}),
        "an array of holes": hide(Array(1)),
        "the strings of a tagged template": (strings => strings)\`a\${1}b\`,
        "a nested value": { outer: hide({ shown: 1 }), list: [hide({ shown: 1 })] },
        "an entry of a Map and of a Set": [new Map([["k", hide([1])]]), new Set([hide([1])])],
        "a getter": accessor({ get: () => 1 }),
        "a setter": accessor({ set() {} }),
        "a getter and setter": accessor({ get: () => 1, set() {} }),
        "a key that is no identifier": hide({ shown: 1 }, "my key"),
        "keys of UTF-16": hide(hide({ shown: 1 }, "ключ"), "𝒽idden"),
        "a symbol key": hide({ shown: 1 }, Symbol("hidden"), 3),
        "keys in the order of their creation": Object.assign(hide(hide({ a: 1 }, "b"), "c"), { d: 4 }),
        "keys of the prototypes": Object.create(hide({ shownAbove: 1 }, "hiddenAbove")),
        "members of a class": new Inherits(),
        "an own key that shadows a member of its class": hide(new Inherits(), "x", "own"),
        "an own __esModule": hide({ a: 1 }, "__esModule", true),
        "an own __esModule beside an accessor": hide({ a: 1, get g() { return 1; } }, "__esModule", true),
        // Two limits.
        "none on the global of a node:vm context": require("node:vm").runInContext("globalThis", require("node:vm").createContext(hide({ shown: 1 }))),
        "without brackets behind a Proxy among the prototypes": Object.create(new Proxy(hide({ shown: 1 }), {})),
      };
      for (const [name, value] of Object.entries(rows)) {
        console.log("# " + name);
        console.dir(value, { showHidden: true });
        console.log("# " + name + ", by %o");
        console.log("%o", value);
      }`);
    const expected = {
      "a null-prototype object": "[Object: null prototype] { shown: 1, [hidden]: 2, }",
      "a frozen object": "{ shown: 1, [hidden]: 2, }",
      "the target of a Proxy": "{ shown: 1, [hidden]: 2, }",
      "an object with no other key": "{ [hidden]: 2, }",
      "an array of holes": "[ empty item, [hidden]: 2 ]",
      "the strings of a tagged template": `[ "a", "b", [raw]: [ "a", "b" ] ]`,
      "a nested value": "{ outer: { shown: 1, [hidden]: 2, }, list: [ { shown: 1, [hidden]: 2, } ], }",
      "an entry of a Map and of a Set": `[ Map(1) { "k": [ 1, [hidden]: 2 ], }, Set(1) { [ 1, [hidden]: 2 ], } ]`,
      "a getter": "{ shown: 1, [hidden]: [Getter], }",
      "a setter": "{ shown: 1, [hidden]: [Setter], }",
      "a getter and setter": "{ shown: 1, [hidden]: [Getter/Setter], }",
      "a key that is no identifier": `{ shown: 1, ["my key"]: 2, }`,
      "keys of UTF-16": `{ shown: 1, ["ключ"]: 2, ["𝒽idden"]: 2, }`,
      "a symbol key": "{ shown: 1, [Symbol(hidden)]: 3, }",
      "keys in the order of their creation": "{ a: 1, [b]: 2, [c]: 2, d: 4, }",
      "keys of the prototypes": "{ shownAbove: 1, [hiddenAbove]: 2, }",
      "members of a class": "Inherits { [x]: [Getter], [method]: [Function: method], }",
      "an own key that shadows a member of its class": `Inherits { [x]: "own", [method]: [Function: method], }`,
      "an own __esModule": "{ a: 1, [__esModule]: true, }",
      "an own __esModule beside an accessor": "{ a: 1, g: [Getter], [__esModule]: true, }",
      "none on the global of a node:vm context": "{ shown: 1, }",
      "without brackets behind a Proxy among the prototypes": "{ shown: 1, hidden: 2, }",
    };
    // "# <row>" is in front of what each row prints, which may take several lines.
    const [, ...parts] = stdout.split(/^# (.*)\n/m);
    const printed: Record<string, string> = {};
    for (let i = 0; i < parts.length; i += 2) printed[parts[i]] = parts[i + 1].trim().replace(/\s+/g, " ");
    expect(printed).toEqual(
      Object.fromEntries(
        Object.entries(expected).flatMap(([name, text]) => [
          [name, text],
          [`${name}, by %o`, text],
        ]),
      ),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it.concurrent("`%o` lists them in every method that takes a format string", async () => {
    const methods = ["log", "info", "debug", "warn", "error", "trace", "assert", "group", "groupCollapsed", "dirxml"];
    const { stdout, stderr, exitCode } = await run(`
      for (const method of ${JSON.stringify(methods)}) {
        const v = hide([method]);
        if (method === "assert") console.assert(false, "%o", v);
        else console[method]("%o", v);
        if (method.startsWith("group")) console.groupEnd();
      }`);
    const lines = (stdout + stderr).split("\n").map(line => line.trim());
    expect({
      methodsThatListNone: methods.filter(method => !lines.includes(`[ "${method}", [hidden]: 2 ]`)),
      exitCode,
    }).toEqual({ methodsThatListNone: [], exitCode: 0 });
  });

  it.concurrent("`%o` lists them for its own value only", async () => {
    expect(
      await run(`
        const v = hide([1]);
        console.log("%o | %O |", v, v, v);
        console.log("%O | %o", v, v);
        console.log("%o", [v]);
        console.log("%%o", v);
        console.log("%s %o", "%o", v, v);`),
    ).toEqual({
      stdout: [
        "[ 1, [hidden]: 2 ] | [ 1 ] | [ 1 ]",
        "[ 1 ] | [ 1, [hidden]: 2 ]",
        "[\n  [ 1, [hidden]: 2 ]\n]",
        "%o [ 1 ]",
        "%o [ 1, [hidden]: 2 ] [ 1 ]",
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  // Node has a format string only as the first argument, and only as a primitive string. Bun also fills the
  // directives of other values (#4826), so only the array is looked for in what each of these calls prints.
  it.concurrent.each([
    ["without colors", bunEnv],
    ["in color", { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" }],
  ])("`%%o` lists none where the first argument is no format string, %s", async (_, env) => {
    const { stdout, stderr, exitCode } = await run(
      `
      const v = hide([1]);
      console.log("a", "%o", v);
      console.log(v, "%o", v);
      console.log(1, "%o", v);
      console.log("query failed:", "... LIKE '%order%'", v);
      console.log(new String("%o"), v);
      console.log(new (class Text extends String {})("%o"), v);
      console.log(/%o/, v);
      console.log(Symbol("%o"), v);`,
      env,
    );
    const lines = Bun.stripANSI(stdout).split("\n");
    expect({
      calls: lines.length - 1,
      linesWithoutThePlainArray: lines.slice(0, -1).filter(line => !line.includes("[ 1 ]")),
      stderr,
      exitCode,
    }).toEqual({ calls: 8, linesWithoutThePlainArray: [], stderr: "", exitCode: 0 });
  });

  it.concurrent("console.dir reads `showHidden` as a boolean, for that call only", async () => {
    expect(
      await run(`
        for (const showHidden of [true, 1, "false", false, 0, undefined]) console.dir(hide([String(showHidden)]), { showHidden });
        const nested = { a: hide([1]) };
        console.dir(nested, { showHidden: true, depth: 0 });
        console.dir(nested, { showHidden: true, depth: 1 });
        console.dir(nested);`),
    ).toEqual({
      stdout: [
        `[ "true", [hidden]: 2 ]`,
        `[ "1", [hidden]: 2 ]`,
        `[ "false", [hidden]: 2 ]`,
        `[ "false" ]`,
        `[ "0" ]`,
        `[ "undefined" ]`,
        "{\n  a: [Array ...],\n}",
        "{\n  a: [ 1, [hidden]: 2 ],\n}",
        "{\n  a: [ 1 ],\n}",
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  // The function itself gets the options of a plain print: one that hands them on to `inspect` prints as before.
  it.concurrent("are listed for what a custom inspect function returns, not for what it prints", async () => {
    expect(
      await run(`
        const custom = Symbol.for("nodejs.util.inspect.custom");
        const returnsAnObject = { [custom]: () => hide([1]) };
        console.log("%o", returnsAnObject);
        console.dir(returnsAnObject, { showHidden: true });
        console.log(returnsAnObject);
        const logs = { [custom]: () => (console.log(hide([2])), "logged") };
        console.log("%o", logs);
        class Brand { #x = 1; get [Symbol.toStringTag]() { return "Brand" + this.#x; } }
        const handsOn = { [custom]: (depth, options, inspect) => "Wrapper<" + inspect(Brand, options) + ">" };
        console.log("%o", handsOn);
        console.dir(handsOn, { showHidden: true });`),
    ).toEqual({
      stdout: [
        "[ 1, [hidden]: 2 ]",
        "[ 1, [hidden]: 2 ]",
        "[ 1 ]",
        "[ 2 ]",
        "logged",
        "Wrapper<[class Brand]>",
        "Wrapper<[class Brand]>",
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  it.concurrent("are listed for the values that a Buffer prints", async () => {
    expect(
      await run(`
        const buf = Buffer.from("ab");
        buf.prop = hide({ shown: 1 });
        hide(buf, "hiddenProp", 7);
        console.log("%o", buf);
        console.dir(buf, { showHidden: true });
        console.log(buf);
        // A Buffer that one of its own values leads back to.
        const inItself = Buffer.from("a");
        hide(inItself, "self", inItself);
        console.log("%o", inItself);
        console.dir(inItself, { showHidden: true });
        const inAValue = Buffer.from("b");
        inAValue.holder = { back: inAValue };
        console.log(inAValue);
        // A getter that prints its Buffer starts a print of its own, which is no way back.
        let printed = false;
        const printsItself = Buffer.from("c");
        Object.defineProperty(printsItself, "hex", { get() { if (!printed) { printed = true; console.log(this); } return "63"; }, enumerable: true });
        console.log(printsItself);
        Object.prototype.showHidden = true;
        console.log(buf);`),
    ).toEqual({
      stdout: [
        "<Buffer 61 62, prop: { shown: 1, [hidden]: 2 }, hiddenProp: 7>",
        "<Buffer 61 62, prop: { shown: 1, [hidden]: 2 }, hiddenProp: 7>",
        "<Buffer 61 62, prop: { shown: 1 }>",
        "<Buffer 61, self: [Circular]>",
        "<Buffer 61, self: [Circular]>",
        "<Buffer 62, holder: { back: [Circular] }>",
        `<Buffer 63, hex: "63">`,
        `<Buffer 63, hex: "63">`,
        "<Buffer 61 62, prop: { shown: 1 }>",
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  it.concurrent("no getter of the program is called, and no lazy value of native code is created", async () => {
    const { stdout, stderr, exitCode } = await run(`
      let calls = 0;
      const counts = Object.defineProperty({}, "hidden", { get() { return ++calls; }, enumerable: false });
      console.log("%o", counts);
      console.dir(Object.create(counts), { showHidden: true });
      console.log(calls);
      console.dir(console, { showHidden: true, depth: 0 });
      console.dir(DataView.prototype, { showHidden: true });`);
    const lines = stdout.split("\n");
    expect(lines.slice(0, 7)).toEqual(["{", "  [hidden]: [Getter],", "}", "{", "  [hidden]: [Getter],", "}", "0"]);
    // The two are the streams of the process, which are made when they are first read.
    expect(lines.filter(line => line.startsWith("  [_std"))).toEqual([
      "  [_stdout]: [Getter],",
      "  [_stderr]: [Getter],",
    ]);
    // Each of the three is an accessor of native code that has no cell. Its key is not left out.
    expect(
      ["buffer", "byteLength", "byteOffset"].filter(name => !lines.some(line => line.startsWith(`  [${name}]: `))),
    ).toEqual([]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it.concurrent("an error thrown while one is printed is thrown on, and nothing behind it is printed", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const custom = Symbol.for("nodejs.util.inspect.custom");
      const throws = { [custom]() { throw new Error("thrown"); } };
      const before = v => Object.assign(hide(v, "h", throws), { behind: 1 });
      const rows = {
        "an object": () => console.log("%o", before({ a: 1 })),
        "a prototype": () => console.log("%o", Object.create(before({ a: 1 }))),
        "an array": () => console.log("%o", before([1])),
        "an object with an accessor": () => console.log("%o", before({ get a() { return 1; } })),
        "a nested object": () => console.log("%o", { outer: before({ a: 1 }), behind: 1 }),
        "a value of a Buffer": () => console.log("%o", Object.assign(Buffer.from("a"), { prop: before({ a: 1 }) })),
        "the showHidden option": () => console.dir({ behind: 1 }, { get showHidden() { throw new Error("thrown"); } }),
      };
      const caught = {};
      for (const [name, print] of Object.entries(rows)) {
        try { print(); caught[name] = "nothing"; } catch (e) { caught[name] = e.message; }
      }
      console.error(JSON.stringify(caught));`);
    expect(JSON.parse(stderr)).toEqual({
      "an object": "thrown",
      "a prototype": "thrown",
      "an array": "thrown",
      "an object with an accessor": "thrown",
      "a nested object": "thrown",
      "a value of a Buffer": "thrown",
      "the showHidden option": "thrown",
    });
    expect(stdout).toContain("  [h]: ");
    expect(stdout).not.toContain("behind");
    expect(exitCode).toBe(0);
  });

  it.concurrent("a chain of them that is too deep for the stack throws a RangeError", async () => {
    const { stdout, stderr, exitCode } = await run(`
      let deep = { behind: 1 };
      for (let i = 0; i < 20000; i++) deep = hide({}, "h", deep);
      try {
        console.dir(deep, { showHidden: true, depth: Infinity });
      } catch (e) {
        console.error(e.constructor.name);
      }`);
    expect(stderr).toBe("RangeError\n");
    expect(stdout).toContain("  [h]: ");
    expect(stdout).not.toContain("behind");
    expect(exitCode).toBe(0);
  });

  it.concurrent("are listed in color as they are without", async () => {
    const script = `
      console.log("%o and %O", hide([1]), hide([1]));
      console.dir(hide(hide({ shown: 1 }, "my key"), "ключ"), { showHidden: true });
      console.log("%o", hide({}));`;
    const [colored, plain] = await Promise.all([
      run(script, { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" }),
      run(script),
    ]);
    expect(colored.stdout.split("\n").slice(-4)).toEqual([
      "{",
      "  \x1b[0m\x1b[2m[\x1b[0mhidden\x1b[2m]:\x1b[0m \x1b[0m\x1b[33m2\x1b[0m\x1b[0m\x1b[2m,\x1b[0m",
      "}",
      "",
    ]);
    expect({ ...colored, stdout: Bun.stripANSI(colored.stdout) }).toEqual(plain);
    expect(plain).toEqual({
      stdout: [
        "[ 1, [hidden]: 2 ] and [ 1 ]",
        "{",
        "  shown: 1,",
        `  ["my key"]: 2,`,
        `  ["ключ"]: 2,`,
        "}",
        "{",
        "  [hidden]: 2,",
        "}",
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });
});
