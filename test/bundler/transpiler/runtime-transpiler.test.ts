import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";

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

// A parse that does not bundle keeps a top-level class and `export default` where they are
// written. One process imports every module of the tables below. `t` returns what a read
// returns, or the class of the error that it throws. `report` stores that for the module.
describe("a top-level class and `export default` stay where they are written", () => {
  type Row = [name: string, files: (stem: string) => Record<string, string>, expected: unknown];
  const throws = "THROW:ReferenceError";

  // Each module reads a binding above the statement that initializes it.
  const readsAboveTheStatement: Row[] = [
    ["typeof a class", m => ({ [`${m}.mjs`]: `report(t(() => typeof C));\nclass C {}\n` }), throws],
    ["new on a class", m => ({ [`${m}.mjs`]: `report(t(() => new C().constructor.name));\nclass C {}\n` }), throws],
    ["an exported class", m => ({ [`${m}.mjs`]: `report(t(() => typeof X));\nexport class X {}\n` }), throws],
    [
      "a default class with a name",
      m => ({ [`${m}.mjs`]: `report(t(() => typeof Named));\nexport default class Named {}\n` }),
      throws,
    ],
    [
      "a class that a function declared below it reads",
      m => ({ [`${m}.mjs`]: `report(t(probe));\nclass C {}\nfunction probe() { return typeof C; }\n` }),
      throws,
    ],
    [
      "an assignment to a class",
      m => ({
        [`${m}.mjs`]: `const seen = [t(() => { C = 1; return "assigned"; })];\nclass C {}\nseen.push(typeof C);\nreport(seen);\n`,
      }),
      [throws, "function"],
    ],
    [
      "an instance built before the class has its static properties",
      m => ({
        [`${m}.mjs`]: `
          report(t(() => make().mode));
          function make() { return new Config(); }
          class Config { constructor() { this.mode = Config.defaultMode; } }
          Config.defaultMode = "safe";
        `,
      }),
      throws,
    ],
    ...(
      [
        ["export default class {}", "export default class {}"],
        ["a default class with a name", "export default class Named {}"],
        ["export default 42", "export default 42;"],
        ["a default arrow function", "export default () => 1;"],
      ] as const
    ).map(([name, statement]): Row => [
      `${name}, read through the module namespace`,
      m => ({
        [`${m}.mjs`]: `import * as self from "./${m}.mjs";\nreport(t(() => typeof self.default));\n${statement}\n`,
      }),
      throws,
    ]),
    ["a class in a CommonJS module", m => ({ [`${m}.cjs`]: `report(t(() => typeof C));\nclass C {}\n` }), throws],
    [
      "a class that a function of an import cycle partner reads",
      m => ({
        [`${m}.mjs`]: `import { helper } from "./${m}-partner.mjs";\nreport(t(helper));\nexport class A {}\n`,
        [`${m}-partner.mjs`]: `import { A } from "./${m}.mjs";\nexport function helper() { return typeof A; }\n`,
      }),
      throws,
    ],
    [
      "a class that is the type of a decorated field, with emitDecoratorMetadata",
      m => ({
        [`${m}.ts`]: `
          const d = (..._: unknown[]) => {};
          report(t(() => { class Holder { @d dto: Dto; } return typeof Holder; }));
          class Dto {}
        `,
      }),
      throws,
    ],
    [
      "a class in a module that a plugin onLoad returns",
      m => ({ [`${m}.virtual`]: `report(t(() => typeof C));\nclass C {}\n` }),
      throws,
    ],
  ];

  // TypeScript prints `export =` as the last statement of the module.
  const exportEquals: Row[] = [
    [
      "module.exports below the statement is the object it was above it",
      m => ({
        [`${m}.cts`]: `
          const above = typeof module.exports;
          export = function handler() {};
          report([above, typeof module.exports]);
        `,
      }),
      ["object", "object"],
    ],
    [
      "a class below the statement is the export",
      m => ({
        [`${m}.cjs`]: `report([t(() => typeof require("./${m}-a.cts")), t(() => typeof require("./${m}-b.ts"))]);\n`,
        [`${m}-a.cts`]: `export = Foo;\nclass Foo {}\n`,
        [`${m}-b.ts`]: `export = Foo;\nclass Foo {}\n`,
      }),
      ["function", "function"],
    ],
  ];

  // A function declaration has its value before the module runs, and a read that runs below a
  // statement sees what the statement made. A class with a static block was never moved.
  const unaffected: Row[] = [
    [
      "a closure that is called below the class",
      m => ({ [`${m}.mjs`]: `const read = () => typeof C;\nclass C {}\nreport(t(read));\n` }),
      "function",
    ],
    [
      "a class with a static block",
      m => ({ [`${m}.mjs`]: `report(t(() => typeof W));\nclass W { static { void 0; } }\n` }),
      throws,
    ],
    [
      "export default function, read through the module namespace",
      m => ({
        [`${m}.mjs`]: `import * as self from "./${m}.mjs";\nreport(t(() => typeof self.default));\nexport default function f() {}\n`,
      }),
      "function",
    ],
    [
      "two modules that import the default class of each other",
      m => ({
        [`${m}.mjs`]: `import A from "./${m}-a.mjs";\nimport B from "./${m}-b.mjs";\nreport([A.useB(), B.useA()]);\n`,
        [`${m}-a.mjs`]: `import B from "./${m}-b.mjs";\nexport default class A { static useB() { return B.name; } }\n`,
        [`${m}-b.mjs`]: `import A from "./${m}-a.mjs";\nexport default class B { static useA() { return A.name; } }\n`,
      }),
      ["B", "A"],
    ],
  ];

  // tsc prints `Object` as the type of a union with null, so Node does not read the class.
  // Bun prints `typeof Later === "undefined" ? Object : Later`, which throws ReferenceError
  // above `class Later {}` (#44120).
  const unionType: Row = [
    "a class in a union that is the type of a decorated field, with emitDecoratorMetadata",
    m => ({
      [`${m}.ts`]: `
        const d = (..._: unknown[]) => {};
        report(t(() => { class Holder { @d later: Later | null = null; } return typeof Holder; }));
        class Later {}
      `,
    }),
    "function",
  ];

  const rows = [...readsAboveTheStatement, ...exportEquals, ...unaffected, unionType];

  async function runFixture() {
    const files: Record<string, string> = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, strictNullChecks: true },
      }),
    };
    const imports: [name: string, file: string][] = [];
    rows.forEach(([name, make], i) => {
      const made = make(`m${i}`);
      Object.assign(files, made);
      imports.push([name, `./${Object.keys(made)[0]}`]);
    });
    // The plugin is registered last, so the modules before it load with no plugin.
    imports.sort(([, a], [, b]) => Number(a.endsWith(".virtual")) - Number(b.endsWith(".virtual")));
    files["entry.mjs"] = `
      const out = {};
      let current;
      globalThis.report = value => { out[current] = value; };
      globalThis.t = read => { try { return String(read()); } catch (e) { return "THROW:" + e.constructor.name; } };
      for (const [name, file] of ${JSON.stringify(imports)}) {
        if (file.endsWith(".virtual")) {
          Bun.plugin({
            name: "virtual",
            setup(build) {
              build.onLoad({ filter: /\\.virtual$/ }, async ({ path }) => ({ contents: await Bun.file(path).text(), loader: "js" }));
            },
          });
        }
        current = name;
        await import(file);
      }
      console.log(JSON.stringify(out));
    `;
    using dir = tempDir("transpiler-source-order", files);
    const { stdout, ...result } = await bunRun(join(String(dir), "entry.mjs"));
    return { out: result.exitCode === 0 ? JSON.parse(stdout) : {}, result };
  }
  let fixture: ReturnType<typeof runFixture> | undefined;

  test("the fixture runs", async () => {
    const { out, result } = await (fixture ??= runFixture());
    expect(result).toEqual({ stderr: "", exitCode: 0, signalCode: null });
    expect(Object.keys(out).sort()).toEqual(rows.map(([name]) => name).sort());
  });

  describe("a read above the statement", () => {
    test.each(readsAboveTheStatement)("%s", async (name, _, expected) => {
      expect((await (fixture ??= runFixture())).out[name]).toEqual(expected);
    });
  });

  describe("TypeScript export =", () => {
    test.each(exportEquals)("%s", async (name, _, expected) => {
      expect((await (fixture ??= runFixture())).out[name]).toEqual(expected);
    });
  });

  describe("unaffected", () => {
    test.each(unaffected)("%s", async (name, _, expected) => {
      expect((await (fixture ??= runFixture())).out[name]).toEqual(expected);
    });
  });

  test.todo(unionType[0], async () => {
    expect((await (fixture ??= runFixture())).out[unionType[0]]).toEqual(unionType[2]);
  });

  // Node prints K. Bun runs the body of a.mjs inside the require() of c.cjs, above `class K {}`,
  // and throws ReferenceError.
  test.todo("a CommonJS module that requires the import cycle partner of its importer", async () => {
    using dir = tempDir("transpiler-source-order-cjs", {
      "a.mjs": `import c from "./c.cjs";\nimport "./b.mjs";\nconsole.log(c.make().constructor.name);\n`,
      "b.mjs": `import "./a.mjs";\n`,
      "c.cjs": `exports.make = () => new K();\nrequire("./b.mjs");\nclass K {}\n`,
    });
    expect(await bunRun(join(String(dir), "a.mjs"))).toEqual({
      stdout: "K",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test("bun build --no-bundle --target=bun prints a directive, an import and an export default function in the order they are written", async () => {
    const page = `"use client";\nimport x from "./x";\nexport default function Page() {\n  return x;\n}`;
    using dir = tempDir("transpiler-source-order-print", { "page.mjs": page + "\n" });
    expect(await bunRun(["build", "--no-bundle", "--target=bun", join(String(dir), "page.mjs")])).toEqual({
      stdout: page,
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.each([
    "class C {}",
    "export class C {}",
    "export default class N {}",
    "export default class {}",
    "export default 42;",
    "export default () => a;",
    "export default function f() {}",
  ])("Bun.Transpiler prints `%s` below the statement above it", statement => {
    const transpiler = new Bun.Transpiler({ treeShaking: true, target: "bun" });
    expect(transpiler.transformSync(`const a = 1;\n${statement}\n`)).toStartWith("const a = 1;\n");
  });
});
