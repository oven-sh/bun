import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

it("console.log %s matches util.format and Console instances (Node's rule)", async () => {
  // The three `%s` implementations (util.format, the native global console, and
  // JS `Console` instances) historically disagreed: the native console forced
  // engine ToString, while util.format ported Node's decision tree. All three
  // now route through a single `formatPercentS` in internal/util/inspect.
  using dir = tempDir("console-percent-s", {
    "run.mjs": `
      import util from "node:util";
      import { Console } from "node:console";
      import { Writable } from "node:stream";
      import fs from "node:fs";

      let captured = "";
      const jsConsole = new Console(new Writable({
        write(chunk, enc, cb) { captured += chunk; cb(); },
      }));

      const cases = [
        ["string",          "hi"],
        ["number",          3.5],
        ["-0",              -0],
        ["NaN",             NaN],
        ["Infinity",        Infinity],
        ["42n",             42n],
        ["true",            true],
        ["null",            null],
        ["undefined",       undefined],
        ["Symbol(q)",       Symbol("q")],
        ["Symbol()",        Symbol()],
        ["[1,2]",           [1, 2]],
        ["{a:1}",           { a: 1 }],
        ["arrow",           () => 1],
        ["Map",             new Map([["k", "v"]])],
        ["Set",             new Set([1, 2])],
        ["Date(0)",         new Date(0)],
        ["Buffer",          Buffer.from("ab")],
        ["URL",             new URL("http://a/b")],
        ["URLSearchParams", new URLSearchParams("a=1&b=2")],
        ["Uint8Array",      new Uint8Array([65])],
        ["Number(5)",       new Number(5)],
        ["String(x)",       new String("x")],
        ["ArrayBuffer",     new ArrayBuffer(4)],
        ["null-proto",      Object.create(null)],
        ["toString-null",   { toString: null }],
        ["[Symbol]",        [Symbol("a")]],
        ["revoked-proxy",   (() => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; })()],
        ["RegExp",          /re/g],
        ["own-toString",    { toString() { return "own"; } }],
        ["own-toPrim",      { [Symbol.toPrimitive]() { return "prim"; } }],
        ["class-toString",  new (class C { toString() { return "C!"; } })()],
        ["nested",          { a: { b: 1 } }],
      ];

      const marker = String.fromCharCode(30);
      const rows = [];
      for (const [label, v] of cases) {
        const uf = util.format("%s", v);
        captured = "";
        jsConsole.log("%s", v);
        const jc = captured.endsWith("\\n") ? captured.slice(0, -1) : captured;
        process.stdout.write(marker);
        try {
          console.log("%s", v);
        } catch (e) {
          process.stdout.write("THREW:" + e.constructor.name + "\\n");
        }
        rows.push({ label, uf, jc });
      }
      // The global console writes synchronously to this process's stdout, so
      // flush the metadata to a side file we read back in the parent.
      fs.writeFileSync("rows.json", JSON.stringify(rows));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.mjs"],
    env: { ...bunEnv, TZ: "UTC", NO_COLOR: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).toBe("");

  const rows: { label: string; uf: string; jc: string }[] = JSON.parse(
    await Bun.file(join(String(dir), "rows.json")).text(),
  );
  const gc = out
    .replaceAll("\r\n", "\n")
    .split(String.fromCharCode(30))
    .slice(1)
    .map(s => (s.endsWith("\n") ? s.slice(0, -1) : s));
  expect(gc.length).toBe(rows.length);

  // (1) all three paths must produce identical text for every value
  const actual = rows.map((r, i) => ({ label: r.label, uf: r.uf, gc: gc[i], jc: r.jc }));
  const expected = rows.map(r => ({ label: r.label, uf: r.uf, gc: r.uf, jc: r.uf }));
  expect(actual).toEqual(expected);

  // (2) and the shared value is Node's `%s` rule
  const byLabel = Object.fromEntries(rows.map(r => [r.label, r.uf]));
  expect(byLabel).toMatchObject({
    "string": "hi",
    "number": "3.5",
    "-0": "-0",
    "NaN": "NaN",
    "Infinity": "Infinity",
    "42n": "42n",
    "true": "true",
    "null": "null",
    "undefined": "undefined",
    "Symbol(q)": "Symbol(q)",
    "Symbol()": "Symbol()",
    "[1,2]": "[ 1, 2 ]",
    "{a:1}": "{ a: 1 }",
    "arrow": "() => 1",
    "Map": "Map(1) { 'k' => 'v' }",
    "Set": "Set(2) { 1, 2 }",
    "Date(0)": "1970-01-01T00:00:00.000Z",
    "Buffer": "ab",
    "URL": "http://a/b",
    "URLSearchParams": "a=1&b=2",
    "Uint8Array": "65",
    "Number(5)": "[Number: 5]",
    "String(x)": "[String: 'x']",
    "null-proto": "[Object: null prototype] {}",
    "toString-null": "{ toString: null }",
    "[Symbol]": "[ Symbol(a) ]",
    "revoked-proxy": "<Revoked Proxy>",
    "RegExp": "/re/g",
    "own-toString": "own",
    "own-toPrim": "prim",
    "class-toString": "C!",
    "nested": "{ a: [Object] }",
  });

  expect(exitCode).toBe(0);
});

it("console.log with SharedArrayBuffer", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(new ArrayBuffer(0))).toBe("ArrayBuffer(0) []");
  expect(Bun.inspect(new SharedArrayBuffer(0))).toBe("SharedArrayBuffer(0) []");
  expect(Bun.inspect(new ArrayBuffer(3))).toBe("ArrayBuffer(3) [ 0, 0, 0 ]");
  expect(Bun.inspect(new SharedArrayBuffer(3))).toBe("SharedArrayBuffer(3) [ 0, 0, 0 ]");
});
