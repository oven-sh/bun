import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, tempDir } from "harness";
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

// docs/bundler/index.mdx ("target"): a build with no explicit target defaults to
// target "bun" when an entry point starts with `#!/usr/bin/env bun`.
describe.concurrent("bundler hashbang target default", () => {
  const hashbang = "#!/usr/bin/env bun";
  const backends = ["api", "cli"] as const;

  // Imports node:fs so the selected target is observable at runtime: the bun
  // target keeps the import, the browser target replaces it with an empty stub.
  const usesNodeFs = (firstLine: string) =>
    `${firstLine}import { readFileSync } from "node:fs";\nconsole.log(typeof readFileSync);\n`;

  /**
   * Builds `entries` (relative to `dir`) into `dir/out` and returns each entry's output text.
   * With `outfile`, the one output is `dir/out/<outfile>`.
   */
  async function build(
    backend: (typeof backends)[number],
    dir: string,
    entries: string[],
    { target, format, outfile }: { target?: "node" | "browser"; format?: "cjs"; outfile?: string } = {},
  ): Promise<string[]> {
    if (backend === "api") {
      const result = await Bun.build({
        entrypoints: entries.map(entry => join(dir, entry)),
        outdir: join(dir, "out"),
        ...(outfile ? { naming: outfile } : {}),
        ...(target ? { target } : {}),
        ...(format ? { format } : {}),
      });
      expect(result.success).toBe(true);
    } else {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          ...entries,
          ...(outfile ? ["--outfile", join("out", outfile)] : ["--outdir", "out"]),
          ...(target ? [`--target=${target}`] : []),
          ...(format ? [`--format=${format}`] : []),
        ],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    }
    const outputs = outfile ? [outfile] : entries.map(entry => entry.replace(/\.\w+$/, ".js"));
    return Promise.all(outputs.map(output => Bun.file(join(dir, "out", output)).text()));
  }

  // A dependency whose exports show what the build's target chose: the
  // `process.browser` define, the package.json "exports" condition, the
  // "browser" field and map, and the node:os builtin or its browser polyfill.
  const targetProbes = {
    "dep.js": `import road from "road";
import condition from "condition";
import field from "field";
import map from "map";
import { cpus } from "node:os";
export const fromDep = { road, condition, field, map, cpus: cpus().length > 0 };
`,
    "node_modules/road/package.json": JSON.stringify({ name: "road", main: "index.js" }),
    "node_modules/road/index.js": `module.exports = process.browser === true ? "browser" : "node";\n`,
    "node_modules/condition/package.json": JSON.stringify({
      name: "condition",
      exports: { browser: "./browser.js", bun: "./bun.js", default: "./default.js" },
    }),
    "node_modules/condition/browser.js": `module.exports = "browser";\n`,
    "node_modules/condition/bun.js": `module.exports = "bun";\n`,
    "node_modules/condition/default.js": `module.exports = "default";\n`,
    "node_modules/field/package.json": JSON.stringify({ name: "field", main: "main.js", browser: "browser.js" }),
    "node_modules/field/main.js": `module.exports = "main";\n`,
    "node_modules/field/browser.js": `module.exports = "browser";\n`,
    "node_modules/map/package.json": JSON.stringify({
      name: "map",
      main: "index.js",
      browser: { "./impl.js": "./impl-browser.js" },
    }),
    "node_modules/map/index.js": `module.exports = require("./impl.js");\n`,
    "node_modules/map/impl.js": `module.exports = "impl";\n`,
    "node_modules/map/impl-browser.js": `module.exports = "impl-browser";\n`,
  };
  const targetProbeResults = [
    {
      name: "a hashbang entry is defined and resolved for bun",
      firstLine: `${hashbang}\n`,
      expected: { browser: false, road: "node", condition: "bun", field: "main", map: "impl", cpus: true },
    },
    {
      name: "an entry without a hashbang is defined and resolved for the browser",
      firstLine: "",
      expected: {
        browser: true,
        road: "browser",
        condition: "browser",
        field: "browser",
        map: "impl-browser",
        cpus: false,
      },
    },
  ];

  const firstLines = [
    { name: "LF", source: `${hashbang}\n`, bun: true },
    { name: "CRLF", source: `${hashbang}\r\n`, bun: true },
    { name: "flags", source: `${hashbang} --smol\n`, bun: true },
    { name: "tab", source: `${hashbang}\t--smol\n`, bun: true },
    { name: "node", source: `#!/usr/bin/env node\n`, bun: false },
    { name: "bunx", source: `${hashbang}x\n`, bun: false },
  ];

  for (const backend of backends) {
    test.each(firstLines)(`${backend}: $name hashbang`, async ({ source, bun }) => {
      using dir = tempDir("hashbang-target", { "cli.js": usesNodeFs(source) });
      const [output] = await build(backend, String(dir), ["cli.js"]);
      const hashbangLine = source.split(/\r?\n/)[0];
      if (bun) {
        expect(output).toStartWith(`${hashbangLine}\n// @bun\n`);
      } else {
        expect(output).toStartWith(`${hashbangLine}\n`);
        expect(output).not.toContain("// @bun");
      }
      expect(await bunRun(join(String(dir), "out", "cli.js"))).toSpawn(bun ? "function" : "undefined");
    });

    test(`${backend}: a file containing only the hashbang`, async () => {
      using dir = tempDir("hashbang-target", { "cli.js": hashbang });
      const [output] = await build(backend, String(dir), ["cli.js"]);
      expect(output).toStartWith(`${hashbang}\n// @bun\n`);
    });

    test(`${backend}: dependencies of the hashbang entry are built for bun too`, async () => {
      using dir = tempDir("hashbang-target", {
        "cli.js": `${hashbang}\nimport { dep } from "./dep.js";\nconsole.log(dep);\n`,
        "dep.js": `import { readFileSync } from "node:fs";
import os from "node:os";
import { semver } from "bun";
export const dep = [typeof readFileSync, os.cpus().length > 0, semver.satisfies("1.2.3", "^1.0.0")].join(" ");
`,
      });
      const [output] = await build(backend, String(dir), ["cli.js"]);
      expect(output).toStartWith(`${hashbang}\n// @bun\n`);
      expect(await bunRun(join(String(dir), "out", "cli.js"))).toSpawn("function true true");
    });

    // The resolver completes these: the hashbang is in the file that is loaded.
    test.each([
      { name: "without its extension", entry: "./cli" },
      { name: "with the extension of its output", entry: "./cli.js" },
      { name: "as its directory", entry: "./bin" },
      // `Bun.build` resolves a package name from the working directory of this test.
      ...(backend === "cli" ? [{ name: "as a package name", entry: "my-cli" }] : []),
    ])(`${backend}: an entry point given $name`, async ({ entry }) => {
      using dir = tempDir("hashbang-target", {
        "cli.ts": usesNodeFs(`${hashbang}\n`),
        "bin/index.ts": usesNodeFs(`${hashbang}\n`),
        "node_modules/my-cli/package.json": JSON.stringify({ name: "my-cli", main: "cli.js" }),
        "node_modules/my-cli/cli.js": usesNodeFs(`${hashbang}\n`),
      });
      const [output] = await build(backend, String(dir), [entry], { outfile: "built.js" });
      expect(output).toStartWith(`${hashbang}\n// @bun\n`);
      expect(await bunRun(join(String(dir), "out", "built.js"))).toSpawn("function");
    });

    test.each(targetProbeResults)(`${backend}: $name`, async ({ firstLine, expected }) => {
      using dir = tempDir("hashbang-target", {
        ...targetProbes,
        "cli.js": `${firstLine}import { fromDep } from "./dep.js";\nconsole.log(JSON.stringify({ browser: process.browser, ...fromDep }));\n`,
      });
      await build(backend, String(dir), ["cli.js"]);
      expect(await bunRun(join(String(dir), "out", "cli.js"))).toSpawn(JSON.stringify(expected));
    });

    test.each([
      { name: "a later", entries: ["lib.js", "cli.js"] },
      { name: "the first", entries: ["cli.js", "lib.js"] },
    ])(`${backend}: a hashbang on $name entry point applies to the whole build`, async ({ entries }) => {
      using dir = tempDir("hashbang-target", {
        "lib.js": usesNodeFs(""),
        "cli.js": usesNodeFs(`${hashbang}\n`),
      });
      const outputs = await build(backend, String(dir), entries);
      expect(outputs[entries.indexOf("lib.js")]).toStartWith("// @bun\n");
      expect(outputs[entries.indexOf("cli.js")]).toStartWith(`${hashbang}\n// @bun\n`);
      expect(await bunRun(join(String(dir), "out", "lib.js"))).toSpawn("function");
    });

    test(`${backend}: a hashbang in an entry point that is not JavaScript does not count`, async () => {
      using dir = tempDir("hashbang-target", {
        "note.txt": `${hashbang}\nnot a script\n`,
        "lib.js": usesNodeFs(""),
      });
      const [, lib] = await build(backend, String(dir), ["note.txt", "lib.js"]);
      expect(lib).not.toContain("// @bun");
      expect(await bunRun(join(String(dir), "out", "lib.js"))).toSpawn("undefined");
    });

    test.each(["node", "browser"] as const)(
      `${backend}: an explicit --target=%s wins over the hashbang`,
      async target => {
        using dir = tempDir("hashbang-target", {
          "cli.js": `${hashbang}\nimport { Shared } from "./shared.js";\nimport { ReExported } from "./reexport.js";\nconsole.log(Shared === ReExported);\n`,
          "shared.js": `export class Shared {}\n`,
          "reexport.js": `import { Shared } from "./shared.js";\nexport const ReExported = Shared;\n`,
        });
        const [output] = await build(backend, String(dir), ["cli.js"], { target });
        expect(output).toStartWith(`${hashbang}\n`);
        expect(output).not.toContain("// @bun");
        // The whole build shares one target, so shared.js is bundled exactly once.
        expect(output.split("class Shared").length - 1).toBe(1);
        expect(await bunRun(join(String(dir), "out", "cli.js"))).toSpawn("true");
      },
    );

    test.each(["node", "browser"] as const)(
      `${backend}: with an explicit --target=%s a hashbang entry cannot import "bun"`,
      async target => {
        using dir = tempDir("hashbang-target", {
          "cli.js": `${hashbang}\nimport { semver } from "bun";\nconsole.log(typeof semver);\n`,
        });
        const expected = 'Browser build cannot import Bun builtin: "bun"';
        if (backend === "api") {
          const result = await Bun.build({ entrypoints: [join(String(dir), "cli.js")], target, throw: false });
          expect(result.logs.map(log => log.message)).toEqual([expect.stringContaining(expected)]);
          expect(result.success).toBe(false);
        } else {
          await using proc = Bun.spawn({
            cmd: [bunExe(), "build", "cli.js", "--outdir", "out", `--target=${target}`],
            cwd: String(dir),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
          expect(stderr).toContain(expected);
          expect(exitCode).toBe(1);
        }
      },
    );

    // Only an explicit target disables the default; format: "cjs" alone does not.
    test(`${backend}: the hashbang still selects bun with format cjs`, async () => {
      using dir = tempDir("hashbang-target", { "cli.js": `${hashbang}\nconsole.log("cjs");\n` });
      const [output] = await build(backend, String(dir), ["cli.js"], { format: "cjs" });
      expect(output).toStartWith(`${hashbang}\n// @bun @bun-cjs\n`);
      expect(await bunRun(join(String(dir), "out", "cli.js"))).toSpawn("cjs");
    });
  }

  test("api: an in-memory `files` entry is checked instead of the file on disk", async () => {
    using dir = tempDir("hashbang-target", {
      "plain.js": usesNodeFs(""),
      "cli.js": usesNodeFs(`${hashbang}\n`),
    });
    const plain = join(String(dir), "plain.js");
    const cli = join(String(dir), "cli.js");

    const inMemoryHashbang = await Bun.build({
      entrypoints: [plain],
      files: { [plain]: usesNodeFs(`${hashbang}\n`) },
    });
    expect(await inMemoryHashbang.outputs[0].text()).toStartWith(`${hashbang}\n// @bun\n`);

    const inMemoryPlain = await Bun.build({
      entrypoints: [cli],
      files: { [cli]: usesNodeFs("") },
    });
    expect(await inMemoryPlain.outputs[0].text()).not.toContain("// @bun");
  });

  test("api: an entry point that a plugin supplies is checked", async () => {
    using dir = tempDir("hashbang-target", { "plain.js": usesNodeFs("") });
    const loaded = await Bun.build({
      entrypoints: [join(String(dir), "plain.js")],
      plugins: [
        {
          name: "adds a hashbang",
          setup(build) {
            build.onLoad({ filter: /plain\.js$/ }, () => ({ contents: usesNodeFs(`${hashbang}\n`), loader: "js" }));
          },
        },
      ],
    });
    expect(await loaded.outputs[0].text()).toStartWith(`${hashbang}\n// @bun\n`);

    const virtual = await Bun.build({
      entrypoints: ["virtual:cli"],
      plugins: [
        {
          name: "virtual entry",
          setup(build) {
            build.onResolve({ filter: /^virtual:cli$/ }, () => ({ path: "cli", namespace: "virtual" }));
            build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
              contents: usesNodeFs(`${hashbang}\n`),
              loader: "js",
            }));
          },
        },
      ],
    });
    expect(await virtual.outputs[0].text()).toStartWith(`${hashbang}\n// @bun\n`);
  });

  // The build runs a second time for bun. The plugins are set up once, and they see the entry
  // points again.
  test.each([
    { name: "for a hashbang entry with no target", target: undefined, entryCalls: 2 },
    { name: "with target bun", target: "bun" as const, entryCalls: 1 },
  ])("api: plugin callbacks $name", async ({ target, entryCalls }) => {
    using dir = tempDir("hashbang-target", {
      "cli.js": `${hashbang}\nimport "./dep.js";\n`,
      "dep.js": usesNodeFs(""),
    });
    const calls: Record<string, number> = {};
    const count = (name: string) => void (calls[name] = (calls[name] ?? 0) + 1);
    const result = await Bun.build({
      entrypoints: [join(String(dir), "cli.js")],
      ...(target ? { target } : {}),
      plugins: [
        {
          name: "counter",
          setup(build) {
            count("setup");
            build.onStart(() => count("onStart"));
            build.onEnd(() => count("onEnd"));
            build.onResolve({ filter: /\.js$/ }, args => count(`onResolve ${basename(args.path)}`));
            build.onLoad({ filter: /\.js$/ }, args => count(`onLoad ${basename(args.path)}`));
          },
        },
      ],
    });
    expect(await result.outputs[0].text()).toStartWith(`${hashbang}\n// @bun\n`);
    expect(calls).toEqual({
      setup: 1,
      onStart: 1,
      onEnd: 1,
      "onResolve cli.js": entryCalls,
      "onLoad cli.js": entryCalls,
      "onResolve dep.js": 1,
      "onLoad dep.js": 1,
    });
  });

  // The first pass stops at the hashbang entry, so it never loads what only that entry imports.
  test("api: a plugin that waits for a file of the hashbang entry does not hang the build", async () => {
    using dir = tempDir("hashbang-target", {
      "plain.js": usesNodeFs(""),
      "cli.js": `${hashbang}\nimport "./only-cli-imports-this.js";\n`,
      "only-cli-imports-this.js": usesNodeFs(""),
    });
    const loaded = Promise.withResolvers<void>();
    const result = await Bun.build({
      entrypoints: [join(String(dir), "plain.js"), join(String(dir), "cli.js")],
      plugins: [
        {
          name: "waits",
          setup(build) {
            build.onLoad({ filter: /only-cli-imports-this\.js$/ }, () => void loaded.resolve());
            build.onLoad({ filter: /plain\.js$/ }, async () => {
              await loaded.promise;
              return { contents: `console.log("from the plugin");`, loader: "js" };
            });
          },
        },
      ],
    });
    const outputs = await Promise.all(result.outputs.map(output => output.text()));
    expect(outputs.map(output => output.split("\n").find(line => line.startsWith("//")))).toEqual([
      "// @bun",
      "// @bun",
    ]);
    expect(outputs[0]).toContain(`console.log("from the plugin");`);
  });

  // A directory is read once per process, so the second pass does not log these again.
  test.each([
    { name: "an error", packageJson: `{ "name": "broken", `, success: false },
    { name: "a warning", packageJson: `{ "name": "a", "name": "b" }`, success: true },
  ])("api: $name in the package.json of a hashbang entry is reported once", async ({ packageJson, success }) => {
    const files = { "cli.js": usesNodeFs(`${hashbang}\n`), "package.json": packageJson };
    using dir = tempDir("hashbang-target", files);
    using control = tempDir("hashbang-target", files);
    const [result, expected] = await Promise.all([
      Bun.build({ entrypoints: [join(String(dir), "cli.js")], throw: false }),
      Bun.build({ entrypoints: [join(String(control), "cli.js")], target: "bun", throw: false }),
    ]);
    const report = (built: typeof result) => ({
      success: built.success,
      logs: built.logs.map(log => `${log.level}: ${log.message}`),
    });
    expect(report(expected).logs).toHaveLength(1);
    expect(report(result)).toEqual(report(expected));
    expect(result.success).toBe(success);
  });

  test("api: the browser chunk of an HTML import has no pragma", async () => {
    using dir = tempDir("hashbang-target", {
      "server.js": `${hashbang}\nimport page from "./index.html";\nconsole.log(page);\n`,
      "index.html": `<script type="module" src="./client.js"></script>`,
      "client.js": `${hashbang}\nconsole.log("in the browser");\n`,
    });
    const result = await Bun.build({ entrypoints: [join(String(dir), "server.js")], target: "bun" });
    const outputs = await Promise.all(result.outputs.map(output => output.text()));
    const client = outputs.find(output => output.includes("in the browser"));
    expect(client).toBeDefined();
    expect(client).not.toContain("// @bun");
    expect(outputs.find(output => output.includes("index.html"))).toStartWith(`${hashbang}\n// @bun\n`);
  });
});
