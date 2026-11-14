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

// JSC keeps the frames of an error until its stack is made into text: when error.stack is
// read or assigned, when structuredClone() copies the error, when a collection finds a frame
// whose function is dead. After that the printer reads the frames from the "    at ..." lines
// of that text. It prints what it prints for an error that still has its frames.
describe("frames read from the error.stack string", () => {
  const join = (...parts) => parts.join(process.platform === "win32" ? "\\" : "/");

  const withFrames = frames => {
    const error = new Error("boom");
    error.stack = ["Error: boom", ...frames.map(frame => `    at ${frame}`)].join("\n");
    return error;
  };
  const printedFrames = text =>
    text
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("at "));
  const printedLines = frames => Bun.inspect(withFrames(frames)).trimEnd().split("\n");

  // What the printer read a line as: [name, URL, line, column], or null if it prints no frame
  // for the line. The printer colors each of the four in its own way, and a line that is cut
  // at the wrong place can still print as the same text.
  const read = stack => {
    const error = new Error("boom");
    error.stack = stack;
    const printed = Bun.inspect(error, { colors: true })
      .split("\n")
      .filter(line => Bun.stripANSI(line).trimStart().startsWith("at "));
    return printed.map(line => {
      const frame = line.slice(line.indexOf("at ") + "at ".length);
      const open = frame.indexOf("\x1b[2m (\x1b[0m");
      const location =
        open === -1 ? frame : frame.slice(open + "\x1b[2m (\x1b[0m".length, frame.lastIndexOf("\x1b[2m)"));
      const position = location.search(/(\x1b\[0m\x1b\[2m:)?\x1b\[0m\x1b\[33m/);
      const [lineNumber, column] = Array.from(location.matchAll(/\x1b\[33m(\d+)/g), match => Number(match[1]));
      return [
        open === -1 ? "" : Bun.stripANSI(frame.slice(0, open)),
        Bun.stripANSI(position === -1 ? location : location.slice(0, position)),
        lineNumber,
        column,
      ].filter(field => field !== undefined);
    });
  };
  // The line is between two others, so it also shows if it ends the stack.
  const readBetween = frame =>
    read(withFrames(["first (/fake/first.js:1:1)", frame, "last (/fake/last.js:9:9)"]).stack);

  describe.each([
    {
      name: "a name and a location",
      frames: {
        "thrower (/fake/lib.mjs:2:13)": ["thrower", "/fake/lib.mjs", 2, 13],
        "async load (/fake/main.mjs:4:3)": ["async load", "/fake/main.mjs", 4, 3],
        "new Loader (/fake/main.mjs:4:3)": ["new Loader", "/fake/main.mjs", 4, 3],
        "<anonymous> (/fake/main.cjs:1:2)": ["<anonymous>", "/fake/main.cjs", 1, 2],
        "async <anonymous> (/fake/main.cjs:1:2)": ["async <anonymous>", "/fake/main.cjs", 1, 2],
        "Object.<anonymous> (/fake/main.cjs:1:2)": ["Object.<anonymous>", "/fake/main.cjs", 1, 2],
        "Loader.load [as run] (/fake/lib.js:1:2)": ["Loader.load [as run]", "/fake/lib.js", 1, 2],
        // A stack has "native" or "unknown" for a frame with no URL.
        "map (native:17:41)": ["map", "", 17, 41],
        "run (unknown:3:4)": ["run", "", 3, 4],
        "global code (/fake/main.js:12:1)": ["", "/fake/main.js", 12, 1],
        " (/fake/lib.js:3:4)": ["", "/fake/lib.js", 3, 4],
      },
    },
    {
      name: "a location alone: module-level code",
      frames: {
        "/fake/lib.mjs:4:1": ["", "/fake/lib.mjs", 4, 1],
        "file:///fake/lib.mjs:4:1": ["", "file:///fake/lib.mjs", 4, 1],
        "async file:///fake/main.mjs:3:7": ["", "file:///fake/main.mjs", 3, 7],
        "node:internal/main/run_main_module:36:49": ["", "node:internal/main/run_main_module", 36, 49],
        "C:\\Users\\me\\app\\index.js:1:2": ["", "C:\\Users\\me\\app\\index.js", 1, 2],
      },
    },
    {
      name: "no line, or no column: none is made up",
      frames: {
        "second (node:child_process)": ["second", "node:child_process"],
        "third (/fake/lib.js:7)": ["third", "/fake/lib.js", 7],
        "/fake/main.mjs:7": ["", "/fake/main.mjs", 7],
        "/fake/main.mjs": ["", "/fake/main.mjs"],
        "new Promise (<anonymous>)": ["new Promise", "<anonymous>"],
        "async Promise.all (index 0)": ["async Promise.all", "index 0"],
        "<parse> (/fake/bad.js:3)": ["<parse>", "/fake/bad.js", 3],
        "<parse> (:4)": ["<parse>", "", 4],
      },
    },
    {
      // JSC's frames do not list a call into native code, so the printer does not print one for an error that has them.
      name: "a native call, which has no line, is not a frame",
      frames: {
        "unknown": null,
        "native": null,
        "first (native)": null,
        "parse (unknown)": null,
        "<parse> (:0)": null,
        "empty ()": null,
        "": null,
      },
    },
    {
      name: "parentheses in the location",
      frames: {
        "vm:module(0):1:2": ["", "vm:module(0)", 1, 2],
        "/fake/app/(group)/page.ts:7:10": ["", "/fake/app/(group)/page.ts", 7, 10],
        "named (vm:module(0):8:9)": ["named", "vm:module(0)", 8, 9],
        "named (/fake/module(0).js:6:7)": ["named", "/fake/module(0).js", 6, 7],
        "render (/fake/app/(group)/page.js:5:3)": ["render", "/fake/app/(group)/page.js", 5, 3],
        "render (/fake/to (copy)/page.js:5:3)": ["render", "/fake/to (copy)/page.js", 5, 3],
        "C:\\Program Files (x86)\\app\\index.js:1:2": ["", "C:\\Program Files (x86)\\app\\index.js", 1, 2],
        "main (C:\\Program Files (x86)\\app\\index.js:3:4)": ["main", "C:\\Program Files (x86)\\app\\index.js", 3, 4],
        "vm:module(0)": ["", "vm:module(0)"],
        "/fake/app/(group)": ["", "/fake/app/(group)"],
        "named (vm:module(0))": ["named", "vm:module(0)"],
        "named (/fake/app/(group))": ["named", "/fake/app/(group)"],
      },
    },
    {
      name: "parentheses in the name",
      frames: {
        "method (with parens) (/fake/lib.js:2:3)": ["method (with parens)", "/fake/lib.js", 2, 3],
        "Object.a (b) (/fake/to (copy)/lib.js:4:5)": ["Object.a (b)", "/fake/to (copy)/lib.js", 4, 5],
        "eval (eval at run (/fake/lib.js:1:2), <anonymous>:3:4)": [
          "eval",
          "eval at run (/fake/lib.js:1:2), <anonymous>",
          3,
          4,
        ],
      },
    },
    {
      name: "parentheses that do not balance: the first ` (` opens the location",
      frames: {
        "render (/fake/half(open/lib.js:1:7)": ["render", "/fake/half(open/lib.js", 1, 7],
        "render (/fake/half)shut/lib.js:1:7)": ["render", "/fake/half)shut/lib.js", 1, 7],
        "half(open (/fake/lib.js:1:7)": ["half(open", "/fake/lib.js", 1, 7],
      },
    },
    {
      name: "colons and digits in the URL that are not a position",
      frames: {
        "load (http://localhost:3000/app.js)": ["load", "http://localhost:3000/app.js"],
        "http://localhost:3000/app.js:10:5": ["", "http://localhost:3000/app.js", 10, 5],
        "worker (blob:9f86d081-884c-4d65-a2f4-1a2b3c4d5e6f)": ["worker", "blob:9f86d081-884c-4d65-a2f4-1a2b3c4d5e6f"],
        "wasm://wasm/0a1b2c3d:wasm-function[3]:0x1a": ["", "wasm://wasm/0a1b2c3d:wasm-function[3]:0x1a"],
        "odd (/fake/lib.js:7abc)": ["odd", "/fake/lib.js:7abc"],
        "odd (/fake/lib.js:+7:2)": ["odd", "/fake/lib.js:+7", 2],
        "odd (/fake/lib.js:1:)": ["odd", "/fake/lib.js:1:"],
        "odd (/fake/lib.js::1)": ["odd", "/fake/lib.js:", 1],
      },
    },
    {
      // A line and a column count from 1.
      name: "a 0, or a number that is too large, is no line or no column",
      frames: {
        "zero (/fake/lib.js:2:0)": ["zero", "/fake/lib.js", 2],
        "zero (/fake/lib.js:0:5)": ["zero", "/fake/lib.js"],
        "zero (/fake/lib.js:0)": ["zero", "/fake/lib.js"],
        "large (/fake/lib.js:2147483647:2147483647)": ["large", "/fake/lib.js", 2147483647, 2147483647],
        "large (/fake/lib.js:1:2147483648)": ["large", "/fake/lib.js", 1],
        "large (/fake/lib.js:2147483648:1)": ["large", "/fake/lib.js"],
      },
    },
    {
      name: "a line that is not `name (location)` is a location",
      frames: {
        "method(/fake/lib.js:1:2)": ["", "method(/fake/lib.js:1:2)"],
        "(/fake/lib.js:1:2)": ["", "(/fake/lib.js:1:2)"],
        "name (/fake/lib.js:1:2) and more": ["", "name (/fake/lib.js:1:2) and more"],
        "a) (b": ["", "a) (b"],
        "()": ["", "()"],
        ")": ["", ")"],
        "(": ["", "("],
        ":": ["", ":"],
      },
    },
    {
      name: "text that is not ASCII",
      frames: {
        "café (/fake/café (copie)/(groupe)/página.js:2:3)": ["café", "/fake/café (copie)/(groupe)/página.js", 2, 3],
        "描画 (/fake/プロジェクト (コピー)/(グループ)/ページ.ts:7:10)": [
          "描画",
          "/fake/プロジェクト (コピー)/(グループ)/ページ.ts",
          7,
          10,
        ],
        "/fake/プロジェクト/(グループ)/ページ.ts:7:10": ["", "/fake/プロジェクト/(グループ)/ページ.ts", 7, 10],
      },
    },
  ])("$name", ({ frames }) => {
    test.each(Object.entries(frames))("%j", (frame, fields) => {
      expect(readBetween(frame)).toEqual([
        ["first", "/fake/first.js", 1, 1],
        ...(fields ? [fields] : []),
        ["last", "/fake/last.js", 9, 9],
      ]);
    });
  });

  test("every frame of a stack is read, whatever comes before it", () => {
    const frames = [
      "thrower (/fake/lib.mjs:2:13)",
      "/fake/lib.mjs:4:1",
      "unknown",
      "load (/fake/main.mjs:4:3)",
      "async file:///fake/main.mjs:7:1",
      "",
      "node:internal/main/run_main_module:36:49",
    ];
    expect(read(withFrames(frames).stack)).toEqual([
      ["thrower", "/fake/lib.mjs", 2, 13],
      ["", "/fake/lib.mjs", 4, 1],
      ["load", "/fake/main.mjs", 4, 3],
      ["", "file:///fake/main.mjs", 7, 1],
      ["", "node:internal/main/run_main_module", 36, 49],
    ]);
  });

  test("CRLF line endings", () => {
    expect(read("Error: boom\r\n    at thrower (/fake/lib.mjs:2:13)\r\n    at /fake/lib.mjs:4:1\r\n")).toEqual([
      ["thrower", "/fake/lib.mjs", 2, 13],
      ["", "/fake/lib.mjs", 4, 1],
    ]);
  });

  test("a frame line starts with four spaces and `at `", () => {
    expect(
      read(
        "at first (/fake/lib.js:1:1)\n\tat second (/fake/lib.js:2:2)\n  at third (/fake/lib.js:3:3)\n    at fourth (/fake/lib.js:4:4)",
      ),
    ).toEqual([["fourth", "/fake/lib.js", 4, 4]]);
  });

  test("a stack with more frames than the printer holds", () => {
    const frames = Array.from({ length: 40 }, (_, i) => `/fake/lib.mjs:${i + 1}:1`);
    expect(printedFrames(Bun.inspect(withFrames(frames)))).toEqual(frames.slice(0, 32).map(frame => `at ${frame}`));
  });

  // bun does not print these frames for an error that has its frames.
  test("the frames of the tick queue are hidden", () => {
    expect(
      read(withFrames(["callback (/fake/main.mjs:2:3)", "unknown", "processTicksAndRejections (native:7:39)"]).stack),
    ).toEqual([["callback", "/fake/main.mjs", 2, 3]]);
  });

  describe("source preview", () => {
    const files = {
      app: { "(group)": { "page.js": "// line 1\n// line 2\nconst page = 3;\n" } },
      "to (copy)": { "lib.js": "// line 1\nconst lib = 2;\n" },
      "half(open": { "lib.js": "const half = 1;\n" },
      "plain.js": "const plain = 1;\n",
    };

    test("is of the file that a location or a name with parentheses is for", () => {
      using dir = tempDir("inspect-error-stack-string", files);
      const page = join(String(dir), "app", "(group)", "page.js");
      const lib = join(String(dir), "to (copy)", "lib.js");
      const half = join(String(dir), "half(open", "lib.js");
      const plain = join(String(dir), "plain.js");
      expect({
        location: printedLines([`render (${page}:3:7)`]),
        locationOnly: printedLines([`${page}:3:7`]),
        locationWithSpace: printedLines([`render (${lib}:2:7)`]),
        locationNotBalanced: printedLines([`render (${half}:1:7)`]),
        name: printedLines([`method (with parens) (${plain}:1:7)`]),
      }).toEqual({
        location: [
          "1 | // line 1",
          "2 | // line 2",
          "3 | const page = 3;",
          "          ^",
          "error: boom",
          `      at render (${page}:3:7)`,
        ],
        locationOnly: [
          "1 | // line 1",
          "2 | // line 2",
          "3 | const page = 3;",
          "          ^",
          "error: boom",
          `      at ${page}:3:7`,
        ],
        locationWithSpace: [
          "1 | // line 1",
          "2 | const lib = 2;",
          "          ^",
          "error: boom",
          `      at render (${lib}:2:7)`,
        ],
        locationNotBalanced: ["1 | const half = 1;", "          ^", "error: boom", `      at render (${half}:1:7)`],
        name: ["1 | const plain = 1;", "          ^", "error: boom", `      at method (with parens) (${plain}:1:7)`],
      });
    });

    test("is of the first frame that has a line, with a caret if it has a column", () => {
      using dir = tempDir("inspect-error-stack-string", files);
      const lib = join(String(dir), "to (copy)", "lib.js");
      expect({
        noLine: printedLines([`first (${lib})`]),
        lineOnly: printedLines([`first (${lib}:2)`]),
        thirdFrame: printedLines(["first (native)", lib, `third (${lib}:2:7)`]),
      }).toEqual({
        noLine: ["error: boom", `      at first (${lib})`],
        lineOnly: ["1 | // line 1", "2 | const lib = 2;", "", "error: boom", `      at first (${lib}:2)`],
        thirdFrame: [
          "1 | // line 1",
          "2 | const lib = 2;",
          "          ^",
          "error: boom",
          `      at ${lib}`,
          `      at third (${lib}:2:7)`,
        ],
      });
    });

    // In front of a caret the printer writes a space for each column.
    test.each([
      // "1 | const plain = 1;"
      [16, "                   ^"],
      [17, "                    ^"],
      [18, ""],
      [2147483647, ""],
    ])("has a caret for column %d only if it is under the line or right after it", (column, caret) => {
      using dir = tempDir("inspect-error-stack-string", files);
      const plain = join(String(dir), "plain.js");
      expect({
        name: printedLines([`render (${plain}:1:${column})`]),
        location: printedLines([`${plain}:1:${column}`]),
      }).toEqual({
        name: ["1 | const plain = 1;", caret, "error: boom", `      at render (${plain}:1:${column})`],
        location: ["1 | const plain = 1;", caret, "error: boom", `      at ${plain}:1:${column}`],
      });
    });
  });

  describe.concurrent("in a program", () => {
    const run = async (files, args, env = {}) => {
      using dir = tempDir("inspect-error-stack-string", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        cwd: String(dir),
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const junit = Bun.file(join(String(dir), "junit.xml"));
      return { dir: String(dir), stdout, stderr, exitCode, junit: (await junit.exists()) ? await junit.text() : "" };
    };

    // Each flow prints an error, makes its stack into text, and prints the error again.
    const print = `
      const before = {};
      const after = {};
      function print(name, error, makeText = error => void error.stack) {
        before[name] = Bun.inspect(error);
        makeText(error);
        after[name] = Bun.inspect(error);
      }
      function inFunction(name, makeText) {
        print(name, new Error("boom"), makeText);
      }
    `;
    const flows = {
      "flows.mjs": `
        import { readFileSync } from "node:fs";
        ${print}
        const tick = () => new Promise(resolve => process.nextTick(resolve));

        print("module", new Error("boom"));
        inFunction("function");
        (function () {
          print("anonymous function", new Error("boom"));
        })();
        new (class Thrower {
          constructor() {
            print("constructor", new Error("boom"));
          }
        })();
        ({
          get value() {
            print("getter", new Error("boom"));
          },
        }).value;
        [0].map(function each() {
          print("array callback", new Error("boom"));
        });
        try {
          JSON.parse("{");
        } catch (error) {
          print("JSON.parse", error);
        }
        try {
          readFileSync("does-not-exist");
        } catch (error) {
          print("fs.readFileSync", error);
        }
        try {
          null.property;
        } catch (error) {
          print("TypeError", error);
        }
        inFunction("structuredClone of the error", error => void structuredClone(error));
        // A collection makes the text when the function of a frame is dead.
        let collected;
        (function inDeadFunction() {
          collected = new Error("boom");
        })();
        print("a collection", collected, () => Bun.gc(true));
        (function inFunction() {
          const original = new Error("boom");
          before["the clone that structuredClone makes"] = Bun.inspect(original);
          after["the clone that structuredClone makes"] = Bun.inspect(structuredClone(original));
        })();

        await tick();
        print("module after a tick", new Error("boom"));
        inFunction("function after a tick");
        await (async function asyncFunction() {
          await tick();
          print("async function after a tick", new Error("boom"));
        })();
        await new Promise(resolve =>
          process.nextTick(function callback() {
            print("tick callback", new Error("boom"));
            resolve();
          }),
        );
        await new Promise(resolve =>
          setTimeout(function callback() {
            print("timer callback", new Error("boom"));
            resolve();
          }, 0),
        );
        await Promise.resolve().then(function reaction() {
          print("promise reaction", new Error("boom"));
        });
        async function inner() {
          await tick();
          throw new Error("boom");
        }
        async function outer() {
          await inner();
        }
        await (async () => {
          await outer();
        })().catch(error => print("async callers", error));

        Error.prepareStackTrace = (error, sites) => error + sites.map(site => "\\n    at " + site).join("");
        inFunction("Error.prepareStackTrace");
        Error.prepareStackTrace = undefined;

        print("eval", (0, eval)("new Error('boom')"));
        console.log(JSON.stringify({ before, after }));
      `,
      "flows.cjs": `
        ${print}
        print("module", new Error("boom"));
        inFunction("function");
        (function () {
          print("anonymous function", new Error("boom"));
        })();
        process.nextTick(function callback() {
          print("tick callback", new Error("boom"));
          setTimeout(function callback() {
            print("timer callback", new Error("boom"));
            console.log(JSON.stringify({ before, after }));
          }, 0);
        });
      `,
      "flows.test.js": `
        import { expect, test } from "bun:test";
        ${print}
        test("flows", async () => {
          print("test", new Error("boom"));
          inFunction("function");
          await new Promise(resolve => process.nextTick(resolve));
          print("test after a tick", new Error("boom"));
          try {
            expect(1).toBe(2);
          } catch (error) {
            print("expect", error);
          }
          console.log(JSON.stringify({ before, after }));
        });
      `,
    };

    test.each([
      // A stack that eval() wrote has another name and column for its frame than the frame has.
      { args: ["flows.mjs"], flows: 21, different: ["eval"] },
      { args: ["flows.cjs"], flows: 5, different: [] },
      { args: ["test", "flows.test.js"], flows: 4, different: [] },
    ])(
      "an error prints the same before and after its stack is made into text: bun $args",
      async ({ args, flows: count, different }) => {
        const { stdout, exitCode } = await run(flows, args);
        const { before, after } = JSON.parse(stdout.trimEnd().split("\n").at(-1));
        const names = Object.keys(before);
        expect({
          flows: names.length,
          different: names.filter(name => after[name] !== before[name]),
          after: Object.fromEntries(names.filter(name => !different.includes(name)).map(name => [name, after[name]])),
        }).toEqual({
          flows: count,
          different,
          after: Object.fromEntries(names.filter(name => !different.includes(name)).map(name => [name, before[name]])),
        });
        expect(exitCode).toBe(0);
      },
    );

    // https://github.com/oven-sh/bun/issues/18357
    test("an error that structuredClone() copied keeps its frames", async () => {
      const { dir, stdout, stderr, exitCode } = await run(
        {
          "repro-error-clone.ts": [
            "function okay() {",
            '  const error = new Error("OKAY");',
            "  console.error(error);",
            "}",
            "",
            "function broken() {",
            '  const error = new Error("BROKEN");',
            "  structuredClone(error);",
            "  console.error(error);",
            "}",
            "",
            "function main() {",
            "  okay();",
            "  broken();",
            "}",
            "",
            "main();",
            "",
          ].join("\n"),
        },
        ["repro-error-clone.ts"],
      );
      // The line of each frame. The column of `new Error` is another one in a stack than in a frame.
      const frames = printedFrames(stderr.replaceAll("\\", "/").replaceAll(dir.replaceAll("\\", "/") + "/", "")).map(
        frame => frame.replace(/:\d+(\)?)$/, "$1"),
      );
      expect({ stdout, frames }).toEqual({
        stdout: "",
        frames: [
          "at okay (repro-error-clone.ts:2)",
          "at main (repro-error-clone.ts:13)",
          "at repro-error-clone.ts:17",
          "at broken (repro-error-clone.ts:7)",
          "at main (repro-error-clone.ts:14)",
          "at repro-error-clone.ts:17",
        ],
      });
      expect(exitCode).toBe(0);
    });

    test("error.stack, Bun.inspect and the uncaught error have the frames of a module that require() loads", async () => {
      // require() puts the module-level frame of lib.mjs in the middle of the stack, with
      // load() and the module-level frame of main.mjs below it.
      const { dir, stdout, stderr, exitCode } = await run(
        {
          "lib.mjs": ["function thrower() {", '  throw new Error("boom");', "}", "thrower();", ""].join("\n"),
          "main.mjs": [
            'import { createRequire } from "node:module";',
            "const require = createRequire(import.meta.url);",
            "function load() {",
            '  require("./lib.mjs");',
            "}",
            "try {",
            "  load();",
            "} catch (e) {",
            "  console.log(JSON.stringify({ stack: e.stack, inspect: Bun.inspect(e) }));",
            "  throw e;",
            "}",
            "",
          ].join("\n"),
        },
        ["main.mjs"],
      );
      const { stack, inspect } = JSON.parse(stdout);

      // The frames of require() itself are between lib.mjs and load(). A debug build has more of them.
      const prefix = dir.replaceAll("\\", "/") + "/";
      const ownFrames = text =>
        printedFrames(text.replaceAll("\\", "/").replaceAll(prefix, "")).filter(line => line.includes(".mjs"));
      const own = ownFrames(stack);
      expect(own).toEqual([
        expect.stringMatching(/^at thrower \(lib\.mjs:2:\d+\)$/),
        "at lib.mjs:4:1",
        expect.stringMatching(/^at load \(main\.mjs:4:\d+\)$/),
        expect.stringMatching(/^at main\.mjs:7:\d+$/),
      ]);
      expect({ inspect: ownFrames(inspect), uncaught: ownFrames(stderr) }).toEqual({ inspect: own, uncaught: own });
      expect(exitCode).toBe(1);
    });

    // JSC makes the stack of a SyntaxError into text when the parser makes the error. Its first frame has a line and no column.
    test("a SyntaxError of the parser has a frame with a line and no column", async () => {
      const { dir, stdout, stderr, exitCode } = await run(
        {
          "bad.cjs": '// line 1\n"".match(/[a-0]/);\n',
          "main.cjs": 'try {\n  require("./bad.cjs");\n} catch (error) {\n  console.log(Bun.inspect(error));\n}\n',
        },
        ["main.cjs"],
      );
      expect({
        stderr,
        printed: stdout.replaceAll(dir, "<dir>").replaceAll("\\", "/").split("\n").slice(0, 5),
      }).toEqual({
        stderr: "",
        printed: [
          "1 | // line 1",
          '2 | "".match(/[a-0]/);',
          "",
          "SyntaxError: Invalid regular expression: range out of order in character class",
          "      at <parse> (<dir>/bad.cjs:2)",
        ],
      });
      expect(exitCode).toBe(0);
    });

    // The GitHub Actions annotation is for the first frame.
    test.each([
      {
        name: "has the position of a first frame that has one",
        frames: ["first (/fake/app/(group)/page.js:3:4)", "second (node:child_process)"],
        annotation: /^::error file=(.*[\\/])?app[\\/]\(group\)[\\/]page\.js,line=3,col=4,title=error: boom::/,
      },
      {
        name: "has no column for a first frame that has only a line",
        frames: ["first (/fake/lib.js:7)", "second (node:child_process)"],
        annotation: /^::error file=(.*[\\/])?lib\.js,line=7,title=error: boom::/,
      },
      {
        name: "has no file for a first frame that has no line",
        frames: ["first (node:child_process)", "second (/fake/lib.js:3:4)"],
        annotation: /^::error title=error: boom::/,
      },
    ])("the annotation of an uncaught error $name", async ({ frames, annotation }) => {
      const { stdout, stderr, exitCode } = await run(
        {},
        [
          "-e",
          `const error = new Error("boom"); error.stack = ${JSON.stringify(withFrames(frames).stack)}; throw error;`,
        ],
        { GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: "/fake" },
      );
      expect({
        stdout,
        frames: printedFrames(stderr),
        annotation: stderr.split("\n").find(line => line.startsWith("::error ")),
      }).toEqual({
        stdout: "",
        frames: frames.map(frame => `at ${frame}`),
        annotation: expect.stringMatching(annotation),
      });
      expect(exitCode).toBe(1);
    });

    test("the body of a JUnit failure has the frames", async () => {
      const frames = [
        "first (native)",
        "second (node:child_process)",
        "third (file:///fake/lib.js:7)",
        "vm:module(0):7:10",
      ];
      const { junit, exitCode } = await run(
        {
          "fails.test.js": `
            import { test } from "bun:test";
            test("fails", async () => {
              await 1;
              const error = new Error("boom");
              error.stack = ${JSON.stringify(withFrames(frames).stack)};
              throw error;
            });
          `,
        },
        ["test", "--reporter=junit", "--reporter-outfile=junit.xml", "fails.test.js"],
      );
      const body = /<failure[^>]*>([^]*?)<\/failure>/.exec(junit)?.[1] ?? "";
      expect(printedFrames(body.replaceAll("&#10;", "\n"))).toEqual([
        "at second (node:child_process)",
        "at third (file:///fake/lib.js:7)",
        "at vm:module(0):7:10",
      ]);
      expect(exitCode).toBe(1);
    });

    test("the development error page of Bun.serve has -1 for a line or a column that a frame does not have", async () => {
      const frames = [
        "first (native)",
        "second (http://localhost:3000/app.js)",
        "third (file:///fake/lib.js:7)",
        "vm:module(0):7:10",
      ];
      const { stdout, exitCode } = await run(
        {
          "server.js": `
            const server = Bun.serve({
              port: 0,
              hostname: "127.0.0.1",
              development: true,
              fetch() {
                const error = new Error("boom");
                error.stack = ${JSON.stringify(withFrames(frames).stack)};
                throw error;
              },
            });
            const html = await (await fetch(server.url)).text();
            const payload = JSON.parse(/<script id="__bunfallback" type="application\\/json">([^<]*)<\\/script>/.exec(html)[1]);
            console.log(JSON.stringify(payload.problems.exceptions[0].stack.frames));
            server.stop(true);
            // The error of the handler was reported as an unhandled rejection, which sets the exit code.
            process.exit(0);
          `,
        },
        ["server.js"],
      );
      expect(JSON.parse(stdout.trimEnd().split("\n").at(-1))).toMatchObject([
        { function_name: "second", file: "http://localhost:3000/app.js", position: { line: -1, column: -1 } },
        { function_name: "third", file: "file:///fake/lib.js", position: { line: 7, column: -1 } },
        { function_name: "", file: "vm:module(0)", position: { line: 7, column: 10 } },
      ]);
      expect(exitCode).toBe(0);
    });
  });
});
