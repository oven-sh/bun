import { describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("error.cause", () => {
  const err = new Error("error 1");
  const err2 = new Error("error 2", { cause: err });
  expect(
    Bun.inspect(err2)
      .replaceAll("\\", "/")
      .replaceAll(import.meta.dir.replaceAll("\\", "/"), "[dir]"),
  ).toMatchInlineSnapshot(`
"1 | import { describe, expect, jest, test } from "bun:test";
2 | import { bunEnv, bunExe, tempDir } from "harness";
3 | 
4 | test("error.cause", () => {
5 |   const err = new Error("error 1");
6 |   const err2 = new Error("error 2", { cause: err });
                       ^
error: error 2
      at <anonymous> ([dir]/inspect-error.test.js:6:20)

1 | import { describe, expect, jest, test } from "bun:test";
2 | import { bunEnv, bunExe, tempDir } from "harness";
3 | 
4 | test("error.cause", () => {
5 |   const err = new Error("error 1");
                      ^
error: error 1
      at <anonymous> ([dir]/inspect-error.test.js:5:19)
"
`);
});

test("Error", () => {
  const err = new Error("my message");
  expect(
    Bun.inspect(err)
      .replaceAll("\\", "/")
      .replaceAll(import.meta.dir.replaceAll("\\", "/"), "[dir]"),
  ).toMatchInlineSnapshot(`
"30 | "
31 | \`);
32 | });
33 | 
34 | test("Error", () => {
35 |   const err = new Error("my message");
                       ^
error: my message
      at <anonymous> ([dir]/inspect-error.test.js:35:19)
"
`);
});

test("BuildMessage", async () => {
  try {
    await import("./inspect-error-fixture-bad.js");
    expect.unreachable();
  } catch (e) {
    expect(
      Bun.inspect(e)
        .replaceAll("\\", "/")
        .replaceAll(import.meta.dir.replaceAll("\\", "/"), "[dir]"),
    ).toMatchInlineSnapshot(`
"2 | const duplicateConstDecl = 456;
          ^
error: "duplicateConstDecl" has already been declared
    at [dir]/inspect-error-fixture-bad.js:2:7

1 | const duplicateConstDecl = 123;
          ^
note: "duplicateConstDecl" was originally declared here
   at [dir]/inspect-error-fixture-bad.js:1:7"
`);
  }
});

const normalizeError = str =>
  // remove debug-only stack trace frames of bun's own builtins, which have a
  // position but no file, like "at require (51:24)"
  str
    .split("\n")
    .filter(line => !/^\s*at \S+ \(:?\d+:\d+\)$/.test(line))
    .join("\n");

test("Error inside minified file (no color) ", () => {
  try {
    require("./inspect-error-fixture.min.js");
    expect.unreachable();
  } catch (e) {
    expect(
      normalizeError(
        Bun.inspect(e, { colors: false })
          .replaceAll("\\", "/")
          .replaceAll(import.meta.dir.replaceAll("\\", "/"), "[dir]")
          .trim(),
      ),
    ).toMatchInlineSnapshot(`
      "21 | exports.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=Z;
      22 | exports.cache=function(a){return function(){var b=U.current;if(!b)return a.apply(null,arguments);var c=b.getCacheForType(V);b=c.get(a);void 0===b&&(b=W(),c.set(a,b));c=0;for(var f=arguments.length;c<f;c++){var d=arguments[c];if("function"===typeof d||"object"===typeof d&&null!==d){var e=b.o;null===e&&(b.o=e=new WeakMap);b=e.get(d);void 0===b&&(b=W(),e.set(d,b))}else e=b.p,null===e&&(b.p=e=new Map),b=e.get(d),void 0===b&&(b=W(),e.set(d,b))}if(1===b.s)return b.v;if(2===b.s)throw b.v;try{var g=a.apply(null,
      23 | arguments);c=b;c.s=1;return c.v=g}catch(h){throw g=b,g.s=2,g.v=h,h;}}};
      24 | exports.cloneElement=function(a,b,c){if(null===a||void 0===a)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+a+".");var f=C({},a.props),d=a.key,e=a.ref,g=a._owner;if(null!=b){void 0!==b.ref&&(e=b.ref,g=K.current);void 0!==b.key&&(d=""+b.key);if(a.type&&a.type.defaultProps)var h=a.type.defaultProps;for(k in b)J.call(b,k)&&!L.hasOwnProperty(k)&&(f[k]=void 0===b[k]&&void 0!==h?h[k]:b[k])}var k=arguments.length-2;if(1===k)f.children=c;else if(1<k){h=Array(k);
      25 | for(var m=0;m<k;m++)h[m]=arguments[m+2];f.children=h}return{$$typeof:l,type:a.type,key:d,ref:e,props:f,_owner:g}};exports.createContext=function(a){a={$$typeof:u,_currentValue:a,_currentValue2:a,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null};a.Provider={$$typeof:t,_context:a};return a.Consumer=a};exports.createElement=M;exports.createFactory=function(a){var b=M.bind(null,a);b.type=a;return b};exports.createRef=function(){return{current:null}};
      26 | exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};expo

      error: error inside long minified file!
            at <anonymous> ([dir]/inspect-error-fixture.min.js:26:2850)
            at <anonymous> ([dir]/inspect-error-fixture.min.js:26:2890)
            at <anonymous> ([dir]/inspect-error.test.js:87:5)"
    `);
  }
});

test("Error inside minified file (color) ", () => {
  try {
    require("./inspect-error-fixture.min.js");
    expect.unreachable();
  } catch (e) {
    expect(
      // TODO: remove this workaround once snapshots work better
      normalizeError(
        Bun.stripANSI(Bun.inspect(e, { colors: true }))
          .replaceAll("\\", "/")
          .replaceAll(import.meta.dir.replaceAll("\\", "/"), "[dir]")
          .trim(),
      ),
    ).toMatchInlineSnapshot(`
      "21 | exports.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=Z;
      22 | exports.cache=function(a){return function(){var b=U.current;if(!b)return a.apply(null,arguments);var c=b.getCacheForType(V);b=c.get(a);void 0===b&&(b=W(),c.set(a,b));c=0;for(var f=arguments.length;c<f;c++){var d=arguments[c];if("function"===typeof d||"object"===typeof d&&null!==d){var e=b.o;null===e&&(b.o=e=new WeakMap);b=e.get(d);void 0===b&&(b=W(),e.set(d,b))}else e=b.p,null===e&&(b.p=e=new Map),b=e.get(d),void 0===b&&(b=W(),e.set(d,b))}if(1===b.s)return b.v;if(2===b.s)throw b.v;try{var g=a.apply(null,
      23 | arguments);c=b;c.s=1;return c.v=g}catch(h){throw g=b,g.s=2,g.v=h,h;}}};
      24 | exports.cloneElement=function(a,b,c){if(null===a||void 0===a)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+a+".");var f=C({},a.props),d=a.key,e=a.ref,g=a._owner;if(null!=b){void 0!==b.ref&&(e=b.ref,g=K.current);void 0!==b.key&&(d=""+b.key);if(a.type&&a.type.defaultProps)var h=a.type.defaultProps;for(k in b)J.call(b,k)&&!L.hasOwnProperty(k)&&(f[k]=void 0===b[k]&&void 0!==h?h[k]:b[k])}var k=arguments.length-2;if(1===k)f.children=c;else if(1<k){h=Array(k);
      25 | for(var m=0;m<k;m++)h[m]=arguments[m+2];f.children=h}return{$$typeof:l,type:a.type,key:d,ref:e,props:f,_owner:g}};exports.createContext=function(a){a={$$typeof:u,_currentValue:a,_currentValue2:a,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null};a.Provider={$$typeof:t,_context:a};return a.Consumer=a};exports.createElement=M;exports.createFactory=function(a){var b=M.bind(null,a);b.type=a;return b};exports.createRef=function(){return{current:null}};
      26 | exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};exports.forwardRef=function(a){return{$$typeof:v,render:a}};expo | ... truncated 

      error: error inside long minified file!
            at <anonymous> ([dir]/inspect-error-fixture.min.js:26:2850)
            at <anonymous> ([dir]/inspect-error-fixture.min.js:26:2890)
            at <anonymous> ([dir]/inspect-error.test.js:115:5)"
    `);
  }
});

test("Inserted originalLine and originalColumn do not appear in node:util.inspect", () => {
  const err = new Error("my message");
  expect(
    require("util")
      .inspect(err)
      .replaceAll("\\", "/")
      .replaceAll(import.meta.path.replaceAll("\\", "/"), "[file]"),
  ).toMatchInlineSnapshot(`
"Error: my message
    at <anonymous> ([file]:143:19)"
`);
});

describe("observable properties", () => {
  for (let property of ["sourceURL", "line", "column"]) {
    test(`${property} is observable`, () => {
      const mock = jest.fn();
      const err = new Error("my message");
      Object.defineProperty(err, property, {
        get: mock,
        enumerable: true,
        configurable: true,
      });
      expect(mock).not.toHaveBeenCalled();
      Bun.inspect(err);
      expect(mock).not.toHaveBeenCalled();
    });
  }
});

describe("error.code is a String object that has no primitive value", () => {
  const codes = {
    "toString throws": `Object.assign(new String("E_X"), { toString() { throw new Error("toString threw"); } })`,
    "no prototype": `Object.setPrototypeOf(new String("E_X"), null)`,
    "Symbol.toPrimitive returns an object": `Object.assign(new String("E_X"), { [Symbol.toPrimitive]() { return {}; } })`,
  };

  async function run(source) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  describe.each(Object.entries(codes))("%s", (_, code) => {
    // The own-property printer converts a String object with `toString`, so
    // both calls can throw that error to the caller.
    test.concurrent("Bun.inspect and console.error return to the caller", async () => {
      const { stdout, stderr, exitCode, signalCode } = await run(`
        const e = new Error("boom");
        e.code = ${code};
        try { Bun.inspect(e); } catch {}
        try { console.error(e); } catch {}
        console.log("survived");
      `);
      expect(stderr).toContain("error: boom");
      expect({ stdout, exitCode, signalCode }).toEqual({ stdout: "survived\n", exitCode: 0, signalCode: null });
    });

    test.concurrent.each([
      ["an uncaught throw", "throw e;"],
      ["an unhandled rejection", "Promise.reject(e);"],
    ])("%s prints the error", async (_, raise) => {
      const { stdout, stderr, exitCode, signalCode } = await run(`
        const e = new Error("boom");
        e.code = ${code};
        ${raise}
      `);
      expect(stderr).toContain("error: boom");
      expect({ stdout, exitCode, signalCode }).toEqual({ stdout: "", exitCode: 1, signalCode: null });
    });
  });

  test("a String object that has a primitive value is printed", () => {
    const e = new Error("boom");
    e.code = new String("E_X");
    expect(Bun.inspect(e)).toContain(`code: "E_X"`);
  });
});

test("error.stack throwing an error doesn't lead to a crash", () => {
  const err = new Error("my message");
  Object.defineProperty(err, "stack", {
    get: () => {
      throw new Error("my message");
    },
    enumerable: true,
    configurable: true,
  });
  expect(() => {
    throw err;
  }).toThrow();
});

test("an uncaught error whose message getter throws exits with code 1", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `class E extends Error { get message() { throw new RangeError("from the getter"); } }
      setTimeout(() => { setImmediate(() => console.log("immediate")); throw new E(); }, 0);
      console.log("after");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("throw new E()");
  expect(stdout).toBe("after\nimmediate\n");
  expect(exitCode).toBe(1);
});

describe("source map remapping of the printed stack", () => {
  // The "at ..." lines that mention one of `files`, with the temp dir removed
  // from the paths.
  function frames(text, dir, files) {
    const prefix = dir.replaceAll("\\", "/") + "/";
    return text
      .replaceAll("\\", "/")
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("at ") && files.some(file => line.includes(file)))
      .map(line => line.replaceAll(prefix, ""));
  }

  async function run(files) {
    using dir = tempDir("inspect-error-sourcemap", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The JSON is the last line of stdout.
    return { dir: String(dir), out: JSON.parse(stdout.trimEnd().split("\n").at(-1)), stdout, stderr, exitCode };
  }

  // A prebuilt file whose map names a source that is neither on disk nor in
  // `sourcesContent` (the shape of a deployed `bun build --target=bun
  // --sourcemap` artifact with the sources stripped). The original source can't
  // be shown, but the frames still have to be remapped, exactly like
  // error.stack is.
  test.concurrent("external map whose original source is unavailable", async () => {
    const main = [
      "// @bun",
      'function thrower() { throw new Error("HOSTILE"); }',
      "const out = {};",
      "try { thrower(); } catch (e) { out.inspect = Bun.inspect(e); }",
      "try { thrower(); } catch (e) { out.stack = e.stack; }",
      "console.log(JSON.stringify(out));",
      "thrower();",
    ];
    // One segment at column 0 of each generated line below, so every position on
    // a line maps to the same original position: line 1 -> orig.ts:11:5, line 3
    // -> 21:5, line 4 -> 31:5, line 6 -> 41:5. (Column 5 rather than 1 because
    // error.stack prints no column at all for column 1.)
    const map = {
      version: 3,
      sources: ["orig.ts"],
      sourcesContent: [null],
      names: [],
      mappings: ";AAUI;;AAUA;AAUA;;AAUA",
    };
    const { dir, out, stderr, exitCode } = await run({
      "main.js": main.join("\n") + "\n//# sourceMappingURL=main.js.map\n",
      "main.js.map": JSON.stringify(map),
    });

    const files = ["orig.ts", "main.js"];
    expect({
      stack: frames(out.stack, dir, files),
      inspect: frames(out.inspect, dir, files),
      uncaught: frames(stderr, dir, files),
    }).toEqual({
      stack: ["at thrower (orig.ts:11:5)", "at orig.ts:31:5"],
      inspect: ["at thrower (orig.ts:11:5)", "at orig.ts:21:5"],
      uncaught: ["at thrower (orig.ts:11:5)", "at orig.ts:41:5"],
    });
    expect(exitCode).toBe(1);
  });

  // Modules bun transpiled itself. `present.ts` stays on disk; `deleted.ts` is
  // removed after it was loaded, so the code frame can no longer be read back.
  // Reading error.stack first makes the printer start from the already
  // remapped frames of that string instead of the raw JSC frames; those must
  // not be remapped a second time (https://github.com/oven-sh/bun/issues/15859).
  test.concurrent("transpiled modules: source deleted, and frames already remapped by error.stack", async () => {
    const module = message =>
      [
        "type Padding1 = { a: number };",
        "type Padding2 = { b: string };",
        "type Padding3 = { c: boolean };",
        "export function thrower(): never {",
        `  throw new Error(${JSON.stringify(message)});`,
        "}",
        "export function caller(onError: (e: Error) => string): string {",
        "  try {",
        "    thrower();",
        "  } catch (e) {",
        "    return onError(e as Error);",
        "  }",
        "  return 'unreachable';",
        "}",
        "",
      ].join("\n");
    const { dir, out, stderr, exitCode } = await run({
      "present.ts": module("present"),
      "deleted.ts": module("deleted"),
      "main.js": [
        'import { unlinkSync } from "node:fs";',
        'import { join } from "node:path";',
        'import * as present from "./present.ts";',
        'import * as deleted from "./deleted.ts";',
        'unlinkSync(join(import.meta.dir, "deleted.ts"));',
        "const out = {",
        "  presentStack: present.caller(e => e.stack),",
        "  presentInspect: present.caller(e => Bun.inspect(e)),",
        "  presentStackThenInspect: present.caller(e => (e.stack, Bun.inspect(e))),",
        "  deletedStack: deleted.caller(e => e.stack),",
        "  deletedInspect: deleted.caller(e => Bun.inspect(e)),",
        "  deletedStackThenInspect: deleted.caller(e => (e.stack, Bun.inspect(e))),",
        "};",
        "console.log(JSON.stringify(out));",
        "present.caller(e => { e.stack; throw e; });",
        "",
      ].join("\n"),
    });

    const files = ["present.ts", "deleted.ts"];
    const positions = text => frames(text, dir, files);
    // The throw is on line 5 and the call to thrower() on line 9 of the
    // original module; after type stripping they are on lines 2 and 6.
    const expected = file => [
      expect.stringMatching(new RegExp(`^at thrower \\(${file}:5:\\d+\\)$`)),
      expect.stringMatching(new RegExp(`^at caller \\(${file}:9:\\d+\\)$`)),
    ];
    expect(positions(out.presentStack)).toEqual(expected("present.ts"));
    expect(positions(out.deletedStack)).toEqual(expected("deleted.ts"));

    expect({
      presentInspect: positions(out.presentInspect),
      presentStackThenInspect: positions(out.presentStackThenInspect),
      deletedInspect: positions(out.deletedInspect),
      deletedStackThenInspect: positions(out.deletedStackThenInspect),
      uncaughtAfterStack: positions(stderr),
    }).toEqual({
      presentInspect: positions(out.presentStack),
      presentStackThenInspect: positions(out.presentStack),
      deletedInspect: positions(out.deletedStack),
      deletedStackThenInspect: positions(out.deletedStack),
      uncaughtAfterStack: positions(out.presentStack),
    });
    expect(exitCode).toBe(1);
  });

  // A file loaded through a blob: URL keeps the relative path it was opened
  // with as its source URL. Loading it again replaces its source map, and the
  // printer runs the `cause` getter between remapping the frames and printing
  // them.
  test.concurrent("a `cause` getter that loads the throwing file again", async () => {
    const map = {
      version: 3,
      sources: ["orig.ts"],
      sourcesContent: [
        'function thrower() { throw new Error("RELOADED"); }\nexport function caller() { thrower(); }\n',
      ],
      names: [],
      // Line 2 -> orig.ts:1:5, line 3 -> orig.ts:2:5.
      mappings: ";;AAAI;AACA",
    };
    const { dir, out, stdout, stderr, exitCode } = await run({
      "rel.js": [
        "// @bun @bun-cjs",
        "(function(exports, require, module, __filename, __dirname) {",
        'function thrower() { throw new Error("RELOADED"); }',
        "module.exports = function caller() { thrower(); };",
        "})",
        "//# sourceMappingURL=data:application/json;base64," + Buffer.from(JSON.stringify(map)).toString("base64"),
      ].join("\n"),
      "main.js": [
        'const load = () => require(URL.createObjectURL(Bun.file("rel.js")));',
        "let reloads = 0;",
        "function thrown() {",
        "  let error;",
        "  try { load()(); } catch (e) { error = e; }",
        '  Object.defineProperty(error, "cause", { get() { reloads++; load(); } });',
        "  return error;",
        "}",
        "const out = { inspect: Bun.inspect(thrown()), stack: thrown().stack };",
        'process.on("exit", () => console.log(JSON.stringify({ ...out, reloads })));',
        "console.log(thrown());",
        "console.error(thrown());",
        "throw thrown();",
      ].join("\n"),
    });

    const files = ["orig.ts", "rel.js"];
    const expected = ["at thrower (orig.ts:1:5)", "at caller (orig.ts:2:5)"];
    expect({
      reloads: out.reloads,
      inspect: frames(out.inspect, dir, files),
      consoleLog: frames(stdout, dir, files),
      consoleErrorThenUncaught: frames(stderr, dir, files),
      stack: frames(out.stack, dir, files),
    }).toEqual({
      // Bun.inspect, console.log, console.error and the uncaught error. Reading `stack` does not read `cause`.
      reloads: 4,
      inspect: expected,
      consoleLog: expected,
      consoleErrorThenUncaught: [...expected, ...expected],
      stack: expected,
    });
    expect(exitCode).toBe(1);
  });
});

// The printer walks the `errors` property of an AggregateError after it prints
// the AggregateError. When there is nothing to walk, the AggregateError is all
// that prints. A deleted `errors` used to crash the process (the empty value
// was passed to the iteration, which read it as a cell at address 0), an
// accessor was passed to it as well, the other shapes printed nothing, and a
// non-iterable `errors` made console.error throw.
describe.concurrent("AggregateError whose errors cannot be walked", () => {
  async function run(cmd, files) {
    using dir = tempDir("inspect-aggregate-error", files ?? {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const header = "AggregateError: outer message";
  // The line that names each printed error, with its indentation.
  const names = text => text.split("\n").filter(line => /^ *\w*[Ee]rror: /.test(line));
  const make = 'const e = new AggregateError([new Error("inner")], "outer message");';
  const shapes = {
    "errors was deleted": "delete e.errors;",
    "errors is an empty array": "e.errors = [];",
    "errors is not iterable": "e.errors = {};",
    "errors is null": "e.errors = null;",
    "errors is a primitive": "e.errors = 1;",
    "the errors getter throws": 'Object.defineProperty(e, "errors", { get() { throw new Error("getter"); } });',
  };

  for (const [name, shape] of Object.entries(shapes)) {
    test(`console.error: ${name}`, async () => {
      const { stdout, stderr, exitCode } = await run([
        "-e",
        `${make} ${shape} console.error(e); console.log("after");`,
      ]);
      expect(stderr).toContain(header);
      expect(stdout).toBe("after\n");
      expect(exitCode).toBe(0);
    });

    test(`uncaught: ${name}`, async () => {
      const { stderr, exitCode } = await run(["-e", `${make} ${shape} throw e;`]);
      expect(stderr).toContain(header);
      expect(exitCode).toBe(1);
    });
  }

  test("Bun.inspect: errors was deleted", async () => {
    const { stdout, stderr, exitCode } = await run([
      "-e",
      `${make} delete e.errors; console.log(JSON.stringify(Bun.inspect(e)));`,
    ]);
    expect(JSON.parse(stdout)).toContain(header);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("errors is an accessor: the members it returns are printed", async () => {
    const { stdout, stderr, exitCode } = await run([
      "-e",
      `${make}
       Object.defineProperty(e, "errors", { get() { return [new Error("from the getter")]; } });
       console.error(e);
       console.log("after");`,
    ]);
    expect(names(stderr)).toEqual([header, "  error: from the getter"]);
    expect(stdout).toBe("after\n");
    expect(exitCode).toBe(0);
  });

  test("members are printed after the AggregateError", async () => {
    const { stderr, exitCode } = await run([
      "-e",
      'throw new AggregateError([new Error("first member"), new TypeError("second member")], "outer message");',
    ]);
    expect(names(stderr)).toEqual([header, "  error: first member", "  TypeError: second member"]);
    expect(exitCode).toBe(1);
  });

  // Without any user code: a module with two or more build errors rejects its
  // first load with an AggregateError of BuildMessages. JSC settles every later
  // load of it from the module registry with a copy made by
  // JSModuleLoader::duplicateError, which keeps the error type and message but
  // not the `errors` property.
  const broken = {
    "broken.ts": "export function f() {\n  const v = {b: {},),r,};\n}\n",
  };

  test("the error a second load of a module that failed to build rejects with", async () => {
    const { stdout, stderr, exitCode } = await run(["main.ts"], {
      ...broken,
      "main.ts": `
        const seen = [];
        for (let i = 0; i < 2; i++) {
          try {
            await import("./broken.ts");
          } catch (e) {
            seen.push(e.constructor.name);
            if (i === 1) console.error(e);
          }
        }
        console.log(JSON.stringify(seen));
      `,
    });
    expect(stdout).toBe('["AggregateError","AggregateError"]\n');
    expect(stderr).toContain("broken.ts");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/36963
  test("bun test: two files import a module that failed to build", async () => {
    const importer = 'import { f } from "./broken.ts";\nf();\n';
    const { stderr, exitCode } = await run(["test", "./a.test.ts", "./b.test.ts"], {
      ...broken,
      "a.test.ts": importer,
      "b.test.ts": importer,
    });
    expect(stderr).toContain("a.test.ts:");
    expect(stderr).toContain("b.test.ts:");
    expect(stderr).toContain("across 2 files");
    expect(exitCode).toBe(1);
  });
});

// An AggregateError prints as any other error does. Its members follow its
// stack trace, a blank line before each, indented under it. Its `cause`
// follows the last member, at the column of the AggregateError.
describe.concurrent("AggregateError with members", () => {
  // Runs `bun ...args` in a directory that holds `files`. The output has no
  // directory in its paths and no version line.
  async function run(files, ...args) {
    using dir = tempDir("inspect-aggregate-members", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const prefix = String(dir).replaceAll("\\", "/") + "/";
    const clean = text =>
      text
        .replaceAll("\\", "/")
        .replaceAll(prefix, "")
        .replace(/\nBun v.*\n$/, "");
    return { stdout: clean(stdout), stderr: clean(stderr), exitCode };
  }

  // Drops the source previews. Keeps the indentation, the blank lines and the
  // stack frames.
  const withoutPreviews = text =>
    text
      .split("\n")
      .filter(line => !/^ *\d+ \| /.test(line) && !/^ *\^$/.test(line))
      .join("\n")
      .trimEnd();

  // One line for each name and message, property and marker, with its
  // indentation.
  const outline = text =>
    withoutPreviews(text)
      .split("\n")
      .filter(line => line !== "" && !/^ +at /.test(line));

  const fixture = `function member(message) {
  const error = new Error(message);
  return error;
}
function aggregate() {
  const error = new AggregateError([member("first member"), member("second member")], "outer message");
  error.code = "E_AGG";
  return error;
}
const error = aggregate();
switch (process.argv[2]) {
  case "throw":
    throw error;
  case "reject":
    Promise.reject(error);
    break;
  case "reportError":
    reportError(error);
    break;
  case "console.error":
    console.error(error);
    break;
  case "console.log":
    console.log(error);
    break;
  case "Bun.inspect":
    process.stdout.write(Bun.inspect(error));
    break;
  case "setTimeout":
    setTimeout(() => {
      throw error;
    }, 1);
    break;
  case "setImmediate":
    setImmediate(() => {
      throw error;
    });
    break;
  case "process.nextTick":
    process.nextTick(() => {
      throw error;
    });
    break;
  case "queueMicrotask":
    queueMicrotask(() => {
      throw error;
    });
    break;
}
`;

  test("an uncaught AggregateError prints itself, then each member under it", async () => {
    const { stderr, exitCode } = await run({ "index.cjs": fixture }, "index.cjs", "throw");
    expect(stderr.split("\n")).toEqual([
      "1 | function member(message) {",
      "2 |   const error = new Error(message);",
      "3 |   return error;",
      "4 | }",
      "5 | function aggregate() {",
      '6 |   const error = new AggregateError([member("first member"), member("second member")], "outer message");',
      "                        ^",
      "AggregateError: outer message",
      ' code: "E_AGG"',
      "",
      "      at aggregate (index.cjs:6:21)",
      "      at <anonymous> (index.cjs:10:15)",
      "",
      "  1 | function member(message) {",
      "  2 |   const error = new Error(message);",
      "                          ^",
      "  error: first member",
      "        at member (index.cjs:2:21)",
      "        at aggregate (index.cjs:6:37)",
      "        at <anonymous> (index.cjs:10:15)",
      "",
      "  1 | function member(message) {",
      "  2 |   const error = new Error(message);",
      "                          ^",
      "  error: second member",
      "        at member (index.cjs:2:21)",
      "        at aggregate (index.cjs:6:61)",
      "        at <anonymous> (index.cjs:10:15)",
      "",
    ]);
    expect(exitCode).toBe(1);
  });

  test.each([
    ["reject", "stderr", 1],
    ["reportError", "stderr", 1],
    ["console.error", "stderr", 0],
    ["console.log", "stdout", 0],
    ["Bun.inspect", "stdout", 0],
  ])("%s prints the same lines", async (sink, stream, expectedExitCode) => {
    const result = await run({ "index.cjs": fixture }, "index.cjs", sink);
    expect(withoutPreviews(result[stream]).split("\n")).toEqual([
      "AggregateError: outer message",
      ' code: "E_AGG"',
      "",
      "      at aggregate (index.cjs:6:21)",
      "      at <anonymous> (index.cjs:10:15)",
      "",
      "  error: first member",
      "        at member (index.cjs:2:21)",
      "        at aggregate (index.cjs:6:37)",
      "        at <anonymous> (index.cjs:10:15)",
      "",
      "  error: second member",
      "        at member (index.cjs:2:21)",
      "        at aggregate (index.cjs:6:61)",
      "        at <anonymous> (index.cjs:10:15)",
    ]);
    expect(result.exitCode).toBe(expectedExitCode);
  });

  // An error that these callbacks throw reaches the printer inside a
  // `JSC::Exception`. The printer shows no own property (`code`) and no
  // `cause` of such an error, whatever its type.
  test.each(["setTimeout", "setImmediate", "process.nextTick", "queueMicrotask"])(
    "thrown from a %s callback, it prints itself, then its members",
    async sink => {
      const { stderr, exitCode } = await run({ "index.cjs": fixture }, "index.cjs", sink);
      expect(outline(stderr)).toEqual([
        "AggregateError: outer message",
        "  error: first member",
        "  error: second member",
      ]);
      expect(exitCode).toBe(1);
    },
  );

  test("an object that is only named AggregateError has no members", async () => {
    const { stderr, exitCode } = await run(
      {
        "index.cjs": `const thrown = { name: "AggregateError", message: "not an error", errors: [new Error("not a member")] };
setTimeout(() => {
  throw thrown;
}, 1);
`,
      },
      "index.cjs",
    );
    expect(outline(stderr)).toEqual(["AggregateError: not an error"]);
    expect(exitCode).toBe(1);
  });

  // `Bun.inspect(value)`, one line for each name and message, property and
  // marker.
  const inspected = value => outline(Bun.inspect(value));

  test("its cause follows its last member", () => {
    const error = new AggregateError([new Error("member")], "outer", { cause: new Error("the cause") });
    expect(inspected(error)).toEqual(["AggregateError: outer", "  error: member", "error: the cause"]);
  });

  test("a nested AggregateError indents its members once more", () => {
    const inner = new AggregateError([new Error("leaf")], "inner");
    expect(inspected(new AggregateError([inner, new Error("sibling")], "outer"))).toEqual([
      "AggregateError: outer",
      "  AggregateError: inner",
      "    error: leaf",
      "  error: sibling",
    ]);
  });

  test("reached as a cause or as a property, it prints its members too", () => {
    const wrapper = new Error("wrapper", { cause: new AggregateError([new Error("member")], "outer") });
    expect(inspected(wrapper)).toEqual(["error: wrapper", "AggregateError: outer", "  error: member"]);

    const holder = new Error("holder");
    holder.related = new AggregateError([new Error("member")], "outer");
    expect(inspected(holder)).toEqual(["error: holder", "AggregateError: outer", "  error: member"]);
  });

  test("members that are not errors print under it as they print on their own", () => {
    expect(inspected(new AggregateError(["a string", { plain: 1 }, 42], "outer"))).toEqual([
      "AggregateError: outer",
      "  error: a string",
      '  "a string"',
      "  error",
      "  {",
      "    plain: 1,",
      "  }",
      "  error: 42",
      "  42",
    ]);
  });

  test("a member keeps its cause and its Error-valued properties", () => {
    const member = new Error("member");
    member.cause = new Error("assigned cause");
    member.related = new Error("related");
    expect(inspected(new AggregateError([member], "outer"))).toEqual([
      "AggregateError: outer",
      "  error: member",
      "  error: assigned cause",
      "  error: related",
    ]);
  });

  test("a cycle prints [Circular], and the AggregateError once", () => {
    const holdsItself = new AggregateError([], "outer");
    holdsItself.errors.push(holdsItself, new Error("member"));
    expect(inspected(holdsItself)).toEqual(["AggregateError: outer", "  [Circular]", "  error: member"]);

    const a = new AggregateError([], "a");
    const b = new AggregateError([a], "b");
    a.errors.push(b);
    expect(inspected(a)).toEqual(["AggregateError: a", "  AggregateError: b", "    [Circular]"]);

    const causeOfMember = new AggregateError([], "outer");
    causeOfMember.errors.push(new Error("member", { cause: causeOfMember }));
    expect(inspected(causeOfMember)).toEqual(["AggregateError: outer", "  error: member", "   cause: [Circular],"]);
  });

  test("`errors` is read once, and an array is walked by index", () => {
    let reads = 0;
    const accessor = new AggregateError([], "outer");
    Object.defineProperty(accessor, "errors", {
      get() {
        reads++;
        return [new Error("from the getter")];
      },
    });
    expect(inspected(accessor)).toEqual(["AggregateError: outer", "  error: from the getter"]);
    expect(reads).toBe(1);

    const error = new AggregateError([new Error("member")], "outer");
    const iterator = Array.prototype[Symbol.iterator];
    let iterations = 0;
    Array.prototype[Symbol.iterator] = function () {
      iterations++;
      return iterator.call(this);
    };
    try {
      expect(inspected(error)).toEqual(["AggregateError: outer", "  error: member"]);
    } finally {
      Array.prototype[Symbol.iterator] = iterator;
    }
    expect(iterations).toBe(0);
  });

  // Only an array has a length that bounds the walk.
  test("an `errors` that is not an array is not walked", () => {
    let steps = 0;
    const iterable = new AggregateError([], "outer");
    iterable.errors = (function* () {
      for (const message of ["one", "two", "three"]) {
        steps++;
        yield new Error(message);
      }
    })();
    expect(inspected(new Error("wrapper", { cause: iterable }))).toEqual(["error: wrapper", "AggregateError: outer"]);
    expect(inspected(iterable)).toEqual(["AggregateError: outer"]);
    expect(steps).toBe(0);

    const inSet = new AggregateError([], "outer");
    inSet.errors = new Set([new Error("in a set")]);
    expect(inspected(inSet)).toEqual(["AggregateError: outer"]);
  });

  test("an own enumerable `errors` prints once", () => {
    class Listed extends AggregateError {
      name = "Listed";
      errors = [new Error("from the field")];
    }
    expect(inspected(new Listed([], "outer"))).toEqual(["Listed: outer", "  error: from the field"]);

    // What is not walked stays a property line.
    class Fields extends AggregateError {
      name = "Fields";
      errors = { email: "not an address" };
    }
    expect(inspected(new Fields([], "outer"))).toEqual([
      "Fields: outer",
      " errors: {",
      '  email: "not an address",',
      "},",
    ]);
  });

  test("an assigned cause that is an AggregateError prints once at every level", () => {
    const mid = new Error("mid");
    mid.cause = new AggregateError([new Error("member")], "assigned");
    expect(inspected(new Error("top", { cause: mid }))).toEqual([
      "error: top",
      "error: mid",
      "AggregateError: assigned",
      "  error: member",
    ]);

    const third = new AggregateError([new Error("third member")], "third");
    const second = new AggregateError([new Error("second member")], "second");
    second.cause = third;
    const first = new AggregateError([new Error("first member")], "first");
    first.cause = second;
    expect(inspected(new Error("top", { cause: first }))).toEqual([
      "error: top",
      "AggregateError: first",
      "  error: first member",
      "AggregateError: second",
      "  error: second member",
      "AggregateError: third",
      "  error: third member",
    ]);
  });

  test("one blank line separates the blocks, whatever the block before ends in", () => {
    // Without frames, a block that has properties ends in a blank line.
    const { stackTraceLimit } = Error;
    Error.stackTraceLimit = 0;
    let error;
    try {
      const first = Object.assign(new Error("first"), { code: "E_FIRST" });
      const second = Object.assign(new Error("second"), { code: "E_SECOND" });
      error = Object.assign(new AggregateError([first, second], "outer", { cause: new Error("the cause") }), {
        code: "E_OUTER",
      });
    } finally {
      Error.stackTraceLimit = stackTraceLimit;
    }
    expect(Bun.inspect(error).split("\n")).toEqual([
      "AggregateError: outer",
      ' code: "E_OUTER"',
      "",
      "  error: first",
      '   code: "E_FIRST"',
      "",
      "  error: second",
      '   code: "E_SECOND"',
      "",
      "error: the cause",
      "",
    ]);

    // A cause chain that the depth cuts ends in a marker with no line end.
    const chained = new Error("chained", { cause: new Error("cause", { cause: new Error("cut") }) });
    const cut = Bun.inspect(new AggregateError([chained, new Error("next")], "outer"), { depth: 1 });
    expect(
      withoutPreviews(cut)
        .split("\n")
        .filter(line => !/^ +at /.test(line)),
    ).toEqual(["AggregateError: outer", "", "  error: chained", "", "  [Error ...]", "", "  error: next"]);
  });

  test("the indentation stops at 32 levels", () => {
    let error = new Error("leaf");
    for (let i = 0; i < 40; i++) error = new AggregateError([error], "level");
    const columns = Bun.inspect(error, { depth: Infinity })
      .split("\n")
      .filter(line => /^ *(AggregateError: level|error: leaf)$/.test(line))
      .map(line => line.search(/\S/));
    expect(columns).toEqual([...Array.from({ length: 32 }, (_, level) => level * 2), ...Array(9).fill(64)]);
  });

  test("Promise.any: the AggregateError has no message and no stack, and its members follow", async () => {
    const { stderr, exitCode } = await run(
      {
        "index.cjs": `function reject(message) {
  const error = new Error(message);
  return Promise.reject(error);
}
Promise.any([reject("first rejection"), reject("second rejection")]);
`,
      },
      "index.cjs",
    );
    expect(withoutPreviews(stderr).split("\n")).toEqual([
      "AggregateError: ",
      "",
      "  error: first rejection",
      "        at reject (index.cjs:2:21)",
      "        at <anonymous> (index.cjs:5:14)",
      "",
      "  error: second rejection",
      "        at reject (index.cjs:2:21)",
      "        at <anonymous> (index.cjs:5:41)",
    ]);
    expect(exitCode).toBe(1);
  });

  // Bun wraps the build errors of a module in an AggregateError when there are
  // two or more. That list is all there is to say, so it stands in for the
  // AggregateError, whose message only counts it.
  describe("whose members are all build errors", () => {
    const broken = { "broken.ts": "export function f() {\n  const v = {b: {},),r,};\n}\n" };
    const buildErrors = [
      'error: Expected identifier but found ")"',
      "    at broken.ts:2:20",
      "",
      'error: Expected "}" but found "r"',
      "    at broken.ts:2:22",
      "",
      'error: Expected identifier but found "}"',
      "    at broken.ts:2:24",
      "",
      "error: This constant must be initialized",
      "    at broken.ts:2:24",
    ];
    const indented = lines => lines.map(line => (line === "" ? "" : "  " + line));
    const printed = text => withoutPreviews(text).split("\n");

    test.each([
      ["a module that does not build", 'import "./broken.ts";\n'],
      ["a build that Bun.build rejects", 'await Bun.build({ entrypoints: ["./broken.ts"] });\n'],
      [
        "an AggregateError that user code made",
        `const { logs } = await Bun.build({ entrypoints: ["./broken.ts"], throw: false });
throw new AggregateError(logs, "the build failed");
`,
      ],
      // The list is read from the storage of the array.
      ["after Array.prototype is frozen", 'Object.freeze(Array.prototype);\nawait import("./broken.ts");\n'],
    ])("%s prints the list only", async (_, source) => {
      const { stderr, exitCode } = await run({ ...broken, "index.mjs": source }, "index.mjs");
      expect(printed(stderr)).toEqual(buildErrors);
      expect(exitCode).toBe(1);
    });

    test("a list of resolve errors prints the list only", async () => {
      const { stderr, exitCode } = await run(
        {
          "unresolved.ts": 'import "./missing-a";\nimport "./missing-b";\n',
          "index.mjs": 'await Bun.build({ entrypoints: ["./unresolved.ts"] });\n',
        },
        "index.mjs",
      );
      expect(printed(stderr)).toEqual([
        'error: Could not resolve: "./missing-a"',
        "    at unresolved.ts:1:8",
        "",
        'error: Could not resolve: "./missing-b"',
        "    at unresolved.ts:2:8",
      ]);
      expect(exitCode).toBe(1);
    });

    test("with another member, the AggregateError prints and the build errors are members", async () => {
      const { stderr, exitCode } = await run(
        {
          ...broken,
          "index.mjs": `const { logs } = await Bun.build({ entrypoints: ["./broken.ts"], throw: false });
throw new AggregateError([new Error("plain"), logs[0], logs[1]], "mixed");
`,
        },
        "index.mjs",
      );
      expect(printed(stderr)).toEqual([
        "AggregateError: mixed",
        "      at index.mjs:2:11",
        "",
        "  error: plain",
        "        at index.mjs:2:31",
        "",
        ...indented(buildErrors.slice(0, 5)),
      ]);
      expect(exitCode).toBe(1);
    });

    test("an index getter on `errors` runs once, and the AggregateError prints", async () => {
      const { stdout, stderr, exitCode } = await run(
        {
          ...broken,
          "index.mjs": `const { logs } = await Bun.build({ entrypoints: ["./broken.ts"], throw: false });
let reads = 0;
const errors = Object.defineProperty([logs[0]], 1, {
  get() {
    reads++;
    return logs[1];
  },
});
console.error(Object.assign(new AggregateError([], "listed"), { errors }));
console.log(reads);
`,
        },
        "index.mjs",
      );
      expect(printed(stderr)).toEqual([
        "AggregateError: listed",
        "      at index.mjs:9:33",
        "",
        ...indented(buildErrors.slice(0, 5)),
      ]);
      expect(stdout).toBe("1\n");
      expect(exitCode).toBe(0);
    });

    // As a member, a list is at the column of the members, and a build error
    // that stands alone is a member like any other.
    test("as members of the AggregateError of Promise.any", async () => {
      const { stderr, exitCode } = await run(
        {
          ...broken,
          "one.ts": "export const oops = ;\n",
          "index.mjs": 'await Promise.any([import("./broken.ts"), import("./one.ts")]);\n',
        },
        "index.mjs",
      );
      expect(printed(stderr)).toEqual([
        "AggregateError: ",
        "",
        ...indented(buildErrors),
        "",
        "  error: Unexpected ;",
        "      at one.ts:1:21",
      ]);
      expect(exitCode).toBe(1);
    });

    // The queue and a callback hand the AggregateError to the printer of one
    // error, which prints it with its members.
    test("reached as a cause, it prints itself with the list under it", async () => {
      const { stderr, exitCode } = await run(
        {
          ...broken,
          "index.mjs": `try {
  await import("./broken.ts");
} catch (error) {
  throw new Error("wrapper", { cause: error });
}
`,
        },
        "index.mjs",
      );
      expect(printed(stderr)).toEqual([
        "error: wrapper",
        "      at index.mjs:4:13",
        "",
        'AggregateError: 4 errors building "broken.ts"',
        "",
        ...indented(buildErrors),
      ]);
      expect(exitCode).toBe(1);
    });

    test("thrown from a timer callback, it prints itself with the list under it", async () => {
      const { stderr, exitCode } = await run(
        { ...broken, "index.cjs": 'setTimeout(() => {\n  require("./broken.ts");\n}, 1);\n' },
        "index.cjs",
      );
      expect(outline(stderr)).toEqual([
        'AggregateError: 4 errors building "broken.ts"',
        ...indented(buildErrors.filter(line => line.startsWith("error: "))),
      ]);
      expect(exitCode).toBe(1);
    });
  });

  test("bun test and its JUnit report name the AggregateError first", async () => {
    using dir = tempDir("inspect-aggregate-junit", {
      "a.test.js": `import { test } from "bun:test";
test("rejects", async () => {
  await Promise.reject(new AggregateError([new Error("first member"), new TypeError("second member")], "outer message"));
});
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./a.test.js", "--reporter=junit", "--reporter-outfile=junit.xml"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const junit = await Bun.file(`${dir}/junit.xml`).text();
    expect({
      printed: outline(stderr).filter(line => /^ *\w*[Ee]rror: /.test(line)),
      failure: /<failure type="[^"]*" message="[^"]*">/.exec(junit)?.[0],
      reported: [...junit.matchAll(/(\w*Error): (\w+ \w+)&#10;/g)].map(match => match[1] + ": " + match[2]),
    }).toEqual({
      printed: ["AggregateError: outer message", "  error: first member", "  TypeError: second member"],
      failure: '<failure type="AggregateError" message="outer message">',
      reported: ["AggregateError: outer message", "Error: first member", "TypeError: second member"],
    });
    expect(exitCode).toBe(1);
  });

  // It has no message and no stack, so its members carry the report.
  test("the AggregateError of Promise.any adds no annotation and no JUnit failure of its own", async () => {
    using dir = tempDir("inspect-aggregate-any", {
      "a.test.js": `import { test } from "bun:test";
test("rejects", async () => {
  await Promise.any([Promise.reject(new Error("first rejection")), Promise.reject(new TypeError("second rejection"))]);
});
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./a.test.js", "--reporter=junit", "--reporter-outfile=junit.xml"],
      cwd: String(dir),
      env: { ...bunEnv, GITHUB_ACTIONS: "true" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const junit = await Bun.file(`${dir}/junit.xml`).text();
    expect({
      printed: outline(stderr).filter(line => /^ *\w*[Ee]rror: /.test(line)),
      annotations: stderr.split("\n").filter(line => line.startsWith("::error ")).length,
      failure: /<failure type="[^"]*" message="[^"]*">/.exec(junit)?.[0],
    }).toEqual({
      printed: ["AggregateError: ", "  error: first rejection", "  TypeError: second rejection"],
      annotations: 2,
      failure: '<failure type="Error" message="first rejection">',
    });
    expect(exitCode).toBe(1);
  });

  test("node:net: a connect that fails at two addresses prints its AggregateError by name", async () => {
    const { stderr, exitCode } = await run(
      {
        "index.cjs": `const net = require("node:net");
const listener = net.createServer().listen(0, "127.0.0.1", () => {
  const { port } = listener.address();
  listener.close(() => {
    const socket = net.connect({
      port,
      host: "two-addresses.invalid",
      autoSelectFamily: true,
      lookup: (hostname, options, callback) =>
        callback(null, [
          { address: "127.0.0.1", family: 4 },
          { address: "127.0.0.2", family: 4 },
        ]),
    });
    socket.on("error", error => console.error(error));
  });
});
`,
      },
      "index.cjs",
    );
    const names = outline(stderr).filter(line => /^ *\w*[Ee]rror: /.test(line));
    expect(names.map(line => line.replace(/connect \w+ (\S+):\d+$/, "connect $1"))).toEqual([
      "AggregateError: ",
      "  error: connect 127.0.0.1",
      "  error: connect 127.0.0.2",
    ]);
    expect(exitCode).toBe(0);
  });

  test("the development error page of Bun.serve lists the AggregateError, then its members", async () => {
    const { stdout, exitCode } = await run(
      {
        "index.cjs": `const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  development: true,
  fetch() {
    throw new AggregateError([new Error("first member"), new TypeError("second member")], "outer message");
  },
});
fetch(server.url)
  .then(response => response.text())
  .then(html => {
    const json = /<script id="__bunfallback" type="application\\/json">([^<]*)<\\/script>/.exec(html)[1];
    console.log(JSON.stringify(JSON.parse(json).problems.exceptions.map(({ name, message }) => name + ": " + message)));
    // The error that the server reported set the exit code.
    process.exit(0);
  });
`,
      },
      "index.cjs",
    );
    expect(JSON.parse(stdout)).toEqual([
      "AggregateError: outer message",
      "Error: first member",
      "TypeError: second member",
    ]);
    expect(exitCode).toBe(0);
  });
});

describe("an error with a circular reference to itself", () => {
  // Drops the source preview, stack frames, blank lines and the version line.
  function rendered(text) {
    return text
      .split("\n")
      .filter(line => !/^\s*\d+ \| /.test(line) && !/^\s*\^\s*$/.test(line) && !/^\s+at /.test(line))
      .filter(line => line.trim() !== "" && !line.startsWith("Bun v"));
  }

  test("prints [Circular] under the key that closes the cycle", () => {
    const self = new Error("x");
    self.self = self;
    expect(rendered(Bun.inspect(self))).toEqual(["error: x", " self: [Circular],"]);

    const a = new Error("a");
    a.cause = new Error("b", { cause: a });
    expect(rendered(Bun.inspect(a))).toEqual(["error: a", "error: b", " cause: [Circular],"]);

    const outer = new Error("a");
    const inner = new Error("b");
    outer.x = [inner];
    inner.y = inner;
    expect(rendered(Bun.inspect(outer))).toEqual(["error: a", " x: [", "error: b", " y: [Circular],", "],"]);
  });

  test("is printed once when thrown", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", 'const e = new Error("cyc"); e.cause = e; e.errors = [e]; throw e;'],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect({ lines: rendered(stderr), exitCode }).toEqual({
      lines: ["error: cyc", "  cause: [Circular],", " errors: [", "  [Circular]", "],"],
      exitCode: 1,
    });
  });

  test("an error that appears twice without a cycle is printed in full each time", () => {
    const e = new Error("twice");
    e.meta = {};
    const lines = rendered(Bun.inspect([e, { a: e, b: { c: e } }]));
    expect(lines.filter(line => line.trim() === "error: twice").length).toBe(3);
    expect(lines.filter(line => line.includes("[Circular]"))).toEqual([]);
  });
});

// `Malloc=1` lets ASAN catch a read past the end of the source.
test.concurrent("prints the source preview for an error positioned at the end of the source text", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `(0, eval)("xyz");`],
    env: { ...bunEnv, NO_COLOR: "1", Malloc: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, excerpt: stderr.split("\n").slice(0, 3) }).toEqual({
    stdout: "",
    excerpt: ["1 | xyz", "       ^", "ReferenceError: xyz is not defined"],
  });
  expect(exitCode).toBe(1);
});

test.concurrent("reports the right position for a multi-line `new` expression in a 16-bit source", async () => {
  const source = `/* 中 */
function code() {
  throw new (class Boom extends Error {
    constructor(message) {
      super(message);
    }
  })("boom");
}
code();`;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `(0, eval)(${JSON.stringify(source)});`],
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(stderr).toMatch(/error: boom\n +at code \(.*:3:9\)\n/);
  expect(exitCode).toBe(1);
});
