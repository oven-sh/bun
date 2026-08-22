import { describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, normalizeBunSnapshot, tempDir } from "harness";

test("error.cause", () => {
  const err = new Error("error 1");
  const err2 = new Error("error 2", { cause: err });
  expect(
    Bun.inspect(err2)
      .replaceAll("\\", "/")
      .replaceAll(import.meta.dir.replaceAll("\\", "/"), "[dir]"),
  ).toMatchInlineSnapshot(`
"1 | import { describe, expect, jest, test } from "bun:test";
2 | import { bunEnv, bunExe, isASAN, isDebug, normalizeBunSnapshot, tempDir } from "harness";
3 | 
4 | test("error.cause", () => {
5 |   const err = new Error("error 1");
6 |   const err2 = new Error("error 2", { cause: err });
                       ^
error: error 2
      at <anonymous> ([dir]/inspect-error.test.js:6:20)

[cause]:
1 | import { describe, expect, jest, test } from "bun:test";
2 | import { bunEnv, bunExe, isASAN, isDebug, normalizeBunSnapshot, tempDir } from "harness";
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
"31 | "
32 | \`);
33 | });
34 | 
35 | test("Error", () => {
36 |   const err = new Error("my message");
                       ^
error: my message
      at <anonymous> ([dir]/inspect-error.test.js:36:19)
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
            at <anonymous> ([dir]/inspect-error.test.js:87:7)"
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
            at <anonymous> ([dir]/inspect-error.test.js:115:7)"
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
    at <anonymous> ([file]:144:19)"
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
    return { dir: String(dir), out: JSON.parse(stdout), stderr, exitCode };
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
});

const count = (haystack, needle) => haystack.split(needle).length - 1;

// The printer prints an AggregateError and then the members of its `errors`
// property; whatever that property holds, the AggregateError itself has to be
// printed. A deleted `errors` used to crash the process (the empty value was
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
    expect(stderr).toContain(header);
    expect(stderr).toContain("error: from the getter");
    expect(stderr.indexOf("error: from the getter")).toBeGreaterThan(stderr.indexOf(header));
    expect(stdout).toBe("after\n");
    expect(exitCode).toBe(0);
  });

  test("members are printed after the AggregateError", async () => {
    const { stderr, exitCode } = await run([
      "-e",
      'throw new AggregateError([new Error("first member"), new TypeError("second member")], "outer message");',
    ]);
    expect(stderr).toContain(header);
    expect(stderr).toContain("error: first member");
    expect(stderr).toContain("TypeError: second member");
    expect(stderr.indexOf("error: first member")).toBeGreaterThan(stderr.indexOf(header));
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
    // The first load still has the members, the replayed one does not; both print the header.
    expect(count(stderr, "AggregateError: 4 errors building ")).toBe(2);
    expect(stderr).toContain('error: Expected identifier but found ")"');
    expect(stderr).toContain("across 2 files");
    expect(exitCode).toBe(1);
  });
});

async function run(code) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// https://github.com/oven-sh/bun/issues/1352
describe("#1352 native error printer", () => {
  // The expected header/message strings are built at runtime so that the
  // source-line preview the printer emits (which quotes the `-e` source)
  // cannot accidentally satisfy the assertion.
  const src = `
const m1 = new Error(["err", "one"].join("-"));
const m2 = new RangeError(["err", "two"].join("-"));
const cause = new TypeError(["the", "cause"].join("-"));
const agg = new AggregateError([m1, m2], ["agg", "msg"].join("-"), { cause });
`;
  const AGG = ["agg", "msg"].join("-");
  const M1 = ["err", "one"].join("-");
  const M2 = ["err", "two"].join("-");
  const CAUSE = ["the", "cause"].join("-");

  test.concurrent.each([
    ["console.error", `${src}; console.error(agg);`, 0],
    ["Bun.inspect", `${src}; process.stderr.write(Bun.inspect(agg));`, 0],
    ["uncaught throw", `${src}; throw agg;`, 1],
    ["unhandled rejection", `${src}; Promise.reject(agg);`, 1],
  ])("AggregateError via %s prints header, [cause] and each [errors] member", async (_, code, exit) => {
    const { stderr, exitCode } = await run(code);

    expect(stderr).toContain("AggregateError: " + AGG);
    expect(stderr).toContain("[cause]:");
    expect(stderr).toContain("TypeError: " + CAUSE);
    expect(stderr).toContain("[errors]:");
    expect(stderr).toContain("error: " + M1);
    expect(stderr).toContain("RangeError: " + M2);

    // Header must precede the [cause] label which must precede [errors].
    const hdr = stderr.indexOf("AggregateError: " + AGG);
    const causeLabel = stderr.indexOf("[cause]:");
    const errorsLabel = stderr.indexOf("[errors]:");
    expect(hdr).toBeGreaterThan(-1);
    expect(causeLabel).toBeGreaterThan(hdr);
    expect(errorsLabel).toBeGreaterThan(causeLabel);
    expect(exitCode).toBe(exit);
  });

  test.concurrent("AggregateError reached via a cause chain prints its members", async () => {
    const { stderr, exitCode } = await run(`${src}; console.error(new Error("outer", { cause: agg }));`);

    expect(stderr).toContain("[cause]:");
    expect(stderr).toContain("AggregateError: " + AGG);
    expect(stderr).toContain("[errors]:");
    expect(stderr).toContain("error: " + M1);
    expect(stderr).toContain("RangeError: " + M2);
    expect(exitCode).toBe(0);
  });

  test.concurrent("error.cause is labeled with [cause]:", async () => {
    const { stderr, exitCode } = await run(
      `const e = new Error(${JSON.stringify("outer-" + M1)}, { cause: new Error(${JSON.stringify("inner-" + M2)}) }); console.error(e);`,
    );
    const causeLabel = stderr.indexOf("[cause]:");
    expect(causeLabel).toBeGreaterThan(-1);
    expect(stderr.indexOf("error: inner-" + M2)).toBeGreaterThan(causeLabel);
    expect(stderr.indexOf("error: outer-" + M1)).toBeLessThan(causeLabel);
    expect(exitCode).toBe(0);
  });

  // After `.stack` materializes, overwrite it with another V8-format stack
  // string that mixes paren-ful, paren-less and `at async /path:l:c` frames,
  // followed by a malformed frame, at which parsing stops, and a well-formed
  // one that must therefore not be printed.
  test.concurrent.each([
    ["an unbalanced parenthesis", "at broken (/fake-four.js:77:88"],
    ["nothing after async", "at async "],
  ])("reassigned Error.stack (V8 format) is honored up to a frame with %s", async (_, malformed) => {
    const { stderr, exitCode } = await run(
      `const e = new Error("X"); void e.stack;` +
        `e.stack = "Error: X\\n    at fn (/fake-one.js:11:22)\\n    at /fake-two.js:33:44\\n    at async /fake-three.mjs:55:66` +
        `\\n    ${malformed}\\n    at fine (/fake-five.js:99:11)";` +
        `console.error(e);`,
    );
    expect(stderr).toContain("at fn (/fake-one.js:11:22)");
    expect(stderr).toContain("at /fake-two.js:33:44");
    expect(stderr).toContain("/fake-three.mjs:55:66");
    expect(stderr).not.toContain("async /fake-three.mjs");
    expect(stderr).not.toContain("fake-four");
    expect(stderr).not.toContain("fake-five");
    // Original creation site must not leak through.
    expect(stderr).not.toContain("[eval]:1");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/15859
  test.concurrent("uncaught error printed after error.stack was read keeps all the frames of error.stack", async () => {
    // Reading .stack makes the printer re-parse the formatted string; the
    // top-level frame, which has no function name, used to be dropped by that
    // parser. The imports push the TypeScript source lines away from the
    // transpiled ones so a frame remapped twice would also show up.
    using dir = tempDir("inspect-error-stack-reparse", {
      "test.ts": `import * as i1 from "util";
import * as i2 from "util";
import * as i3 from "util";
function err() {
    throw new Error()
};
function f1(){
    err()
}
function f2(){

}
try {
    f1();
} catch (error: any) {
    console.log(error.stack)
    throw error
}
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const positions = s => [...s.matchAll(/test\.ts:(\d+:\d+)/g)].map(m => m[1]);
    expect(positions(stdout)).toEqual(["5:15", "8:5", "14:5"]);
    expect(positions(stderr)).toEqual(positions(stdout));
    expect(exitCode).toBe(1);
  });

  test.concurrent("Promise.any rejection prints AggregateError header", async () => {
    const { stderr, exitCode } = await run(
      `Promise.any([Promise.reject(new Error(${JSON.stringify(M1)})), Promise.reject(new Error(${JSON.stringify(M2)}))]);`,
    );
    expect(stderr).toContain("AggregateError:");
    expect(stderr).toContain("[errors]:");
    expect(stderr).toContain("error: " + M1);
    expect(stderr).toContain("error: " + M2);
    expect(exitCode).toBe(1);
  });
});

// https://github.com/oven-sh/bun/issues/21528
test.concurrent("uncaught AggregateError output layout", async () => {
  using dir = tempDir("aggregate-error-layout", {
    "index.js": `function foo() {
  return new Error("foo!");
}
function bar() {
  return new Error("bar!");
}
throw new AggregateError([foo(), bar()], "qux!");
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(normalizeBunSnapshot(stderr.replace(/^Bun v.*$/m, ""), String(dir))).toMatchInlineSnapshot(`
    "2 |   return new Error("foo!");
    3 | }
    4 | function bar() {
    5 |   return new Error("bar!");
    6 | }
    7 | throw new AggregateError([foo(), bar()], "qux!");
                  ^
    AggregateError: qux!
          at <dir>/index.js:7:11

    [errors]:
    2 |   return new Error("foo!");
    3 | }
    4 | function bar() {
    5 |   return new Error("bar!");
    6 | }
    7 | throw new AggregateError([foo(), bar()], "qux!");
                                  ^
    error: foo!
          at <dir>/index.js:7:27

    [errors]:
    2 |   return new Error("foo!");
    3 | }
    4 | function bar() {
    5 |   return new Error("bar!");
    6 | }
    7 | throw new AggregateError([foo(), bar()], "qux!");
                                         ^
    error: bar!
          at <dir>/index.js:7:34"
  `);
  expect(exitCode).toBe(1);
});

// The printer used to walk .errors with no cycle or depth guard and without
// checking that the property still is an array, so every shape below crashed
// (or lost the aggregate's own header) on every sink that reaches it.
describe("AggregateError .errors printing is guarded", () => {
  // Messages are assembled at runtime so the -e source preview the printer
  // quotes cannot satisfy the assertions; counting a header therefore
  // measures how many times the error itself was printed.
  const SELF = ["self", "cycle"].join("-");
  const A = ["agg", "a"].join("-");
  const B = ["agg", "b"].join("-");
  const C = ["plain", "c"].join("-");

  const shapes = [
    {
      name: "errors containing the aggregate itself",
      build: `const e = new AggregateError([], ["self", "cycle"].join("-")); e.errors.push(e);`,
      check(stderr) {
        expect(count(stderr, "AggregateError: " + SELF)).toBe(1);
        expect(stderr).toContain("[errors]: [Circular]");
      },
    },
    {
      name: "two aggregates containing each other",
      build:
        `const e = new AggregateError([], ["agg", "a"].join("-"));` +
        `const b = new AggregateError([e], ["agg", "b"].join("-"));` +
        `e.errors = [b];`,
      check(stderr) {
        expect(count(stderr, "AggregateError: " + A)).toBe(1);
        expect(count(stderr, "AggregateError: " + B)).toBe(1);
        expect(stderr.indexOf("AggregateError: " + B)).toBeGreaterThan(stderr.indexOf("AggregateError: " + A));
        expect(stderr).toContain("[errors]: [Circular]");
      },
    },
    {
      name: "a member whose cause is the aggregate",
      build:
        `const c = new Error(["plain", "c"].join("-"));` +
        `const e = new AggregateError([c], ["agg", "a"].join("-"));` +
        `c.cause = e;`,
      check(stderr) {
        expect(count(stderr, "AggregateError: " + A)).toBe(1);
        expect(count(stderr, "error: " + C)).toBe(1);
        expect(stderr).toContain("[cause]: [Circular]");
      },
    },
    {
      // Promise.any([Promise.reject({ code })]) produces this shape.
      name: "a member that is a plain object",
      build: `const e = new AggregateError([{ code: ["EN", "OENT"].join("") }], ["agg", "a"].join("-"));`,
      check(stderr) {
        expect(stderr).toContain("AggregateError: " + A);
        expect(stderr).toContain("[errors]:");
        expect(stderr).toContain('code: "ENOENT"');
        expect(stderr).not.toContain("[Circular]");
      },
    },
    {
      name: "a plain-object member that refers back to the aggregate",
      build:
        `const o = { code: ["EN", "OENT"].join("") };` +
        `const e = new AggregateError([o], ["agg", "a"].join("-"));` +
        `o.parent = e;`,
      check(stderr) {
        expect(count(stderr, "AggregateError: " + A)).toBe(1);
        expect(stderr).toContain('code: "ENOENT"');
        expect(stderr).toContain("parent: [Circular]");
      },
    },
    {
      // The shapes in which `.errors` itself cannot be walked are covered by
      // "AggregateError whose errors cannot be walked" above.
      name: "an .errors element that throws when read",
      build:
        `const e = new AggregateError([new Error(["plain", "c"].join("-")), new Error("never"), new Error("never")], ["agg", "a"].join("-"));` +
        `Object.defineProperty(e.errors, 1, { get() { throw new Error("boom"); } });`,
      check(stderr) {
        expect(stderr).toContain("AggregateError: " + A);
        expect(stderr).toContain("error: " + C);
        expect(stderr).not.toContain("error: never");
        expect(stderr).toContain("... 2 more errors");
      },
    },
  ];

  describe.each([
    ["console.error", e => `console.error(${e});`, 0],
    ["uncaught throw", e => `throw ${e};`, 1],
  ])("via %s", (_, sink, expectedExitCode) => {
    test.concurrent.each(shapes)("$name", async ({ build, check }) => {
      const { stdout, stderr, exitCode } = await run(`${build} ${sink("e")}`);
      check(stderr, stdout);
      expect(exitCode).toBe(expectedExitCode);
    });
  });

  test.concurrent.each([
    [101, "... 1 more error\n"],
    [103, "... 3 more errors\n"],
  ])("prints at most 100 of %i members and counts the rest", async (length, trailer) => {
    const { stderr, exitCode } = await run(
      `const members = Array.from({ length: ${length} }, (_, i) => new Error("member" + i));` +
        `console.error(new AggregateError(members, ["agg", "a"].join("-")));`,
    );
    expect(stderr).toContain("AggregateError: " + A);
    expect(count(stderr, "[errors]:")).toBe(100);
    expect(stderr).toContain("error: member99\n");
    expect(stderr).not.toContain("error: member100\n");
    expect(stderr).toContain(trailer);
    expect(exitCode).toBe(0);
  });
});

// Nesting deeper than the native stack allows must stop printing instead of
// overflowing it. console.* and Bun.inspect report that as a RangeError; the
// uncaught-exception and unhandled-rejection reporters truncate the output.
describe("deeply nested error chains do not overflow the stack", () => {
  // A debug or ASAN build runs out of stack a few hundred levels down and
  // takes tens of microseconds to construct each error; a release build prints
  // thousands of levels (about 1500 on Linux, more on Windows, where the
  // printer's frames are smaller) and constructs the chain in about a
  // microsecond per error.
  const DEPTH = isDebug || isASAN ? 3_000 : 50_000;
  const TOP = "level" + (DEPTH - 1);
  const deepAggregate =
    `let e = new AggregateError([], "leaf");\n` +
    `for (let i = 0; i < ${DEPTH}; i++)\n` +
    `  e = new AggregateError([e], "level" + i);\n`;
  const deepCause =
    `let e = new Error("leaf");\n` +
    `for (let i = 0; i < ${DEPTH}; i++)\n` +
    `  e = new Error("level" + i, { cause: e });\n`;
  // Each printed level has one `<name>: level<n>` header; the quoted source
  // lines contain `"level"` and so do not match.
  const printedLevels = stderr => count(stderr, ": level");

  test.concurrent("AggregateError chain via console.error throws a RangeError", async () => {
    const { stdout, stderr, exitCode } = await run(
      `${deepAggregate} try { console.error(e); } catch (err) { console.log("caught", err.name); }`,
    );
    expect(stderr).toContain("AggregateError: " + TOP);
    expect(printedLevels(stderr)).toBeLessThan(DEPTH);
    expect(stdout).toBe("caught RangeError\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent.each([
    ["AggregateError chain", deepAggregate, "AggregateError: " + TOP],
    ["cause chain", deepCause, "error: " + TOP],
  ])("%s via uncaught throw", async (_, build, header) => {
    const { stderr, exitCode } = await run(`${build} throw e;`);
    expect(stderr).toContain(header);
    expect(printedLevels(stderr)).toBeLessThan(DEPTH);
    expect(exitCode).toBe(1);
  });

  test.concurrent.each([
    ["AggregateError chain", deepAggregate, "AggregateError: " + TOP],
    ["cause chain", deepCause, "error: " + TOP],
  ])("%s via unhandled rejection", async (_, build, header) => {
    const { stderr, exitCode } = await run(`${build} Promise.reject(e);`);
    expect(stderr).toContain(header);
    expect(printedLevels(stderr)).toBeLessThan(DEPTH);
    expect(exitCode).toBe(1);
  });
});
