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

// The runtime transpiler has minify-syntax on, which inlines a single-use `const`/`let` into the
// statement that uses it. Rewriting `const r = f(); return r;` into `return f();` creates a tail
// call the user never wrote: JSC implements proper tail calls in strict mode code (every ES
// module), so the returning function's frame would be gone from every stack trace captured inside
// `f`. The binding has to stay whenever the initializer ends in a call and the use is the value
// being returned. Everything else keeps getting inlined.
describe("single-use inlining does not create tail calls", () => {
  const transpiler = new Bun.Transpiler({ loader: "js", target: "bun" });

  function transpileBody(body: string): string {
    const code = transpiler.transformSync(`function hello(c, x) {\n${body}\n}`);
    const lines = code.trim().split("\n");
    expect(lines[0]).toBe("function hello(c, x) {");
    expect(lines.at(-1)).toBe("}");
    return lines
      .slice(1, -1)
      .map(line => line.trim())
      .join(" ");
  }

  test.each([
    ["const r = f(); return r;", "const r = f(); return r;"],
    ["let r = f(); return r;", "let r = f(); return r;"],
    ["const r = x.f(); return r;", "const r = x.f(); return r;"],
    ["const r = f.call(x); return r;", "const r = f.call(x); return r;"],
    ["const r = f?.(); return r;", "const r = f?.(); return r;"],
    ["const r = f()(); return r;", "const r = f()(); return r;"],
    ["const r = f`x`; return r;", "const r = f`x`; return r;"],
    ['const r = require("./x"); return r;', 'const r = require("./x"); return r;'],
    ['const r = require.resolve("./x"); return r;', 'const r = require.resolve("./x"); return r;'],
    ["const r = c ? f() : g(); return r;", "const r = c ? f() : g(); return r;"],
    ["const r = c ? 1 : g(); return r;", "const r = c ? 1 : g(); return r;"],
    ["const r = c || f(); return r;", "const r = c || f(); return r;"],
    ["const r = c && f(); return r;", "const r = c && f(); return r;"],
    ["const r = c ?? f(); return r;", "const r = c ?? f(); return r;"],
    ["const r = (g(), f()); return r;", "const r = (g(), f()); return r;"],
    // `a` is inlined into `b`'s initializer, which then has to stay.
    ["const a = f(); const b = a; return b;", "const b = f(); return b;"],
    // A side-effect free initializer may be substituted into a branch of the returned expression,
    // and those branches are tail positions too.
    ["const r = /* @__PURE__ */ f(); return c ? r : 0;", "const r = f(); return c ? r : 0;"],
    ["const r = /* @__PURE__ */ f(); return c || r;", "const r = f(); return c || r;"],
    ["const r = /* @__PURE__ */ f(); return c ?? r;", "const r = f(); return c ?? r;"],
  ])("keeps the binding: %s", (input, expected) => {
    expect(transpileBody(input)).toBe(expected);
  });

  test.each([
    // The use is not the returned value, so the call does not end up in tail position.
    ["const r = f(); return r.x;", "return f().x;"],
    ["const r = f(); return r();", "return f()();"],
    ["const r = f(); return r + 1;", "return f() + 1;"],
    ["const r = f(); return !r;", "return !f();"],
    ["const r = f(); return r ? 1 : 2;", "return f() ? 1 : 2;"],
    ["const r = f(); return r || c;", "return f() || c;"],
    ["const r = f(); return [r];", "return [f()];"],
    ["const r = f(); throw r;", "throw f();"],
    ["const r = f(); r.x;", "f().x;"],
    ["const r = f(); if (r) g();", "if (f()) g();"],
    // The initializer does not end in a call.
    ["const r = new F(); return r;", "return new F;"],
    ["const r = f().x; return r;", "return f().x;"],
    ["const r = f() + 1; return r;", "return f() + 1;"],
    ["const r = f() ? 1 : 2; return r;", "return f() ? 1 : 2;"],
    ["const r = f() || c; return r;", "return f() || c;"],
    ["const r = `${f()}`; return r;", "return `${f()}`;"],
    ['const r = import("./x"); return r;', 'return import("./x");'],
    ["const r = c; return r;", "return c;"],
    ["const r = 1; return r;", "return 1;"],
  ])("still inlines: %s", (input, expected) => {
    expect(transpileBody(input)).toBe(expected);
  });

  test("the initializer of an awaited call is still inlined", () => {
    const code = transpiler.transformSync("async function hello() { const r = await f(); return r; }");
    expect(code).toContain("return await f();");
  });

  // Nothing in this file's source says it is strict mode code (no import/export, no "use strict"),
  // but a `.mjs` file is still evaluated as a module, so JSC still tail calls in it.
  test.concurrent("the returning function stays in the stack trace", async () => {
    using dir = tempDir("transpiler-inlined-tail-call", {
      "chain.mjs": /* js */ `
        function captureStack() {
          return new Error("captured").stack;
        }
        function viaConst() {
          const r = captureStack();
          return r;
        }
        function* viaGenerator() {
          const r = captureStack();
          return r;
        }
        const viaArrow = () => {
          const r = captureStack();
          return r;
        };
        const frames = stack => stack.split("\\n").slice(1, 3).map(line => line.trim().split(" ")[1]);
        console.log(JSON.stringify({
          viaConst: frames(viaConst()),
          viaGenerator: frames(viaGenerator().next().value),
          viaArrow: frames(viaArrow()),
        }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "chain.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      viaConst: ["captureStack", "viaConst"],
      viaGenerator: ["captureStack", "viaGenerator"],
      viaArrow: ["captureStack", "viaArrow"],
    });
    expect(exitCode).toBe(0);
  });
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
