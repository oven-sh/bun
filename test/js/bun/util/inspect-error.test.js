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

  // An empty entry in `sources` is the module that carries the map
  // (magic-string writes one when it gets no `source`). A frame from it keeps
  // the URL of that module, and only its line and column are remapped. No
  // other file is read for the code frame.
  describe("a source with no name is the module itself", () => {
    const inline = map => "//# sourceMappingURL=data:application/json;base64," + btoa(JSON.stringify(map)) + "\n";
    const code = [
      "// @bun",
      'export function thrower() { throw new Error("EMPTY"); }',
      "export function caller() { thrower(); }",
      "",
    ].join("\n");
    // One segment at column 0 of lines 2 and 3: line 2 -> 3:5, line 3 -> 21:5.
    const map = { version: 3, sources: [""], sourcesContent: [null], names: [], mappings: ";AAEI;AAkBA" };
    const withText = { ...map, sourcesContent: ["// The text in the map.\n// Line 2.\nconst fromTheMap = 3;\n"] };
    // In this map line 3 is from the second source.
    const twoSources = { ...map, sources: ["", "orig.ts"], sourcesContent: [null, null], mappings: ";AAEI;ACkBA" };

    // The code frame at 3:5, from the module and from the text in the map.
    const ofModule = [...code.split("\n", 3).map((line, i) => `${i + 1} | ${line}`), "        ^"];
    const ofMap = ["1 | // The text in the map.", "2 | // Line 2.", "3 | const fromTheMap = 3;", "        ^"];
    const codeFrame = inspected => inspected.split("\n").slice(0, 4);

    // The "at thrower" and "at caller" lines, with `dir` removed.
    const positions = (text, dir) =>
      text
        .replaceAll("\\", "/")
        .replaceAll(dir.replaceAll("\\", "/") + "/", "")
        .split("\n")
        .map(line => line.trim())
        .filter(line => /^at (thrower|caller) /.test(line));
    const frames = (thrower, caller = thrower) => [`at thrower (${thrower}:3:5)`, `at caller (${caller}:21:5)`];
    // What each reader of a frame gives for one module.
    const readers = (of, dir) => ({
      stack: positions(of.stack, dir),
      inspect: positions(of.inspect, dir),
      stackThenInspect: positions(of.stackThenInspect, dir),
      callSites: positions(of.callSites, dir),
    });
    const all = frames => ({ stack: frames, inspect: frames, stackThenInspect: frames, callSites: frames });

    // main.js: `read(caller)` reads an error of a module in each way that remaps its frames.
    const read = [
      "function read(caller) {",
      "  const thrown = () => { try { caller(); } catch (e) { return e; } };",
      "  const of = { stack: thrown().stack, inspect: Bun.inspect(thrown()) };",
      "  const stackWasRead = thrown();",
      "  stackWasRead.stack;",
      "  of.stackThenInspect = Bun.inspect(stackWasRead);",
      "  Error.prepareStackTrace = (_, sites) =>",
      "    sites.map(s => `at ${s.getFunctionName()} (${s.getFileName()}:${s.getLineNumber()}:${s.getColumnNumber()})`).join('\\n');",
      "  of.callSites = thrown().stack;",
      "  Error.prepareStackTrace = undefined;",
      "  return of;",
      "}",
    ];

    test.concurrent("in a file", async () => {
      const { dir, out, stderr, exitCode } = await run({
        "map-file.js": code,
        "map-file.js.map": JSON.stringify(map),
        "map-file-text.js": code,
        "map-file-text.js.map": JSON.stringify(withText),
        "inline.js": code + inline(map),
        "inline-text.js": code + inline(withText),
        "two-sources.js": code + inline(twoSources),
        // A map that names its own file: an empty name gives what this one gives.
        "own-name.js": code,
        "own-name.js.map": JSON.stringify({ ...map, sources: ["own-name.js"] }),
        "main.js": [
          ...read,
          "const out = {};",
          'for (const name of ["map-file", "map-file-text", "inline", "inline-text", "two-sources", "own-name"]) {',
          "  out[name] = read((await import(`./${name}.js`)).caller);",
          "}",
          "console.log(JSON.stringify(out));",
          '(await import("./map-file.js")).caller();',
        ].join("\n"),
      });
      const received = { uncaught: positions(stderr, dir) };
      for (const name in out) {
        received[name] = {
          ...readers(out[name], dir),
          codeFrame: codeFrame(out[name].inspect),
          codeFrameAfterStack: codeFrame(out[name].stackThenInspect),
        };
      }
      // Once `.stack` was read the printer does not go back to the map: the code
      // frame is then the text of the module, also where the map has the text.
      const expected = (file, codeFrame, caller = file) => ({
        ...all(frames(file, caller)),
        codeFrame,
        codeFrameAfterStack: ofModule,
      });
      expect(received).toEqual({
        "map-file": expected("map-file.js", ofModule),
        "map-file-text": expected("map-file-text.js", ofMap),
        "inline": expected("inline.js", ofModule),
        "inline-text": expected("inline-text.js", ofMap),
        "two-sources": expected("two-sources.js", ofModule, "orig.ts"),
        "own-name": expected("own-name.js", ofModule),
        uncaught: frames("map-file.js"),
      });
      expect(exitCode).toBe(1);
    });

    // On a `blob:` module and on a module of a plugin, Bun.inspect and the uncaught error used to abort the process.
    test.concurrent("in a module that has no directory", async () => {
      const { dir, out, stderr, exitCode } = await run({
        "main.js": [
          ...read,
          `const module = ${JSON.stringify(code + inline(map))};`,
          "Bun.plugin({",
          '  name: "plugin",',
          "  setup(build) {",
          '    build.module("virtual-module", () => ({ contents: module, loader: "js" }));',
          '    build.onResolve({ filter: /.*/, namespace: "virtual" }, ({ path }) => ({ path, namespace: "virtual" }));',
          '    build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: module, loader: "js" }));',
          "  },",
          "});",
          "const urls = {",
          '  blob: URL.createObjectURL(new Blob([module], { type: "text/javascript" })),',
          '  data: "data:text/javascript;base64," + Buffer.from(module).toString("base64"),',
          '  virtual: "virtual-module",',
          '  namespace: "virtual:module",',
          "};",
          "const out = { urls };",
          "for (const name in urls) out[name] = read((await import(urls[name])).caller);",
          "console.log(JSON.stringify(out));",
          "(await import(urls.blob)).caller();",
        ].join("\n"),
      });
      // Each module is shown by the URL it was imported with.
      const { urls, ...modules } = out;
      const received = { uncaught: positions(stderr.replaceAll(urls.blob, "MODULE"), dir) };
      for (const name in modules) {
        const of = modules[name];
        for (const reader in of) of[reader] = of[reader].replaceAll(urls[name], "MODULE");
        received[name] = readers(of, dir);
      }
      expect(received).toEqual({
        blob: all(frames("MODULE")),
        data: all(frames("MODULE")),
        virtual: all(frames("MODULE")),
        namespace: all(frames("MODULE")),
        uncaught: frames("MODULE"),
      });
      expect(exitCode).toBe(1);
    });

    // A plugin that rewrites a file can write such a map. The file on disk
    // is then the original source, and the code frame is read from it.
    test.concurrent("in a file that a plugin rewrote: the code frame is the file on disk", async () => {
      const onDisk = [
        "// The file on disk.",
        "export function thrower() {",
        '  throw new Error("EMPTY");',
        "}",
        "export function caller() {",
        "  thrower();",
        "}",
        "",
      ];
      const { dir, out, stderr, exitCode } = await run({
        "mod.js": onDisk.join("\n"),
        "main.js": [
          // Line 2 -> 3:3, line 3 -> 6:3.
          `const rewritten = ${JSON.stringify(code + inline({ ...map, mappings: ";AAEE;AAGA" }))};`,
          "Bun.plugin({",
          '  name: "plugin",',
          "  setup(build) {",
          '    build.onLoad({ filter: /mod\\.js$/ }, () => ({ contents: rewritten, loader: "js" }));',
          "  },",
          "});",
          'const { caller } = await import("./mod.js");',
          "try { caller(); } catch (e) { console.log(JSON.stringify(Bun.inspect(e))); }",
        ].join("\n"),
      });
      expect({ codeFrame: codeFrame(out), frames: positions(out, dir), stderr }).toEqual({
        codeFrame: [...onDisk.slice(0, 3).map((line, i) => `${i + 1} | ${line}`), "      ^"],
        frames: ["at thrower (mod.js:3:3)", "at caller (mod.js:6:3)"],
        stderr: "",
      });
      expect(exitCode).toBe(0);
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
