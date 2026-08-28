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

// The runtime transpiler folds constant expressions, inlines single-use
// constants and substitutes defines. A fold that turns a call target or a
// template tag into a property access must not change `this`, and an optional
// chain that lands in tag position must stay parenthesized. Node prints the
// same values for every fixture here.
describe("this binding for call targets and template tags", () => {
  async function run(files: Record<string, string>, entry: string, bunArgs: string[] = []) {
    using dir = tempDir("transpiler-this-binding", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...bunArgs, entry],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return stdout.trim().split("\n");
  }

  // `this` is undefined for an unbound call in a module and the object for a
  // method call.
  const describeThis = `
    const o = { f() { return this === o ? "o" : this === undefined ? "undefined" : typeof this } };
    function f() { return this === undefined ? "undefined" : typeof this }
  `;

  test.concurrent("template tag folds", async () => {
    const lines = await run(
      {
        "entry.mjs": `
          ${describeThis}
          function single() { const t = o.f; return t\`x\`; }
          function singleIndex() { const t = o["f"]; return t\`x\`; }
          console.log(o.f\`x\`, (o.f)\`x\`, o["f"]\`x\`, { foo: f }.foo\`\`, ({ foo: f }).foo\`\`);
          console.log((0, o.f)\`x\`, (true && o.f)\`x\`, (false || o.f)\`x\`, (null ?? o.f)\`x\`, (1 ? o.f : 0)\`x\`, (0 ? 1 : o.f)\`x\`);
          console.log(single(), singleIndex(), (0, f)\`\`, (true && f)\`\`);
        `,
      },
      "entry.mjs",
    );
    expect(lines).toEqual([
      "o o o object object",
      "undefined undefined undefined undefined undefined undefined",
      "undefined undefined undefined undefined",
    ]);
  });

  test.concurrent("call target folds", async () => {
    const lines = await run(
      {
        "entry.mjs": `
          ${describeThis}
          function single() { const t = o.f; return t(); }
          function singleIndex() { const t = o["f"]; return t(); }
          console.log(o.f(), (o.f)(), o["f"](), o.f?.(), o?.f(), { foo: f }.foo(), ({ foo: f }).foo());
          console.log((0, o.f)(), (true && o.f)(), (false || o.f)(), (null ?? o.f)(), (1 ? o.f : 0)(), (0 ? 1 : o.f)());
          console.log(single(), singleIndex(), (0, f)(), (true && f)());
        `,
      },
      "entry.mjs",
    );
    expect(lines).toEqual([
      "o o o o o object object",
      "undefined undefined undefined undefined undefined undefined",
      "undefined undefined undefined undefined",
    ]);
  });

  test.concurrent("optional chains in tag position", async () => {
    const lines = await run(
      {
        "entry.mjs": `
          function tag(a) { const t = a?.b; return t\`x\`; }
          function tagIndex(a) { const t = a?.["b"]; return t\`x\`; }
          function tagDeep(a) { const t = a?.b.c; return t\`x\`; }
          const y = { z() { return "y.z" } };
          const w = { v: { z() { return this === w.v ? "w.v" : String(this) } } };
          console.log(tag({ b: () => "ok" }), tagIndex({ b: () => "ok" }), tagDeep({ b: { c: () => "ok" } }));
          console.log((y?.z)\`\`, (y?.["z"])\`\`, (w?.v).z\`\`, (true && y?.z)\`\`);
        `,
      },
      "entry.mjs",
    );
    expect(lines).toEqual(["ok ok ok", "y.z y.z w.v y.z"]);
  });

  test.concurrent("defines", async () => {
    const lines = await run(
      {
        "entry.mjs": `
          ${describeThis}
          o.C = class { kind = "ctor" };
          console.log(callee(), callee\`x\`, plain(), plain\`x\`, new ctor().kind, callee.name);
        `,
      },
      "entry.mjs",
      ["--define", "callee=o.f", "--define", "plain=f", "--define", "ctor=o.C"],
    );
    expect(lines).toEqual(["undefined undefined undefined undefined ctor f"]);
  });

  test.concurrent("CommonJS imports", async () => {
    const lines = await run(
      {
        "entry.mjs": `
          import def from "./default.cjs";
          import { who } from "./lib.cjs";
          import * as ns from "./lib.cjs";
          console.log(def(), def\`\`, who(), who\`\`, ns.who(), ns.who\`\`, (0, ns.who)(), (0, ns.who)\`\`);
        `,
        "default.cjs": `
          "use strict";
          module.exports = function () { return this === undefined ? "undefined" : typeof this; };
        `,
        "lib.cjs": `
          "use strict";
          exports.who = function () { return this === undefined ? "undefined" : this === exports ? "exports" : typeof this; };
        `,
      },
      "entry.mjs",
    );
    expect(lines).toEqual(["undefined undefined undefined undefined object object undefined undefined"]);
  });
});
