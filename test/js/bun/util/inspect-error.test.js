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

// An Error-valued `cause` is printed after the error that holds it, once,
// for a `cause` that was assigned and for a `cause` from the constructor.
describe.concurrent("an assigned cause", () => {
  const assigned = n =>
    `let e = new Error("leaf"); for (let i = 0; i < ${n}; i++) { const x = new Error("l" + i); x.cause = e; e = x; }`;
  const constructed = n =>
    `let e = new Error("leaf"); for (let i = 0; i < ${n}; i++) { e = new Error("l" + i, { cause: e }); }`;

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
  // What the printer writes, without the source previews and the stack frames.
  const text = output =>
    output.split("\n").filter(line => !/^\s*\d+ \| /.test(line) && !/^\s*\^\s*$/.test(line) && !/^\s+at /.test(line));
  const renders = output =>
    output
      .split("\n")
      .filter(line => /^\s*(error: |AggregateError: |\[Error \.\.\.\]|\[Circular\])/.test(line))
      .map(line => line.trim());
  const chain = n => [...Array.from({ length: n }, (_, i) => "error: l" + (n - 1 - i)), "error: leaf"];

  test("Bun.inspect renders each error of the chain once", async () => {
    const { stdout, exitCode } = await run(
      [3, 6, 10]
        .map(n => `{ ${assigned(n)} console.log("chain of " + ${n}); console.log(Bun.inspect(e, { depth: 100 })); }`)
        .join("\n"),
    );
    const seen = {};
    let current;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("chain of ")) seen[line] = current = [];
      else current?.push(...renders(line));
    }
    expect({ seen, exitCode }).toEqual({
      seen: { "chain of 3": chain(3), "chain of 6": chain(6), "chain of 10": chain(10) },
      exitCode: 0,
    });
  });

  test.each(["throw e;", "Promise.reject(e);", "reportError(e);"])(
    "a chain of 2000 ends at the depth cap: %s",
    async statement => {
      const { stdout, stderr, exitCode, signalCode } = await run(`${assigned(2000)} ${statement}`);
      expect({ renders: renders(stderr), stdout, exitCode, signalCode }).toEqual({
        renders: [...chain(2000).slice(0, 9), "[Error ...]"],
        stdout: "",
        exitCode: 1,
        signalCode: null,
      });
    },
  );

  test("throw prints the same text as for a cause from the constructor", async () => {
    const [a, c] = await Promise.all([run(`${assigned(12)} throw e;`), run(`${constructed(12)} throw e;`)]);
    expect({ text: text(a.stderr), renders: renders(a.stderr), exitCode: a.exitCode }).toEqual({
      text: text(c.stderr),
      renders: [...chain(12).slice(0, 9), "[Error ...]"],
      exitCode: 1,
    });
  });

  test("console.log and Bun.inspect print the same text as for a cause from the constructor", async () => {
    const { stdout, exitCode } = await run(`
      const values = {
        assigned: (() => { ${assigned(4)} return e; })(),
        constructed: (() => { ${constructed(4)} return e; })(),
      };
      for (const [name, value] of Object.entries(values)) {
        console.log("console.log: " + name);
        console.log(value);
        console.log("Bun.inspect: " + name);
        console.log(Bun.inspect(value));
      }
      console.log("end");`);
    const seen = {};
    let current;
    for (const line of text(stdout)) {
      if (/^(console\.log|Bun\.inspect): /.test(line)) seen[line] = current = [];
      else if (line === "end") break;
      else current?.push(line);
    }
    expect({
      "console.log": seen["console.log: assigned"],
      "Bun.inspect": seen["Bun.inspect: assigned"],
      "console.log renders": renders(seen["console.log: assigned"].join("\n")),
      "Bun.inspect renders": renders(seen["Bun.inspect: assigned"].join("\n")),
      exitCode,
    }).toEqual({
      "console.log": seen["console.log: constructed"],
      "Bun.inspect": seen["Bun.inspect: constructed"],
      "console.log renders": ["error: l3", "error: l2", "error: l1", "[Error ...]"],
      "Bun.inspect renders": chain(4),
      exitCode: 0,
    });
  });

  // node:test assigns the failure of a subtest as `cause` at each level of t.test().
  test("bun test prints the failure of a node:test subtest four levels deep once", async () => {
    using dir = tempDir("assigned-cause-node-test", {
      "nested.test.js": `
        const { test } = require("node:test");
        const assert = require("node:assert");
        // Built at runtime so that the message is not in the source preview.
        const message = ["the", "root", "failure"].join(" ");
        test("level 1", async t => {
          await t.test("level 2", async t => {
            await t.test("level 3", async t => {
              await t.test("level 4", async () => {
                assert.strictEqual(1, 2, message);
              });
            });
          });
        });`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./nested.test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      renders: stderr.split("\n").filter(line => line.startsWith("AssertionError: ")),
      exitCode,
    }).toEqual({
      renders: ["AssertionError: the root failure"],
      exitCode: 1,
    });
  });

  test("a cycle of assigned causes ends with [Circular]", async () => {
    const { stderr, exitCode, signalCode } = await run(`
      const [a, b, c, d] = ["a", "b", "c", "d"].map(name => new Error(name));
      a.cause = b;
      b.cause = c;
      c.cause = d;
      d.cause = c;
      throw a;`);
    expect({ renders: renders(stderr), exitCode, signalCode }).toEqual({
      renders: ["error: a", "error: b", "error: c", "error: d", "[Circular]"],
      exitCode: 1,
      signalCode: null,
    });
  });

  // Only an Error-valued `cause` goes to the queue from a nested error. The
  // queue prints no members of an AggregateError, so that value stays in place.
  test("a nested error keeps its other values in its property list", async () => {
    const shapes = {
      "an Error-valued property that is not the cause": `
        const mid = new Error("mid");
        mid.other = new Error("other");
        throw new Error("top", { cause: mid });`,
      "a cause that is an AggregateError": `
        const mid = new Error("mid");
        mid.cause = new AggregateError([new Error("member")], "agg");
        throw new Error("top", { cause: mid });`,
    };
    const names = Object.keys(shapes);
    const results = await Promise.all(names.map(name => run(shapes[name])));
    const seen = Object.fromEntries(
      names.map((name, i) => [
        name,
        {
          renders: renders(results[i].stderr),
          inPlace: results[i].stderr.split("\n").filter(line => /^ (other|cause): /.test(line)).length,
          exitCode: results[i].exitCode,
        },
      ]),
    );
    expect(seen).toEqual({
      "an Error-valued property that is not the cause": {
        renders: ["error: top", "error: mid", "error: other"],
        inPlace: 1,
        exitCode: 1,
      },
      "a cause that is an AggregateError": {
        renders: ["error: top", "error: mid", "error: member", "AggregateError: agg"],
        inPlace: 1,
        exitCode: 1,
      },
    });
  });
});
