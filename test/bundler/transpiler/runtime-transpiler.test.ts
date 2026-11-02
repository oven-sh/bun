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

  // The `with` object can have a property with the name of a `const` from an
  // enclosing scope. Inside the `with` body that property shadows the const,
  // so a read there is a lookup at run time and not the value of the const.
  // Each expected value is what Node prints. A `.cjs` file runs in sloppy
  // mode, which `with` needs.
  test.concurrent("a read in the body is not replaced by the value of a shadowed const", async () => {
    using dir = tempDir("with-shadows-const", {
      "index.cjs": /* js */ `
        const top = "const";
        function read(o) { const x = "const"; with (o) { return x; } }
        function closure(o) { const x = "const"; with (o) { return () => x; } }
        function nested(a, b) { const x = "const"; with (a) { with (b) { return x; } } }
        function outsideAndInside(o) { const x = "const"; const before = x; with (o) { return [before, x]; } }
        function typeOf(o) { const x = "const"; with (o) { return typeof x; } }
        function callTarget(o) { const x = "const"; with (o) { try { return x(); } catch (e) { return e.constructor.name; } } }
        function topLevel(o) { with (o) { return top; } }
        function deleteIt(o) { const x = "const"; with (o) { return [delete x, "x" in o]; } }
        // Each read asks the object, also when the object does not have the name.
        function proxyHas() {
          const x = "const";
          let seen = 0;
          const o = new Proxy({}, { has(target, key) { if (key === "x") seen++; return false; } });
          with (o) { x; x; }
          return seen;
        }
        function unscopables() { const x = "const"; with ({ x: "with", [Symbol.unscopables]: { x: true } }) { return x; } }
        // A const declared in the body's own block shadows the with object.
        function declaredInBody(o) { with (o) { const x = "const"; return x; } }
        // The cases of a switch share one scope, and the read is in a later case.
        function laterCase(k, o) {
          try {
            switch (k) { case 1: const x = "const"; case 2: with (o) { return x; } }
          } catch (e) { return e.constructor.name; }
        }
        console.log(
          JSON.stringify({
            read: [read({ x: "with" }), read({})],
            closure: [closure({ x: "with" })(), closure({})()],
            nested: [nested({ x: "outer" }, {}), nested({ x: "outer" }, { x: "inner" }), nested({}, {})],
            outsideAndInside: outsideAndInside({ x: "with" }),
            typeOf: [typeOf({ x: 1 }), typeOf({})],
            callTarget: [callTarget({ x() { return this.tag; }, tag: "with" }), callTarget({})],
            topLevel: [topLevel({ top: "with" }), topLevel({})],
            deleteIt: [deleteIt({ x: "with" }), deleteIt({})],
            proxyHas: proxyHas(),
            unscopables: unscopables(),
            declaredInBody: declaredInBody({ x: "with" }),
            laterCase: [laterCase(1, { x: "with" }), laterCase(1, {}), laterCase(2, { x: "with" }), laterCase(2, {})],
          }),
        );
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      read: ["with", "const"],
      closure: ["with", "const"],
      nested: ["outer", "inner", "const"],
      outsideAndInside: ["const", "with"],
      typeOf: ["number", "string"],
      callTarget: ["with", "TypeError"],
      topLevel: ["with", "const"],
      deleteIt: [
        [true, false],
        [false, false],
      ],
      proxyHas: 2,
      unscopables: "const",
      declaredInBody: "const",
      laterCase: ["with", "const", "with", "ReferenceError"],
    });
    expect(exitCode).toBe(0);
  });

  // tsc computes an enum member when it compiles: `A = x` is emitted as `A = 1`.
  // So a const in a member initializer is still replaced in a `with` body.
  test.concurrent("a const in an enum member initializer in the body is still replaced", async () => {
    using dir = tempDir("with-enum-initializer", {
      "index.cts": /* ts */ `
        const x = 1;
        function f(o: any) { with (o) { enum E { A = x, B } return [E.A, E.B]; } }
        console.log(JSON.stringify([f({}), f({ x: 5 })]));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "[[1,2],[1,2]]\n", stderr: "", exitCode: 0 });
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
