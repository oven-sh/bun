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

// A class field initializer and a class static block run as a method call, so
// `new.target` is undefined in them. JavaScriptCore throws
// "ReferenceError: Can't find private variable: PrivateSymbol.newTargetLocal"
// on entry to an arrow function that contains such a class and has no function
// around it.
test("new.target in a class field initializer or a class static block is undefined", async () => {
  using dir = tempDir("transpiler-new-target-class-field", {
    "index.mjs": `
      const results = {};
      async function t(name, f) {
        try {
          results[name] = await f();
        } catch (e) {
          results[name] = "throws " + e;
        }
      }

      // The class is inside an arrow function with no function around it.
      await t("instance field", () => { class A { x = typeof new.target; } return new A().x; });
      await t("static field", () => { class A { static x = typeof new.target; } return A.x; });
      await t("static block", () => { let r; class A { static { r = typeof new.target; } } return r; });
      await t("private field", () => { class A { #x = typeof new.target; get x() { return this.#x; } } return new A().x; });
      await t("class expression", () => new (class { x = typeof new.target; })().x);
      await t("derived class", () => { class B {} class A extends B { x = typeof new.target; } return new A().x; });
      await t("arrow in arrow", () => (() => { class A { x = typeof new.target; } return new A().x; })());
      await t("arrow in field", () => { class A { x = (() => typeof new.target)(); } return new A().x; });
      await t("key of a class in a field", () => { class A { x = class { static [typeof new.target] = 1; }; } return Object.keys(new A().x)[0]; });
      await t("async arrow", async () => { class A { x = typeof new.target; } return new A().x; });

      // A static block in an arrow function throws with a function around the arrow function too.
      await t("static block, arrow in function", function () { return (() => { let r; class A { static { r = typeof new.target; } } return r; })(); });

      // The transpiler moves the initializer of an auto-accessor into the constructor.
      await t("auto-accessor", function () { class A { accessor x = typeof new.target; } return new A().x; });

      // These see the new.target of a function, and keep it.
      await t("function in field", () => { class A { f = function () { return new.target; }; } const f = new A().f; return new f() === f; });
      await t("function in static block", () => { let f; class A { static { f = function () { return new.target; }; } } return new f() === f; });
      await t("constructor", () => { class A { constructor() { this.x = new.target; } } return new A().x === A; });
      await t("field key", () => { let k; function F() { class A { [new.target.name] = 1; } k = Object.keys(new A())[0]; } new F(); return k; });
      await t("extends clause", () => { let ok; function F() { class A extends new.target.Base {} ok = new A() instanceof F.Base; } F.Base = class {}; new F(); return ok; });

      console.log(JSON.stringify(results));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Debug builds print an ASAN warning here.
  expect(stderr.split("\n").filter(line => line && !line.startsWith("WARNING: ASAN"))).toEqual([]);
  expect(JSON.parse(stdout)).toEqual({
    "instance field": "undefined",
    "static field": "undefined",
    "static block": "undefined",
    "private field": "undefined",
    "class expression": "undefined",
    "derived class": "undefined",
    "arrow in arrow": "undefined",
    "arrow in field": "undefined",
    "key of a class in a field": "undefined",
    "async arrow": "undefined",
    "static block, arrow in function": "undefined",
    "auto-accessor": "undefined",
    "function in field": true,
    "function in static block": true,
    "constructor": true,
    "field key": "F",
    "extends clause": true,
  });
  expect(exitCode).toBe(0);
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
