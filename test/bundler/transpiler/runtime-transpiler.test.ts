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

  // The `with` object can have a property with the name of a `const` from an
  // enclosing scope. Inside the `with` body that property shadows the const.
  // Each fixture prints JSON, and each expected value is what Node prints.
  // A `.cjs` file runs in sloppy mode, which `with` needs.
  async function runSloppy(source: string) {
    using dir = tempDir("with-shadows-const", { "index.cjs": source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("a read in the body is not replaced by the value of a shadowed const", async () => {
    const { stdout, stderr, exitCode } = await runSloppy(/* js */ `
      const top = "const";
      function read(o) { const x = "const"; with (o) { return x; } }
      function closure(o) { const x = "const"; with (o) { return (() => x)(); } }
      function nested(a, b) { const x = "const"; with (a) { with (b) { return x; } } }
      function outsideAndInside(o) { const x = "const"; const before = x; with (o) { return [before, x]; } }
      function typeOf(o) { const x = "const"; with (o) { return typeof x; } }
      function topLevel(o) { with (o) { return top; } }
      // A const declared in the body's own block shadows the with object.
      function declaredInBody(o) { with (o) { const x = "const"; return x; } }
      // The cases of a switch share one scope, and the read is in a later case.
      function laterCase(k, o) { switch (k) { case 1: const x = "const"; case 2: with (o) { return x; } } }
      console.log(
        JSON.stringify({
          read: [read({ x: "with" }), read({})],
          closure: [closure({ x: "with" }), closure({})],
          nested: [nested({ x: "outer" }, {}), nested({ x: "outer" }, { x: "inner" }), nested({}, {})],
          outsideAndInside: outsideAndInside({ x: "with" }),
          typeOf: [typeOf({ x: 1 }), typeOf({})],
          topLevel: [topLevel({ top: "with" }), topLevel({})],
          declaredInBody: declaredInBody({ x: "with" }),
          laterCase: [laterCase(1, { x: "with" }), laterCase(1, {})],
        }),
      );
    `);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      read: ["with", "const"],
      closure: ["with", "const"],
      nested: ["outer", "inner", "const"],
      outsideAndInside: ["const", "with"],
      typeOf: ["number", "string"],
      topLevel: ["with", "const"],
      declaredInBody: "const",
      laterCase: ["with", "const"],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("an assignment in the body can target the with object instead of a const", async () => {
    const { stdout, stderr, exitCode } = await runSloppy(/* js */ `
      function assign(o) { const x = 1; with (o) { x = 5; } return [o.x, x]; }
      function compound(o) { const x = 1; with (o) { x += 5; } return [o.x, x]; }
      function update(o) { const x = 1; with (o) { x++; } return [o.x, x]; }
      function destructure(o) { const x = 1; with (o) { [x] = [7]; } return [o.x, x]; }
      function forIn(o) { const x = 1; with (o) { for (x in { key: 0 }); } return [o.x, x]; }
      function closure(o) { const x = 1; with (o) { (() => { x = 5; })(); } return [o.x, x]; }
      function notLiteral(o) { const x = {}; with (o) { x = 5; } return [o.x, typeof x]; }
      // Without the property, the assignment reaches the const and throws at run time.
      function noProperty(o) { const x = 1; try { with (o) { x = 5; } } catch (e) { return [e.constructor.name, x]; } }
      // https://github.com/oven-sh/bun/issues/13992, the fourth snippet
      const obj = { obj: 2 };
      with (obj) {
        obj = 10;
      }
      console.log(
        JSON.stringify({
          assign: assign({ x: 2 }),
          compound: compound({ x: 2 }),
          update: update({ x: 2 }),
          destructure: destructure({ x: 2 }),
          forIn: forIn({ x: 2 }),
          closure: closure({ x: 2 }),
          notLiteral: notLiteral({ x: 2 }),
          noProperty: noProperty({}),
          obj,
        }),
      );
    `);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      assign: [5, 1],
      compound: [7, 1],
      update: [3, 1],
      destructure: [7, 1],
      forIn: ["key", 1],
      closure: [5, 1],
      notLiteral: [5, "object"],
      noProperty: ["TypeError", 1],
      obj: { obj: 10 },
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
