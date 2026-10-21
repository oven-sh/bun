import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { parse, urlToHttpOptions } from "url";

describe("Url.prototype.parse", () => {
  it("parses URL correctly", () => {
    const url = parse("https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");

    expect(url.hash).toEqual("#qat");
    expect(url.host).toEqual("baz.qat:8000");
    expect(url.hostname).toEqual("baz.qat");
    expect(url.href).toEqual("https://foo:bar@baz.qat:8000/qux/quux?foo=bar&baz=12#qat");
    expect(url.pathname).toEqual("/qux/quux");
    expect(url.port).toEqual("8000");
    expect(url.protocol).toEqual("https:");
    expect(url.search).toEqual("?foo=bar&baz=12");
  });

  it("accepts empty host", () => {
    expect(() => parse("http://")).not.toThrow();
  });

  it("accepts ipv6 host", () => {
    expect(parse("http://[::1]")).toEqual({
      protocol: "http:",
      slashes: true,
      auth: null,
      host: "[::1]",
      port: null,
      hostname: "::1",
      hash: null,
      search: null,
      query: null,
      pathname: "/",
      path: "/",
      href: "http://[::1]/",
    });
  });

  it("handles punycode", () => {
    expect(parse("http://xn--xample-hva.com")).toEqual({
      protocol: "http:",
      slashes: true,
      auth: null,
      host: "xn--xample-hva.com",
      port: null,
      hostname: "xn--xample-hva.com",
      hash: null,
      search: null,
      query: null,
      pathname: "/",
      path: "/",
      href: "http://xn--xample-hva.com/",
    });
    expect(parse("http://💥.net")).toEqual({
      protocol: "http:",
      slashes: true,
      auth: null,
      host: "xn--hs8h.net",
      port: null,
      hostname: "xn--hs8h.net",
      hash: null,
      search: null,
      query: null,
      pathname: "/",
      path: "/",
      href: "http://xn--hs8h.net/",
    });
  });
});

it("urlToHttpOptions returns a null-prototype object", () => {
  const options = urlToHttpOptions(new URL("http://user:pass@foo.bar.com:21/aaa/zzz?l=24#test"));
  expect(Object.getPrototypeOf(options)).toBe(null);
  expect<object>({ ...options }).toEqual({
    protocol: "http:",
    hostname: "foo.bar.com",
    hash: "#test",
    search: "?l=24",
    pathname: "/aaa/zzz",
    path: "/aaa/zzz?l=24",
    href: "http://user:pass@foo.bar.com:21/aaa/zzz?l=24#test",
    port: 21,
    auth: "user:pass",
  });
});

it("URL constructor throws ERR_MISSING_ARGS", () => {
  var err;
  try {
    // @ts-expect-error
    new URL();
  } catch (e) {
    err = e;
  }

  expect(err?.code).toEqual("ERR_MISSING_ARGS");
});

// https://github.com/oven-sh/bun/issues/16705
it("#16705", () => {
  expect(Bun.fileURLToPath("file://C:/firebase-gen-%7B%7B%20firebase.gen%20%7D%7D")).toEqual(
    process.platform === "win32" ? "C:\\firebase-gen-{{ firebase.gen }}" : "/C:/firebase-gen-{{ firebase.gen }}",
  );
});

// DEP0169 is for application code only: "Type: Application (non-`node_modules` code only)".
// https://nodejs.org/api/deprecations.html#DEP0169
describe("url.parse() from a package in node_modules", () => {
  // `check` is isInsideNodeModules. A package passes it as the callback itself, so no frame of the
  // package is its caller: only engine frames and frames of built-in modules are between the two.
  const library = String.raw`
    const { AsyncResource } = require("node:async_hooks");
    const vm = require("node:vm");
    const resource = new AsyncResource("lib");

    exports.direct = (check, limit) => check(limit);
    exports.evalCode = check => eval("check()");
    exports.hot = (check, calls) => {
      let inside = 0;
      for (let i = 0; i < calls; i++) if ([1].some(check)) inside++;
      return inside;
    };
    // A script that a program names "node:".
    const namedLikeNode = new vm.Script("(check, limit) => check(limit)", { filename: "node:fake" }).runInThisContext();
    exports.nodeName = (check, limit) => namedLikeNode(check, limit);
    exports.some = (check, limit) => [limit].some(check);
    exports.map = (check, limit) => [limit].map(check)[0];
    exports.filter = (check, limit) => [limit].filter(check).length === 1;
    exports.reduce = (check, limit) => [limit, 0].reduce(check);
    exports.arrayFrom = (check, limit) => Array.from([limit], check)[0];
    exports.typedArrayMap = (check, limit) => new Int32Array([limit]).map(check)[0] === 1;
    exports.replace = check => "x".replace("x", check) === "true";
    exports.jsonParse = check => JSON.parse("1", check);
    exports.then = check => Promise.resolve().then(check);
    // "depth" engine frames: each bound Array.prototype.some calls the next.
    exports.stacked = (check, limit, depth) => {
      let callback = check;
      for (let array = [limit]; depth > 0; depth--, array = [0]) callback = Array.prototype.some.bind(array, callback);
      return callback();
    };
    // "depth" frames of node:async_hooks.
    exports.asyncHooks = (check, depth, ...args) => {
      let callback = check;
      for (; depth > 0; depth--, args = []) callback = resource.runInAsyncScope.bind(resource, callback, null, ...args);
      return callback();
    };
    exports.sqliteTransaction = (check, limit) =>
      new (require("bun:sqlite").Database)(":memory:").transaction(check)(limit);
    exports.Field = class {
      inside = this.check(1);
    };
    // (import "m" "f" (func (param i32) (result i32)))
    // (func (export "run") (param i32) (result i32) local.get 0 call 0)
    const wasm = new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 127, 1, 127, 2, 7, 1, 1, 109, 1, 102, 0, 0, 3, 2, 1, 0, 7, 7, 1, 3,
      114, 117, 110, 0, 1, 10, 8, 1, 6, 0, 32, 0, 16, 0, 11,
    ]);
    exports.wasm = (check, limit) =>
      new WebAssembly.Instance(new WebAssembly.Module(wasm), { m: { f: check } }).exports.run(limit) === 1;
    exports.callback = callback => callback();
  `;
  // Not a tail call: JavaScriptCore drops the frame of a strict function that makes one.
  const strictSome = `(check, limit) => ([limit].some(check) ? "inside" : "outside")`;
  // What a fixture printed: its results, or the text when that is not JSON.
  const results = (stdout: string) => {
    try {
      return JSON.parse(stdout);
    } catch {
      return stdout;
    }
  };

  // This fixture gives the same results with "node --expose-internals" (v26.3.0), except for bun:sqlite and bun:jsc.
  test.concurrent("isInsideNodeModules() does not list engine frames", async () => {
    using dir = tempDir("url-inside-node-modules", {
      "node_modules/lib/index.js": library,
      "node_modules/strictlib/index.js": `"use strict";\nexports.some = ${strictSome};`,
      "node_modules/esmlib/package.json": JSON.stringify({ name: "esmlib", type: "module", exports: "./index.js" }),
      "node_modules/esmlib/index.js": `export const some = ${strictSome};\nexport const topLevel = globalThis.check(1);`,
      "main.js": String.raw`
        const { isInsideNodeModules: check } = require("internal/test/binding").internalBinding("util");
        const vm = require("node:vm");
        const lib = require("lib");
        const strictlib = require("strictlib");

        // The smallest limit with which the check finds the package: the number of frames it lists.
        function frames(call) {
          for (let limit = 0; limit <= 10; limit++) if (call(limit)) return limit;
          return null;
        }

        async function main() {
          globalThis.check = check;
          const esmlib = await import("esmlib");
          const results = {};
          for (const shape of ["direct", "some", "map", "filter", "reduce", "arrayFrom", "typedArrayMap", "wasm"]) {
            results[shape] = frames(limit => lib[shape](check, limit));
          }
          results.stacked = [2, 3, 4, 8].map(depth => frames(limit => lib.stacked(check, limit, depth)));
          results.asyncHooks = [1, 2, 3].map(depth => frames(limit => lib.asyncHooks(check, depth, limit)));
          results.nodeName = frames(limit => lib.nodeName(check, limit));
          if (process.versions.bun) {
            results.sqliteTransaction = frames(limit => lib.sqliteTransaction(check, limit));
            results.hot = [lib.hot(check, 10000), require("bun:jsc").numberOfDFGCompiles(lib.hot) > 0];
          }
          results.strict = strictlib.some(check, 1);
          results.esm = esmlib.some(check, 1);
          results.esmTopLevel = esmlib.topLevel;
          results.evalCode = lib.evalCode(check);
          results.globalCode = new vm.Script("check(1)", { filename: "/app/node_modules/pkg/index.js" }).runInThisContext();
          results.doubleLimit = lib.direct(check, new Float64Array([0])[0]);
          lib.Field.prototype.check = check;
          results.fieldInitializer = new lib.Field().inside;
          results.replace = lib.replace(check);
          results.jsonParse = lib.jsonParse(check);
          results.defaultLimit = [lib.asyncHooks(check, 9), lib.asyncHooks(check, 10)];
          results.then = await lib.then(check);
          results.application = frames(limit => check(limit));
          results.applicationCallback = frames(limit => lib.callback(() => check(limit)));
          const fromFile = filename => new vm.Script("check => check()", { filename }).runInThisContext()(check);
          results.paths = [
            "/app/node_modules/pkg/index.js",
            "C:\\app\\node_modules\\pkg\\index.js",
            "/app/node_modules\\pkg/index.js",
            "C:\\app\\node_modules/pkg/index.js",
            "/app/not_node_modules/index.js",
            "/app/node_modules.js",
          ].map(fromFile);

          // The check does not use what a program can change on Error.
          Error.prepareStackTrace = () => lib.direct(check, 1);
          results.insidePrepareStackTrace = new Error().stack;
          let uses = 0;
          for (const name of ["stackTraceLimit", "prepareStackTrace"]) {
            Object.defineProperty(Error, name, { configurable: true, get: () => void uses++, set: () => void uses++ });
          }
          results.errorAccessors = [lib.direct(check, 1), uses];
          Object.freeze(Error);
          results.frozenError = lib.direct(check, 1);
          console.log(JSON.stringify(results));
        }
        main();
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--expose-internals", "main.js"],
      // Without the concurrent JIT, the DFG has compiled `hot` before its loop ends.
      env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ results: results(stdout), stderr, exitCode }).toEqual({
      results: {
        // The package is the first frame listed: an engine frame takes none of the limit.
        direct: 1,
        some: 1,
        map: 1,
        filter: 1,
        reduce: 1,
        arrayFrom: 1,
        typedArrayMap: 1,
        stacked: [1, 1, 1, 1],
        strict: "inside",
        esm: "inside",
        fieldInitializer: true,
        replace: true,
        jsonParse: true,
        // The same in code that the DFG compiled, and for a frame of each other kind of code.
        hot: [10000, true],
        esmTopLevel: true,
        evalCode: true,
        globalCode: true,
        // A frame of a built-in module, or of a script named "node:", takes one of the limit and does not decide.
        asyncHooks: [2, 3, 4],
        sqliteTransaction: 2,
        nodeName: 2,
        // No argument means 10 frames. A limit can be a double.
        defaultLimit: [true, false],
        doubleLimit: false,
        // A WebAssembly frame decides. A promise reaction has no caller.
        wasm: null,
        then: false,
        application: null,
        applicationCallback: null,
        // "node_modules" with a separator of either kind on each side.
        paths: [true, true, true, true, false, false],
        insidePrepareStackTrace: true,
        errorAccessors: [true, 0],
        frozenError: true,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  const parseLibrary = `
    const url = require("node:url");
    exports.parse = input => url.parse(input).hostname;
    const from = "http://example.com/a/b";
    const stacked = callback => {
      for (let depth = 3; depth > 0; depth--) callback = Array.prototype.some.bind([from], callback);
      return callback();
    };
    // Each deprecated function is the callback itself.
    exports.shapes = {
      "map(url.parse)": () => [from].map(url.parse),
      "forEach(url.parse)": () => [from].forEach(url.parse),
      "replace(url.parse)": () => from.replace(/^.*$/, url.parse),
      "3 engine frames, url.parse": () => stacked(url.parse),
      "map(url.format)": () => [from].map(url.format),
      "3 engine frames, url.format": () => stacked(url.format),
      "reduce(url.resolve)": () => [from, "/c"].reduce(url.resolve),
      "reduce(url.resolveObject)": () => [from, "/c"].reduce(url.resolveObject),
      "map(Url.prototype.resolve)": () => ["/c"].map(url.Url.prototype.resolve, url.parse(from)),
      "headers.forEach(url.parse)": () => new Headers({ location: from }).forEach(url.parse),
      "new ReadableStream({ start: url.parse })": () => {
        try {
          new ReadableStream({ start: url.parse });
        } catch {}
      },
    };
  `;

  // This fixture gives the same results with node v26.3.0, except for the ReadableStream:
  // Node.js implements it in JavaScript, lists those frames, and warns.
  test.concurrent("does not emit DEP0169 when the deprecated function is a callback", async () => {
    using dir = tempDir("url-dep0169-callback", {
      "node_modules/lib/index.js": parseLibrary,
      "main.js": `
        const url = require("node:url");
        const { shapes } = require("lib");
        const warnings = [];
        process.on("warning", warning => warnings.push(warning.code));
        const emitted = () => new Promise(resolve => setImmediate(() => resolve(warnings.splice(0))));

        async function main() {
          const results = {};
          for (const [name, call] of Object.entries(shapes)) {
            call();
            results[name] = await emitted();
          }
          url.parse("http://example.com/");
          results.application = await emitted();
          for (const call of Object.values(shapes)) call();
          url.parse("http://example.com/");
          results.afterTheWarning = await emitted();
          console.log(JSON.stringify(results));
        }
        main();
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      // The process still emits the "warning" event. Nothing prints it.
      env: { ...bunEnv, NODE_NO_WARNINGS: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ results: results(stdout), stderr, exitCode }).toEqual({
      results: {
        "map(url.parse)": [],
        "forEach(url.parse)": [],
        "replace(url.parse)": [],
        "3 engine frames, url.parse": [],
        "map(url.format)": [],
        "3 engine frames, url.format": [],
        "reduce(url.resolve)": [],
        "reduce(url.resolveObject)": [],
        "map(Url.prototype.resolve)": [],
        "headers.forEach(url.parse)": [],
        "new ReadableStream({ start: url.parse })": [],
        application: ["DEP0169"],
        afterTheWarning: [],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // A bundle is one file outside node_modules. Its source map names the files it was built from.
  test.concurrent("finds a package that a bundle inlines through the source map of the bundle", async () => {
    using dir = tempDir("url-dep0169-bundle", {
      "node_modules/lib/index.js": parseLibrary,
      "app.js": `
        process.on("warning", warning => console.log(warning.code));
        console.log(require("lib").parse("http://example.com/"));
      `,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "app.js", "--target=bun", "--sourcemap=linked", "--outdir=dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "inherit",
    });
    expect(await build.exited).toBe(0);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "dist/app.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "example.com\n", stderr: "", exitCode: 0 });
  });
});
