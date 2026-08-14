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
            at <anonymous> ([dir]/inspect-error.test.js:86:7)"
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
            at <anonymous> ([dir]/inspect-error.test.js:114:7)"
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

describe("source map remapping of the printed stack", () => {
  // The "at ..." lines that mention one of `files`, with the directory part of
  // the path removed so the expectations are independent of the temp dir.
  function frames(text, files) {
    return text
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("at ") && files.some(file => line.includes(file)))
      .map(line => line.replace(/[^\s(]*[\\/](?=[\w.-]+:\d+:\d+)/g, ""));
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
    return { out: JSON.parse(stdout), stderr, exitCode };
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
    const { out, stderr, exitCode } = await run({
      "main.js": main.join("\n") + "\n//# sourceMappingURL=main.js.map\n",
      "main.js.map": JSON.stringify(map),
    });

    const files = ["orig.ts", "main.js"];
    expect({
      stack: frames(out.stack, files),
      inspect: frames(out.inspect, files),
      uncaught: frames(stderr, files),
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
  // not be remapped a second time.
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
    const { out, stderr, exitCode } = await run({
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
    const positions = text => frames(text, files);
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
});
