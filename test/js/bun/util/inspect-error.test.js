import { describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe, expectRssDeltaBelow, isLinux, tempDir } from "harness";

test("error.cause", () => {
  const err = new Error("error 1");
  const err2 = new Error("error 2", { cause: err });
  expect(
    Bun.inspect(err2)
      .replaceAll("\\", "/")
      .replaceAll(import.meta.dir.replaceAll("\\", "/"), "[dir]"),
  ).toMatchInlineSnapshot(`
"1 | import { describe, expect, jest, test } from "bun:test";
2 | import { bunEnv, bunExe, expectRssDeltaBelow, isLinux, tempDir } from "harness";
3 | 
4 | test("error.cause", () => {
5 |   const err = new Error("error 1");
6 |   const err2 = new Error("error 2", { cause: err });
                       ^
error: error 2
      at <anonymous> ([dir]/inspect-error.test.js:6:20)

1 | import { describe, expect, jest, test } from "bun:test";
2 | import { bunEnv, bunExe, expectRssDeltaBelow, isLinux, tempDir } from "harness";
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

// Once script has read error.stack, the frames are read back from that text.
test("a folder named in parentheses, in the stack of an error whose stack was read", async () => {
  using dir = tempDir("inspect-error-parentheses", {
    "(group)/throws.js": `throw new Error("at the top level");`,
    "(group)/fails.js": `export function fails() { throw new Error("in a function"); }`,
    "index.js": `
      for (const run of [() => import("./(group)/throws.js"), async () => (await import("./(group)/fails.js")).fails()]) {
        try {
          await run();
        } catch (error) {
          void error.stack;
          console.log(Bun.inspect(error).split("\\n").find(line => /^\\s+at /.test(line)).trim());
        }
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.replaceAll("\\", "/").replaceAll(String(dir).replaceAll("\\", "/"), "[dir]").split("\n")).toEqual([
    "at [dir]/(group)/throws.js:1:11",
    "at fails ([dir]/(group)/fails.js:1:37)",
    "",
  ]);
  expect(exitCode).toBe(0);
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

// The code frame of an error from a module with a source map is cut from a
// whole source text: the module's file, or a `sourcesContent` entry of its
// map. A print keeps the frame that it cut. The next print of an error from
// the same place loads no source: `codeFrame_sourceLoads` counts the loads.
describe.concurrent("the code frame of an error that is printed again", () => {
  // For a fixture. `loadsIn(fn)` is the number of sources that the printer
  // loaded while `fn` ran. `frame(text)` is the numbered source lines of a
  // printed error.
  const helpers = String.raw`
const { getCounters } = require("bun:internal-for-testing");
function loadsIn(fn) {
  const before = getCounters().codeFrame_sourceLoads;
  fn();
  return getCounters().codeFrame_sourceLoads - before;
}
const frame = text => text.split("\n").filter(line => /^\s*\d+ \| /.test(line)).join("\n");
`;
  const frame = text =>
    text
      .split("\n")
      .filter(line => /^\s*\d+ \| /.test(line))
      .join("\n");

  // Runs main.js. `out` is the JSON that it printed.
  async function run(files, env) {
    using dir = tempDir("inspect-error-code-frame", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: String(dir),
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let out;
    try {
      out = JSON.parse(stdout);
    } catch {
      out = { stdout, stderr };
    }
    return { out, stderr, exitCode };
  }

  // A module that bun transpiles. `make()` returns an error thrown on line 5.
  const transpiled = (message = "boom") =>
    [
      "type Padding1 = { a: number };",
      "type Padding2 = { b: string };",
      "export function make(): Error {",
      "  try {",
      `    throw new Error(${JSON.stringify(message)});`,
      "  } catch (e) {",
      "    return e as Error;",
      "  }",
      "}",
      "",
    ].join("\n");
  const transpiledFrame = (message = "boom") =>
    [
      "1 | type Padding1 = { a: number };",
      "2 | type Padding2 = { b: string };",
      "3 | export function make(): Error {",
      "4 |   try {",
      `5 |     throw new Error(${JSON.stringify(message)});`,
    ].join("\n");

  // The `mappings` of a source map in which generated line N starts at
  // `lines[N] = [source, line]`, both counted from 0.
  function mappings(lines) {
    const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const vlq = value => {
      let rest = value < 0 ? (-value << 1) | 1 : value << 1;
      let out = "";
      do {
        const digit = rest & 31;
        rest >>>= 5;
        out += digits[rest ? digit | 32 : digit];
      } while (rest);
      return out;
    };
    let previous = [0, 0];
    return lines
      .map(([source, line]) => {
        const segment = "A" + vlq(source - previous[0]) + vlq(line - previous[1]) + "A";
        previous = [source, line];
        return segment;
      })
      .join(";");
  }

  // A prebuilt module and its source map, which has two sources. `make()`
  // returns an error from line 4 of original.ts and `makeOther()` one from
  // line 4 of other.ts.
  const prebuilt = sourceMappingURL =>
    [
      "// @bun",
      "// generated line 2",
      "function thrower() {",
      '  if (globalThis.traceFirst) console.trace("trace"); throw new Error("boom");',
      "}",
      "function other() {",
      '  throw new Error("other");',
      "}",
      "export function make() { try { thrower(); } catch (e) { return e; } }",
      "export function makeOther() { try { other(); } catch (e) { return e; } }",
      "//# sourceMappingURL=" + sourceMappingURL,
      "",
    ].join("\n");
  const prebuiltLines = [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [1, 2],
    [1, 3],
    [1, 4],
    [0, 4],
    [1, 4],
  ];
  const prebuiltMap = (word = "original", padding = "") =>
    JSON.stringify({
      version: 3,
      sources: ["original.ts", "other.ts"],
      sourcesContent: [
        [
          `// ${word} line 1`,
          `// ${word} line 2`,
          "function thrower() {",
          '  throw new Error("boom");',
          "}",
          padding,
        ].join("\n"),
        ["// other line 1", "// other line 2", "function other() {", '  throw new Error("other");', "}", ""].join("\n"),
      ],
      names: [],
      mappings: mappings(prebuiltLines),
    });
  const prebuiltFrame = (word = "original") =>
    [
      `1 | // ${word} line 1`,
      `2 | // ${word} line 2`,
      "3 | function thrower() {",
      '4 |   throw new Error("boom");',
    ].join("\n");
  const otherFrame = [
    "1 | // other line 1",
    "2 | // other line 2",
    "3 | function other() {",
    '4 |   throw new Error("other");',
  ].join("\n");
  const inlineURL = map => "data:application/json;base64," + Buffer.from(map).toString("base64");

  test("a module that bun transpiled", async () => {
    const { out, exitCode } = await run({
      "mod.ts": transpiled(),
      "main.js":
        helpers +
        String.raw`
const { make } = require("./mod.ts");
const out = {};
const error = make();
let first;
out.firstPrint = loadsIn(() => (first = Bun.inspect(error)));
out.frame = frame(first);
let same = true;
out.repeats = loadsIn(() => {
  for (let i = 0; i < 100; i++) same &&= Bun.inspect(error) === first;
});
out.same = same;
out.anotherError = loadsIn(() => (out.anotherErrorFrame = frame(Bun.inspect(make()))));
// One print that shows the error three times.
out.nested = loadsIn(() => Bun.inspect([error, { a: error, b: { c: error } }]));
// An error whose stack was read reaches the printer with frames that are
// already remapped. Nothing ties them to the module that threw, so each
// print reads their text.
const stackRead = make();
stackRead.stack;
out.stackRead = [0, 1].map(() => loadsIn(() => (out.stackReadFrame = frame(Bun.inspect(stackRead)))));
console.log(JSON.stringify(out));
`,
    });
    expect({ out, exitCode }).toEqual({
      out: {
        firstPrint: 1,
        frame: transpiledFrame(),
        repeats: 0,
        same: true,
        anotherError: 0,
        anotherErrorFrame: transpiledFrame(),
        nested: 0,
        stackRead: [1, 1],
        stackReadFrame: transpiledFrame(),
      },
      exitCode: 0,
    });
  });

  test("sourcesContent of an external and of an inline source map", async () => {
    // The error maps to line 1 of a source that starts with an empty line:
    // the frame is that one line, which has no bytes.
    const emptyLine = JSON.stringify({
      version: 3,
      sources: ["original.ts"],
      sourcesContent: ["\n// original line 2\n"],
      names: [],
      mappings: mappings(prebuiltLines.map(() => [0, 0])),
    });
    const { out, exitCode } = await run({
      "external.js": prebuilt("external.js.map"),
      "external.js.map": prebuiltMap(),
      "inline.js": prebuilt(inlineURL(prebuiltMap())),
      "empty-line.js": prebuilt(inlineURL(emptyLine)),
      "main.js":
        helpers +
        String.raw`
const out = {};
for (const name of ["external.js", "inline.js", "empty-line.js"]) {
  const mod = require("./" + name);
  const error = mod.make();
  const result = (out[name] = {});
  let first;
  result.firstPrint = loadsIn(() => (first = Bun.inspect(error)));
  result.frame = frame(first);
  let same = true;
  result.repeats = loadsIn(() => {
    for (let i = 0; i < 100; i++) same &&= Bun.inspect(error) === first;
  });
  result.same = same;
  if (name === "empty-line.js") continue;
  // The same line of the other source of the map is another place.
  result.other = [0, 1].map(() => loadsIn(() => (result.otherFrame = frame(Bun.inspect(mod.makeOther())))));
  result.again = loadsIn(() => (result.againFrame = frame(Bun.inspect(mod.make()))));
  // The frames of an error whose stack was read name original.ts, which is
  // not on the disk.
  const stackRead = mod.make();
  stackRead.stack;
  result.stackRead = [0, 1].map(() => loadsIn(() => (result.stackReadFrame = frame(Bun.inspect(stackRead)))));
}
console.log(JSON.stringify(out));
`,
    });
    const expected = {
      firstPrint: 1,
      frame: prebuiltFrame(),
      repeats: 0,
      same: true,
      other: [1, 0],
      otherFrame,
      again: 0,
      againFrame: prebuiltFrame(),
      stackRead: [1, 1],
      stackReadFrame: "",
    };
    expect({ out, exitCode }).toEqual({
      out: {
        "external.js": expected,
        "inline.js": expected,
        "empty-line.js": { firstPrint: 1, frame: "", repeats: 0, same: true },
      },
      exitCode: 0,
    });
  });

  // A kept frame is the text that the last print to read its place cut. A
  // source that changes on the disk does not change it. A module that loads
  // again has new places.
  test("a source that changes on the disk, and a module that loads again", async () => {
    const { out, exitCode } = await run({
      "mod.ts": transpiled(),
      "external.js": prebuilt("external.js.map"),
      "external.js.map": prebuiltMap(),
      "edited.map": prebuiltMap("edited"),
      "main.js":
        helpers +
        String.raw`
const fs = require("fs");
const out = {};
{
  const path = require.resolve("./mod.ts");
  const source = fs.readFileSync(path, "utf8");
  const result = (out.transpiled = {});
  let mod = require(path);
  const error = mod.make();
  const first = Bun.inspect(error);

  fs.writeFileSync(path, source.replaceAll("boom", "edited"));
  result.editedOnDisk = Bun.inspect(error) === first;

  // A load of the file in the middle of a rewrite (--hot can do that) gives
  // a source map with no mappings. It does not replace the module's map.
  fs.writeFileSync(path, "// rewrite in progress\n");
  delete require.cache[path];
  require(path);
  result.loadedWhileTruncated = loadsIn(() => (result.loadedWhileTruncatedSame = Bun.inspect(error) === first));

  fs.writeFileSync(path, source.replaceAll("boom", "loaded again"));
  delete require.cache[path];
  mod = require(path);
  result.loadedAgain = loadsIn(() => (result.loadedAgainFrame = frame(Bun.inspect(mod.make()))));
  result.loadedAgainRepeat = loadsIn(() => (result.loadedAgainRepeatFrame = frame(Bun.inspect(mod.make()))));
}
{
  const path = require.resolve("./external.js");
  const result = (out.external = {});
  let mod = require(path);
  const error = mod.make();
  const first = Bun.inspect(error);

  fs.copyFileSync("edited.map", "external.js.map");
  result.editedOnDisk = Bun.inspect(error) === first;

  delete require.cache[path];
  mod = require(path);
  result.loadedAgain = loadsIn(() => (result.loadedAgainFrame = frame(Bun.inspect(mod.make()))));
  result.loadedAgainRepeat = loadsIn(() => (result.loadedAgainRepeatFrame = frame(Bun.inspect(mod.make()))));
}
console.log(JSON.stringify(out));
`,
    });
    expect({ out, exitCode }).toEqual({
      out: {
        transpiled: {
          editedOnDisk: true,
          loadedWhileTruncated: 0,
          loadedWhileTruncatedSame: true,
          loadedAgain: 1,
          loadedAgainFrame: transpiledFrame("loaded again"),
          loadedAgainRepeat: 0,
          loadedAgainRepeatFrame: transpiledFrame("loaded again"),
        },
        external: {
          editedOnDisk: true,
          loadedAgain: 1,
          loadedAgainFrame: prebuiltFrame("edited"),
          loadedAgainRepeat: 0,
          loadedAgainRepeatFrame: prebuiltFrame("edited"),
        },
      },
      exitCode: 0,
    });
  });

  // A place that was printed keeps its lines. Another place of the module
  // gets the transpiled lines, as it does without this change.
  test("a source that can no longer be read", async () => {
    const { out, exitCode } = await run({
      "mod.ts":
        transpiled() +
        [
          "export function makeSecond(): Error {",
          "  try {",
          '    throw new Error("second");',
          "  } catch (e) {",
          "    return e as Error;",
          "  }",
          "}",
          "",
        ].join("\n"),
      "main.js":
        helpers +
        String.raw`
const fs = require("fs");
const path = require.resolve("./mod.ts");
const mod = require(path);
const out = {};
const error = mod.make();
const first = Bun.inspect(error);
fs.unlinkSync(path);
out.kept = loadsIn(() => (out.keptSame = Bun.inspect(error) === first));
let second;
out.second = [0, 1].map(() => loadsIn(() => (second = Bun.inspect(mod.makeSecond()))));
out.secondIsRemapped = /at makeSecond \(.*mod\.ts:12:\d+\)/.test(second);
console.log(JSON.stringify(out));
`,
    });
    expect({ out, exitCode }).toEqual({
      out: { kept: 0, keptSame: true, second: [1, 1], secondIsRemapped: true },
      exitCode: 0,
    });
  });

  // The printer clamps a long line, marks the clamp when it prints colors,
  // and puts a caret under the error's column. A kept frame goes through
  // that like a frame that was just read. Each case is two files with the
  // same text, so a fresh print of one can be compared with a kept print of
  // the other.
  test("a kept frame prints like a fresh one", async () => {
    const line = (length, tail = "") => {
      const code = 'export function make() { try { throw new Error("boom"); } catch (e) { return e; } } // ';
      return code + Buffer.alloc(length - code.length - Buffer.byteLength(tail), "p").toString() + tail;
    };
    const cases = {
      "1023 bytes": line(1023) + "\n",
      "1024 bytes": line(1024) + "\n",
      "1025 bytes": line(1025) + "\n",
      "a character that crosses byte 1024": line(1100, "€" + Buffer.alloc(75, "p").toString()) + "\n",
      "a line of spaces above": "// first\n    \n" + line(100) + "\n",
      "CRLF": ["// first", "// second", line(100), "// last", ""].join("\r\n"),
      "no newline at the end": "// first\n" + line(100),
      "the first line": line(100) + "\n// last\n",
      "two places on one line":
        'export function make(second) { try { if (second) throw new Error("second"); throw new Error("first"); } catch (e) { return e; } }\n',
      "a frame of 4096 bytes": line(4096) + "\n",
      "a frame of 4097 bytes": line(4097) + "\n",
    };
    const files = {};
    for (const [name, source] of Object.entries(cases)) {
      files[name + ".ts"] = source;
      files[name + ".twin.ts"] = source;
    }

    const { out, exitCode } = await run({
      ...files,
      "main.js":
        helpers +
        String.raw`
const out = {};
const untwin = text => text.replaceAll(".twin.ts", ".ts");
for (const name of ${JSON.stringify(Object.keys(cases))}) {
  // All four errors are made on the next line, so the stacks of a pair differ
  // in the file name only. The second error of a file is from the second
  // place on its line, if it has one.
  const [[first, second], [twinFirst, twinSecond]] = [".ts", ".twin.ts"].map(extension =>
    [false, true].map(arg => require("./" + name + extension).make(arg)),
  );
  let freshColored, freshPlain, keptColored, keptPlain;
  const loads = [
    loadsIn(() => (freshColored = Bun.inspect(twinSecond, { colors: true }))),
    loadsIn(() => (freshPlain = Bun.inspect(first, { colors: false }))),
    loadsIn(() => (keptColored = Bun.inspect(second, { colors: true }))),
    loadsIn(() => (keptPlain = Bun.inspect(twinFirst, { colors: false }))),
  ];
  out[name] = {
    loads,
    hasFrame: frame(freshPlain).includes("throw new Error"),
    same: untwin(freshColored) === keptColored && untwin(keptPlain) === freshPlain,
  };
}
console.log(JSON.stringify(out));
`,
    });
    const kept = { loads: [1, 1, 0, 0], hasFrame: true, same: true };
    expect({ out, exitCode }).toEqual({
      out: {
        "1023 bytes": kept,
        "1024 bytes": kept,
        "1025 bytes": kept,
        "a character that crosses byte 1024": kept,
        "a line of spaces above": kept,
        "CRLF": kept,
        "no newline at the end": kept,
        "the first line": kept,
        "two places on one line": kept,
        "a frame of 4096 bytes": kept,
        // One byte more than a slot holds.
        "a frame of 4097 bytes": { loads: [1, 1, 1, 1], hasFrame: true, same: true },
      },
      exitCode: 0,
    });
  });

  // The page gets the source lines whole. The terminal gets them clamped.
  test("the development error page of Bun.serve", async () => {
    const long = Buffer.alloc(1500, "p").toString();
    const { out, exitCode } = await run({
      "mod.ts": [
        "type Padding = { a: number };",
        "export function thrower(): never {",
        `  throw new Error("boom"); // ${long}`,
        "}",
        "",
      ].join("\n"),
      "main.js": String.raw`
const { getCounters } = require("bun:internal-for-testing");
const { thrower } = require("./mod.ts");
const server = Bun.serve({
  port: 0,
  development: true,
  fetch() {
    thrower();
  },
});
// The source lines in the page, and the sources loaded to make it.
async function page() {
  const before = getCounters().codeFrame_sourceLoads;
  const html = await (await fetch(server.url)).text();
  const payload = JSON.parse(/<script id="__bunfallback" type="application\/json">(.*?)<\/script>/s.exec(html)[1]);
  const lines = payload.problems.exceptions[0].stack.source_lines;
  return { lines, loads: getCounters().codeFrame_sourceLoads - before };
}
const first = await page();
const second = await page();
await server.stop(true);
console.log(
  JSON.stringify({
    loads: [first.loads, second.loads],
    lines: first.lines.map(line => line.line),
    errorLineLength: first.lines.find(line => line.line === 3).text.length,
    same: JSON.stringify(first.lines) === JSON.stringify(second.lines),
  }),
);
`,
    });
    expect({ out, exitCode }).toEqual({
      out: {
        loads: [1, 0],
        lines: [1, 2, 3],
        errorLineLength: '  throw new Error("boom"); // '.length + 1500,
        same: true,
      },
      // An error that the fetch handler threw sets the exit code.
      exitCode: 1,
    });
  });

  // A module whose `sites[i]()` returns an error thrown on its own line. Each
  // of those lines ends with a comment of `padding` bytes.
  const sitesModule = (count, padding = 0) =>
    [
      "export const sites: (() => Error)[] = [",
      ...Array.from(
        { length: count },
        (_, i) =>
          `  () => { try { throw new Error("site ${i}"); } catch (e) { return e; } },` +
          (padding ? " // " + Buffer.alloc(padding, "p") : ""),
      ),
      "];",
      "",
    ].join("\n");

  // 64 places fit. One more place in rotation replaces the oldest each time,
  // so no print finds its frame. Each print still shows its own lines.
  test.each([
    [64, [64, 0, 0]],
    [65, [65, 65, 65]],
  ])("%d places in rotation", async (count, rounds) => {
    const { out, exitCode } = await run({
      "sites.ts": sitesModule(count),
      "main.js":
        helpers +
        String.raw`
const { sites } = require("./sites.ts");
const rounds = [];
let ownLines = true;
for (let round = 0; round < 3; round++) {
  rounds.push(
    loadsIn(() => {
      for (let i = 0; i < sites.length; i++) {
        const lines = frame(Bun.inspect(sites[i]())).split("\n");
        ownLines &&= lines.at(-1).includes('"site ' + i + '"');
      }
    }),
  );
}
console.log(JSON.stringify({ rounds, ownLines }));
`,
    });
    expect({ out, exitCode }).toEqual({ out: { rounds, ownLines: true }, exitCode: 0 });
  });

  // Comment lines that make a source large.
  const padding = kib => Buffer.alloc(kib * 1024, "// pppppppppppppp\n").toString() + "\n";

  // inspect-error-leak.test.js, error-gc-test.test.js and the stack overflow
  // test of bun-inspect.test.ts print errors from one place in a loop, so all
  // of their prints but the first use a kept frame. The prints of the next two
  // tests load the source each time: a frame with the line of `make()` is too
  // long to keep, and 65 places in rotation replace each other. The two tests
  // are serial because a debug build prints this many errors slowly.
  const longLine = `export function make() { try { throw new Error("boom"); } catch (e) { return e; } } // ${Buffer.alloc(5000, "p")}\n`;

  test.serial("prints that load the source each time do not keep it", async () => {
    using dir = tempDir("inspect-error-code-frame-loads", {
      "long-line.ts": longLine,
      // 4 MiB that the transpiler skips fast.
      "large.ts": `${longLine}/*${Buffer.alloc(4 * 1024 * 1024, "p")}*/\n`,
      // The 6 lines of a frame are 3.6 KB, a little less than a slot holds.
      "sites.ts": sitesModule(65, 520),
      "main.js":
        helpers +
        String.raw`
const { isASANEnabled } = require("bun:internal-for-testing");
// A debug or ASAN build is too slow for many prints. It prints few, from a
// source that is large enough to show one copy that leaks per print.
const slow = Bun.version.includes("debug") || isASANEnabled();
const { make } = require(slow ? "./large.ts" : "./long-line.ts");
const { sites } = require("./sites.ts");
let next = 0;
const prints = {
  tooLong: () => Bun.inspect(make()),
  // Each print replaces the frame that was kept longest.
  rotation: () => Bun.inspect(sites[next++ % sites.length]()),
};
function print(counts) {
  for (const [name, count] of Object.entries(counts)) {
    const loads = loadsIn(() => {
      for (let i = 0; i < count; i++) prints[name]();
    });
    if (loads !== count) throw new Error(name + ": " + loads + " loads in " + count + " prints");
  }
}
print(slow ? { tooLong: 10, rotation: 65 } : { tooLong: 2_000, rotation: 2_000 });
Bun.gc(true);
const before = process.memoryUsage.rss();
print(slow ? { tooLong: 25, rotation: 130 } : { tooLong: 20_000, rotation: 20_000 });
Bun.gc(true);
console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1048576 }));
`,
    });
    // What leaks per print adds up to at least 70 MiB: the 5 KB of
    // long-line.ts or the 3.6 KB of a replaced frame in a release build, the
    // 4 MiB of large.ts in a slow one.
    await expectRssDeltaBelow([`${dir}/main.js`], { release: 32, debug: 48 });
  });

  test.serial("prints that load the source each time, of one error and as deep as the stack allows", async () => {
    const { out, exitCode } = await run({
      "long-line.ts": longLine,
      "main.js":
        helpers +
        String.raw`
const { make } = require("./long-line.ts");
const out = { outlived: [] };
// An error that outlives its prints and collections.
for (let round = 0; round < 3; round++) {
  const error = make();
  out.outlived.push(
    loadsIn(() => {
      for (let i = 0; i < 10; i++) Bun.inspect(error);
    }),
  );
  Bun.gc(true);
  error.stack += "";
  Bun.gc(true);
}

// Each level of a nested error loads the source.
let deep = { a: 1 };
for (let i = 0; i < 16 * 1024; i++) {
  const error = make();
  error.object = deep;
  deep = error;
}
const deepLoads = loadsIn(() => {
  try {
    Bun.inspect(deep, { depth: Infinity });
    out.deep = "no error";
  } catch (error) {
    out.deep = error.message;
  }
});
out.deepLoadedEachLevel = deepLoads > 10;
console.log(JSON.stringify(out));
`,
    });
    expect({ out, exitCode }).toEqual({
      out: { outlived: [10, 10, 10], deep: "Maximum call stack size exceeded.", deepLoadedEachLevel: true },
      exitCode: 0,
    });
  });

  // console.warn and console.trace show no frame. A place that an earlier
  // print kept does not change that.
  test("a print that shows no frame, after a print that kept one", async () => {
    const { out, stderr, exitCode } = await run({
      "mod.ts": transpiled(),
      "external.js": prebuilt("external.js.map"),
      "external.js.map": prebuiltMap(),
      "inline.js": prebuilt(inlineURL(prebuiltMap())),
      "main.js": String.raw`
const modules = ["./mod.ts", "./external.js", "./inline.js"].map(file => require(file));
for (const { make } of modules) {
  const error = make();
  Bun.inspect(error);
  console.warn(error);
}
// console.trace() on the line of a place that is kept.
globalThis.traceFirst = true;
modules[1].make();
globalThis.traceFirst = false;
console.error("--- console.error ---");
for (const { make } of modules) console.error(make());
`,
    });
    // The trace is all that the fixture writes to stdout.
    const trace = out.stdout ?? "";
    const [warned, errored] = stderr.split("--- console.error ---\n");
    expect({
      warnings: warned.match(/\bboom\b/g)?.length,
      warned: frame(warned),
      traced: /at thrower \(.*original\.ts:4:\d+\)/.test(trace),
      trace: frame(trace),
      errored: frame(errored ?? ""),
      exitCode,
    }).toEqual({
      warnings: 3,
      warned: "",
      traced: true,
      trace: "",
      errored: [transpiledFrame(), prebuiltFrame(), prebuiltFrame()].join("\n"),
      exitCode: 0,
    });
  });

  test.each(["BUN_DISABLE_SOURCE_CODE_PREVIEW", "BUN_DISABLE_TRANSPILED_SOURCE_CODE_PREVIEW"])(
    "%s=1: a print shows no frame and counts no load",
    async flag => {
      const { out, exitCode } = await run(
        {
          "mod.ts": transpiled(),
          "external.js": prebuilt("external.js.map"),
          "external.js.map": prebuiltMap(),
          "inline.js": prebuilt(inlineURL(prebuiltMap())),
          "main.js":
            helpers +
            String.raw`
const out = {};
for (const name of ["mod.ts", "external.js", "inline.js"]) {
  const error = require("./" + name).make();
  const frames = [];
  const loads = [0, 1, 2].map(() => loadsIn(() => frames.push(frame(Bun.inspect(error)))));
  out[name] = { loads, frames };
}
console.log(JSON.stringify(out));
`,
        },
        { [flag]: "1" },
      );
      const none = { loads: [0, 0, 0], frames: ["", "", ""] };
      expect({ out, exitCode }).toEqual({
        out: { "mod.ts": none, "external.js": none, "inline.js": none },
        exitCode: 0,
      });
    },
  );

  // What the process read, whatever counts it: 50 prints read less than one
  // copy of the module's file, or of its source map.
  test.skipIf(!isLinux)("repeat prints do not read the source again", async () => {
    const { out, exitCode } = await run({
      "small.ts": padding(64) + transpiled(),
      "large.ts": padding(128) + transpiled(),
      "small.js": prebuilt("small.js.map"),
      "small.js.map": prebuiltMap("original", padding(64)),
      "large.js": prebuilt("large.js.map"),
      "large.js.map": prebuiltMap("original", padding(128)),
      "main.js": String.raw`
const fs = require("fs");
const readSoFar = () => Number(/^rchar: (\d+)$/m.exec(fs.readFileSync("/proc/self/io", "utf8"))[1]);
const out = {};
for (const name of ["small.ts", "large.ts", "small.js", "large.js"]) {
  const error = require("./" + name).make();
  Bun.inspect(error);
  const before = readSoFar();
  for (let i = 0; i < 50; i++) Bun.inspect(error);
  out[name] = readSoFar() - before < fs.statSync(name.endsWith(".js") ? name + ".map" : name).size;
}
console.log(JSON.stringify(out));
`,
    });
    expect({ out, exitCode }).toEqual({
      out: { "small.ts": true, "large.ts": true, "small.js": true, "large.js": true },
      exitCode: 0,
    });
  });
});

// The printer replaces an AggregateError with the members of its `errors`
// property. When there is nothing to walk it has to print the AggregateError
// itself. A deleted `errors` used to crash the process (the empty value was
// passed to the iteration, which read it as a cell at address 0), an accessor
// was passed to it as well, the other shapes printed nothing, and a
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
    expect(stderr).toContain("error: from the getter");
    expect(stderr).not.toContain(header);
    expect(stdout).toBe("after\n");
    expect(exitCode).toBe(0);
  });

  test("members are still printed in place of the AggregateError", async () => {
    const { stderr, exitCode } = await run([
      "-e",
      'throw new AggregateError([new Error("first member"), new TypeError("second member")], "outer message");',
    ]);
    expect(stderr).toContain("error: first member");
    expect(stderr).toContain("TypeError: second member");
    expect(stderr).not.toContain(header);
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
