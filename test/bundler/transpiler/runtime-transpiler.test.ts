import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

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

describe("a function declared twice in a sloppy block", () => {
  async function run(files: Record<string, string>, ...args: string[]) {
    using dir = tempDir("transpiler-block-function-twice", files);
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

  // A direct eval keeps each declaration as it is written.
  const twice = `
    function twoClauses(kind) { switch (kind) { case "a": function handler() { return "A" } eval(""); break; case "b": function handler() { return "B" } break; } try { return handler(); } catch (e) { return e.name; } }
    function threeClauses(k) { switch (k) { case 1: eval(""); function h() { return 1 } break; case 2: function h() { return 2 } break; case 3: function h() { return 3 } } return typeof h === "function" ? h() : typeof h; }
    function fallthrough(k) { switch (k) { case 1: function h() { return 1 } eval(""); case 2: function h() { return 2 } break; case 3: function h() { return 3 } } return typeof h === "function" ? h() : typeof h; }
    function sameClause(k) { switch (k) { case 1: function h() { return 1 } eval(""); function h() { return 2 } break; } return typeof h === "function" ? h() : typeof h; }
    function defaultFirst(k) { switch (k) { default: function h() { return "d" } eval(""); break; case 1: function h() { return 1 } } return h(); }
    function evalInLaterClause(k) { switch (k) { case 1: function h() { return 1 } break; case 2: function h() { return 2 } eval(""); } return typeof h === "function" ? h() : typeof h; }
    function assignBetween(k) { switch (k) { case 1: function h() { return 1 } h = 5; eval(""); function h() { return 2 } } return h; }
    function leaveBefore(k) { switch (k) { case 1: if (k) break; eval(""); function h() { return 1 } case 2: function h() { return 2 } } return typeof h === "function" ? h() : typeof h; }
    function tryFinally() { try { function f() { return 1 } eval(""); throw 0; function f() { return 2 } } catch (e) { } finally { function g() { return 3 } eval(""); function g() { return 4 } } return f() + "," + g(); }
    function inLoop() { var seen = []; for (var i = 0; i < 3; i++) { switch (i) { case 0: function h() { return "a" } eval(""); break; case 1: function h() { return "b" } } seen.push(typeof h === "function" ? h() : typeof h); } return seen.join(); }
    function leaveBetween() { exit: { function f() { return 1 } eval(""); break exit; function f() { return 2 } } return f(); }
    function three() { { function f() { return 1 } eval(""); function f() { return 2 } function f() { return 3 } } return f(); }
    module.exports = {
      twoClauses: [twoClauses("a"), twoClauses("b"), twoClauses("c")],
      threeClauses: [threeClauses(1), threeClauses(2), threeClauses(3), threeClauses(4)],
      fallthrough: [fallthrough(1), fallthrough(2), fallthrough(3), fallthrough(4)],
      sameClause: [sameClause(1), sameClause(2)],
      defaultFirst: [defaultFirst(1), defaultFirst(2)],
      evalInLaterClause: [evalInLaterClause(1), evalInLaterClause(2), evalInLaterClause(3)],
      assignBetween: [assignBetween(1), assignBetween(2)],
      leaveBefore: [leaveBefore(1), leaveBefore(2), leaveBefore(3)],
      tryFinally: tryFinally(),
      inLoop: inLoop(),
      leaveBetween: leaveBetween(), three: three(),
    };
  `;
  const print = `console.log(JSON.stringify(rows));`;
  // What node prints for the file.
  const expected = {
    twoClauses: ["B", "B", "TypeError"],
    threeClauses: [3, 3, 3, "undefined"],
    fallthrough: [3, 3, 3, "undefined"],
    sameClause: [2, "undefined"],
    defaultFirst: [1, 1],
    evalInLaterClause: [2, 2, "undefined"],
    assignBetween: [5, null],
    leaveBefore: ["undefined", 2, "undefined"],
    tryFinally: "2,4",
    inLoop: "b,b,b",
    leaveBetween: 2,
    three: 3,
  };
  const commonjs = {
    "twice.cjs": twice,
    "twice.js": twice,
    "require.cjs": `const rows = require("./twice.cjs"); ${print}`,
    "require-js.cjs": `const rows = require("./twice.js"); ${print}`,
    "import.mjs": `import rows from "./twice.cjs"; ${print}`,
    "import-js.mjs": `import rows from "./twice.js"; ${print}`,
    "worker.mjs": `const worker = new Worker(new URL("./in-worker.cjs", import.meta.url).href); worker.onmessage = ({ data: rows }) => { ${print} worker.terminate(); };`,
    "in-worker.cjs": `postMessage(require("./twice.cjs"));`,
  };
  test.concurrent.each([
    ["require.cjs", ["require.cjs"]],
    ["require-js.cjs", ["require-js.cjs"]],
    ["import.mjs", ["import.mjs"]],
    ["import-js.mjs", ["import-js.mjs"]],
    ["worker.mjs", ["worker.mjs"]],
    ["-e", ["-e", `${twice} const rows = module.exports; ${print}`]],
  ])("each declaration statement assigns the var of the function: bun %s", async (_, args) => {
    const { stdout, stderr, exitCode } = await run(commonjs, ...args);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  // Strict code rejects two declarations of one name in a block. Bun runs a
  // file with no CommonJS marker as a module, which is strict code, so these
  // files must not get both.
  const strict = `
    { function f() { return 1 } eval(""); function f() { return 2 } console.log(f()); }
    switch (1) { case 0: function g() { return 1 } eval(""); case 1: function g() { return 2 } console.log(g()); }
  `;
  const modules = {
    "twice.js": strict,
    "twice.mjs": strict,
    "twice.cjs": strict,
    "twice.ts": strict,
    "use-strict.cjs": `"use strict";\n${strict}\nmodule.exports = 1;`,
    "strict-function.cjs": `(function () { "use strict";\n${strict} })();\nmodule.exports = 1;`,
    "import.mjs": `import "./twice.cjs";`,
    "dynamic-import.mjs": `await import("./twice.cjs");`,
    "main.js": ``,
    "plugin.mjs": `
      import { plugin } from "bun";
      plugin({ name: "twice", setup(b) { b.onLoad({ filter: /\\.virtual$/ }, () => ({ loader: "js", contents: ${JSON.stringify(strict)} })); } });
      await import("./twice.virtual");
    `,
    "twice.virtual": ``,
  };
  test.concurrent.each([
    [["twice.js"]],
    [["twice.mjs"]],
    [["twice.ts"]],
    [["twice.cjs"]],
    [["use-strict.cjs"]],
    [["strict-function.cjs"]],
    [["import.mjs"]],
    [["dynamic-import.mjs"]],
    [["--preload", "./twice.cjs", "main.js"]],
    [["plugin.mjs"]],
  ])("a file that can run as strict code still loads: bun %p", async args => {
    const { stdout, stderr, exitCode } = await run(modules, ...args);
    expect(stderr).toBe("");
    expect(stdout).toBe("2\n2\n");
    expect(exitCode).toBe(0);
  });

  // A plugin source is evaluated as a module. When it is CommonJS by content its
  // body does not run (#34112), and with two declarations of one name it does not
  // load either.
  test.failing("a plugin source that is CommonJS by content runs", async () => {
    const { stdout, exitCode } = await run(
      {
        "plugin.mjs": `
          import { plugin } from "bun";
          plugin({ name: "twice", setup(b) { b.onLoad({ filter: /\\.virtual$/ }, () => ({ loader: "js", contents: ${JSON.stringify(strict + "module.exports = 1;")} })); } });
          await import("./twice.virtual");
        `,
        "twice.virtual": ``,
      },
      "plugin.mjs",
    );
    expect(stdout).toBe("2\n2\n");
    expect(exitCode).toBe(0);
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
