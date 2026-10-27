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

// An assignment names an anonymous function or class only when IsIdentifierRef of its target is
// true (ECMA-262, the evaluation of AssignmentExpression and of AssignmentElement), and `(a)` is
// not an IdentifierRef. Each expected value is what node v26.3.0 prints for the same file.
describe("a parenthesized assignment target does not name an anonymous function or class", () => {
  async function run(file: string, source: string) {
    using dir = tempDir("parenthesized-assignment-target", { [file]: source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), file],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout: stdout.trim(), exitCode };
  }

  const names = /* js */ `
    const out = {};
    { let a; (a) = function () {}; out.function = a.name; }
    { let a; (a) = () => {}; out.arrow = a.name; }
    { let a; (a) = class {}; out.class = a.name; }
    { let a; (a) = async function () {}; out.asyncFunction = a.name; }
    { let a; (a) = function* () {}; out.generator = a.name; }
    { let a; (a) = async () => {}; out.asyncArrow = a.name; }
    { let a; ((a)) = function () {}; out.nested = a.name; }
    { let a; (a) ||= function () {}; out.or = a.name; }
    { let a = 1; (a) &&= function () {}; out.and = a.name; }
    { let a; (a) ??= function () {}; out.nullish = a.name; }
    { let a, x; x = (a) = function () {}; out.chained = [a.name, x.name]; }
    { let a; [(a) = function () {}] = []; out.arrayPattern = a.name; }
    { let a; ({ x: (a) = function () {} } = {}); out.objectPattern = a.name; }
    { let a; ({ a: (a) = function () {} } = {}); out.objectPatternSameKey = a.name; }
    { let a, k = "x"; ({ [k]: (a) = function () {} } = {}); out.objectPatternComputedKey = a.name; }
    { let a; [{ x: (a) = class {} }] = [{}]; out.nestedPattern = a.name; }
    { let a; for ([(a) = function () {}] of [[]]); out.forOf = a.name; }
    { let a; for ([(a) = function () {}] in { "": 1 }); out.forIn = a.name; }
    { let a; const o = { k: (a) = function () {} }; out.objectLiteralValue = [a.name, o.k.name]; }
    { let a; (a) = (function () {}); out.parenthesizedValue = a.name; }
    { let a; (a) = class { static seen = this.name; }; out.staticInitializer = a.seen; }
    { var merged; (merged) = function () {}; out.afterVar = merged.name; }
    { let a; (a) = function () {}; const first = a.name; a = function () {}; out.thenPlain = [first, a.name]; }
    // A plain target names the value.
    { let a; a = function () {}; out.plain = a.name; }
    { let a; a ||= () => {}; out.plainOr = a.name; }
    { let a; [a = class {}] = []; out.plainArrayPattern = a.name; }
    { let a; ({ x: a = function () {} } = {}); out.plainObjectPattern = a.name; }
    { let a; ({ a = function () {} } = {}); out.plainShorthand = a.name; }
    { let a; a = (function () {}); out.plainParenthesizedValue = a.name; }
    { let a; (a) = function named() {}; out.named = a.name; }
    { let a; a = class { static seen = this.name; }; out.plainStaticInitializer = a.seen; }
    console.log(JSON.stringify(out));
  `;
  const expectedNames = {
    function: "",
    arrow: "",
    class: "",
    asyncFunction: "",
    generator: "",
    asyncArrow: "",
    nested: "",
    or: "",
    and: "",
    nullish: "",
    chained: ["", ""],
    arrayPattern: "",
    objectPattern: "",
    objectPatternSameKey: "",
    objectPatternComputedKey: "",
    nestedPattern: "",
    forOf: "",
    forIn: "",
    objectLiteralValue: ["", ""],
    parenthesizedValue: "",
    staticInitializer: "",
    afterVar: "",
    thenPlain: ["", "a"],
    plain: "a",
    plainOr: "a",
    plainArrayPattern: "a",
    plainObjectPattern: "a",
    plainShorthand: "a",
    plainParenthesizedValue: "a",
    named: "named",
    plainStaticInitializer: "a",
  };

  test.concurrent.each(["names.mjs", "names.cjs", "names.ts"])("%s", async file => {
    const { stdout, exitCode } = await run(file, names);
    expect({ names: JSON.parse(stdout), exitCode }).toEqual({ names: expectedNames, exitCode: 0 });
  });

  test.concurrent("in sloppy mode: a with statement and an undeclared global", async () => {
    const { stdout, exitCode } = await run(
      "sloppy.cjs",
      /* js */ `
        const out = {};
        var w;
        with ({}) { (w) = function () {}; }
        out.with = w.name;
        const scope = { inScope: null };
        with (scope) { (inScope) = function () {}; }
        out.withProperty = scope.inScope.name;
        (sloppyGlobal) = function () {};
        out.sloppyGlobal = globalThis.sloppyGlobal.name;
        plainGlobal = function () {};
        out.plainGlobal = globalThis.plainGlobal.name;
        console.log(JSON.stringify(out));
      `,
    );
    expect({ names: JSON.parse(stdout), exitCode }).toEqual({
      names: { with: "", withProperty: "", sloppyGlobal: "", plainGlobal: "plainGlobal" },
      exitCode: 0,
    });
  });

  // node removes the types and leaves the parentheses. tsc prints `a = function () {}` for
  // `(a as any) = function () {}`.
  test.concurrent("where TypeScript syntax is removed from the parentheses", async () => {
    const { stdout, exitCode } = await run(
      "types.ts",
      /* ts */ `
        const out: Record<string, unknown> = {};
        { let a: any; (a as any) = function () {}; out.as = a.name; }
        { let a: any; (a satisfies any) ||= () => {}; out.satisfies = a.name; }
        { let a: any; (a!) = class {}; out.nonNull = a.name; }
        { let a: any; (a)! = function () {}; out.nonNullAfter = a.name; }
        { let a: any; ((a as any)) = function () {}; out.nestedAs = a.name; }
        { let a: any; [(a as any) = function () {}] = []; out.arrayPattern = a.name; }
        { let a: any; ({ x: (a as any) = function () {} } = {} as any); out.objectPattern = a.name; }
        { let a: any; (a) = function () {} as any; out.valueAs = a.name; }
        { let a: any; a = function () {} as any; out.plain = a.name; }
        console.log(JSON.stringify(out));
      `,
    );
    expect({ names: JSON.parse(stdout), exitCode }).toEqual({
      names: {
        as: "",
        satisfies: "",
        nonNull: "",
        nonNullAfter: "",
        nestedAs: "",
        arrayPattern: "",
        objectPattern: "",
        valueAs: "",
        plain: "a",
      },
      exitCode: 0,
    });
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
