import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { basename, join } from "path";
import { itBundled } from "./expectBundled";

const nestedFunctions = /* js */ `
  export function outer() {
    function middle() {
      function inner() {
        return "world";
      }
      return inner();
    }
    return middle();
  }
  console.log(outer());
`;

describe("bundler", () => {
  for (const backend of ["cli", "api"] as const) {
    itBundled(`bun/bytecode-depth-${backend}`, {
      backend,
      target: "bun",
      format: "cjs",
      bytecode: true,
      bytecodeDepth: 0,
      outdir: "/out",
      files: { "/entry.ts": nestedFunctions },
      run: { stdout: "world\n" },
      async onAfterBundle(api) {
        const shallow = Bun.file(api.join("out/entry.js.jsc")).size;
        const full = await Bun.build({
          entrypoints: [api.join("entry.ts")],
          outdir: api.join("full"),
          target: "bun",
          format: "cjs",
          bytecode: true,
        });
        expect(full.outputs[1].kind).toBe("bytecode");
        expect(shallow).toBeGreaterThan(0);
        expect(shallow).toBeLessThan(full.outputs[1].size);
      },
    });
  }

  // https://github.com/oven-sh/bun/issues/18899
  itBundled("bun/import-bun-format-cjs", {
    target: "bun",
    format: "cjs",
    bytecode: true,
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
        import {RedisClient} from 'bun';
        import * as BunStar from 'bun';
        const bunRequire = require("bun");
        if (RedisClient.name !== "RedisClient") {
          throw new Error("RedisClient.name is not RedisClient");
        }
        if (BunStar.RedisClient.name !== "RedisClient") {
          throw new Error("BunStar.RedisClient.name is not RedisClient");
        }
        if (bunRequire.RedisClient.name !== "RedisClient") {
          throw new Error("bunRequire.RedisClient.name is not RedisClient");
        }

        console.log(RedisClient.name);
        console.log(BunStar.RedisClient.name);
        console.log(bunRequire.RedisClient.name);

        export class RedisCache {
          constructor(config: any) {
            this.connectServer(config);
          }
          
        }
      `,
    },
    run: { stdout: "RedisClient\nRedisClient\nRedisClient\n" },
  });
  itBundled("bun/embedded-sqlite-file", {
    target: "bun",
    outfile: "",
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
        import db from './db.sqlite' with {type: "sqlite", embed: "true"};
        console.log(db.query("select message from messages LIMIT 1").get().message);
      `,
      "/db.sqlite": (() => {
        const db = new Database(":memory:");
        db.exec("create table messages (message text)");
        db.exec("insert into messages values ('Hello, world!')");
        return db.serialize();
      })(),
    },
    run: { stdout: "Hello, world!" },
  });
  itBundled("bun/sqlite-file", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import db from './db.sqlite' with {type: "sqlite"};
        console.log(db.query("select message from messages LIMIT 1").get().message);
      `,
    },
    runtimeFiles: {
      "/db.sqlite": (() => {
        const db = new Database(":memory:");
        db.exec("create table messages (message text)");
        db.exec("insert into messages values ('Hello, world!')");
        return db.serialize();
      })(),
    },
    run: { stdout: "Hello, world!", setCwd: true },
  });
  itBundled("bun/TargetBunNoSourcemapMessage", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        // this file has comments and weird whitespace, intentionally
        // to make it obvious if sourcemaps were generated and mapped properly
        if           (true) code();
        function code() {
          // hello world
                  throw new
            Error("Hello World");
        }
      `,
    },
    run: {
      exitCode: 1,
      validate({ stderr }) {
        expect(stderr).toInclude("\nnote: missing sourcemaps for ");
        expect(stderr).toInclude("\nnote: consider bundling with '--sourcemap' to get unminified traces\n");
      },
    },
  });
  itBundled("bun/TargetBunSourcemapInline", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        // this file has comments and weird whitespace, intentionally
        // to make it obvious if sourcemaps were generated and mapped properly
        if           (true) code();
        function code() {
          // hello world
                  throw   new
            Error("Hello World");
        }
      `,
    },
    sourceMap: "inline",
    run: {
      exitCode: 1,
      validate({ stderr }) {
        expect(stderr).toStartWith(
          `1 | // this file has comments and weird whitespace, intentionally
2 | // to make it obvious if sourcemaps were generated and mapped properly
3 | if           (true) code();
4 | function code() {
5 |   // hello world
6 |           throw   new
                      ^
error: Hello World`,
        );
        expect(stderr).toInclude("entry.ts:6:19");
      },
    },
  });
  itBundled("bun/unicode comment", {
    target: "bun",
    files: {
      "/a.ts": /* js */ `
        /* æ */
      `,
    },
    run: { stdout: "" },
  });

  const unknownBunSpecifiers = [
    "bun:not-a-builtin",
    "bun:not-a-builtin/star",
    "bun:not-a-builtin/export-star",
    "bun:not-a-builtin/export-named",
    "bun:not-a-builtin/require",
    "bun:not-a-builtin/require-resolve",
    "bun:not-a-builtin/dynamic",
    "bun:./not-a-builtin.js",
    // The part after "bun:" is a builtin, but not a bare Node.js name.
    "bun:node:fs",
    "bun:bun:test",
    "bun:ws",
    // A Node.js builtin only with --experimental-stream-iter.
    "bun:stream/iter",
  ];
  for (const backend of ["cli", "api"] as const) {
    for (const format of ["esm", "cjs"] as const) {
      itBundled(`bun/UnknownBunSpecifierIsPrintedAsWritten-${backend}-${format}`, {
        backend,
        format,
        target: "bun",
        metafile: true,
        files: {
          "/entry.js": /* js */ `
            import real from "bun:not-a-builtin";
            import * as star from "bun:not-a-builtin/star";
            export * from "bun:not-a-builtin/export-star";
            export { named } from "bun:not-a-builtin/export-named";
            const required = require("bun:not-a-builtin/require");
            const resolved = require.resolve("bun:not-a-builtin/require-resolve");
            const dynamic = import("bun:not-a-builtin/dynamic");
            const relative = import("bun:./not-a-builtin.js");
            const builtins = [import("bun:node:fs"), import("bun:bun:test"), import("bun:ws")];
            const flagged = import("bun:stream/iter");
            console.log(real, star, required, resolved, dynamic, relative, builtins, flagged);
          `,
        },
        onAfterBundle(api) {
          const out = api.readFile("/out.js");
          for (const specifier of unknownBunSpecifiers) {
            expect(out).toContain(JSON.stringify(specifier));
            // The specifier without "bun:" names a different module.
            expect(out).not.toContain(JSON.stringify(specifier.slice("bun:".length)));
          }

          const [input] = Object.values<any>(JSON.parse(api.readFile("/metafile.json")).inputs);
          const external = input.imports.filter((record: any) => record.external);
          expect(external.map((record: any) => record.path)).toEqual(unknownBunSpecifiers);
        },
      });
    }
  }
  for (const format of ["esm", "cjs"] as const) {
    itBundled(`bun/UnknownBunSpecifierDoesNotLoadThePackageNamedLikeItsSuffix-${format}`, {
      target: "bun",
      format,
      files: {
        "/entry.js": /* js */ `
          import real from "bun:not-a-builtin";
          console.log(real);
        `,
        "/node_modules/not-a-builtin/package.json": JSON.stringify({ name: "not-a-builtin", main: "index.js" }),
        "/node_modules/not-a-builtin/index.js": `module.exports = "the package named like the suffix";`,
      },
      run: {
        exitCode: 1,
        validate({ stdout, stderr }) {
          expect(stdout).toBe("");
          expect(stderr).toContain("'bun:not-a-builtin'");
        },
      },
    });
    // "bun:fs" is not a module, but it has always loaded "fs", and programs import it.
    itBundled(`bun/BunPrefixedBuiltinLoadsTheBuiltin-${format}`, {
      target: "bun",
      format,
      files: {
        "/entry.js": /* js */ `
          import fs from "bun:fs";
          const path = require("bun:path");
          import("bun:fs/promises").then(promises => console.log(typeof fs.readFileSync, typeof path.join, typeof promises.readFile));
        `,
      },
      onAfterBundle(api) {
        expect(api.readFile("/out.js").match(/"(bun:)?(fs|path|fs\/promises)"/g)).toEqual([
          `"fs"`,
          `"path"`,
          `"fs/promises"`,
        ]);
      },
      run: { stdout: "function function function" },
    });
  }
  itBundled("bun/UnknownBunSpecifierInShebangEntry", {
    // No `target`: the "#!/usr/bin/env bun" line makes the entry point a file for bun.
    files: {
      "/entry.js": `#!/usr/bin/env bun\nimport fromImport from "bun:not-a-builtin";\nconsole.log(fromImport);`,
    },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain(`import fromImport from "bun:not-a-builtin";`);
    },
  });
  itBundled("bun/UnknownBunSpecifierInExecutable", {
    backend: "cli",
    compile: true,
    bytecode: true,
    format: "cjs",
    files: {
      "/entry.js": /* js */ `
        const fromRequire = require("bun:not-a-builtin");
        console.log(fromRequire);
      `,
      // What the name without its prefix finds in the directory the executable runs in.
      "/node_modules/not-a-builtin/index.js": `console.log("LOADED node_modules/not-a-builtin");`,
    },
    run: {
      setCwd: true,
      exitCode: 1,
      validate({ stdout, stderr }) {
        expect(stdout).toBe("");
        expect(stderr).toMatch(/^error: Cannot find package 'bun:not-a-builtin' from '.*'\r?$/m);
      },
    },
  });
  if (Bun.version.startsWith("1.4") || Bun.version.startsWith("1.3") || Bun.version.startsWith("1.2")) {
    for (const backend of ["api", "cli"] as const) {
      itBundled("bun/ExportsConditionsDevelopment" + backend.toUpperCase(), {
        files: {
          "src/entry.js": `import 'pkg1'`,
          "node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "development": "./custom1.js",
            "default": "./default.js"
          }
        }
      `,
          "node_modules/pkg1/custom1.js": `console.log('SUCCESS')`,
          "node_modules/pkg1/default.js": `console.log('FAIL')`,
        },
        backend,
        outfile: "out.js",
        define: { "process.env.NODE_ENV": '"development"' },
        run: {
          stdout: "SUCCESS",
        },
      });
      itBundled("bun/ExportsConditionsDevelopmentInProduction" + backend.toUpperCase(), {
        files: {
          "src/entry.js": `import 'pkg1'`,
          "node_modules/pkg1/package.json": /* json */ `
        {
          "exports": {
            "development": "./custom1.js",
            "default": "./default.js"
          }
        }
      `,
          "node_modules/pkg1/custom1.js": `console.log('FAIL')`,
          "node_modules/pkg1/default.js": `console.log('SUCCESS')`,
        },
        backend,
        outfile: "/Users/user/project/out.js",
        define: { "process.env.NODE_ENV": '"production"' },
        run: {
          stdout: "SUCCESS",
        },
      });
    }
  }
});

// The bundle has one copy of each file that a "#!/usr/bin/env bun" entry point imports.
describe.concurrent("bundler hashbang entry in a build for another target", () => {
  const hashbang = "#!/usr/bin/env bun";
  // state.js is imported by the entry point and by a file that the entry point imports.
  const files = {
    "entry.js": `${hashbang}
import { state } from "./state.js";
import { stateOfDependency } from "./dependency.js";
export const sameState = state === stateOfDependency;
`,
    "dependency.js": `import { state } from "./state.js";
export const stateOfDependency = state;
`,
    "state.js": `export const state = { from: "state.js" };\n`,
  };

  /** How many times the output of entry.js has `text`. */
  async function countInEntryOutput(config: Bun.BuildConfig, text = `from: "state.js"`) {
    const result = await Bun.build(config);
    const entry = result.outputs.find(output => basename(output.path) === "entry.js")!;
    return (await entry.text()).split(text).length - 1;
  }

  test.each([{}, { target: "node" }, { target: "browser" }, { target: "node", format: "cjs" }] as const)(
    "Bun.build with %j",
    async options => {
      using dir = tempDir("hashbang-entry", files);
      expect(await countInEntryOutput({ entrypoints: [join(String(dir), "entry.js")], ...options })).toBe(1);
    },
  );

  const inMemory = Object.fromEntries(Object.entries(files).map(([name, text]) => [`/${name}`, text]));
  test("Bun.build with files in memory", async () => {
    expect(await countInEntryOutput({ entrypoints: ["/entry.js"], files: inMemory })).toBe(1);
  });

  /** An onResolve plugin for state.js that returns `path`, or nothing. */
  const resolveState = (path: string | undefined): Bun.BunPlugin => ({
    name: "resolve state.js",
    setup(build) {
      build.onResolve({ filter: /state\.js$/ }, () => (path === undefined ? undefined : { path }));
    },
  });
  test.each(["a path", "nothing"])("Bun.build with an onResolve plugin that returns %s", async answer => {
    using dir = tempDir("hashbang-entry", files);
    const plugins = [resolveState(answer === "a path" ? join(String(dir), "state.js") : undefined)];
    expect(await countInEntryOutput({ entrypoints: [join(String(dir), "entry.js")], plugins })).toBe(1);
  });
  test.each(["a path", "nothing"])(
    "Bun.build with files in memory and an onResolve plugin that returns %s",
    async answer => {
      const plugins = [resolveState(answer === "a path" ? "/state.js" : undefined)];
      expect(await countInEntryOutput({ entrypoints: ["/entry.js"], files: inMemory, plugins })).toBe(1);
    },
  );

  test("Bun.build with an onLoad plugin that adds the hashbang", async () => {
    using dir = tempDir("hashbang-entry", { ...files, "entry.js": files["entry.js"].slice(hashbang.length + 1) });
    const plugin: Bun.BunPlugin = {
      name: "add the hashbang",
      setup(build) {
        build.onLoad({ filter: /entry\.js$/ }, async ({ path }) => ({
          contents: `${hashbang}\n${await Bun.file(path).text()}`,
          loader: "js",
        }));
      },
    };
    expect(await countInEntryOutput({ entrypoints: [join(String(dir), "entry.js")], plugins: [plugin] })).toBe(1);
  });

  // `side` is "client" in a build for the browser and "server" otherwise. It is not in the types of a plugin.
  test.each([
    ["browser", "client"],
    ["node", "server"],
  ] as const)("Bun.build with target %s calls onLoad once for each file, for the %s", async (target, side) => {
    using dir = tempDir("hashbang-entry", files);
    const loaded: string[] = [];
    const plugin: Bun.BunPlugin = {
      name: "record loads",
      setup(build) {
        build.onLoad({ filter: /\.js$/ }, args => {
          loaded.push(`${basename(args.path)}: ${(args as typeof args & { side: string }).side}`);
          return undefined;
        });
      },
    };
    await Bun.build({ entrypoints: [join(String(dir), "entry.js")], target, plugins: [plugin] });
    expect(loaded.sort()).toEqual([`dependency.js: ${side}`, `entry.js: ${side}`, `state.js: ${side}`]);
  });

  test("Bun.build with a stylesheet, an asset and JSON", async () => {
    using dir = tempDir("hashbang-entry", {
      "entry.js": `${hashbang}
import "./style.css";
import logo from "./logo.png";
import data from "./data.json";
import { ofDependency } from "./dependency.js";
export const same = [logo === ofDependency.logo, data === ofDependency.data];
`,
      "dependency.js": `import "./style.css";
import logo from "./logo.png";
import data from "./data.json";
export const ofDependency = { logo, data };
`,
      "style.css": `.from-style-css { color: red; }\n`,
      "logo.png": "an image",
      "data.json": `{ "from": "data.json" }`,
    });
    const result = await Bun.build({ entrypoints: [join(String(dir), "entry.js")] });
    const outputs = result.outputs.map(async output => [
      basename(output.path).replace(/-[a-z0-9]+\.png$/, "-[hash].png"),
      (await output.text()).split(/from-style-css|from: "data.json"/).length - 1,
    ]);
    expect((await Promise.all(outputs)).sort()).toEqual([
      ["entry.css", 1],
      ["entry.js", 1],
      ["logo-[hash].png", 0],
    ]);
  });

  test("Bun.build with a file under two loaders, as without the hashbang", async () => {
    const twoLoaders = {
      "entry.js": `import text from "./data.json" with { type: "text" };
import { data } from "./dependency.js";
export const both = [text, data];
`,
      "dependency.js": `import data from "./data.json";\nexport { data };\n`,
      "data.json": `{ "from": "data.json" }`,
    };
    using plain = tempDir("hashbang-entry", twoLoaders);
    using dir = tempDir("hashbang-entry", { ...twoLoaders, "entry.js": `${hashbang}\n${twoLoaders["entry.js"]}` });
    const count = (root: string) => countInEntryOutput({ entrypoints: [join(root, "entry.js")] }, "data.json");
    expect(await count(String(dir))).toBe(await count(String(plain)));
  });

  // A server-side file that imports an HTML file gets a module with the manifest of the page.
  const page = `<!doctype html><html><head><script type="module" src="./client.js"></script></head></html>`;

  /** Builds entry.js of `dir` into `dir/out` and runs it. */
  async function buildAndRun(dir: string, config: Partial<Bun.BuildConfig> = {}) {
    const { outputs } = await Bun.build({ entrypoints: [join(dir, "entry.js")], outdir: join(dir, "out"), ...config });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "out", "entry.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { outputs, stdout, stderr, exitCode };
  }
  test("Bun.build with target node gives an HTML file one manifest", async () => {
    using dir = tempDir("hashbang-entry-html", {
      "entry.js": `${hashbang}
import page from "./page.html";
import { pageOfDependency } from "./dependency.js";
export const samePage = page === pageOfDependency;
`,
      "dependency.js": `import page from "./page.html";\nexport const pageOfDependency = page;\n`,
      "page.html": page,
      "client.js": `console.log("client");\n`,
    });
    const config: Bun.BuildConfig = { entrypoints: [join(String(dir), "entry.js")], target: "node" };
    expect(await countInEntryOutput(config, "__jsonParse(")).toBe(1);
  });

  // In a build for the browser, the HTML file itself is a file of the build, at the same path.
  test("Bun.build with no target keeps the manifest of an HTML file apart from the file", async () => {
    using dir = tempDir("hashbang-entry-html", {
      "entry.js": `${hashbang}
import page from "./page.html";
import samePage from "./page.html";
console.log(page === samePage, typeof page.index);
`,
      "page.html": page,
      "client.js": `console.log("client");\n`,
    });
    const { outputs, stdout, stderr, exitCode } = await buildAndRun(String(dir));
    const manifests = outputs.map(async output => [
      basename(output.path).replace(/-[a-z0-9]+\.js$/, "-[hash].js"),
      (await output.text()).split("__jsonParse(").length - 1,
    ]);
    expect((await Promise.all(manifests)).sort()).toEqual([
      ["chunk-[hash].js", 0],
      ["entry.js", 1],
      ["page.html", 0],
    ]);
    expect({ stdout, stderr }).toEqual({ stdout: "true string\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("Bun.build with no target finds the manifest of an HTML file for an onResolve plugin", async () => {
    using dir = tempDir("hashbang-entry-html", {
      "entry.js": `${hashbang}
import page from "./page.html";
import samePage from "the-page";
console.log(page === samePage, typeof page.index);
`,
      "page.html": page,
      "client.js": `console.log("client");\n`,
    });
    const plugin: Bun.BunPlugin = {
      name: "resolve the-page",
      setup(build) {
        build.onResolve({ filter: /^the-page$/ }, () => ({ path: join(String(dir), "page.html") }));
      },
    };
    const { stdout, stderr, exitCode } = await buildAndRun(String(dir), { plugins: [plugin] });
    expect({ stdout, stderr }).toEqual({ stdout: "true string\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("bun build with no target", async () => {
    using dir = tempDir("hashbang-entry-cli", {
      "config.mjs": `export const config = { verbose: false };\n`,
      "run.mjs": `import { config } from "./config.mjs";
export const run = () => console.log("verbose is", config.verbose);
`,
      "main.mjs": `${hashbang}
import { config } from "./config.mjs";
import { run } from "./run.mjs";
config.verbose = true;
run();
`,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "./main.mjs", "--outdir=out"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildStderr, buildExitCode] = await Promise.all([build.stderr.text(), build.exited, build.stdout.text()]);
    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    await using run = Bun.spawn({
      cmd: [bunExe(), join("out", "main.js")],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "verbose is true\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  // `bun compile --library` builds for node. It also checks the types of the package, which is slow in a debug build.
  test.serial(
    "bun compile --library",
    async () => {
      using dir = tempDir("hashbang-entry-library", {
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, module: "esnext", types: [], lib: ["esnext"] },
        }),
        "package.json": JSON.stringify({ name: "cli", version: "1.0.0", bin: "./src/cli.ts" }),
        "src/cli.ts": `${hashbang}
import { config } from "./config";
import { isVerbose } from "./verbose";
config.verbose = true;
export const verbose: boolean = isVerbose();
`,
        "src/config.ts": `export const config = { verbose: false };\n`,
        "src/verbose.ts": `import { config } from "./config";\nexport const isVerbose = (): boolean => config.verbose;\n`,
      });
      await using build = Bun.spawn({
        cmd: [bunExe(), "compile", "--library", "src/cli.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited, build.stdout.text()]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect((await Bun.file(join(String(dir), "dist", "cli.js")).text()).split("verbose: false")).toHaveLength(2);
    },
    30_000,
  );

  itBundled("bun/HashbangEntryExportStar", {
    target: "browser",
    files: {
      "/entry.js": `${hashbang}
import { state } from "./state.js";
import { state as stateOfBarrel } from "./barrel.js";
console.log(state === stateOfBarrel);
`,
      "/barrel.js": `export * from "./state.js";\n`,
      "/state.js": files["state.js"],
    },
    run: { stdout: "true" },
  });

  // "module" is the file for an import and "main" the file for a require(). A package that is
  // both imported and required is bundled once, from "main".
  itBundled("bun/HashbangEntryDualPackage", {
    target: "browser",
    files: {
      "/entry.js": `${hashbang}
import { state } from "dual";
import required from "./dependency.cjs";
console.log(state === required.state, state.from);
`,
      "/dependency.cjs": `module.exports = require("dual");\n`,
      "/node_modules/dual/package.json": JSON.stringify({ name: "dual", main: "./main.js", module: "./module.js" }),
      "/node_modules/dual/main.js": `exports.state = { from: "main" };\n`,
      "/node_modules/dual/module.js": `export const state = { from: "module" };\n`,
    },
    run: { stdout: "true main" },
  });

  itBundled("bun/HashbangEntryImportedByItsImport", {
    target: "node",
    files: {
      "/entry.js": `${hashbang}
import { stateOfEntry } from "./dependency.js";
export const state = { from: "entry.js" };
console.log(stateOfEntry() === state);
`,
      "/dependency.js": `import { state } from "./entry.js";\nexport const stateOfEntry = () => state;\n`,
    },
    run: { stdout: "true" },
  });

  itBundled("bun/HashbangEntryImportsAnotherEntry", {
    target: "node",
    splitting: true,
    outdir: "/out",
    entryPoints: ["/cli.js", "/lib.js"],
    files: {
      "/cli.js": `${hashbang}\nimport { state } from "./lib.js";\nstate.usedByCli = true;\n`,
      "/lib.js": `export const state = { usedByCli: false };\n`,
    },
    runtimeFiles: {
      "/both.js": `import "./out/cli.js";\nimport { state } from "./out/lib.js";\nconsole.log(state.usedByCli);\n`,
    },
    run: { file: "/both.js", stdout: "true" },
  });
});
