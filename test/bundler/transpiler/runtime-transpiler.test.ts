import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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

describe("Annex B.3.3 block-level function hoisting in sloppy mode", () => {
  const fixture = `
{ function z() { return 9 } }
console.log(z());
if (true) function u() { return 1 }
console.log(typeof u);
if (true) { function w() { return 2 } }
console.log(typeof w);
function outer() {
  { function inner() { return "in" } }
  return inner();
}
console.log(outer());
`;

  test.concurrent("hoists block-level functions to the enclosing var scope in CJS", async () => {
    using dir = tempDir("annex-b-block-fn-cjs", {
      "z.cjs": fixture,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "z.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("9\nfunction\nfunction\nin\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("keeps block-level functions block-scoped in strict mode (ESM)", async () => {
    using dir = tempDir("annex-b-block-fn-esm", {
      "z.mjs": `{ function z() { return 9 } }\nconsole.log(typeof z);\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "z.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("undefined\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("does not hoist past a conflicting lexical binding", async () => {
    using dir = tempDir("annex-b-block-fn-conflict", {
      "z.cjs": `let z = 1;\n{ function z() {} }\nconsole.log(typeof z);\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "z.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("number\n");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/23633
  test.concurrent("assigns the hoisted var when a block-level function shadows an outer one", async () => {
    using dir = tempDir("annex-b-block-fn-shadow", {
      "foo.cjs": `
function foo() { console.log('foo') }
foo();
{
  function foo() { console.log('bar') }
  foo();
}
foo();
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "foo.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("foo\nbar\nbar\n");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/25737
  test.concurrent("hoists a labeled function declaration to the enclosing var scope", async () => {
    using dir = tempDir("annex-b-labeled-fn", {
      "package.json": `{"type":"commonjs"}`,
      "top.js": `foo:\n    function bar() { return "bar"; }\nconsole.log(bar());\n`,
      "nested.js": `
function lex() {
  loop: function _lex() { return "ok"; }
  return _lex();
}
console.log(lex());
`,
    });
    for (const file of ["top.js", "nested.js"]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), file],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe(file === "top.js" ? "bar\n" : "ok\n");
      expect(exitCode).toBe(0);
    }
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
