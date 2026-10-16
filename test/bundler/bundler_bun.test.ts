import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join, sep } from "node:path";
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

  // Bun writes `require` into an ES module in three ways that only Bun runs.
  // A build over such a file has to read each of them as `require`.
  const requireWrittenByBun = {
    // `bun build --no-bundle --target=bun`, `new Bun.Transpiler({ target: "bun" })`
    Hoisted: {
      files: {
        "/entry.js": `import { name } from "./dist/lib.js"; console.log("app: hello " + name);`,
        "/dist/lib.js": `var {require}=import.meta;const config = require("./config.json");\nexport const name = config.name;\n`,
        "/dist/config.json": `{ "name": "world" }`,
      },
      stdout: "app: hello world",
      bundled: "world",
    },
    // `bun build --splitting --target=bun`
    Split: {
      files: {
        "/entry.js": `import { port } from "./dist/index.js"; console.log("app: port " + port());`,
        "/dist/index.js": `// @bun\nfunction port() {\n  return import.meta.require("./settings-xzncmjae.js").port;\n}\nexport {\n  port\n};\n`,
        "/dist/settings-xzncmjae.js": `// @bun\nvar port = 3000;\nexport {\n  port\n};\n`,
      },
      stdout: "app: port 3000",
      bundled: "3000",
    },
    // `bun build --target=bun`
    Helper: {
      files: {
        "/entry.js": `import { sep } from "./dist/index.js"; console.log("app: " + sep());`,
        "/dist/index.js": `// @bun\nvar __require = import.meta.require;\nfunction sep() {\n  return __require("path").posix.sep;\n}\nexport {\n  sep\n};\n`,
      },
      stdout: "app: /",
      bundled: undefined,
    },
  };
  for (const [target, format] of [
    ["bun", "esm"],
    ["node", "esm"],
    ["browser", "esm"],
    ["bun", "cjs"],
    ["node", "cjs"],
  ] as const) {
    for (const [form, { files, stdout, bundled }] of Object.entries(requireWrittenByBun)) {
      itBundled(`bun/RequireWrittenByBun${form}-${target}-${format}`, {
        files,
        target,
        format,
        run: { runtime: target === "node" ? "node" : "bun", stdout },
        onAfterBundle(api) {
          if (bundled) api.expectFile("/out.js").toContain(bundled);
          // A `require` that stays for run time is made from `import.meta` in esm output for bun and node.
          const keepsRequire = form === "Helper" && format === "esm" && target !== "browser";
          if (!keepsRequire) api.expectFile("/out.js").not.toContain("import.meta");
        },
      });
    }
  }
  itBundled("bun/RequireWrittenByBunOtherSpellings", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./lib/renamed.js";
        import { b } from "./lib/formatted.js";
        import { c } from "./lib/minified.js";
        import { d } from "./lib/indexed.js";
        import { e } from "./lib/used-above.js";
        import { f } from "./lib/two-properties.js";
        import { g } from "./lib/let.js";
        console.log(a, b, c, d, e, f, g);
      `,
      "/lib/renamed.js": `var { require: require2 } = import.meta;\nexport const a = require2("./a.cjs").x;`,
      "/lib/formatted.js": `// @bun\nvar { require } = import.meta;\nexport const b = require("./b.cjs").x;`,
      "/lib/minified.js": `var e=import.meta.require;export const c=e("./c.cjs").x;`,
      "/lib/indexed.js": `export const d = import.meta["require"]("./d.cjs").x;`,
      "/lib/used-above.js": `function load() { return __require("./e.cjs").x; }\nvar __require = import.meta.require;\nexport const e = load();`,
      "/lib/two-properties.js": `var { require, main } = import.meta;\nexport const f = require("./f.cjs").x + typeof main;`,
      "/lib/let.js": `let load = import.meta.require;\nexport const g = load("./g.cjs").x;`,
      "/lib/a.cjs": `exports.x = "a";`,
      "/lib/b.cjs": `exports.x = "b";`,
      "/lib/c.cjs": `exports.x = "c";`,
      "/lib/d.cjs": `exports.x = "d";`,
      "/lib/e.cjs": `exports.x = "e";`,
      "/lib/f.cjs": `exports.x = "f";`,
      "/lib/g.cjs": `exports.x = "g";`,
    },
    target: "bun",
    run: { stdout: "a b c d e fboolean g" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("import.meta.require");
    },
  });
  itBundled("bun/RequireWrittenByBunPropertiesOfTheAlias", {
    files: {
      "/entry.js": `import "./lib/hoisted.js"; import "./lib/helper.js";`,
      "/lib/hoisted.js": /* js */ `
        var {require}=import.meta;
        const uncalled = require;
        console.log(typeof require, typeof uncalled, require.resolve("./hoisted.cjs").endsWith("hoisted.cjs"));
        export {};
      `,
      "/lib/helper.js": /* js */ `
        var __require = import.meta.require;
        console.log(typeof __require, __require.resolve("./helper.cjs").endsWith("helper.cjs"));
        export {};
      `,
      "/lib/hoisted.cjs": ``,
      "/lib/helper.cjs": ``,
    },
    target: "bun",
    run: { stdout: "function function true\nfunction true" },
  });
  // A file with no `import` or `export` does not become CommonJS.
  itBundled("bun/RequireWrittenByBunStaysESM", {
    files: {
      "/entry.js": `import "./lib/side.js";`,
      "/lib/side.js": `var __require = import.meta.require;\nconsole.log(__require("./dep.js").x);`,
      "/lib/dep.js": `export const x = "dep";`,
    },
    target: "bun",
    run: { stdout: "dep" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__commonJS");
    },
  });
  // The helper that a `--splitting --target=bun` build shares between chunks.
  for (const target of ["bun", "node"] as const) {
    itBundled(`bun/RequireWrittenByBunExportedHelper-${target}-cjs`, {
      files: {
        "/entry.js": `import { sep } from "./dist/index.js"; console.log("app: " + sep());`,
        "/dist/index.js": `// @bun\nimport {\n  __require\n} from "./index-pb1dcdw6.js";\nfunction sep() {\n  return __require("path").posix.sep;\n}\nexport {\n  sep\n};\n`,
        "/dist/index-pb1dcdw6.js": `// @bun\nvar __require = import.meta.require;\n\nexport { __require };\n`,
      },
      target,
      format: "cjs",
      run: { runtime: target, stdout: "app: /" },
      onAfterBundle(api) {
        api.expectFile("/out.js").not.toContain("import.meta");
      },
    });
  }
  itBundled("bun/RequireWrittenByBunBytecode", {
    files: requireWrittenByBun.Helper.files,
    target: "bun",
    format: "cjs",
    bytecode: true,
    outdir: "/out",
    run: { stdout: "app: /" },
  });
  itBundled("bun/RequireWrittenByBunTranspilerInPlugin", {
    files: {
      "/entry.js": `import { name } from "./src/lib.ts"; console.log("app: hello " + name);`,
      "/src/lib.ts": `const config = require("./config.json"); export const name: string = config.name;`,
      "/src/config.json": `{ "name": "world" }`,
    },
    target: "bun",
    plugins(builder) {
      builder.onLoad({ filter: /lib\.ts$/ }, async args => ({
        contents: new Bun.Transpiler({ target: "bun", loader: "ts" }).transformSync(await Bun.file(args.path).text()),
        loader: "js",
      }));
    },
    run: { stdout: "app: hello world" },
  });
  itBundled("bun/RequireWrittenByBunMissingFile", {
    files: {
      "/entry.js": `import "./split.js"; import "./hoisted.js";`,
      "/split.js": `console.log(import.meta.require("./missing-chunk.js"));`,
      "/hoisted.js": `var {require}=import.meta;console.log(require("./missing-file.js"));export {};`,
    },
    target: "bun",
    bundleErrors: {
      "/split.js": ['Could not resolve: "./missing-chunk.js"'],
      "/hoisted.js": ['Could not resolve: "./missing-file.js"'],
    },
  });
  itBundled("bun/RequireWrittenByBunMissingFileHandled", {
    files: {
      "/entry.js": /* js */ `
        try {
          import.meta.require("./missing.js");
        } catch {
          console.log("caught");
        }
        if (false) import.meta.require("./never.js");
      `,
    },
    target: "bun",
    run: { stdout: "caught" },
  });
  // A call that is not `require` of one string stays as the user wrote it.
  itBundled("bun/RequireNotWrittenByBunIsLeftAlone", {
    files: {
      "/entry.js": /* js */ `
        import { createRequire } from "node:module";
        const require = createRequire(import.meta.url);
        function withParameter(require) {
          return require("./dep.cjs");
        }
        const name = "./dep" + ".cjs";
        console.log(
          require("./dep.cjs").x,
          withParameter(x => "parameter:" + x),
          import.meta.require(name).x,
          import.meta.require?.("./dep.cjs").x,
          import.meta.require("./dep.cjs", {}).x,
          typeof import.meta.require.resolve,
          typeof import.meta.require.cache,
        );
      `,
      "/dep.cjs": `exports.x = "not in the bundle";`,
    },
    target: "bun",
    run: {
      stdout:
        "not in the bundle parameter:./dep.cjs not in the bundle not in the bundle not in the bundle function object",
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("not in the bundle");
      for (const kept of [
        "createRequire(import.meta.url)",
        "import.meta.require(name)",
        'import.meta.require?.("./dep.cjs")',
        'import.meta.require("./dep.cjs", {})',
        "import.meta.require.resolve",
        "import.meta.require.cache",
      ]) {
        expect(out).toContain(kept);
      }
    },
  });
  // A binding that can hold something other than `import.meta.require` stays a binding.
  itBundled("bun/RequireAliasWithAnotherValueIsLeftAlone", {
    files: {
      "/entry.js": /* js */ `
        import { exported } from "./exported.js";
        import "./declared-after.js";
        import "./declared-before.js";
        import "./declared-in-block.js";
        import "./assigned.js";
        import "./assigned-in-pattern.js";
        import "./assigned-with-warning.js";
        import "./with-eval.js";
        import "./let.js";
        import "./assigned-property.js";
        console.log(exported("./dep.cjs").x);
      `,
      "/exported.js": `var __require = import.meta.require;\nexport { __require as exported };`,
      "/declared-after.js": `var load = import.meta.require;\nvar load = x => "declared after:" + x;\nconsole.log(load("./dep.cjs"));`,
      "/declared-before.js": `var load = x => "declared before:" + x;\nconsole.log(load("./dep.cjs"));\nvar load = import.meta.require;`,
      "/declared-in-block.js": `var load = import.meta.require;\n{\n  var load = x => "declared in a block:" + x;\n}\nconsole.log(load("./dep.cjs"));`,
      "/assigned.js": `var load = import.meta.require;\nload = x => "assigned:" + x;\nconsole.log(load("./dep.cjs"));`,
      "/assigned-in-pattern.js": `var {require}=import.meta;\n[require] = [x => "assigned in a pattern:" + x];\nconsole.log(require("./dep.cjs"));`,
      "/assigned-with-warning.js": `-->\nvar load = import.meta.require;\nload = x => "assigned with a warning:" + x;\nconsole.log(load("./dep.cjs"));`,
      "/assigned-property.js": `import.meta.require = x => "assigned property:" + x;\nconsole.log(import.meta.require("./dep.cjs"));`,
      "/with-eval.js": `var {require}=import.meta;\nconsole.log("with eval:", eval("1 + 1"), require("./dep.cjs").x);`,
      "/let.js": `let load = import.meta.require;\nload = x => "let:" + x;\nconsole.log(load("./dep.cjs"));`,
      "/dep.cjs": `exports.x = "not in the bundle";`,
    },
    target: "bun",
    run: {
      stdout:
        "declared after:./dep.cjs\ndeclared before:./dep.cjs\ndeclared in a block:./dep.cjs\n" +
        "assigned:./dep.cjs\nassigned in a pattern:./dep.cjs\nassigned with a warning:./dep.cjs\n" +
        "with eval: 2 not in the bundle\nlet:./dep.cjs\nassigned property:./dep.cjs\nnot in the bundle",
    },
    // The second parse of a file does not report a warning again.
    bundleWarnings: {
      "/assigned-with-warning.js": ['Treating "-->" as the start of a legacy HTML single-line comment'],
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("not in the bundle");
    },
  });
  itBundled("bun/RequireWrittenByBunDefineWins", {
    files: {
      "/entry.js": `var __require = import.meta.require;\nconsole.log(__require("./lib/dep.cjs"), import.meta.require("./lib/dep.cjs"));`,
      "/lib/dep.cjs": `exports.x = "not in the bundle";`,
    },
    target: "bun",
    define: { "import.meta.require": "String" },
    run: { stdout: "./lib/dep.cjs ./lib/dep.cjs" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("not in the bundle");
    },
  });

  // Bun writes the library, then bundles an app over what it wrote.
  describe("a bundle over files that bun wrote", () => {
    test.each([
      {
        writer: "Bun.Transpiler for bun",
        files: {
          "dist/config.json": `{ "name": "world" }`,
          "src/lib.ts": `const config = require("./config.json"); export const name: string = config.name;`,
          "app.js": `import { name } from "./dist/lib.js"; console.log("app: hello " + name);`,
        },
        async write(cwd: string) {
          const source = await Bun.file(join(cwd, "src", "lib.ts")).text();
          const written = new Bun.Transpiler({ target: "bun", loader: "ts" }).transformSync(source);
          await Bun.write(join(cwd, "dist", "lib.js"), written);
        },
        format: "esm",
        stdout: "app: hello world\n",
      },
      {
        writer: "Bun.build for bun with splitting",
        files: {
          "src/settings.js": `export const port = 3000;`,
          "src/index.js": `export function port() { return require("./settings.js").port; }`,
          "app.js": `import { port } from "./dist/index.js"; console.log("app: port " + port());`,
        },
        async write(cwd: string) {
          await Bun.build({
            entrypoints: [join(cwd, "src", "index.js")],
            outdir: join(cwd, "dist"),
            target: "bun",
            splitting: true,
          });
        },
        format: "esm",
        stdout: "app: port 3000\n",
      },
      {
        writer: "Bun.build for bun, bundled again as cjs",
        files: {
          "src/index.js": `export function sep() { return require("node:path").sep; }`,
          "app.js": `import { sep } from "./dist/index.js"; console.log("app: " + sep());`,
        },
        async write(cwd: string) {
          await Bun.build({ entrypoints: [join(cwd, "src", "index.js")], outdir: join(cwd, "dist"), target: "bun" });
        },
        format: "cjs",
        stdout: `app: ${sep}\n`,
      },
    ] as const)("$writer", async ({ files, write, format, stdout }) => {
      using dir = tempDir("bundle-over-bun-output", files);
      const cwd = String(dir);
      await write(cwd);
      await Bun.build({ entrypoints: [join(cwd, "app.js")], outdir: join(cwd, "out"), target: "bun", format });

      await using app = Bun.spawn({
        cmd: [bunExe(), join(cwd, "out", "app.js")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([app.stdout.text(), app.stderr.text(), app.exited]);
      expect({ stdout: out, stderr: err, exitCode }).toEqual({ stdout, stderr: "", exitCode: 0 });
    });
  });
});
