import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
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

    // `--minify-identifiers` renames every binding, so no unused name is printed.
    test.concurrent("bun build --no-bundle --minify-identifiers", async () => {
      using dir = tempDir("ts-unused-imports-no-bundle-minify", { ...files, "tsconfig.json": tsconfig });
      const kept = output.split("\n").slice(0, -2);
      expect(await run(String(dir), ["build", "--no-bundle", "--minify-identifiers", "entry.ts"])).toEqual({
        stdout: kept.map(name => `import"./${name}";\n`).join("") + `const o = 1;\nconsole.log("entry", o);\n`,
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

  // `extends` merges each key by itself: `verbatimModuleSyntax: false` in the child does not
  // turn off the `importsNotUsedAsValues` of the base.
  test.concurrent("extends merges the three settings key by key", async () => {
    using dir = tempDir("ts-unused-imports-extends-keys", {
      ...files,
      "base.json": JSON.stringify({ compilerOptions: { importsNotUsedAsValues: "preserve" } }),
      "tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: { verbatimModuleSyntax: false } }),
      "own/plain.json": "{}",
      "own/tsconfig.json": JSON.stringify({ extends: "./plain.json", compilerOptions: { verbatimModuleSyntax: true } }),
      "own/own.ts": `import { unused } from "../effect"; console.log("own");`,
    });
    expect(await run(String(dir), ["entry.ts"])).toEqual({ stdout: keepStatement, stderr: "", exitCode: 0 });
    expect(await run(path.join(String(dir), "own"), ["own.ts"])).toEqual({
      stdout: "effect\nown\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // `bun build --no-bundle` prints a kept name as written. What runs the output links it, so
  // the name must be a real export there. `bun run` and a bundle drop the name instead.
  test.concurrent("the output of bun build --no-bundle runs when each kept name is an export", async () => {
    using dir = tempDir("ts-unused-imports-no-bundle-run", {
      "tsconfig.json": verbatim,
      "effect.ts": files["effect.ts"],
      "types.ts": files["types.ts"],
      "value.ts": `import { unused } from "./effect"; console.log("value");`,
      "type.ts": `import { SomeType } from "./types"; const x: SomeType = 1; console.log("type", x);`,
    });
    const build = await run(String(dir), [
      "build",
      "--no-bundle",
      "--outdir=out",
      "value.ts",
      "type.ts",
      "effect.ts",
      "types.ts",
    ]);
    expect(build.exitCode).toBe(0);
    expect(await run(String(dir), ["out/value.js"])).toEqual({ stdout: "effect\nvalue\n", stderr: "", exitCode: 0 });
    const linked = await run(String(dir), ["out/type.js"]);
    expect(linked.stderr).toContain("Export named 'SomeType' not found");
    expect(linked.exitCode).toBe(1);
    expect(await run(String(dir), ["type.ts"])).toEqual({ stdout: "types\ntype 1\n", stderr: "", exitCode: 0 });
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
          const modules = ["effect", "type-only", "types", "erased"];
          async function bundled(marker: string) {
            for (;;) {
              const html = await (await fetch(server.url)).text();
              const src = html.match(/src="(\\/_bun\\/client\\/[^"]+)"/)![1];
              const script = await (await fetch(new URL(src, server.url))).text();
              if (script.includes(marker))
                return modules.filter(name => script.includes('console.log("' + name + '")')).join(" ");
            }
          }
          console.log(await bundled('"entry"'));
          // A save bundles the file again, and asks for it by its real path.
          const source = await Bun.file("entry.ts").text();
          await Bun.write("entry.ts", source.replace('"entry"', '"entry saved"'));
          console.log(await bundled('"entry saved"'));
        `,
      });
      const { stdout, exitCode } = await run(String(dir), ["serve.ts"]);
      expect(stdout).toBe("effect type-only types\neffect type-only types\n");
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

    test.concurrent("a path in node_modules that a plugin resolved takes no setting", async () => {
      using dir = tempDir("ts-unused-imports-plugin-resolved", {
        "tsconfig.json": verbatim,
        "node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "./index.ts" }),
        "node_modules/dep/index.ts": importer("dep"),
        "node_modules/dep/effect.ts": effect("dep"),
        "entry.ts": `import "alias:dep";`,
        "bundle.ts": `
          import path from "node:path";
          const build = await Bun.build({
            entrypoints: ["./entry.ts"],
            target: "bun",
            plugins: [{
              name: "alias",
              setup(build) {
                build.onResolve({ filter: /^alias:/ }, () => ({ path: path.join(import.meta.dir, "node_modules/dep/index.ts") }));
              },
            }],
          });
          await Bun.write("out.mjs", await build.outputs[0].text());
          await import("./out.mjs");
        `,
      });
      expect(await run(String(dir), ["bundle.ts"])).toEqual({ stdout: "dep\n", stderr: "", exitCode: 0 });
    });

    // `Bun.build({ files })` hands the bundler a source that no directory holds, as a plugin does.
    test.concurrent("a Bun.build({ files }) entry takes the tsconfig.json of the working directory", async () => {
      using dir = tempDir("ts-unused-imports-files", {
        "tsconfig.json": verbatim,
        "disk.ts": `console.log("disk");`,
        ...Object.fromEntries(
          ["replaced", "memory", "nowhere", "dep"].map(name => [`effect-${name}.ts`, effect(name)]),
        ),
        "bundle.ts": `
          import path from "node:path";
          const here = import.meta.dir;
          const source = (name: string) =>
            "import { unused } from " + JSON.stringify(path.join(here, "effect-" + name + ".ts")) + '; console.log("' + name + '");';
          const dependency = path.join(here, "node_modules", "dep", "index.ts");
          const nowhere = path.join(here, "no-such-directory", "memory.ts");
          const build = await Bun.build({
            entrypoints: [path.join(here, "entry.ts")],
            target: "bun",
            files: {
              [path.join(here, "entry.ts")]:
                'import "./disk.ts"; import "./memory.ts"; import ' + JSON.stringify(nowhere) + "; import " + JSON.stringify(dependency) + ";",
              [path.join(here, "disk.ts")]: source("replaced"),
              [path.join(here, "memory.ts")]: source("memory"),
              [nowhere]: source("nowhere"),
              [dependency]: source("dep"),
            },
          });
          await Bun.write("out.mjs", await build.outputs[0].text());
          await import("./out.mjs");
        `,
      });
      expect(await run(String(dir), ["bundle.ts"])).toEqual({
        stdout: "replaced effect\nreplaced\nmemory effect\nmemory\nnowhere effect\nnowhere\ndep\n",
        stderr: "",
        exitCode: 0,
      });
    });

    // The `tsconfig` of one build replaces the tsconfig.json of every directory, for that build only.
    test.concurrent("Bun.build({ tsconfig }) decides for that build", async () => {
      using dir = tempDir("ts-unused-imports-api-override", {
        "tsconfig.json": off,
        "on.json": verbatim,
        "off.json": off,
        "effect.ts": effect("root"),
        "a.ts": importer("a"),
        "pkg/tsconfig.json": verbatim,
        "pkg/effect.ts": effect("pkg"),
        "pkg/b.ts": importer("b"),
        "build.ts": `
          const build = async (entry: string, tsconfig?: string) => {
            const { outputs } = await Bun.build({ entrypoints: [entry], target: "bun", tsconfig });
            return / effect"\\)/.test(await outputs[0].text());
          };
          console.log(
            JSON.stringify({
              first: await build("./pkg/b.ts", "./off.json"),
              without: [await build("./pkg/b.ts"), await build("./a.ts")],
              with: [await build("./a.ts", "./on.json"), await build("./pkg/b.ts", "./off.json")],
              atOnce: await Promise.all([
                build("./a.ts", "./on.json"),
                build("./a.ts"),
                build("./pkg/b.ts", "./off.json"),
                build("./pkg/b.ts"),
              ]),
            }),
          );
          await import("./a.ts");
          await import("./pkg/b.ts");
        `,
      });
      expect(await run(String(dir), ["build.ts"])).toEqual({
        stdout:
          JSON.stringify({
            first: false,
            without: [true, false],
            with: [true, false],
            atOnce: [true, false, false, true],
          }) + "\na\npkg effect\nb\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test.concurrent("an override that cannot be read leaves no setting", async () => {
      using dir = tempDir("ts-unused-imports-override-missing", {
        "tsconfig.json": verbatim,
        "effect.ts": effect("root"),
        "entry.ts": importer("entry"),
      });
      const { stdout, exitCode } = await run(String(dir), ["--tsconfig-override=nowhere.json", "entry.ts"]);
      expect(stdout).toBe("entry\n");
      expect(exitCode).toBe(0);
    });

    // A package with `module` and `main` resolves to two files. The one that is parsed decides.
    test.concurrent.each([
      [off, verbatim, "esm\n"],
      [verbatim, off, "esm effect\nesm\n"],
    ])("a package with two entry files takes the tsconfig.json of the one that is parsed", async (esm, cjs, stdout) => {
      using dir = tempDir("ts-unused-imports-dual", {
        "tsconfig.json": "{}",
        "entry.ts": `import "./pkg";`,
        "pkg/package.json": JSON.stringify({ name: "pkg", module: "./esm/index.ts", main: "./cjs/index.ts" }),
        "pkg/esm/tsconfig.json": esm,
        "pkg/esm/index.ts": importer("esm"),
        "pkg/esm/effect.ts": effect("esm"),
        "pkg/cjs/tsconfig.json": cjs,
        "pkg/cjs/index.ts": importer("cjs"),
        "pkg/cjs/effect.ts": effect("cjs"),
      });
      const build = await run(String(dir), ["build", "--target=bun", "--outfile=out.js", "entry.ts"]);
      expect(build.stderr).toBe("");
      expect(await run(String(dir), ["out.js"])).toEqual({ stdout, stderr: "", exitCode: 0 });
    });

    // These reach the transpiler with no directory of their own, or with no loader yet.
    test.concurrent.each([
      ["./script", "root effect\nscript\n"],
      ["extension.cjs", "root effect\nfoo\n"],
      ["blob.mjs", "root effect\nblob 1\n"],
    ])("a module with no known extension or no directory: %s", async (entry, stdout) => {
      using dir = tempDir("ts-unused-imports-fallbacks", {
        "tsconfig.json": verbatim,
        "effect.ts": effect("root"),
        "script": importer("script"),
        "module.foo": importer("foo"),
        "extension.cjs": `require.extensions[".foo"] = require.extensions[".ts"]; require("./module.foo");`,
        "blob.mjs": `
          const source = 'import { unused } from ' + JSON.stringify(import.meta.dir + "/effect.ts") + '; const x: number = 1; console.log("blob", x);';
          await import(URL.createObjectURL(new Blob([source], { type: "application/typescript" })));
        `,
      });
      expect(await run(String(dir), [entry])).toEqual({ stdout, stderr: "", exitCode: 0 });
    });

    // A workspace package is a link in node_modules to a directory of the project. The file is
    // loaded from that directory, so its tsconfig.json decides: in `bun run` and in `bun build`,
    // by whichever path the file is reached first. With `--preserve-symlinks` the file is loaded
    // from node_modules, and an installed package takes no setting.
    describe("a workspace package that is linked into node_modules", () => {
      const workspace = {
        "tsconfig.json": verbatim,
        "packages/ui/package.json": JSON.stringify({
          name: "ui",
          exports: { ".": "./index.ts", "./button": "./button.ts" },
        }),
        "packages/ui/index.ts": `export * from "./button";`,
        "packages/ui/button.ts": `import { unused } from "./effect"; export const button = "button";`,
        "packages/ui/effect.ts": effect("ui"),
        "app/page.ts": `import { button } from "ui/button"; export const page = "page " + button;`,
        "app/main.ts": `import { page } from "./page"; import { button } from "ui"; console.log(page, button);`,
      };
      function link(dir: string) {
        symlinkSync(
          path.join(dir, "packages", "ui"),
          path.join(dir, "app", "node_modules", "ui"),
          isWindows ? "junction" : "dir",
        );
      }
      const files = { ...workspace, "app/node_modules/.keep": "" };
      const kept = "ui effect\npage button button\n";

      test.concurrent("bun run", async () => {
        using dir = tempDir("ts-unused-imports-workspace-run", files);
        link(String(dir));
        expect(await run(path.join(String(dir), "app"), ["main.ts"])).toEqual({
          stdout: kept,
          stderr: "",
          exitCode: 0,
        });
      });

      test.concurrent("bun build gives one bundle, with the answer of bun run", async () => {
        using dir = tempDir("ts-unused-imports-workspace-build", files);
        link(String(dir));
        const app = path.join(String(dir), "app");
        const builds = await Promise.all(
          Array.from({ length: 4 }, () => run(app, ["build", "--target=bun", "main.ts"])),
        );
        const outputs = new Set(builds.map(build => build.stdout));
        expect(outputs.size).toBe(1);
        await Bun.write(path.join(app, "out.js"), [...outputs][0]);
        expect(await run(app, ["out.js"])).toEqual({ stdout: kept, stderr: "", exitCode: 0 });
      });

      test.concurrent("--preserve-symlinks", async () => {
        using dir = tempDir("ts-unused-imports-workspace-preserve", files);
        link(String(dir));
        expect(await run(path.join(String(dir), "app"), ["--preserve-symlinks", "main.ts"])).toEqual({
          stdout: "page button button\n",
          stderr: "",
          exitCode: 0,
        });
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

  // A kept statement is an import statement, so a file that has one is an ES module. `require`,
  // `__dirname` and "use strict" do not make it CommonJS, as they do not with `import { T }`.
  test.concurrent.each([
    [
      "__dirname",
      `import { type T } from "./type-only"; const x: T = 1; console.log(typeof __dirname, x);`,
      "string 1",
    ],
    [
      "require",
      `import { type T } from "./type-only"; console.log(typeof require("node:fs").readFileSync);`,
      "function",
    ],
    ["use strict", `"use strict";\nimport {} from "./type-only";\nconsole.log("strict");`, "strict"],
  ])("a kept import with %s runs its module in bun run and in bun build", async (_, source, printed) => {
    using dir = tempDir("ts-unused-imports-module-kind", {
      ...files,
      "tsconfig.json": verbatim,
      "package.json": JSON.stringify({ name: "app" }),
      "main.ts": source,
    });
    const stdout = `type-only\n${printed}\n`;
    expect(await run(String(dir), ["main.ts"])).toEqual({ stdout, stderr: "", exitCode: 0 });
    const build = await run(String(dir), ["build", "--target=bun", "--outfile=out.js", "main.ts"]);
    expect(build.stderr).toBe("");
    expect(await run(String(dir), ["out.js"])).toEqual({ stdout, stderr: "", exitCode: 0 });
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
  test.concurrent.each(["d.ts", "d.mts", "d.cts"])("a .%s file keeps no import", async extension => {
    using dir = tempDir("ts-unused-imports-dts", {
      "tsconfig.json": verbatim,
      [`globals.${extension}`]: `
        import { Model } from "./models";
        import { type Other } from "./missing";
        declare global {
          var model: Model | Other;
        }
      `,
      "models.d.ts": `export interface Model { id: number }`,
      "main.ts": `import "./globals.${extension}"; console.log("main");`,
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

  // Auto-install answers an import of a bare name from the registry. An import that only
  // tsconfig.json keeps is not such a request: `import { type Handler } from "aws-lambda"` names
  // the types of `@types/aws-lambda`, and the package `aws-lambda` is another thing.
  describe("auto-install", () => {
    async function registryOf(name: string, files: Record<string, string>) {
      const tarball = await new Bun.Archive(
        Object.fromEntries(Object.entries(files).map(([file, text]) => [`package/${file}`, text])),
        { compress: "gzip" },
      ).bytes();
      const requests: string[] = [];
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const { origin, pathname } = new URL(req.url);
          requests.push(pathname);
          if (pathname === `/${name}-1.0.0.tgz`) return new Response(tarball);
          if (pathname !== `/${name}`) return new Response("not found", { status: 404 });
          return Response.json({
            name,
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": { name, version: "1.0.0", dist: { tarball: `${origin}/${name}-1.0.0.tgz` } } },
          });
        },
      });
      return {
        requests,
        bunfig: `[install]\nregistry = "http://127.0.0.1:${server.port}/"\n`,
        [Symbol.dispose]() {
          server.stop(true);
        },
      };
    }
    const autoInstall = (dir: string, entry: string) =>
      run(dir, [entry], { ...bunEnv, BUN_INSTALL_CACHE_DIR: path.join(dir, ".bun-cache") });

    test.concurrent.each([
      ["a type-only clause", `import { type Handler } from "pkg";\nexport const handler: Handler = () => {};`],
      ["a name that no value uses", `import { Handler } from "pkg";\nexport const handler: Handler = () => {};`],
      ["an empty clause", `import {} from "pkg";`],
      ["a type-only re-export", `export { type Handler } from "pkg";`],
    ])("%s makes no request to the registry", async (_, statement) => {
      using registry = await registryOf("pkg", {
        "package.json": JSON.stringify({ name: "pkg", version: "1.0.0", main: "index.js" }),
        "index.js": `console.log("the package ran");`,
      });
      using dir = tempDir("ts-unused-imports-auto-install", {
        "tsconfig.json": verbatim,
        "bunfig.toml": registry.bunfig,
        "entry.ts": `${statement}\nconsole.log("entry");\n`,
      });
      expect(await autoInstall(String(dir), "entry.ts")).toEqual({ stdout: "entry\n", stderr: "", exitCode: 0 });
      expect(registry.requests).toEqual([]);
    });

    // The project that installs a package did not write its files, and the tsconfig.json in its
    // tarball is not the project's either.
    test.concurrent("a package in the cache takes no setting from the tsconfig.json of its tarball", async () => {
      using registry = await registryOf("pkg", {
        "package.json": JSON.stringify({ name: "pkg", version: "1.0.0", type: "module", module: "index.ts" }),
        "tsconfig.json": verbatim,
        "index.ts": `import { unused } from "./register.ts";\nexport const value: string = "value";`,
        "register.ts": `console.log("register ran");\nexport const unused = 1;`,
      });
      using dir = tempDir("ts-unused-imports-cached-package", {
        "bunfig.toml": registry.bunfig,
        "entry.ts": `import { value } from "pkg";\nconsole.log(value);\n`,
      });
      expect(await autoInstall(String(dir), "entry.ts")).toEqual({ stdout: "value\n", stderr: "", exitCode: 0 });
      expect(registry.requests).toEqual(["/pkg", "/pkg-1.0.0.tgz"]);
    });
  });

  // A kept import is a request for its module, at its place in the file. These programs run
  // without the setting. With it they do what the output of tsc does in Node.
  describe("what a kept import asks for", () => {
    // `./config` and what it imports run before `./setup`, which comes later in the file.
    test.concurrent("its module runs at the place of the statement", async () => {
      const order = {
        "config.ts": `import "./db"; export type Config = { url: string };`,
        "db.ts": `console.log("db reads", globalThis.SETUP ?? "nothing");`,
        "setup.ts": `globalThis.SETUP = "the setup";`,
        "main.ts": `import { type Config } from "./config";\nimport "./setup";\nimport "./db";\nconst config: Config = { url: "" };\nconsole.log("main", config.url);`,
      };
      using kept = tempDir("ts-unused-imports-order", { ...order, "tsconfig.json": verbatim });
      expect(await run(String(kept), ["main.ts"])).toEqual({
        stdout: "db reads nothing\nmain \n",
        stderr: "",
        exitCode: 0,
      });
      using removed = tempDir("ts-unused-imports-order-off", { ...order, "tsconfig.json": "{}" });
      expect(await run(String(removed), ["main.ts"])).toEqual({
        stdout: "db reads the setup\nmain \n",
        stderr: "",
        exitCode: 0,
      });
    });

    // The module must exist. A declaration file is not a module, and `@types/x` is not the package `x`.
    test.concurrent.each([
      ["a sibling declaration file", `import { type T } from "./types";`, "./types"],
      ["a package that has only its types", `import { type Handler } from "only-types";`, "only-types"],
      ["a name that is not marked as a type", `import { Handler } from "only-types";`, "only-types"],
    ])("%s does not resolve", async (_, statement, specifier) => {
      using dir = tempDir("ts-unused-imports-missing", {
        "tsconfig.json": verbatim,
        "types.d.ts": `export type T = number;`,
        "node_modules/@types/only-types/package.json": JSON.stringify({
          name: "@types/only-types",
          types: "index.d.ts",
        }),
        "node_modules/@types/only-types/index.d.ts": `export type Handler = () => void;`,
        "main.ts": `${statement}\nconsole.log("main");`,
      });
      const ran = await run(String(dir), ["main.ts"]);
      expect(ran.stderr).toContain(`Cannot find ${specifier.startsWith(".") ? "module" : "package"} '${specifier}'`);
      expect(ran.stderr).toContain(
        `note: Only the types of this module exist. tsconfig.json keeps an import that no value uses ("verbatimModuleSyntax"). Write "import type" to drop it.`,
      );
      expect(ran.exitCode).toBe(1);
      const build = await run(String(dir), ["build", "--target=bun", "--outfile=out.js", "main.ts"]);
      expect(build.stderr).toContain(`error: Could not resolve: "${specifier}"\n`);
      expect(build.stderr).toContain(
        `note: No value uses this import. tsconfig.json keeps it ("verbatimModuleSyntax"), so the module must exist. Write "import type" to drop it.`,
      );
      expect(build.exitCode).toBe(1);
    });

    test.concurrent("a declaration file that is named in full is a declaration file", async () => {
      using dir = tempDir("ts-unused-imports-dts-named", {
        "tsconfig.json": verbatim,
        "types.d.ts": `export type T = number;`,
        "main.ts": `import { type T } from "./types.d.ts";\nconst x: T = 1;\nconsole.log("main", x);`,
      });
      expect(await run(String(dir), ["main.ts"])).toEqual({ stdout: "main 1\n", stderr: "", exitCode: 0 });
    });

    // A value import that fails gets the usual hint, not the note.
    test.concurrent("an import that a value uses keeps the hint of bun build", async () => {
      using dir = tempDir("ts-unused-imports-missing-used", {
        "tsconfig.json": verbatim,
        // A node_modules directory turns auto-install off.
        "node_modules/.keep": "",
        "main.ts": `import { handler } from "not-installed";\nconsole.log(handler);`,
      });
      const ran = await run(String(dir), ["main.ts"]);
      expect(ran.stderr).toContain("Cannot find package 'not-installed'");
      expect(ran.stderr).not.toContain("note:");
      const build = await run(String(dir), ["build", "--target=bun", "--outfile=out.js", "main.ts"]);
      expect(build.stderr).toContain(`Could not resolve: "not-installed". Maybe you need to "bun install"?`);
      expect(build.stderr).not.toContain("note:");
      expect(build.exitCode).toBe(1);
    });
  });
});
