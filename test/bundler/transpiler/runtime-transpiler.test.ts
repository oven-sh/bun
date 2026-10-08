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

describe("sloppy function declarations in a block or a case clause", () => {
  async function run(files: Record<string, string>, ...args: string[]) {
    using dir = tempDir("transpiler-block-function", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // The expected output is what node prints for these files.
  test.concurrent("each declaration of a name assigns it to the var of the function", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        // A switch body is one block, and a clause can run without the one before it.
        "switch.cjs": `
          function twoClauses(kind) { switch (kind) { case "a": function handler() { return "A" } break; case "b": function handler() { return "B" } break; } try { return handler(); } catch (e) { return e.name; } }
          function fallthrough(k) { switch (k) { case 1: function h() { return 1 } case 2: function h() { return 2 } break; case 3: function h() { return 3 } } return typeof h === "function" ? h() : typeof h; }
          function sameClause(k) { switch (k) { case 1: function h() { return 1 } function h() { return 2 } break; } return typeof h === "function" ? h() : typeof h; }
          function leaveInClause(k) { switch (k) { case 1: function h() { return 1 } if (k) break; function h() { return 2 } } return typeof h === "function" ? h() : typeof h; }
          function defaultFirst(k) { switch (k) { default: function h() { return "d" } break; case 1: function h() { return 1 } } return h(); }
          function mixed(k) { var seen = []; switch (k) { case 1: seen.push(typeof h); function h() { return 1 } seen.push(h()); h = 7; case 2: function h() { return 2 } seen.push(typeof h); } seen.push(typeof h === "function" ? h() : h); return seen.join(); }
          function otherClause(k) { switch (k) { case 1: return typeof h; case 2: function h() {} } return typeof h; }
          function callOtherClause(k) { switch (k) { case 1: return h(); case 2: function h() { return "h" } } return typeof h; }
          module.exports = {
            twoClauses: [twoClauses("a"), twoClauses("b"), twoClauses("c")], fallthrough: [fallthrough(1), fallthrough(2), fallthrough(3), fallthrough(4)],
            sameClause: [sameClause(1), sameClause(2)], leaveInClause: [leaveInClause(1), leaveInClause(2)], defaultFirst: [defaultFirst(1), defaultFirst(2)],
            mixed: [mixed(1), mixed(2), mixed(3)], otherClause: [otherClause(1), otherClause(2), otherClause(3)],
            callOtherClause: [callOtherClause(1), callOtherClause(2), callOtherClause(3)],
          };
        `,
        "eval.cjs": `
          function leaveBetween() { exit: { function f() { return 1 } eval(""); break exit; function f() { return 2 } } return f(); }
          function reassignBetween() { { function h() { return 1 } h = 5; eval(""); function h() { return 2 } } return h; }
          function three() { { function f() { return 1 } eval(""); function f() { return 2 } function f() { return 3 } } return f(); }
          function assignBefore() { { f = 5; eval(""); function f() { return 1 } } return typeof f; }
          function leaveBefore() { a: { eval(""); break a; function f() { return 1 } } return typeof f; }
          function evalInLaterClause(k) { switch (k) { case 1: function h() { return "h" } break; case 2: eval(""); break; } return typeof h; }
          function twoClauses(kind) { switch (kind) { case "a": function handler() { return "A" } eval(""); break; case "b": function handler() { return "B" } break; } try { return handler(); } catch (e) { return e.name; } }
          module.exports = {
            leaveBetween: leaveBetween(), reassignBetween: reassignBetween(), three: three(), assignBefore: assignBefore(), leaveBefore: leaveBefore(),
            evalInLaterClause: [evalInLaterClause(1), evalInLaterClause(2), evalInLaterClause(3)],
            twoClauses: [twoClauses("a"), twoClauses("b"), twoClauses("c")],
          };
        `,
        // Strict code has the binding of the switch, which every clause can read.
        "strict.cjs": `
          "use strict";
          function otherClause(k) { try { switch (k) { case 1: return h(); case 2: function h() { return "ok" } } return "none"; } catch (e) { return e.name; } }
          function clause(k) { switch (k) { case 1: function f() { return 1 } return f(); } return typeof f; }
          module.exports = { otherClause: [otherClause(1), otherClause(2), otherClause(3)], clause: [clause(1), clause(2)] };
        `,
        "entry.cjs": `console.log(JSON.stringify({ sw: require("./switch.cjs"), direct: require("./eval.cjs"), strict: require("./strict.cjs") }));`,
      },
      "entry.cjs",
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      sw: {
        twoClauses: ["B", "B", "TypeError"],
        fallthrough: [3, 3, 3, "undefined"],
        sameClause: [2, "undefined"],
        leaveInClause: [2, "undefined"],
        defaultFirst: [1, 1],
        mixed: ["function,2,number,7", "function,2", ""],
        otherClause: ["function", "function", "undefined"],
        callOtherClause: ["h", "function", "undefined"],
      },
      direct: {
        leaveBetween: 2,
        reassignBetween: 5,
        three: 3,
        assignBefore: "number",
        leaveBefore: "undefined",
        evalInLaterClause: ["function", "undefined", "undefined"],
        twoClauses: ["B", "B", "TypeError"],
      },
      strict: { otherClause: ["ok", "none", "none"], clause: [1, "undefined"] },
    });
    expect(exitCode).toBe(0);
  });

  // Bun runs a file with no CommonJS marker as a module, which is strict code.
  // Strict code rejects two declarations of one name in a block, so these
  // files must not get both.
  const twice = `
    { function f() { return 1 } eval(""); function f() { return 2 } console.log(f()); }
    switch (1) { case 0: function g() { return 1 } case 1: function g() { return 2 } console.log(g()); }
  `;
  const strictFiles = {
    "twice.js": twice,
    "twice.mjs": twice,
    "twice.cjs": twice,
    "twice.jsx": twice + `console.log(typeof <div />);`,
    "node_modules/react/package.json": `{ "name": "react", "version": "0.0.0" }`,
    "node_modules/react/jsx-dev-runtime.js": `export function jsxDEV() { return {}; }`,
    "node_modules/react/jsx-runtime.js": `export function jsx() { return {}; }`,
    "twice.ts": `function dec(value: any, context: any) {}\nclass C { @dec m() {} }\n` + twice,
    "import.mjs": `import "./twice.cjs";`,
    "dynamic-import.mjs": `await import("./twice.cjs");`,
    "main.js": ``,
    "plugin.mjs": `
      import { plugin } from "bun";
      plugin({ name: "twice", setup(b) { b.onLoad({ filter: /\\.virtual$/ }, () => ({ loader: "js", contents: ${JSON.stringify(twice)} })); } });
      await import("./twice.virtual");
    `,
    "twice.virtual": ``,
  };
  test.concurrent.each([
    [["twice.js"], "2\n2\n"],
    [["twice.mjs"], "2\n2\n"],
    [["twice.jsx"], "2\n2\nobject\n"],
    [["twice.ts"], "2\n2\n"],
    [["import.mjs"], "2\n2\n"],
    [["dynamic-import.mjs"], "2\n2\n"],
    [["--preload", "./twice.cjs", "main.js"], "2\n2\n"],
    [["plugin.mjs"], "2\n2\n"],
  ])("a file that runs as a module still loads: bun %p", async (args, expected) => {
    const { stdout, stderr, exitCode } = await run(strictFiles, ...args);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected);
    expect(exitCode).toBe(0);
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
