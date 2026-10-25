import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import path from "node:path";

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

// TypeScript removes an import that no value uses. tsconfig `verbatimModuleSyntax` and the two
// settings that it replaced keep it, so that the module still runs. `bun run` and a bundle
// keep the statement and drop the unused names. A transform prints the names too.
describe("tsconfig unused imports", () => {
  async function run(cwd: string, args: string[], env: Record<string, string | undefined> = bunEnv) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const files = {
    "effect.ts": `console.log("effect"); export const unused = 1;`,
    "type-only.ts": `console.log("type-only"); export type T = number;`,
    // `SomeType` has no export at run time. The statement stays and the name goes.
    "types.ts": `console.log("types"); export type SomeType = number;`,
    "erased.ts": `console.log("erased"); export type Erased = number;`,
    "entry.ts": `
      import { unused } from "./effect";
      import { type T } from "./type-only";
      import { SomeType } from "./types";
      import type { Erased } from "./erased";
      const x: T | SomeType | Erased = 1;
      console.log("entry", x);
    `,
  };
  const keepStatement = "effect\ntype-only\ntypes\nentry 1\n";
  const keepValues = "effect\ntypes\nentry 1\n";
  const verbatim = JSON.stringify({ compilerOptions: { verbatimModuleSyntax: true } });

  describe.each([
    {
      name: "verbatimModuleSyntax",
      compilerOptions: { verbatimModuleSyntax: true },
      output: keepStatement,
      transformed: `import { unused } from "./effect";\nimport {} from "./type-only";\nimport { SomeType } from "./types";\n`,
    },
    {
      name: 'importsNotUsedAsValues: "preserve"',
      compilerOptions: { importsNotUsedAsValues: "preserve" },
      output: keepStatement,
      transformed: `import"./effect";\nimport"./type-only";\nimport"./types";\n`,
    },
    {
      name: 'importsNotUsedAsValues: "error"',
      compilerOptions: { importsNotUsedAsValues: "error" },
      output: keepStatement,
      transformed: `import"./effect";\nimport"./type-only";\nimport"./types";\n`,
    },
    {
      name: "preserveValueImports",
      compilerOptions: { preserveValueImports: true },
      output: keepValues,
      transformed: `import { unused } from "./effect";\nimport { SomeType } from "./types";\n`,
    },
  ])("$name", ({ compilerOptions, output, transformed }) => {
    const tsconfig = JSON.stringify({ compilerOptions });

    test.concurrent("bun run", async () => {
      using dir = tempDir("ts-unused-imports-run", { ...files, "tsconfig.json": tsconfig });
      expect(await run(String(dir), ["entry.ts"])).toEqual({ stdout: output, stderr: "", exitCode: 0 });
    });

    test.concurrent("bun build", async () => {
      using dir = tempDir("ts-unused-imports-build", { ...files, "tsconfig.json": tsconfig });
      const build = await run(String(dir), ["build", "--target=bun", "--outfile=out.js", "entry.ts"]);
      expect(build.stderr).toBe("");
      expect(await run(String(dir), ["out.js"])).toEqual({ stdout: output, stderr: "", exitCode: 0 });
    });

    test.concurrent("bun build --no-bundle", async () => {
      using dir = tempDir("ts-unused-imports-no-bundle", { ...files, "tsconfig.json": tsconfig });
      expect(await run(String(dir), ["build", "--no-bundle", "entry.ts"])).toEqual({
        stdout: transformed + `const x = 1;\nconsole.log("entry", x);\n`,
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("extends inherits the setting, and the child can turn it off", async () => {
      const off = Object.fromEntries(
        Object.keys(compilerOptions).map(key => [key, key === "importsNotUsedAsValues" ? "remove" : false]),
      );
      using dir = tempDir("ts-unused-imports-extends", {
        ...files,
        "base.json": tsconfig,
        "tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: { strict: true } }),
        "off/tsconfig.json": JSON.stringify({ extends: "../base.json", compilerOptions: off }),
        "off/own.ts": `import { unused } from "../effect"; console.log("own");`,
      });
      expect(await run(String(dir), ["entry.ts"])).toEqual({ stdout: output, stderr: "", exitCode: 0 });
      expect(await run(path.join(String(dir), "off"), ["own.ts"])).toEqual({
        stdout: "own\n",
        stderr: "",
        exitCode: 0,
      });
    });
  });

  test.concurrent("no setting removes the imports", async () => {
    using dir = tempDir("ts-unused-imports-default", { ...files, "tsconfig.json": "{}" });
    expect(await run(String(dir), ["entry.ts"])).toEqual({ stdout: "entry 1\n", stderr: "", exitCode: 0 });
  });

  describe("every way to load a file", () => {
    const entryPoints = {
      ...files,
      "tsconfig.json": verbatim,
      "required.cjs": `require("./entry.ts");`,
      // A static import of a module that is not the entry point is transpiled on the thread pool.
      "static.mjs": `import "./entry.ts";`,
      "dynamic.mjs": `await Promise.resolve(); await import("./entry.ts");`,
      "worker.mjs": `
        const worker = new Worker(new URL("./entry.ts", import.meta.url).href);
        await new Promise(resolve => worker.addEventListener("close", resolve));
      `,
      "entry.test.ts": `
        import { unused } from "./effect";
        import { test } from "bun:test";
        test("runs", () => {});
      `,
      "api.mjs": `
        const build = await Bun.build({ entrypoints: ["./entry.ts"], target: "bun" });
        await Bun.write("api-out.mjs", await build.outputs[0].text());
        await import("./api-out.mjs");
      `,
    };

    test.concurrent.each(["required.cjs", "static.mjs", "dynamic.mjs", "worker.mjs", "api.mjs"])("%s", async entry => {
      using dir = tempDir("ts-unused-imports-entry", entryPoints);
      expect(await run(String(dir), [entry])).toEqual({ stdout: keepStatement, stderr: "", exitCode: 0 });
    });

    test.concurrent("bun test", async () => {
      using dir = tempDir("ts-unused-imports-test", entryPoints);
      const { stdout, exitCode } = await run(String(dir), ["test", "entry.test.ts"]);
      expect(stdout).toEndWith("effect\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("bun -e", async () => {
      using dir = tempDir("ts-unused-imports-eval", entryPoints);
      const result = await run(String(dir), ["-e", `import { unused } from "./effect"; console.log("eval");`]);
      expect(result).toEqual({ stdout: "effect\neval\n", stderr: "", exitCode: 0 });
    });

    // The dev server scans the imports of a module with its hot-reload transform.
    test.concurrent("dev server", async () => {
      using dir = tempDir("ts-unused-imports-dev-server", {
        ...entryPoints,
        "index.html": `<!DOCTYPE html><html><body><script type="module" src="./entry.ts"></script></body></html>`,
        "serve.ts": `
          import page from "./index.html";
          using server = Bun.serve({ port: 0, development: true, routes: { "/": page } });
          const html = await (await fetch(server.url)).text();
          const src = html.match(/src="(\\/_bun\\/client\\/[^"]+)"/)![1];
          const script = await (await fetch(new URL(src, server.url))).text();
          const modules = ["effect", "type-only", "types", "erased"];
          console.log(modules.filter(name => script.includes('console.log("' + name + '")')).join(" "));
        `,
      });
      const { stdout, exitCode } = await run(String(dir), ["serve.ts"]);
      expect(stdout).toBe("effect type-only types\n");
      expect(exitCode).toBe(0);
    });
  });

  // The tsconfig.json nearest to a file decides, wherever bun starts. A file in node_modules
  // takes none: its package was not written for the settings of the project that installs it.
  describe("which tsconfig.json governs a file", () => {
    const off = JSON.stringify({ compilerOptions: { verbatimModuleSyntax: false } });
    const importer = (name: string) => `import { unused } from "./effect"; console.log("${name}");`;
    const effect = (name: string) => `console.log("${name} effect"); export const unused = 1;`;
    const modules = ["./app/index.ts", "./app/nested/index.ts", "./lib/index.ts", "dep", "dep-with-tsconfig"];
    const scope = {
      "tsconfig.json": off,
      "app/tsconfig.json": verbatim,
      "app/index.ts": importer("app"),
      "app/effect.ts": effect("app"),
      "app/nested/index.ts": importer("nested"),
      "app/nested/effect.ts": effect("nested"),
      "lib/index.ts": importer("lib"),
      "lib/effect.ts": effect("lib"),
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "./index.ts" }),
      "node_modules/dep/index.ts": importer("dep"),
      "node_modules/dep/effect.ts": effect("dep"),
      "node_modules/dep-with-tsconfig/package.json": JSON.stringify({ name: "dep-with-tsconfig", main: "./index.ts" }),
      "node_modules/dep-with-tsconfig/tsconfig.json": verbatim,
      "node_modules/dep-with-tsconfig/index.ts": importer("dep-with-tsconfig"),
      "node_modules/dep-with-tsconfig/effect.ts": effect("dep-with-tsconfig"),
      "static.ts": modules.map(specifier => `import "${specifier}";`).join("\n"),
      "dynamic.ts": `await Promise.resolve(); for (const specifier of ${JSON.stringify(modules)}) await import(specifier);`,
      "required.cjs": `for (const specifier of ${JSON.stringify(modules)}) require(specifier);`,
      "on.json": verbatim,
    };
    const expected = "app effect\napp\nnested effect\nnested\nlib\ndep\ndep-with-tsconfig\n";

    test.concurrent.each([
      ["static.ts", "."],
      ["static.ts", "app"],
      ["static.ts", "lib"],
      ["static.ts", "node_modules/dep"],
      ["dynamic.ts", "lib"],
      ["required.cjs", "app"],
    ])("%s started in %s", async (entry, cwd) => {
      using dir = tempDir("ts-unused-imports-scope", scope);
      const result = await run(path.join(String(dir), cwd), [path.join(String(dir), entry)]);
      expect(result).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
    });

    test.concurrent("bun build gives the same answer", async () => {
      using dir = tempDir("ts-unused-imports-scope-build", scope);
      const build = await run(path.join(String(dir), "lib"), [
        "build",
        "--target=bun",
        "../static.ts",
        "--outfile=../out.js",
      ]);
      expect(build.stderr).toBe("");
      expect(await run(String(dir), ["out.js"])).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
    });

    test.concurrent("--tsconfig-override replaces the tsconfig.json of every directory", async () => {
      using dir = tempDir("ts-unused-imports-scope-override", scope);
      expect(await run(String(dir), ["--tsconfig-override=on.json", "static.ts"])).toEqual({
        stdout: "app effect\napp\nnested effect\nnested\nlib effect\nlib\ndep\ndep-with-tsconfig\n",
        stderr: "",
        exitCode: 0,
      });
      expect(await run(path.join(String(dir), "app"), ["--tsconfig-override=../tsconfig.json", "index.ts"])).toEqual({
        stdout: "app\n",
        stderr: "",
        exitCode: 0,
      });
      const build = await run(String(dir), [
        "build",
        "--target=bun",
        "--tsconfig-override=on.json",
        "static.ts",
        "--outfile=out.js",
      ]);
      expect(build.stderr).toBe("");
      expect(await run(String(dir), ["out.js"])).toEqual({
        stdout: "app effect\napp\nnested effect\nnested\nlib effect\nlib\ndep\ndep-with-tsconfig\n",
        stderr: "",
        exitCode: 0,
      });
    });

    // A plugin's source has no tsconfig.json of its own: the one of the working directory
    // decides. A source for a path in node_modules takes none.
    test.concurrent("a plugin's source takes the tsconfig.json of the working directory", async () => {
      const names = ["onLoad", "namespace", "module", "dependency"];
      using dir = tempDir("ts-unused-imports-plugin", {
        "tsconfig.json": verbatim,
        ...Object.fromEntries(names.map(name => [`effect-${name}.ts`, effect(name)])),
        "file.virtual": "",
        "node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "./file.virtual" }),
        "node_modules/dep/file.virtual": "",
        "sources.ts": `
          const source = (name: string) => ({
            contents: "import { unused } from " + JSON.stringify(import.meta.dir + "/effect-" + name) + '; console.log("' + name + '");',
            loader: "ts" as const,
          });
          export function setup(build: Bun.PluginBuilder) {
            build.onLoad({ filter: /\\.virtual$/ }, args => source(args.path.includes("node_modules") ? "dependency" : "onLoad"));
            build.onResolve({ filter: /^ns:/ }, args => ({ path: args.path.slice(3), namespace: "ns" }));
            build.onLoad({ filter: /.*/, namespace: "ns" }, () => source("namespace"));
          }
          export const virtualModule = () => source("module");
        `,
        "preload.ts": `
          import { setup, virtualModule } from "./sources";
          Bun.plugin({
            name: "sources",
            setup(build) {
              setup(build);
              build.module("virtual:module", virtualModule);
            },
          });
        `,
        "runtime.ts": `import "./file.virtual"; import "ns:source"; import "virtual:module"; import "dep";`,
        "entry.ts": `import "./file.virtual"; import "ns:source"; import "dep";`,
        "bundle.ts": `
          import { setup } from "./sources";
          const build = await Bun.build({ entrypoints: ["./entry.ts"], target: "bun", plugins: [{ name: "sources", setup }] });
          await Bun.write("out.mjs", await build.outputs[0].text());
          await import("./out.mjs");
        `,
      });
      expect(await run(String(dir), ["--preload=./preload.ts", "runtime.ts"])).toEqual({
        stdout: "onLoad effect\nonLoad\nnamespace effect\nnamespace\nmodule effect\nmodule\ndependency\n",
        stderr: "",
        exitCode: 0,
      });
      expect(await run(String(dir), ["bundle.ts"])).toEqual({
        stdout: "onLoad effect\nonLoad\nnamespace effect\nnamespace\ndependency\n",
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // A file that assigns `module.exports` becomes CommonJS, which cannot hold an import
  // statement. Its unused imports go, as they do without the setting.
  test.concurrent("a file that becomes CommonJS keeps no import", async () => {
    using dir = tempDir("ts-unused-imports-commonjs", {
      ...files,
      "tsconfig.json": verbatim,
      "unused.ts": `import { unused } from "./effect"; module.exports = "unused";`,
      "type-clause.ts": `import { type T } from "./type-only"; const x: T = 1; module.exports = "type-clause";`,
      "default-and-type.ts": `import d, { type T } from "./type-only"; exports.name = "default-and-type";`,
      "main.cjs": `
        const names = [require("./unused.ts"), require("./type-clause.ts"), require("./default-and-type.ts").name];
        console.log(names.join(" "));
        require("./entry.ts");
      `,
    });
    expect(await run(String(dir), ["main.cjs"])).toEqual({
      stdout: "unused type-clause default-and-type\n" + keepStatement,
      stderr: "",
      exitCode: 0,
    });
  });

  // Each statement asks for its module exactly where tsc emits a statement for it.
  // `import "./p"` always does. The other five do only under `verbatimModuleSyntax: true`.
  describe("which statements ask for their module", () => {
    const statements = [
      `import {} from "./p0"`,
      `export {} from "./p1"`,
      `import { type X } from "./p2"`,
      `import d, {} from "./p3"`,
      `import * as n from "./p4"`,
      `import "./p5"`,
    ];
    const fixture = (compilerOptions: object | undefined) => ({
      ...(compilerOptions ? { "tsconfig.json": JSON.stringify({ compilerOptions }) } : {}),
      ...Object.fromEntries(
        statements.flatMap((statement, i) => [
          [`p${i}.ts`, `console.log("p${i}"); export type X = 1; export default 1;`],
          [`m${i}.ts`, `${statement};\nconsole.log("m${i}");`],
        ]),
      ),
      "main.ts": statements.map((_, i) => `import "./m${i}";`).join("\n"),
    });
    const onlyBare = "m0\nm1\nm2\nm3\nm4\np5\nm5\n";
    const all = "p0\nm0\np1\nm1\np2\nm2\np3\nm3\np4\nm4\np5\nm5\n";

    describe.each([
      ["no tsconfig.json", undefined, onlyBare],
      ["{}", {}, onlyBare],
      ["verbatimModuleSyntax: false", { verbatimModuleSyntax: false }, onlyBare],
      ["isolatedModules: true", { isolatedModules: true }, onlyBare],
      ["verbatimModuleSyntax: true", { verbatimModuleSyntax: true }, all],
    ])("%s", (_, compilerOptions, stdout) => {
      test.concurrent("bun run", async () => {
        using dir = tempDir("ts-unused-imports-forms", fixture(compilerOptions));
        expect(await run(String(dir), ["main.ts"])).toEqual({ stdout, stderr: "", exitCode: 0 });
      });

      test.concurrent("bun build", async () => {
        using dir = tempDir("ts-unused-imports-forms-build", fixture(compilerOptions));
        const build = await run(String(dir), ["build", "--target=bun", "--outfile=out.js", "main.ts"]);
        expect(build.stderr).toBe("");
        expect(await run(String(dir), ["out.js"])).toEqual({ stdout, stderr: "", exitCode: 0 });
      });
    });
  });

  // `import { type Mock } from "bun:test"` stays as a request for `bun:test`. It binds
  // no name, so the file still takes `beforeEach`, `test` and `expect` as globals.
  test.concurrent("a type-only import of bun:test keeps the test globals", async () => {
    using dir = tempDir("ts-unused-imports-bun-test", {
      "tsconfig.json": verbatim,
      "globals.test.ts": `
        import { type Mock } from "bun:test";
        let calls: Mock<() => void> | undefined;
        beforeEach(() => {
          calls = undefined;
        });
        test("runs", () => {
          expect(calls).toBeUndefined();
          console.log("ran");
        });
      `,
    });
    const { stdout, exitCode } = await run(String(dir), ["test", "globals.test.ts"]);
    expect(stdout).toEndWith("ran\n");
    expect(exitCode).toBe(0);
  });

  // TypeScript emits nothing for a declaration file, so its imports ask for no module.
  test.concurrent("a declaration file keeps no import", async () => {
    using dir = tempDir("ts-unused-imports-dts", {
      "tsconfig.json": verbatim,
      "globals.d.ts": `
        import { Model } from "./models";
        import { type Other } from "./missing";
        declare global {
          var model: Model | Other;
        }
      `,
      "models.d.ts": `export interface Model { id: number }`,
      "main.ts": `import "./globals.d.ts"; console.log("main");`,
    });
    expect(await run(String(dir), ["main.ts"])).toEqual({ stdout: "main\n", stderr: "", exitCode: 0 });
    const build = await run(String(dir), ["build", "--target=bun", "--outfile=out.js", "main.ts"]);
    expect(build.stderr).toBe("");
    expect(await run(String(dir), ["out.js"])).toEqual({ stdout: "main\n", stderr: "", exitCode: 0 });
  });

  // A `declare` block is dropped whole. Its imports and re-exports ask for no module,
  // with the setting and without it.
  test.concurrent.each([
    ["verbatimModuleSyntax: true", verbatim],
    ["no setting", "{}"],
  ])("an import inside a declare block asks for no module (%s)", async (_, tsconfig) => {
    using dir = tempDir("ts-unused-imports-declare", {
      "tsconfig.json": tsconfig,
      "main.ts": `
        declare module "virtual" {
          import { type T } from "./missing-type";
          import { V } from "./missing-value";
          import "./missing-bare";
          export * from "./missing-star";
          export { W } from "./missing-named";
          export const v: T | V;
        }
        declare global {
          import { G } from "./missing-global";
        }
        declare namespace N {
          import { X } from "./missing-namespace";
        }
        console.log("main");
      `,
    });
    expect(await run(String(dir), ["main.ts"])).toEqual({ stdout: "main\n", stderr: "", exitCode: 0 });
    const build = await run(String(dir), ["build", "--target=bun", "--outfile=out.js", "main.ts"]);
    expect(build.stderr).toBe("");
    expect(await run(String(dir), ["out.js"])).toEqual({ stdout: "main\n", stderr: "", exitCode: 0 });
  });
});
