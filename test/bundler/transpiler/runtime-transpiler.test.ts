import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

// https://github.com/oven-sh/bun/issues/30932
describe("switch-case const does not leak across cases", () => {
  test("literal-initialized const is not inlined into sibling case", () => {
    // Pre-fix, Bun's const-prefix inliner treated `const CONSTANT = 2` in
    // `case "*"` as an inlineable value and replaced `CONSTANT` in `case "a"`
    // with `2`, so the second case returned "a=2". Per the spec the inner
    // `const CONSTANT` hoists into the switch's lexical scope and shadows
    // anything outside, so a reference from a sibling case that runs before
    // the declaration must throw a TDZ ReferenceError.
    function test(action) {
      switch (action) {
        case "*":
          const CONSTANT = 2;
          return "matched " + CONSTANT;
        case "a":
          return "a=" + CONSTANT;
      }
    }
    expect(() => test("a")).toThrow(ReferenceError);
    expect(test("*")).toBe("matched 2");
  });

  test("non-foldable const is not substituted out of sibling case", () => {
    // Pre-fix, the single-use-substitution pass saw `use_count_estimate == 1`
    // for `const X = Math.random()` while visiting `case "*"` (the reference
    // in `case "a"` had not been visited yet), inlined the `Math.random()`
    // call into the case "*" return, and deleted the declaration — leaving
    // `case "a"` with a dangling reference that would throw
    // `X is not defined` instead of a TDZ error.
    function test(action) {
      switch (action) {
        case "*":
          const X = Math.random();
          return "* " + X;
        case "a":
          return "a " + X;
      }
    }
    expect(() => test("a")).toThrow(
      expect.objectContaining({
        name: "ReferenceError",
        message: expect.stringContaining("before initialization"),
      }),
    );
  });

  test("outer const is shadowed by inner const, not leaked through", () => {
    // Matches the shape of the reported repro: an outer `CONSTANT = 1` is
    // shadowed by a switch-scoped `const CONSTANT = 2`. Bun used to resolve
    // the `case "a"` reference to the inlined `2`; Node and the spec require
    // a TDZ ReferenceError because the inner binding hoists over the entire
    // switch body.
    const CONSTANT = 1;
    function test(action) {
      switch (action) {
        case "*":
          const CONSTANT = 2;
          return "* " + CONSTANT;
        case "a":
          return "a " + CONSTANT;
      }
      return "outer=" + CONSTANT;
    }
    expect(() => test("a")).toThrow(ReferenceError);
    expect(test("*")).toBe("* 2");
    // Outside the switch body the outer `CONSTANT` is still visible.
    expect(test("other")).toBe("outer=1");
  });

  test("declaration + use in the same case still works", () => {
    function test() {
      switch ("a") {
        case "a": {
          const X = 42;
          return X;
        }
      }
    }
    expect(test()).toBe(42);
  });

  test("fall-through from declaring case still initializes binding", () => {
    function test() {
      switch ("a") {
        case "a":
          const X = 100;
        case "b":
          return "X=" + X;
      }
    }
    expect(test()).toBe("X=100");
  });
});
