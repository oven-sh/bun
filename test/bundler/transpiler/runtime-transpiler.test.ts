import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";

test("use strict causes CommonJS", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), require.resolve("./use-strict-fixture.js")],
    env: bunEnv,
  });
  expect(stdout.toString()).toBe("function\n");
  expect(exitCode).toBe(0);
});

test("non-ascii regexp literals", () => {
  var str = "🔴11 54 / 10,000";
  expect(str.replace(/[🔵🔴,]+/g, "")).toBe("11 54 / 10000");
});

test("ascii regex with escapes", () => {
  expect(/^[-#!$@£%^&*()_+|~=`{}\[\]:";'<>?,.\/ ]$/).toBeInstanceOf(RegExp);
});

describe("// @bun", () => {
  beforeEach(() => {
    delete require.cache[require.resolve("./async-transpiler-entry")];
    delete require.cache[require.resolve("./async-transpiler-imported")];
  });

  test("async transpiler", async () => {
    const { default: value, hbs } = await import("./async-transpiler-entry");
    expect(value).toBe(42);
    expect(hbs).toBeString();
  });

  test("require()", async () => {
    const { default: value, hbs } = require("./async-transpiler-entry");
    expect(value).toBe(42);
    expect(hbs).toBeString();
  });

  test("synchronous", async () => {
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), require.resolve("./async-transpiler-imported")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });
    expect(stdout.toString()).toBe("Hello world!\n");
    expect(exitCode).toBe(0);
  });
});

describe("json imports", () => {
  test("require(*.json)", async () => {
    const {
      name,
      description,
      players,
      version,
      creator,
      default: defaultExport,
      ...other
    } = require("./runtime-transpiler-json-fixture.json");
    const obj = {
      "name": "Spiral 4v4 NS",
      "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
      "version": "1.0",
      "creator": "Grand Homie",
      "players": [8, 8],
      default: { a: 1 },
    };
    expect({
      name,
      description,
      players,
      version,
      creator,
      default: { a: 1 },
    }).toEqual(obj);
    expect(other).toEqual({});

    // This tests that importing and requiring when already in the cache keeps the state the same
    {
      const {
        name,
        description,
        players,
        version,
        creator,
        default: defaultExport,
        // @ts-ignore
      } = await import("./runtime-transpiler-json-fixture.json");
      const obj = {
        "name": "Spiral 4v4 NS",
        "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
        "version": "1.0",
        "creator": "Grand Homie",
        "players": [8, 8],
        default: { a: 1 },
      };
      expect({
        name,
        description,
        players,
        version,
        creator,
        default: { a: 1 },
      }).toEqual(obj);
      // They should be strictly equal
      expect(defaultExport.players).toBe(players);
      expect(defaultExport).toEqual(obj);
    }

    delete require.cache[require.resolve("./runtime-transpiler-json-fixture.json")];
  });

  test("import(*.json)", async () => {
    const {
      name,
      description,
      players,
      version,
      creator,
      default: defaultExport,
      // @ts-ignore
    } = await import("./runtime-transpiler-json-fixture.json");
    delete require.cache[require.resolve("./runtime-transpiler-json-fixture.json")];
    const obj = {
      "name": "Spiral 4v4 NS",
      "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
      "version": "1.0",
      "creator": "Grand Homie",
      "players": [8, 8],
      default: { a: 1 },
    };
    expect({
      name,
      description,
      players,
      version,
      creator,
      default: { a: 1 },
    }).toEqual(obj);
    // They should be strictly equal
    expect(defaultExport.players).toBe(players);
    expect(defaultExport).toEqual(obj);
  });

  test("should support comments in tsconfig.json", async () => {
    // @ts-ignore
    const { buildOptions, default: defaultExport } = await import("./tsconfig.with-commas.json");
    delete require.cache[require.resolve("./tsconfig.with-commas.json")];
    const obj = {
      "buildOptions": {
        "outDir": "dist",
        "baseUrl": ".",
        "paths": {
          "src/*": ["src/*"],
        },
      },
    };
    expect({
      buildOptions,
    }).toEqual(obj);
    // They should be strictly equal
    expect(defaultExport.buildOptions).toBe(buildOptions);
    expect(defaultExport).toEqual(obj);
  });

  test("should handle non-boecjts in tsconfig.json", async () => {
    // @ts-ignore
    const { default: num } = await import("./tsconfig.is-just-a-number.json");
    delete require.cache[require.resolve("./tsconfig.is-just-a-number.json")];
    expect(num).toBe(1);
  });

  test("should handle duplicate keys", async () => {
    // @ts-ignore
    expect((await import("./runtime-transpiler-fixture-duplicate-keys.json")).a).toBe("4");
  });
});

describe("with statement", () => {
  test("works", () => {
    const { exitCode } = Bun.spawnSync({
      cmd: [bunExe(), require.resolve("./with-statement-works.js")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
    });

    expect(exitCode).toBe(0);
  });
});

test("math.pow", () => {
  function foo1(foo) {
    return 10 ** (foo / 20);
  }

  function foo2(foo) {
    return foo ** -0.5;
  }

  expect(foo1(-1) + "").toEqual("0.8912509381337456");
  expect(10 ** (-1 / 20) + "").toEqual("0.8912509381337456");
  expect(foo2(20.4) + "").toEqual("0.22140372138502384");
  expect(20.4 ** -0.5 + "").toEqual("0.22140372138502384");
});

describe("unterminated string literals in large files", () => {
  test("reports an unterminated string literal at the end of a large JavaScript file", async () => {
    using dir = tempDir("transpiler-long-unterminated-js", {
      "index.js": `var s = "${Buffer.alloc(1 << 20, "a").toString()}`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("Unterminated string literal");
    expect(exitCode).toBe(1);
  });

  test("reports an unterminated string literal at the end of a large JSON file", async () => {
    using dir = tempDir("transpiler-long-unterminated-json", {
      "tsconfig.big.json": `{"name": "${Buffer.alloc(1 << 20, "a").toString()}`,
      "index.js": `require("./tsconfig.big.json");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("Unterminated string literal");
    expect(exitCode).toBe(1);
  });
});

// 2 GiB through the printer takes over 30 seconds on a debug or ASAN build.
test.skipIf(isDebug || isASAN)(
  "printing more than 2 GiB of modules in one process keeps the space after a keyword",
  async () => {
    using dir = tempDir("transpiler-printer-position", {
      "big.cjs": `module.exports = "${Buffer.alloc(1 << 20, "a").toString()}";`,
      "probe.cjs": `module.exports = function named() { return typeof named; };`,
      "index.cjs": `
        const big = require.resolve("./big.cjs");
        for (let i = 0; i < 2100; i++) {
          delete require.cache[big];
          module.children.length = 0;
          require(big);
          if (i % 50 === 0) Bun.gc(true);
        }
        console.log(require("./probe.cjs")());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("function\n");
    expect(exitCode).toBe(0);
  },
);

// A dependency injector reads `/* token */ name` out of `fn.toString()`: https://github.com/oven-sh/bun/issues/13451
describe.concurrent("a parameter list that holds a comment is printed as it is written", () => {
  async function run(files: Record<string, string>, ...args: string[]) {
    using dir = tempDir("parameter-list-as-written", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("the injector of karma finds its tokens", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "tokens.cjs": String.raw`
// How di@0.0.1 (lib/annotation.js), the injector of karma, finds what to inject.
const FN_ARGS = /^function\s*[^\(]*\(\s*([^\)]*)\)/m;
const FN_ARG = /\/\*([^\*]*)\*\//m;
const tokensOf = fn => {
  const list = fn.toString().match(FN_ARGS)[1];
  return list ? list.split(",").map(arg => (arg.match(FN_ARG)?.[1] ?? arg).trim()) : [];
};
// The four parameter lists of karma@6.4.4 that hold tokens.
const proxy = function (/* config */config, /* config.proxies */proxies, /* emitter */emitter) {};
const browser = function (
  id, fullName, /* capturedBrowsers */ collection, emitter, socket, timer,
  /* config.browserDisconnectTimeout */ disconnectDelay,
  /* config.browserNoActivityTimeout */ noActivityTimeout,
  /* config.singleRun */ singleRun,
  /* config.client */ clientConfig) {};
function createRunnerMiddleware (emitter, fileList, capturedBrowsers, reporter, executor,
  /* config.protocol */ protocol, /* config.hostname */ hostname, /* config.port */
  port, /* config.urlRoot */ urlRoot, config) {}
const captureTimeout = function (timer,
  /* config.captureTimeout */ captureTimeout) {};
console.log(JSON.stringify({ proxy: tokensOf(proxy), browser: tokensOf(browser), runner: tokensOf(createRunnerMiddleware), captureTimeout: tokensOf(captureTimeout) }, null, 1));
`,
      },
      "tokens.cjs",
    );
    expect(stderr).toBe("");
    // What Node.js prints.
    expect(JSON.parse(stdout)).toEqual({
      proxy: ["config", "config.proxies", "emitter"],
      browser: [
        "id",
        "fullName",
        "capturedBrowsers",
        "emitter",
        "socket",
        "timer",
        "config.browserDisconnectTimeout",
        "config.browserNoActivityTimeout",
        "config.singleRun",
        "config.client",
      ],
      runner: [
        "emitter",
        "fileList",
        "capturedBrowsers",
        "reporter",
        "executor",
        "config.protocol",
        "config.hostname",
        "config.port",
        "config.urlRoot",
        "config",
      ],
      captureTimeout: ["timer", "config.captureTimeout"],
    });
    expect(exitCode).toBe(0);
  });

  // Every kind of function with every list that fits its count of parameters. Each kind is a module of its own, which has to load.
  test.each([
    [".cjs", "module.exports ="],
    [".ts", "export default"],
  ])("for every kind of function, in a %s file", async (extension, how) => {
    // Each is an expression for the function. `LIST` is where the list goes.
    const functions = {
      "a function declaration": "(() => { function f(LIST) {} return f; })()",
      "an async function declaration": "(() => { async function f(LIST) {} return f; })()",
      "a generator declaration": "(() => { function* f(LIST) {} return f; })()",
      "an async generator declaration": "(() => { async function* f(LIST) {} return f; })()",
      "a function expression": "function (LIST) {}",
      "a named function expression": "function named(LIST) {}",
      "an async function expression": "async function (LIST) {}",
      "a generator expression": "function* (LIST) {}",
      "an arrow function": "(LIST) => {}",
      "an arrow function that returns an expression": "(LIST) => 1",
      "an async arrow function": "async (LIST) => {}",
      "an arrow function in a class field": "new (class { field = (LIST) => {}; })().field",
      "a function in a default value": "(function (inner = function (LIST) {}) { return inner; })()",
      "a constructor": "class { constructor(LIST) {} }",
      "a constructor of a derived class": "class extends Object { constructor(LIST) { super(); } }",
      "a method": "class { method(LIST) {} }.prototype.method",
      "a static method": "class { static method(LIST) {} }.method",
      "a generator method": "class { *method(LIST) {} }.prototype.method",
      "an async method": "class { async method(LIST) {} }.prototype.method",
      "an async generator method": "class { async *method(LIST) {} }.prototype.method",
      "a private method": "class K { #method(LIST) {} static get() { return new K().#method; } }.get()",
      "a static private method": "class K { static #method(LIST) {} static get() { return K.#method; } }.get()",
      "a method with a computed name": 'class { ["m" + 1](LIST) {} }.prototype.m1',
      "a method with a string name": 'class { "a name"(LIST) {} }.prototype["a name"]',
      "a method of an object": "{ method(LIST) {} }.method",
      "an async method of an object": "{ async method(LIST) {} }.method",
      "a generator method of an object": "{ *method(LIST) {} }.method",
      "a method of an object with a computed name": '{ ["m" + 1](LIST) {} }.m1',
    };
    const getters = {
      "a getter": 'Object.getOwnPropertyDescriptor(class { get value(LIST) { return 1; } }.prototype, "value").get',
      "a static getter": 'Object.getOwnPropertyDescriptor(class { static get value(LIST) { return 1; } }, "value").get',
      "a getter of an object": 'Object.getOwnPropertyDescriptor({ get value(LIST) { return 1; } }, "value").get',
    };
    // JavaScriptCore refuses `set value(a,) {}`: the list of a setter is printed as before.
    const setters = {
      "a setter": 'Object.getOwnPropertyDescriptor(class { set value(LIST) {} }.prototype, "value").set',
      "a static setter": 'Object.getOwnPropertyDescriptor(class { static set value(LIST) {} }, "value").set',
      "a private setter": "class { set #value(LIST) {} }",
      "a setter with a computed name":
        'Object.getOwnPropertyDescriptor(class { set ["v" + 1](LIST) {} }.prototype, "v1").set',
      "a setter with a string name":
        'Object.getOwnPropertyDescriptor(class { set "a name"(LIST) {} }.prototype, "a name").set',
      "a setter of an object": 'Object.getOwnPropertyDescriptor({ set value(LIST) {} }, "value").set',
    };
    // [the list as it is written, the same list with no comment]
    const lists = [
      ["/* none */", ""],
      ["\n  // none\n", ""],
      ["/* c */ a", "a"],
      ["a /* c */", "a"],
      ["/* c */ a,", "a"],
      ["a, /* c */", "a"],
      ["a // c\n", "a"],
      ["\n  // c\n  a,\n", "a"],
      ["/** doc */ a", "a"],
      ["/* ) => { */ a", "a"],
      ["/* c */ a, /* d */ b", "a, b"],
      ["a /* c */, b", "a, b"],
      ["/* c */a,/* d */b", "a, b"],
      ["a,\n  /* c */ b,", "a, b"],
      ["\n  // c\n  a,\n  b, // d\n", "a, b"],
      ["/* c */ $a, _b, c1", "$a, _b, c1"],
      ["/* c */ ...a", "...a"],
      ["a, ... /* c */ b", "a, ...b"],
    ];
    const count = (plain: string) => (plain === "" ? 0 : plain.split(",").length);

    const kinds: { name: string; file: string; lists: string[]; isKept: boolean }[] = [];
    const files: Record<string, string> = {};
    const add = (templates: Record<string, string>, fits: (plain: string) => boolean, isKept: boolean) => {
      for (const [name, template] of Object.entries(templates)) {
        const file = `kind-${kinds.length}${extension}`;
        const fitting = lists.filter(([, plain]) => fits(plain));
        const moduleOf = (texts: string[]) =>
          `${how} [\n${texts.map(text => template.replace("LIST", text)).join(",\n")},\n];\n`;
        files[file] = moduleOf(fitting.map(([list]) => list));
        if (!isKept) files["plain-" + file] = moduleOf(fitting.map(([, plain]) => plain));
        kinds.push({ name, file, lists: fitting.map(([list]) => list), isKept });
      }
    };
    add(functions, () => true, true);
    add(getters, plain => count(plain) === 0, true);
    add(setters, plain => count(plain) === 1 && !plain.includes("..."), false);
    files["kinds.json"] = JSON.stringify(kinds);
    files["main.mjs"] = `
      import kinds from "./kinds.json";
      const failed = [];
      let rows = 0;
      for (const { name, file, lists, isKept } of kinds) {
        try {
          const texts = (await import("./" + file)).default.map(String);
          const plain = isKept ? [] : (await import("./plain-" + file)).default.map(String);
          lists.forEach((list, i) => {
            const expected = isKept ? "(" + list + ")" : plain[i];
            if (isKept ? !texts[i].includes(expected) : texts[i] !== expected) failed.push({ name, list, text: texts[i], expected });
            rows++;
          });
        } catch (error) {
          failed.push({ name, error: String(error) });
        }
      }
      console.log(JSON.stringify({ rows, failed }, null, 1));
    `;

    const { stdout, stderr, exitCode } = await run(files, "main.mjs");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ rows: 28 * 18 + 3 * 2 + 6 * 8, failed: [] });
    expect(exitCode).toBe(0);
  });

  test("and the rest of the function is printed as before", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "text.mjs": String.raw`
const fn = function (/* c */ a,   b) { return a+b };
const arrow = (/* c */ a) => a*2;
const asyncArrow = async (/* c */ a) => { await a };
const Class = class { constructor(/* c */ a) { this.a = a } };
const legal = function (/*! legal */ a) {};
console.log(JSON.stringify([fn, arrow, asyncArrow, Class, legal].map(String), null, 1));
`,
      },
      "text.mjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([
      "function(/* c */ a,   b) {\n  return a + b;\n}",
      "(/* c */ a) => a * 2",
      "async (/* c */ a) => {\n  await a;\n}",
      "class {\n  constructor(/* c */ a) {\n    this.a = a;\n  }\n}",
      // A legal comment is also printed in the body, as before.
      "function(/*! legal */ a) {\n  /*! legal */\n}",
    ]);
    expect(exitCode).toBe(0);
  });

  test("however the runtime loads the module", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "entry.mjs": String.raw`
import { plugin } from "bun";
import { createRequire } from "node:module";
import { fn as imported } from "./imported.mjs";

plugin({
  setup(build) {
    build.onLoad({ filter: /from-plugin\.js$/ }, () => ({
      contents: "export function fn(/* token */ a) {}",
      loader: "js",
    }));
  },
});
const { promise: fromWorker, resolve, reject } = Promise.withResolvers();
const worker = new Worker(new URL("./worker.mjs", import.meta.url).href);
worker.onmessage = event => resolve(event.data);
worker.onerror = reject;

const texts = {
  "the entry file": String(function (/* token */ a) {}),
  "require()": String(createRequire(import.meta.url)("./required.cjs").fn),
  "import": String(imported),
  "import()": String((await import("./dynamic.mjs")).fn),
  "a TypeScript file": String((await import("./typed.ts")).fn),
  "a TSX file": String((await import("./element.tsx")).fn),
  "a generic arrow function in a TSX file": String((await import("./element.tsx")).generic),
  "a Worker": await fromWorker,
  "what a plugin's onLoad returns": String((await import("./from-plugin.js")).fn),
};
worker.terminate();
console.log(JSON.stringify(Object.keys(texts).filter(name => !texts[name].includes("(/* token */ a)"))));
`,
        "required.cjs": String.raw`
exports.fn = function (/* token */ a) {};
`,
        "imported.mjs": String.raw`
export function fn(/* token */ a) {}
`,
        "dynamic.mjs": String.raw`
export const fn = (/* token */ a) => a;
`,
        "typed.ts": String.raw`
export function fn(/* token */ a) {
  return a as unknown;
}
`,
        "element.tsx": String.raw`
/** @jsx h */
const h = (type: string) => type;
export function fn(/* token */ a) {
  return <div />;
}
export const generic = <T,>(/* token */ a) => a;
`,
        "worker.mjs": String.raw`
postMessage(String(function (/* token */ a) {}));
`,
        "from-plugin.js": String.raw`
// replaced by the plugin
`,
      },
      "entry.mjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("with -e", async () => {
    const { stdout, stderr, exitCode } = await run({}, "-e", "console.log(String(function (/* token */ a) {}))");
    expect(stderr).toBe("");
    expect(stdout).toBe("function(/* token */ a) {}\n");
    expect(exitCode).toBe(0);
  });

  test("in a test file", async () => {
    const { stdout, exitCode } = await run(
      { "list.test.js": `test("list", () => console.log(String(function (/* token */ a) {})));` },
      "test",
      "list.test.js",
    );
    expect(stdout.split("\n")).toContain("function(/* token */ a) {}");
    expect(exitCode).toBe(0);
  });

  test("in a TypeScript file, when the list holds no type", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "tsconfig.json": `{ "compilerOptions": { "experimentalDecorators": true } }`,
        "lists.ts": String.raw`
const dec = (...args: unknown[]) => {};
// Kept: the text between the parentheses holds names and comments only.
const kept: [Function, string][] = [
  [function (/* c */ a, /* d */ b) {}, "/* c */ a, /* d */ b"],
  [function <T>(/* c */ a) {}, "/* c */ a"],
  [(/* c */ a): number => a, "/* c */ a"],
  [<T,>(/* c */ a) => a, "/* c */ a"],
  [async <T,>(/* c */ a) => a, "/* c */ a"],
  [
    class {
      method<T>(/* c */ a): void {}
    }.prototype.method,
    "/* c */ a",
  ],
];
// Not kept: the printer writes something else than the text of the source.
class WithProperty {
  constructor(/* c */ public a) {}
}
class WithoutComment {
  constructor(public a) {}
}
// The text has two names for the one parameter.
class WithPropertyNamedReadonly {
  constructor(/* c */ readonly readonly) {}
}
class WithoutCommentNamedReadonly {
  constructor(readonly readonly) {}
}
class Decorated {
  method(@dec /* c */ a) {}
}
class DecoratedWithoutComment {
  method(@dec a) {}
}
const declined: Record<string, [Function, Function]> = {
  "a type": [function (/* c */ a: number) {}, function (a: number) {}],
  "a type on a later parameter": [function (/* c */ a, b: number) {}, function (a, b: number) {}],
  "an optional parameter": [function (/* c */ a?) {}, function (a?) {}],
  "a this parameter": [function (this: unknown, /* c */ a) {}, function (this: unknown, a) {}],
  "a this parameter with no type": [function (this, /* c */ a) {}, function (this, a) {}],
  "an arrow function with a type": [(/* c */ a: number) => a, (a: number) => a],
  "a parameter property": [WithProperty, WithoutComment],
  "a parameter property with the name of its modifier": [WithPropertyNamedReadonly, WithoutCommentNamedReadonly],
  "a decorator": [Decorated.prototype.method, DecoratedWithoutComment.prototype.method],
};
const text = (fn: Function) =>
  String(fn).replace(/(WithProperty|WithoutComment)(NamedReadonly)?|DecoratedWithoutComment|Decorated/g, "C");
console.log(
  JSON.stringify(
    {
      notKept: kept.filter(([fn, list]) => !String(fn).includes("(" + list + ")")).map(([fn, list]) => ({ list, text: String(fn) })),
      notAsToday: Object.entries(declined)
        .filter(([, [commented, plain]]) => text(commented) !== text(plain))
        .map(([name, [commented, plain]]) => ({ name, commented: text(commented), plain: text(plain) })),
    },
    null,
    1,
  ),
);
`,
      },
      "lists.ts",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ notKept: [], notAsToday: [] });
    expect(exitCode).toBe(0);
  });

  test("and a list of anything else than names is printed as before", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "declined.cjs": String.raw`
// Each row: a function whose list is not kept, and the same function without the comment.
const id = fn => fn;
const rows = {
  "a default value": [function (/* c */ a = 1) {}, function (a = 1) {}],
  "a default value after it": [function (/* c */ a, b = 1) {}, function (a, b = 1) {}],
  "an object pattern": [function (/* c */ { a }) {}, function ({ a }) {}],
  "an array pattern": [function (/* c */ [a]) {}, function ([a]) {}],
  "a comment that is not ASCII": [function (/* é */ a) {}, function (a) {}],
  "a name that is not ASCII": [function (/* c */ é) {}, function (é) {}],
  "a name with an escape": [function (/* c */ \u0061) {}, function (a) {}],
  "an arrow function with a default value": [(/* c */ a = 1) => a, (a = 1) => a],
  "a comment before the list of an arrow function": [id(/* outside */ a => a), id(a => a)],
  "a comment before the parenthesis": [function /* c */ (a) {}, function (a) {}],
  "a comment after async": [async /* c */ (a) => a, async (a) => a],
  "a comment after the list": [function (a) /* c */ {}, function (a) {}],
  "a comment before the arrow": [(a) /* c */ => a, (a) => a],
  "a comment after a list with other spaces": [( a,b ) /* c */ => a, (a, b) => a],
  // JavaScriptCore takes the name of the source from such a comment.
  "a comment that starts with //#": [function (a, //# sourceURL=renamed.js
    b) {}, function (a, b) {}],
  "a comment that starts with //@": [function (a, //@ sourceURL=renamed.js
    b) {}, function (a, b) {}],
  // mock.module() takes these words, in the text of a factory, as a mention of the original module.
  "importOriginal in a comment": [(/* importOriginal */ a) => a, (a) => a],
  "importActual in a comment": [function (a /* vi.importActual("./a") */) {}, function (a) {}],
  "requireActual in a comment": [function (a, // see jest.requireActual
    b) {}, function (a, b) {}],
  "no comment": [function (a,
    b) {}, function (a, b) {}],
};
const differing = Object.entries(rows).filter(([, [commented, plain]]) => String(commented) !== String(plain));
console.log(JSON.stringify(differing.map(([name, [commented, plain]]) => ({ name, commented: String(commented), plain: String(plain) })), null, 1));
`,
      },
      "declined.cjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test.each([
    ["\\n", "\n"],
    ["\\r\\n", "\r\n"],
    ["\\r", "\r"],
  ])("and positions after a list of several lines stay right, with lines that end in %s", async (_, lineEnding) => {
    const lines = [
      "exports.first = function (",
      "  /* one */ a,",
      "  // two",
      "  b,",
      ") {",
      "  return new Error('first').stack.split('\\n')[1];",
      "};",
      "exports.second = function () { return new Error('second').stack.split('\\n')[1]; };",
    ];
    const { stdout, stderr, exitCode } = await run(
      {
        "positions.cjs": lines.join(lineEnding) + lineEnding,
        "main.cjs": `
          const { first, second } = require("./positions.cjs");
          const position = frame => frame.slice(frame.lastIndexOf("positions.cjs:") + "positions.cjs:".length).replace(")", "");
          const text = String(first);
          console.log(JSON.stringify({
            list: text.slice(text.indexOf("("), text.indexOf(")") + 1),
            first: position(first()),
            second: position(second()),
          }));
        `,
      },
      "main.cjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      // A line of the source ends with "\n" in what is printed.
      list: "(\n  /* one */ a,\n  // two\n  b,\n)",
      first: "6:14",
      second: "8:43",
    });
    expect(exitCode).toBe(0);
  });

  // The React Compiler renames a parameter that shadows a name of the hook: `value` is `value_0` in what it writes.
  test("unless the parameter has another name in what is printed", async () => {
    const { stdout, exitCode } = await run(
      {
        "node_modules/react/package.json": JSON.stringify({
          name: "react",
          version: "19.0.0",
          exports: { ".": "./index.js", "./compiler-runtime": "./compiler-runtime.js" },
        }),
        "node_modules/react/index.js": `export const useState = value => [value, () => {}];`,
        "node_modules/react/compiler-runtime.js": `export const c = size => Array(size).fill(Symbol.for("react.memo_cache_sentinel"));`,
        "hook.js": `
          import { useState } from "react";
          export function useCapture(/* the values */ values, /* the step */ step) {
            const [value] = useState(1);
            const fn = (/* shadows */ value, /* its index */ index) => value + step + index;
            return [fn, values.map(fn)];
          }
        `,
        "hook.test.js": `
          import { useCapture } from "./hook.js";
          test("hook", () => {
            const [fn, mapped] = useCapture([1, 2], 10);
            console.log(JSON.stringify({ hook: String(useCapture).split("\\n")[0], fn: String(fn), mapped }));
          });
        `,
      },
      "test",
      "--react-compiler",
    );
    const { hook, fn, mapped } = JSON.parse(stdout.split("\n").find(line => line.startsWith("{"))!);
    expect(hook).toBe("function useCapture(/* the values */ values, /* the step */ step) {");
    expect(fn).not.toContain("/* shadows */");
    expect(mapped).toEqual([11, 13]);
    expect(exitCode).toBe(0);
  });

  // What `bun build` and `Bun.Transpiler` print is not loaded by the runtime: it has no such list, for any target.
  test("but only in a module the runtime loads", async () => {
    const source = "export const fn = function (/* token */ a) {};\n";
    using dir = tempDir("parameter-list-not-as-written", { "fn.js": source });
    const entrypoints = [join(String(dir), "fn.js")];
    const printedBy = async (...args: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--no-bundle", ...args, "fn.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    // Without the line that names the file.
    const bundled = async (target: "browser" | "bun") =>
      (await (await Bun.build({ entrypoints, target })).outputs[0].text()).replace(/^\/\/ .*fn\.js\n/m, "");

    expect({
      "bun build --no-bundle": await printedBy(),
      "bun build --no-bundle --target=bun": await printedBy("--target=bun"),
      "Bun.Transpiler": new Bun.Transpiler({ loader: "js" }).transformSync(source),
      "Bun.Transpiler for Bun": new Bun.Transpiler({ loader: "js", target: "bun" }).transformSync(source),
      "Bun.build": await bundled("browser"),
      "Bun.build for Bun": await bundled("bun"),
    }).toEqual({
      "bun build --no-bundle": { stdout: "export const fn = function(a) {};\n", stderr: "", exitCode: 0 },
      "bun build --no-bundle --target=bun": { stdout: "export const fn = function(a) {};\n", stderr: "", exitCode: 0 },
      "Bun.Transpiler": "export const fn = function(a) {};\n",
      "Bun.Transpiler for Bun": "export const fn = function(a) {};\n",
      "Bun.build": "var fn = function(a) {};\nexport {\n  fn\n};\n",
      "Bun.build for Bun": "// @bun\nvar fn = function(a) {};\nexport {\n  fn\n};\n",
    });
  });
});
