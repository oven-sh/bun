import { describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("error.cause", () => {
  const err = new Error("error 1");
  const err2 = new Error("error 2", { cause: err });
  expect(
    Bun.inspect(err2)
      .replaceAll("\\", "/")
      .replaceAll(import.meta.dir.replaceAll("\\", "/"), "[dir]"),
  ).toMatchInlineSnapshot(`
"1 | import { describe, expect, jest, test } from "bun:test";
2 | import { bunEnv, bunExe } from "harness";
3 | 
4 | test("error.cause", () => {
5 |   const err = new Error("error 1");
6 |   const err2 = new Error("error 2", { cause: err });
                       ^
error: error 2
      at <anonymous> ([dir]/inspect-error.test.js:6:20)

[cause]:
1 | import { describe, expect, jest, test } from "bun:test";
2 | import { bunEnv, bunExe } from "harness";
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
  // remove debug-only internal-builtin frames like "at require (:1:21)" or "at require (51:24)"
  str
    .split("\n")
    .filter(line => !/^\s+at .+ \(:?\d+:\d+\)$/.test(line))
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

  test.concurrent("reassigned Error.stack (V8 format) is honored by console.error", async () => {
    // After `.stack` materializes, overwrite it with another V8-format stack
    // string that mixes paren-ful, paren-less and `at async /path:l:c` frames.
    const { stderr, exitCode } = await run(
      `const e = new Error("X"); void e.stack;` +
        `e.stack = "Error: X\\n    at fn (/fake-one.js:11:22)\\n    at /fake-two.js:33:44\\n    at async /fake-three.mjs:55:66";` +
        `console.error(e);`,
    );
    expect(stderr).toContain("at fn (/fake-one.js:11:22)");
    expect(stderr).toContain("at /fake-two.js:33:44");
    expect(stderr).toContain("/fake-three.mjs:55:66");
    expect(stderr).not.toContain("async /fake-three.mjs");
    // Original creation site must not leak through.
    expect(stderr).not.toContain("[eval]:1");
    expect(exitCode).toBe(0);
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
