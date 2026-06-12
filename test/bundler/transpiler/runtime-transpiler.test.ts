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

// https://github.com/oven-sh/bun/issues/32175
describe.concurrent("implicit strict mode for files forced to ESM", () => {
  async function run(dir: unknown, file: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), file],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("legacy octal literal in a bare .mjs file is an error", async () => {
    using dir = tempDir("forced-esm-strict-octal", {
      "octal.mjs": "var v = 010;\nconsole.log(v);\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "octal.mjs");
    expect(stderr).toContain("Legacy octal literals cannot be used in strict mode");
    expect(stderr).toContain('".mjs" extension makes it an ECMAScript module');
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("legacy octal literal in a bare .mts file is an error", async () => {
    using dir = tempDir("forced-esm-strict-octal-mts", {
      "octal.mts": "var v = 010;\nconsole.log(v);\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "octal.mts");
    expect(stderr).toContain("Legacy octal literals cannot be used in strict mode");
    expect(stderr).toContain('".mts" extension makes it an ECMAScript module');
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test('legacy octal literal in a "type": "module" package is an error', async () => {
    using dir = tempDir("forced-esm-strict-type-module", {
      "package.json": '{ "type": "module" }',
      "octal.js": "var v = 010;\nconsole.log(v);\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "octal.js");
    expect(stderr).toContain("Legacy octal literals cannot be used in strict mode");
    expect(stderr).toContain('package.json sets "type" to "module"');
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("leading-zero decimal like 08 in a bare .mjs file is an error", async () => {
    using dir = tempDir("forced-esm-strict-08", {
      "zero.mjs": "console.log(08);\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "zero.mjs");
    expect(stderr).toContain("Legacy octal literals cannot be used in strict mode");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("legacy octal literal as an object property key in a .mjs file is an error", async () => {
    using dir = tempDir("forced-esm-strict-octal-key", {
      "key.mjs": "console.log({ 010: 1 });\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "key.mjs");
    expect(stderr).toContain("Legacy octal literals cannot be used in strict mode");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("legacy octal literal as a destructuring binding key in a .mjs file is an error", async () => {
    using dir = tempDir("forced-esm-strict-octal-binding", {
      "binding.mjs": "var { 010: x } = { 8: 1 };\nconsole.log(x);\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "binding.mjs");
    expect(stderr).toContain("Legacy octal literals cannot be used in strict mode");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("eval and arguments declarations in CommonJS-classified .mjs files still fail ESM-format bundles", async () => {
    // The file executes as CommonJS via the interop, but `bun build
    // --format=esm` puts its wrapper inside a strict ES module, so the
    // sloppy-only declaration must keep failing the build.
    using dir = tempDir("forced-esm-bundle-esm-format", {
      "utils.mjs": "exports.x = 1;\nvar arguments = 5;\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "utils.mjs", "--format=esm"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(
      'Declarations with the name "arguments" cannot be used with the ESM output format due to strict mode',
    );
    expect(exitCode).toBe(1);
  });

  test("strict mode reserved word in a bare .mjs file is a transpiler error", async () => {
    using dir = tempDir("forced-esm-strict-reserved", {
      "reserved.mjs": "var package = { name: 1 };\nconsole.log(package.name);\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "reserved.mjs");
    // The transpiler reports this; previously it was left for the JS engine,
    // which printed a different message at runtime.
    expect(stderr).toContain('"package" is a reserved word and cannot be used in strict mode');
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("legacy octal literal with explicit ESM syntax is an error", async () => {
    using dir = tempDir("esm-syntax-strict-octal", {
      "octal.js": "export {};\nconsole.log(010);\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "octal.js");
    expect(stderr).toContain("Legacy octal literals cannot be used in strict mode");
    expect(stderr).toContain('because of the "export" keyword');
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("legacy octal literal inside a class body is an error even in CommonJS", async () => {
    using dir = tempDir("class-strict-octal", {
      "class.js": "class C { m() { return 010; } }\nconsole.log(new C().m());\nmodule.exports = C;\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "class.js");
    expect(stderr).toContain("Legacy octal literals cannot be used in strict mode");
    expect(stderr).toContain("All code inside a class is implicitly in strict mode");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("legacy octal literal inside a class body is an error even in a CommonJS-classified .mjs file", async () => {
    // Class bodies are unconditionally strict; the CommonJS interop
    // classification (the file uses `exports`) must not swallow this.
    using dir = tempDir("forced-esm-class-octal", {
      "class.mjs": "exports.C = class { m() { return 010; } };\nconsole.log(new exports.C().m());\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "class.mjs");
    expect(stderr).toContain("Legacy octal literals cannot be used in strict mode");
    expect(stderr).toContain("All code inside a class is implicitly in strict mode");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test("reserved word inside a class body is an error even in a CommonJS-classified .mjs file", async () => {
    using dir = tempDir("forced-esm-class-reserved", {
      "class.mjs":
        "exports.C = class { m() { var package = 1; return package; } };\nconsole.log(new exports.C().m());\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "class.mjs");
    expect(stderr).toContain('"package" is a reserved word and cannot be used in strict mode');
    expect(stderr).toContain("All code inside a class is implicitly in strict mode");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test('legacy octal literal under "use strict" is an error', async () => {
    using dir = tempDir("use-strict-octal", {
      "strict.js": '"use strict";\nconsole.log(010);\n',
    });
    const { stdout, stderr, exitCode } = await run(dir, "strict.js");
    expect(stderr).toContain("Legacy octal literals cannot be used in strict mode");
    expect(stderr).toContain('because of the "use strict" directive');
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  // Bun deliberately executes forced-ESM files that use CommonJS-only
  // features as CommonJS (sloppy mode), so none of the above applies to them.
  test("file using exports still runs as sloppy CommonJS despite .mjs", async () => {
    using dir = tempDir("forced-esm-cjs-interop-exports", {
      "interop.mjs": "exports.v = 010;\nconsole.log(exports.v);\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "interop.mjs");
    expect({ stdout, stderr }).toEqual({ stdout: "8\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test('file using exports still runs as sloppy CommonJS under "type": "module"', async () => {
    using dir = tempDir("type-module-cjs-interop-exports", {
      "package.json": '{ "type": "module" }',
      "interop.js": "exports.v = 010;\nconsole.log(exports.v);\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "interop.js");
    expect({ stdout, stderr }).toEqual({ stdout: "8\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("file using a with statement still runs as sloppy CommonJS despite .mjs", async () => {
    using dir = tempDir("forced-esm-cjs-interop-with", {
      "with.mjs": "with ({ x: 1 }) { console.log(x); }\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "with.mjs");
    expect({ stdout, stderr }).toEqual({ stdout: "1\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("file using a top-level return still runs as sloppy CommonJS despite .mjs", async () => {
    using dir = tempDir("forced-esm-cjs-interop-return", {
      "return.mjs": "console.log(010);\nreturn;\n",
    });
    const { stdout, stderr, exitCode } = await run(dir, "return.mjs");
    expect({ stdout, stderr }).toEqual({ stdout: "8\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("top-level return makes a plain .js file CommonJS like Node", async () => {
    using dir = tempDir("top-level-return-cjs", {
      "return.js": 'console.log("before");\nreturn;\nconsole.log("after");\n',
    });
    const { stdout, stderr, exitCode } = await run(dir, "return.js");
    expect({ stdout, stderr }).toEqual({ stdout: "before\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("top-level return stays a SyntaxError for bun -e, like node -e", async () => {
    // The [eval] entry point executes as a bare program with no CommonJS
    // function wrapper, so a top-level return cannot make it CommonJS.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", 'console.log("a"); return;'],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("SyntaxError");
    expect(exitCode).toBe(1);
  });

  test("top-level return stays a SyntaxError for piped stdin too", async () => {
    // Same carve-out as [eval]: the [stdin] entry point has no CommonJS
    // function wrapper either.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "-"],
      env: bunEnv,
      stdin: new Blob(['console.log("a"); return;']),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("SyntaxError");
    expect(exitCode).toBe(1);
  });

  test("strict-clean CommonJS code in a .mjs file keeps working", async () => {
    using dir = tempDir("forced-esm-cjs-interop-clean", {
      "clean.mjs":
        'exports.foo = 42;\nconsole.log("ran as", typeof module === "undefined" ? "esm" : "cjs", exports.foo);\n',
    });
    const { stdout, stderr, exitCode } = await run(dir, "clean.mjs");
    expect({ stdout, stderr }).toEqual({ stdout: "ran as cjs 42\n", stderr: "" });
    expect(exitCode).toBe(0);
  });
});
