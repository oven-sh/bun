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

// The runtime transpiler moves a single-use `let`/`const` into the statement
// after it.
describe.concurrent("a single-use declaration moved into the next statement", () => {
  const shortCircuit = /* js */ `
    let calls = 0;
    const fn = () => ++calls;
    function andInArray() { let x = fn(); let k = 0; return [k && x]; }
    function orInArray() { let x = fn(); let k = 1; return [k || x]; }
    function nullishInArray() { let x = fn(); let k = 1; return [k ?? x]; }
    function and() { let x = fn(); let k = 0; return k && x; }
    function or() { let x = fn(); let k = 1; return k || x; }
    function nullish() { let x = fn(); let k = 1; return k ?? x; }
    const values = [andInArray(), orInArray(), nullishInArray(), and(), or(), nullish()];
    console.log(JSON.stringify({ values, calls }));
  `;
  // Every case of a switch is in one scope, so a later case can use the declaration.
  const switchCases = /* js */ `
    var sink;
    const use = x => x;
    function fallThrough(v) { switch (v) { case 0: let a = [1]; let k = 0; k && use(a); case 1: return a; } }
    function comparison(v) { switch (v) { case 0: let a = [1]; let k = 5; (k > 3) && use(a); case 1: return a; } }
    function laterClosure(v) { switch (v) { case 0: let a = use(1); throw a; case 1: return () => a; } }
    function earlierClosure(v) { switch (v) { case 1: return () => a; case 0: let a = use(1); throw a; } }
    function accumulate(v) { switch (v) { case 3: let acc = []; acc.push(3); case 2: acc.push(2); return acc; } }
    function evalInLaterCase(v, code) { switch (v) { case 0: let a = 1; use(a); case 1: return eval(code); } }
    function shadowsParameter(k, x) { switch (k) { case 0: let x = use(7); sink = x; case 1: return x; } }
    function writesOuter(k) { let x = "outer"; switch (k) { case 0: let x = use(1); sink = x; case 1: x = "inner-write"; } return x; }
    function sameCase(v) { switch (v) { case 0: let a = use(1); return a + 1; default: return null; } }
    const attempt = f => {
      try { return f(); } catch (e) { return e.constructor.name + (/initiali[sz]/.test(e.message) ? " (TDZ)" : ": " + e.message); }
    };
    console.log(JSON.stringify({
      fallThrough: attempt(() => fallThrough(0)),
      comparison: attempt(() => comparison(0)),
      laterClosure: attempt(() => laterClosure(1)()),
      earlierClosure: attempt(() => earlierClosure(1)()),
      accumulate: attempt(() => accumulate(3)),
      evalInLaterCase: attempt(() => evalInLaterCase(0, "a")),
      shadowsParameter: attempt(() => shadowsParameter(0, "parameter")),
      writesOuter: attempt(() => writesOuter(0)),
      sameCase: attempt(() => sameCase(0)),
    }));
  `;
  async function run(source: string, how: "mjs" | "cjs" | "-e", flags: string[] = []) {
    using dir = tempDir("transpiler-single-use", how === "-e" ? {} : { [`fixture.${how}`]: source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, ...(how === "-e" ? ["-e", source] : [`fixture.${how}`])],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim() && JSON.parse(stdout), stderr, exitCode };
  }

  test.each(["mjs", "cjs", "-e"] as const)(
    "a call still runs when a literal moves in front of && || ?? (%s)",
    async how => {
      expect(await run(shortCircuit, how)).toEqual({
        stdout: { values: [[0], [1], [1], 0, 1, 1], calls: 6 },
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test.each(["mjs", "cjs", "-e"] as const)(
    "a declaration in a switch case stays for the cases after it (%s)",
    async how => {
      expect(await run(switchCases, how)).toEqual({
        stdout: {
          fallThrough: [1],
          comparison: [1],
          laterClosure: "ReferenceError (TDZ)",
          earlierClosure: "ReferenceError (TDZ)",
          accumulate: [3, 2],
          evalInLaterCase: 1,
          shadowsParameter: 7,
          writesOuter: "outer",
          sameCase: 2,
        },
        stderr: "",
        exitCode: 0,
      });
    },
  );
});
