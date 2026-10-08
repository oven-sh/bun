import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";

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

// Strict code rejects a function declaration as the body of a label, `if` or `else`.
// A file that has one in non-strict code is not an ES module.
// These tests are serial: each one starts bun, and a debug build is slow when many start at once.
describe("a function declaration as the body of a label, if or else", () => {
  const probe = `(function () { return this === undefined; })() ? "strict" : "sloppy"`;
  const label = `l: function g() { return "g"; }\n`;
  const ifBody = `if (true) function g() { return "g"; }\n`;
  // Prints "sloppy g" when the file is CommonJS and the function is visible after its statement.
  const print = `console.log(${probe}, g());\n`;
  const named = (name: string, ...values: string[]) =>
    `console.log(${[JSON.stringify(name + ":"), probe, ...values].join(", ")});\n`;
  const requireAll = (files: object) =>
    Object.keys(files)
      .map(file => `require("./${file}");\n`)
      .join("");

  async function spawn(cwd: string, cmd: string[], options: { stdin?: string; env?: Record<string, string> } = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      env: { ...bunEnv, ...options.env },
      cwd,
      stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("makes the file CommonJS in each form", async () => {
    const forms = {
      "label.js": label + named("label", "g()"),
      "if.js": ifBody + named("if", "g()"),
      "else.js": `if (false) ; else function g() { return "g"; }\n` + named("else", "g()"),
      "nested-label.js": `a: b: function g() { return "g"; }\n` + named("nested label", "g()"),
      "label-in-block.js": `{ ${label} }\n` + named("label in a block", "g()"),
      "in-function.js": `function outer() { ${label} return g(); }\n` + named("in a function", "outer()"),
      "in-arrow.js": `const outer = () => { ${ifBody} return g(); };\n` + named("in an arrow function", "outer()"),
      "dead-branch.js": `if (false) function g() {}\n` + named("dead branch", "typeof g"),
      "typescript.ts": label + named(".ts", "g()"),
      "no-extension": label + named("no extension", "g()"),
    };
    using dir = tempDir("sloppy-fn-decl-forms", { ...forms, "main.cjs": requireAll(forms) });
    expect(await spawn(String(dir), ["main.cjs"])).toEqual({
      stdout:
        "label: sloppy g\nif: sloppy g\nelse: sloppy g\nnested label: sloppy g\nlabel in a block: sloppy g\n" +
        "in a function: sloppy g\nin an arrow function: sloppy g\ndead branch: sloppy undefined\n" +
        ".ts: sloppy g\nno extension: sloppy g\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("leaves the file an ES module without the two forms", async () => {
    const files = {
      "block-label.js": "l: { function g() {} }\n" + named("block as a label body"),
      "loop-label.js": "l: for (;;) break l;\n" + named("loop as a label body"),
      "if-block.js": "if (true) { function g() {} }\n" + named("block as an if body"),
      "if-call.js": "function g() {}\nif (true) g();\n" + named("call as an if body"),
      "plain.js": named("no label or if"),
    };
    using dir = tempDir("sloppy-fn-decl-none", { ...files, "main.cjs": requireAll(files) });
    expect(await spawn(String(dir), ["main.cjs"])).toEqual({
      stdout:
        "block as a label body: strict\nloop as a label body: strict\nblock as an if body: strict\n" +
        "call as an if body: strict\nno label or if: strict\n",
      stderr: "",
      exitCode: 0,
    });
  });

  type Row = { name: string; files: Record<string, string>; cmd: string[]; stdin?: string; stdout?: string };

  const routes: Row[] = [
    {
      // https://github.com/oven-sh/bun/issues/25737
      name: "the file of the issue as the entry point",
      files: { "index.js": `foo:\n    function bar() { return "bar"; }\n\nconsole.log(bar());\n` },
      cmd: ["index.js"],
      stdout: "bar\n",
    },
    { name: "the entry point", files: { "a.js": label + print }, cmd: ["a.js"] },
    {
      name: "an import from an ES module",
      files: {
        "main.mjs":
          `import { createRequire } from "node:module";\n` +
          `import dep from "./dep.js";\n` +
          `const required = createRequire(import.meta.url)("./dep.js");\n` +
          `console.log(typeof dep, dep === required, dep === (await import("./dep.js")).default);\n`,
        "dep.js": label + print,
      },
      cmd: ["main.mjs"],
      stdout: "sloppy g\nobject true true\n",
    },
    { name: "-e", files: {}, cmd: ["-e", label + print] },
    { name: "-p", files: {}, cmd: ["-p", label + `(${probe}) + " " + g()`] },
    { name: "stdin", files: {}, cmd: ["-"], stdin: label + print },
    {
      name: "--preload",
      files: { "pre.js": label + print, "main.mjs": `console.log("main");\n` },
      cmd: ["--preload", "./pre.js", "main.mjs"],
      stdout: "sloppy g\nmain\n",
    },
    {
      name: "a Worker",
      files: {
        "main.mjs":
          `const worker = new Worker(new URL("./worker.js", import.meta.url));\n` +
          `await new Promise(resolve => worker.addEventListener("close", resolve));\n`,
        "worker.js": label + print,
      },
      cmd: ["main.mjs"],
    },
  ];

  test.each(routes)("makes the file CommonJS: $name", async ({ files, cmd, stdin, stdout = "sloppy g\n" }) => {
    using dir = tempDir("sloppy-fn-decl", files);
    expect(await spawn(String(dir), cmd, { stdin })).toEqual({ stdout, stderr: "", exitCode: 0 });
  });

  test("makes a test file with no imports CommonJS", async () => {
    using dir = tempDir("sloppy-fn-decl-test", {
      "a.test.js": label + `test("kind", () => {\n  ${print}});\n`,
    });
    const { stdout, stderr, exitCode } = await spawn(String(dir), ["test", "./a.test.js"]);
    expect(stderr).toContain(" 1 pass");
    // The first line of stdout is the `bun test v...` header.
    expect({ lines: stdout.split("\n").slice(1), exitCode }).toEqual({ lines: ["sloppy g", ""], exitCode: 0 });
  });

  test("the transpiler cache keeps the CommonJS kind", async () => {
    // Only a source of 4 KiB or more is cached.
    const filler = "// " + Buffer.alloc(4096, "a").toString() + "\n";
    using dir = tempDir("sloppy-fn-decl-cache", { "a.js": label + print + filler });
    const cache = join(String(dir), "cache");
    const env = { BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache, BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1" };

    const first = await spawn(String(dir), ["a.js"], { env });
    const entries = readdirSync(cache).length;
    const second = await spawn(String(dir), ["a.js"], { env });
    expect({ first, entries, second, entriesAfter: readdirSync(cache).length }).toEqual({
      first: { stdout: "sloppy g\n", stderr: "", exitCode: 0 },
      entries: 1,
      second: { stdout: "sloppy g\n", stderr: "", exitCode: 0 },
      entriesAfter: 1,
    });
  });

  test("leaves the file an ES module when the parser treats the code as strict", async () => {
    const files = {
      "class-label.js": `class A { m() { ${label} } }\n` + named("label in a class method"),
      "class-if.js": `class A { m() { ${ifBody} } }\n` + named("if in a class method"),
      "strict-function.js": `function o() { "use strict"; ${label} }\n` + named("label in a strict function"),
      "strict-arrow.js": `const o = () => { "use strict"; ${ifBody} };\n` + named("if in a strict arrow function"),
      "type-import.ts": `import type { T } from "./t";\n` + label + named("type-only import"),
      "import.js": `import "node:fs";\n` + label + named("import statement"),
    };
    using dir = tempDir("sloppy-fn-decl-strict", {
      ...files,
      "t.ts": "export type T = number;\n",
      "main.mjs": Object.keys(files)
        .map(file => `await import("./${file}");\n`)
        .join(""),
    });
    expect(await spawn(String(dir), ["main.mjs"])).toEqual({
      stdout:
        "label in a class method: strict\nif in a class method: strict\nlabel in a strict function: strict\n" +
        "if in a strict arrow function: strict\ntype-only import: strict\nimport statement: strict\n",
      stderr: "",
      exitCode: 0,
    });
  });

  const moduleTypes: Row[] = [
    { name: "a .mjs entry point", files: { "a.mjs": label + named("entry point") }, cmd: ["a.mjs"] },
    {
      name: `a "type": "module" package`,
      files: {
        "package.json": `{ "type": "module" }`,
        "main.js": label + named("entry point") + `import("./dep.js");\n`,
        "dep.js": label + named("dependency"),
      },
      cmd: ["main.js"],
      stdout: "entry point: strict\ndependency: strict\n",
    },
  ];

  test.each(moduleTypes)(
    "leaves the file an ES module: $name",
    async ({ files, cmd, stdout = "entry point: strict\n" }) => {
      using dir = tempDir("sloppy-fn-decl-esm", files);
      expect(await spawn(String(dir), cmd)).toEqual({ stdout, stderr: "", exitCode: 0 });
    },
  );

  // The loader reports no module type for these files, so the file contents decide, as for `__dirname`.
  test("gives the same kind as the `__dirname` hint where the loader reports no module type", async () => {
    const hint = "void __dirname;\n";
    using dir = tempDir("sloppy-fn-decl-loader", {
      "typed/package.json": `{ "type": "module" }`,
      "typed/label.jsx": label + named(".jsx in a module package, label"),
      "typed/hint.jsx": hint + named(".jsx in a module package, __dirname"),
      "typed/label": label + named("no extension in a module package, label"),
      "typed/hint": hint + named("no extension in a module package, __dirname"),
      "label.mjs": label + named("imported .mjs, label"),
      "hint.mjs": hint + named("imported .mjs, __dirname"),
      "main.mjs":
        `import { createRequire } from "node:module";\n` +
        `const require = createRequire(import.meta.url);\n` +
        ["label.jsx", "hint.jsx", "label", "hint"].map(file => `require("./typed/${file}");\n`).join("") +
        `await import("./label.mjs");\nawait import("./hint.mjs");\n`,
    });
    expect(await spawn(String(dir), ["main.mjs"])).toEqual({
      stdout:
        ".jsx in a module package, label: sloppy\n.jsx in a module package, __dirname: sloppy\n" +
        "no extension in a module package, label: sloppy\nno extension in a module package, __dirname: sloppy\n" +
        "imported .mjs, label: sloppy\nimported .mjs, __dirname: sloppy\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("bun build does not give the file a CommonJS wrapper", async () => {
    using dir = tempDir("sloppy-fn-decl-build", {
      "a.js": "l: function g() {}\nif (true) function h() {}\n" + `console.log(${probe});\n`,
    });
    expect(await spawn(String(dir), ["build", "a.js"])).toEqual({
      stdout:
        "// a.js\n" +
        "l: {\n  let g2 = function() {};\n  g = g2;\n}\nvar g;\n" +
        "if (true) {\n  let h2 = function() {};\n  h = h2;\n}\nvar h;\n" +
        `console.log(function() {\n  return this === undefined;\n}() ? "strict" : "sloppy");\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  // A CommonJS file cannot take an import that the parser generates: the load fails with
  // "SyntaxError: Unexpected token '{'. import call expects one or two arguments." (#12812).
  test.failing("runs a file that also needs the JSX runtime import", async () => {
    using dir = tempDir("sloppy-fn-decl-jsx", {
      "node_modules/react/package.json": JSON.stringify({
        name: "react",
        version: "0.0.0",
        exports: { "./jsx-dev-runtime": "./jsx-runtime.js", "./jsx-runtime": "./jsx-runtime.js" },
      }),
      "node_modules/react/jsx-runtime.js": "exports.jsxDEV = exports.jsx = exports.jsxs = type => ({ type });\n",
      "a.jsx": label + "const element = <div />;\n" + `console.log(${probe}, g(), element.type);\n`,
    });
    expect(await spawn(String(dir), ["a.jsx"])).toEqual({ stdout: "sloppy g div\n", stderr: "", exitCode: 0 });
  });

  // The same failure as for the JSX runtime import (#12812).
  test.failing("runs a file that also needs a decorator helper import", async () => {
    const files = {
      "legacy-decorator.ts":
        label + "function d(value: any, context: any) {}\nclass A { @d m() {} }\n" + named("decorator in .ts", "g()"),
      "decorator.js":
        label + "function d(value, context) {}\nclass A { @d m() {} }\n" + named("decorator in .js", "g()"),
      "accessor.js": label + "class A { accessor x = 1; }\n" + named("accessor field", "g()"),
    };
    using dir = tempDir("sloppy-fn-decl-helper", {
      ...files,
      "main.cjs": Object.keys(files)
        .map(file => `try { require("./${file}"); } catch (e) { console.log(e.name + ": " + e.message); }\n`)
        .join(""),
    });
    expect(await spawn(String(dir), ["main.cjs"])).toEqual({
      stdout: "decorator in .ts: sloppy g\ndecorator in .js: sloppy g\naccessor field: sloppy g\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // A plugin source that is CommonJS does not run: the module loader evaluates it as an ES module,
  // where the CommonJS wrapper is an unused function expression.
  test.failing("runs a Bun.plugin source", async () => {
    const source = (name: string) => JSON.stringify(label + named(name, "g()"));
    using dir = tempDir("sloppy-fn-decl-plugin", {
      "imported.js": "// The plugin gives the source.\n",
      "required.js": "// The plugin gives the source.\n",
      "main.mjs":
        `import { plugin } from "bun";\n` +
        `import { createRequire } from "node:module";\n` +
        `plugin({\n` +
        `  name: "source",\n` +
        `  setup(build) {\n` +
        `    build.onLoad({ filter: /imported\\.js$/ }, () => ({ contents: ${source("onLoad, import")}, loader: "js" }));\n` +
        `    build.onLoad({ filter: /required\\.js$/ }, () => ({ contents: ${source("onLoad, require")}, loader: "js" }));\n` +
        `    build.module("virtual", () => ({ contents: ${source("build.module")}, loader: "js" }));\n` +
        `  },\n` +
        `});\n` +
        `await import("./imported.js");\n` +
        `createRequire(import.meta.url)("./required.js");\n` +
        `await import("virtual");\n`,
    });
    expect(await spawn(String(dir), ["main.mjs"])).toEqual({
      stdout: "onLoad, import: sloppy g\nonLoad, require: sloppy g\nbuild.module: sloppy g\n",
      stderr: "",
      exitCode: 0,
    });
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
