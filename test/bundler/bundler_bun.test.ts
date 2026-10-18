import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { rm } from "node:fs/promises";
import { join } from "node:path";
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

  // Bun writes `require` into ES-module output through `import.meta`.
  // A build over such a file has to read it as `require`.
  const requireWrittenByBun = {
    // `bun build --no-bundle --target=bun`, `new Bun.Transpiler({ target: "bun" })`
    Prelude: {
      files: {
        "/entry.js": `import { name } from "./dist/lib.js"; console.log("app: hello " + name);`,
        "/dist/lib.js": `var {require}=import.meta;const config = require("./config.json");\nexport const name = config.name;\n`,
        "/dist/config.json": `{ "name": "world" }`,
      },
      stdout: "app: hello world",
    },
    // `bun build --splitting --target=bun`
    SplitCall: {
      files: {
        "/entry.js": `import { port } from "./dist/index.js"; console.log("app: port " + port());`,
        "/dist/index.js": `// @bun\nfunction port() {\n  return import.meta.require("./settings-xzncmjae.js").port;\n}\nexport {\n  port\n};\n`,
        "/dist/settings-xzncmjae.js": `// @bun\nvar port = 3000;\nexport {\n  port\n};\n`,
      },
      stdout: "app: port 3000",
    },
    // `bun build --target=bun`
    Helper: {
      files: {
        "/entry.js": `import { sep } from "./dist/index.js"; console.log("app: " + sep());`,
        "/dist/index.js": `// @bun\nvar __require = import.meta.require;\nfunction sep() {\n  return __require("path").posix.sep;\n}\nexport {\n  sep\n};\n`,
      },
      stdout: "app: /",
    },
    // `bun build --splitting --target=bun` when two chunks use `require`: the helper is in a chunk of its own.
    SharedHelper: {
      files: {
        "/entry.js": `import { sep } from "./dist/index.js"; console.log("app: " + sep());`,
        "/dist/index.js": `// @bun\nimport {\n  __require\n} from "./index-pb1dcdw6.js";\nfunction sep() {\n  return __require("path").posix.sep;\n}\nexport {\n  sep\n};\n`,
        "/dist/index-pb1dcdw6.js": `// @bun\nvar __require = import.meta.require;\n\nexport { __require };\n`,
      },
      stdout: "app: /",
    },
    // Bun 1.0.0 to 1.1.42 wrote the call at each use.
    InlineCall: {
      files: {
        "/entry.js": `import { Command } from "./dist/index.js"; console.log("app: " + typeof new Command().on);`,
        "/dist/index.js": `// @bun\nvar EventEmitter = import.meta.require("events").EventEmitter;\n\nclass Command extends EventEmitter {\n}\nexport {\n  Command\n};\n`,
      },
      stdout: "app: function",
    },
  };
  const cells = [
    ["bun", "esm"],
    ["node", "esm"],
    ["browser", "esm"],
    ["bun", "cjs"],
    ["node", "cjs"],
  ] as const;
  for (const [target, format] of cells) {
    for (const [form, { files, stdout }] of Object.entries(requireWrittenByBun)) {
      itBundled(`bun/RequireWrittenByBun${form}-${target}-${format}`, {
        files,
        target,
        format,
        run: { runtime: target === "node" ? "node" : "bun", stdout },
        onAfterBundle(api) {
          const out = api.readFile("/out.js");
          // Only ES-module output for Bun can keep a call as Bun wrote it.
          if (target !== "bun" || format !== "esm") expect(out).not.toContain("import.meta.require");
          if (format === "cjs") expect(out).not.toContain("import.meta");
          // A string behind a helper that is an import binding stays a run-time lookup.
          if (target === "browser") expect(out.includes("Dynamic require")).toBe(form === "SharedHelper");
        },
      });
    }
  }
  itBundled("bun/RequireWrittenByBunOtherSpellings", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./lib/renamed.js";
        import { b } from "./lib/formatted.js";
        import { c } from "./lib/joined.js";
        import { d } from "./lib/minified.js";
        import { e } from "./lib/indexed.js";
        import { f } from "./lib/used-above.js";
        import { g } from "./lib/after-hashbang.js";
        import { h } from "./lib/typescript.ts";
        console.log(a, b, c, d, e, f, g, h);
      `,
      "/lib/renamed.js": `var { require: require2 } = import.meta;\nexport const a = require2("./a.cjs").x;`,
      "/lib/formatted.js": `// a banner\nimport "./a.cjs";\nvar { require } = import.meta;\nexport const b = require("./b.cjs").x;`,
      "/lib/joined.js": `var{require:e}=import.meta,r=0;export const c=e("./c.cjs").x+r;`,
      "/lib/minified.js": `// @bun\nvar e=import.meta.require;function p(){return e("./d.cjs").x}export const d=p();`,
      "/lib/indexed.js": `// @bun\nexport const e = import.meta["require"]("./e.cjs").x;`,
      "/lib/used-above.js": `// @bun\nfunction load() { return __require("./f.cjs").x; }\nvar __require = import.meta.require;\nexport const f = load();`,
      "/lib/after-hashbang.js": `#!/usr/bin/env bun\n// @bun\nvar __require = import.meta.require;\nexport const g = __require("./g.cjs").x;`,
      "/lib/typescript.ts": `var {require}=import.meta;const value: { x: string } = require("./h.cjs");\nexport const h: string = value.x;`,
      "/lib/a.cjs": `exports.x = "a";`,
      "/lib/b.cjs": `exports.x = "b";`,
      "/lib/c.cjs": `exports.x = "c";`,
      "/lib/d.cjs": `exports.x = "d";`,
      "/lib/e.cjs": `exports.x = "e";`,
      "/lib/f.cjs": `exports.x = "f";`,
      "/lib/g.cjs": `exports.x = "g";`,
      "/lib/h.cjs": `exports.x = "h";`,
    },
    target: "bun",
    run: { stdout: "a b c0 d e f g h" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("import.meta");
    },
  });
  // Only a call with one string is read. The declaration stays for every other use of its name.
  itBundled("bun/RequireWrittenByBunKeepsTheDeclaration", {
    files: {
      "/entry.js": `import "./prelude.js"; import "./helper.js"; import "./assigned.js";`,
      "/prelude.js": /* js */ `var {require}=import.meta;
        const uncalled = require;
        const name = "./run-time.cjs";
        console.log(typeof require, require("./lib/dep.cjs").x, uncalled(name).x, require(name).x, require.resolve(name).endsWith("run-time.cjs"));
        export {};
      `,
      "/helper.js": /* js */ `// @bun
        console.log(typeof __require);
        var __require = import.meta.require;
        console.log(typeof __require, __require("./lib/dep.cjs").x, __require.resolve("./run-time.cjs").endsWith("run-time.cjs"));
        export {};
      `,
      // The bundler does not follow an assignment to `require` either.
      "/assigned.js": /* js */ `// @bun
        var __require = import.meta.require;
        __require = x => ({ x: "assigned " + x });
        console.log(__require("./lib/dep.cjs").x, __require("./run-time" + ".cjs").x);
        export {};
      `,
      "/lib/dep.cjs": `exports.x = "bundled";`,
      "/run-time.cjs": `exports.x = "at run time";`,
    },
    target: "bun",
    run: {
      stdout:
        "function bundled at run time at run time true\nundefined\nfunction bundled true\nbundled assigned ./run-time.cjs",
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("at run time");
    },
  });
  // A file with no import and no export is CommonJS when it uses the real `require`, and an ES module when it does not.
  itBundled("bun/RequireWrittenByBunModuleKind", {
    files: {
      "/entry.js": `import commonjs from "./lib/commonjs.js"; import "./lib/module.js"; console.log(typeof commonjs);`,
      "/lib/commonjs.js": `// @bun\nvar __require = import.meta.require;\nconsole.log(typeof require("node:fs").readFileSync, __require("./dep.cjs").x);`,
      "/lib/module.js": `// @bun\nvar __require = import.meta.require;\nconsole.log(__require("./dep.cjs").x);`,
      "/lib/dep.cjs": `exports.x = "bundled";`,
    },
    target: "bun",
    run: { stdout: "function bundled\nbundled\nobject" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("var require_commonjs = __commonJS(");
      expect(out).toContain("// lib/module.js\nconsole.log(");
    },
  });
  // What Bun did not write stays as it is where Bun runs the output.
  itBundled("bun/RequireNotWrittenByBunIsLeftAlone", {
    files: {
      "/entry.js": /* js */ `
        import { createRequire } from "node:module";
        import { exported } from "./exported.js";
        import "./written-by-bun.js";
        const require = createRequire(import.meta.url);
        function withParameter(require) {
          return require("./dep.cjs");
        }
        const name = "./dep" + ".cjs";
        const { require: second, url } = import.meta;
        let third = import.meta.require;
        const fourth = import.meta.require;
        var fifth = import.meta.require;
        var sixth = import.meta.require;
        var sixth = import.meta.require;
        console.log(
          require("./dep.cjs").x,
          withParameter(x => "parameter:" + x),
          import.meta.require("./dep.cjs").x,
          import.meta.require(name).x,
          import.meta.require?.("./dep.cjs").x,
          import.meta.require("./dep.cjs", {}).x,
          second("./dep.cjs").x,
          third("./dep.cjs").x,
          fourth("./dep.cjs").x,
          fifth("./dep.cjs").x,
          sixth("./dep.cjs").x,
          exported("./dep.cjs").x,
          typeof import.meta.require.resolve,
          typeof url,
        );
      `,
      "/exported.js": `// @bun\nvar __require = import.meta.require;\nexport { __require as exported };`,
      "/written-by-bun.js": `// @bun\nvar __require = import.meta.require;\nconsole.log(__require("./lib/bundled.cjs").x);`,
      "/lib/bundled.cjs": `exports.x = "bundled";`,
      "/dep.cjs": `exports.x = "left";`,
    },
    target: "bun",
    run: {
      stdout: "bundled\nleft parameter:./dep.cjs left left left left left left left left left left function string",
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain('"bundled"');
      expect(out).not.toContain('"left"');
      for (const kept of [
        "createRequire(import.meta.url)",
        'import.meta.require("./dep.cjs")',
        "import.meta.require(name)",
        'import.meta.require?.("./dep.cjs")',
        'import.meta.require("./dep.cjs", {})',
        "import.meta.require.resolve",
      ]) {
        expect(out).toContain(kept);
      }
    },
  });
  // A declaration is read only when its name can have no other value and no other reader.
  itBundled("bun/RequireWrittenByBunDeclarationsThatAreNotRead", {
    files: {
      "/entry.js": /* js */ `
        import "./read.js";
        import "./let.js";
        import "./const-pattern.js";
        import "./exported-var.js";
        import "./exported-in-clause.js";
        import "./two-properties.js";
        import "./default-value.js";
        import "./declared-after.js";
        import "./declared-before.js";
        import "./declared-in-block.js";
        import "./no-bun-line.js";
        import "./other-line.js";
        import "./defined-name.js";
        import "./defined-property.js";
      `,
      "/read.js": `// @bun\nvar __require = import.meta.require;\nconsole.log(__require("./lib/bundled.cjs").x);`,
      "/let.js": `// @bun\nlet __require = import.meta.require;\nconsole.log("let", __require("./dep.cjs").x);`,
      "/const-pattern.js": `const { require } = import.meta;\nconsole.log("const pattern", require("./dep.cjs").x);\nexport {};`,
      "/exported-var.js": `// @bun\nexport var __require = import.meta.require;\nconsole.log("exported var", __require("./dep.cjs").x);`,
      "/exported-in-clause.js": `// @bun\nvar __require = import.meta.require;\nconsole.log("exported in a clause", __require("./dep.cjs").x);\nexport { __require };`,
      "/two-properties.js": `var { require, url } = import.meta;\nconsole.log("two properties", require("./dep.cjs").x, typeof url);\nexport {};`,
      "/default-value.js": `var { require = null } = import.meta;\nconsole.log("default value", require("./dep.cjs").x);\nexport {};`,
      "/declared-after.js": `// @bun\nvar load = import.meta.require;\nvar load = import.meta.require;\nconsole.log("declared after", load("./dep.cjs").x);`,
      "/declared-before.js": `// @bun\nvar load = import.meta.require;\nconsole.log("declared before", load("./dep.cjs").x);\nvar load = import.meta.require;`,
      "/declared-in-block.js": `// @bun\nvar load = import.meta.require;\n{\n  var load = import.meta.require;\n}\nconsole.log("declared in a block", load("./dep.cjs").x);`,
      "/no-bun-line.js": `var __require = import.meta.require;\nconsole.log("no bun line", __require("./dep.cjs").x);\nexport {};`,
      "/other-line.js": `// @bundled by hand\nvar __require = import.meta.require;\nconsole.log("other line", __require("./dep.cjs").x);\nexport {};`,
      "/defined-name.js": `// @bun\nvar definedName = import.meta.require;\nconsole.log("defined name", definedName("./dep.cjs").x);`,
      "/defined-property.js": `// @bun\nvar definedRoot = import.meta.require;\nconsole.log("defined property", definedRoot("./dep.cjs").x, typeof definedRoot.resolve);`,
      "/lib/bundled.cjs": `exports.x = "bundled";`,
      "/dep.cjs": `exports.x = "left";`,
    },
    target: "bun",
    define: { "definedName": "String", "definedRoot.resolve": "String" },
    run: {
      stdout: [
        "bundled",
        "let left",
        "const pattern left",
        "exported var left",
        "exported in a clause left",
        "two properties left string",
        "default value left",
        "declared after left",
        "declared before left",
        "declared in a block left",
        "no bun line left",
        "other line left",
        "defined name left",
        "defined property left function",
      ].join("\n"),
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain('"bundled"');
      expect(out).not.toContain('"left"');
    },
  });
  // Hand-written code that asks for Bun at run time builds for node as before, and gets `require` there.
  itBundled("bun/RequireNotWrittenByBunForNode", {
    files: {
      "/entry.js": /* js */ `
        import "./written-by-bun.js";
        const isBun = typeof Bun !== "undefined";
        const ws = isBun ? import.meta.require("ws") : null;
        const sqlite = isBun ? import.meta.require("bun:sqlite") : null;
        const optional = isBun ? import.meta.require("a-package-that-is-not-installed") : null;
        const load = import.meta.require;
        console.log(ws, sqlite, optional, typeof load, typeof load("node:path").sep);
      `,
      "/written-by-bun.js": `// @bun\nvar __require = import.meta.require;\nconsole.log(typeof __require("node:path").sep, __require("./lib/bundled.cjs").x);`,
      "/lib/bundled.cjs": `exports.x = "bundled";`,
    },
    target: "node",
    run: { runtime: "node", stdout: "string bundled\nnull null null function string" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("import.meta.require");
      expect(out).toContain('__require("ws")');
    },
  });
  // A file that is not there at build time leaves the call for run time, as before the call was read.
  itBundled("bun/RequireWrittenByBunUnresolvedStaysForRunTime", {
    files: {
      "/entry.js": `import { pins } from "./split.js"; import "./prelude.js"; import { optional } from "./helper.js"; console.log(typeof pins, typeof optional);`,
      "/split.js": /* js */ `// @bun
        console.log(import.meta.require("./lib/bundled.cjs").x);
        try {
          import.meta.require("./missing-chunk.js");
        } catch (e) {
          console.log("split:", e.code);
        }
        export function pins() {
          return [import.meta.require("/$bunfs/root/chunk-def456.js"), import.meta.require("B:/~BUN/root/chunk-def456.js")];
        }
      `,
      "/prelude.js": /* js */ `var {require}=import.meta;
        try {
          require("./missing-file.js");
        } catch (e) {
          console.log("prelude:", e.code);
        }
        export {};
      `,
      "/helper.js": /* js */ `// @bun
        var __require = import.meta.require;
        export function optional() {
          return __require("a-package-that-is-not-installed");
        }
        console.log("helper: built");
      `,
      "/lib/bundled.cjs": `exports.x = "bundled";`,
    },
    target: "bun",
    run: { stdout: "bundled\nsplit: MODULE_NOT_FOUND\nprelude: MODULE_NOT_FOUND\nhelper: built\nfunction function" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      for (const kept of [
        'import.meta.require("./missing-chunk.js")',
        'import.meta.require("/$bunfs/root/chunk-def456.js")',
        'import.meta.require("B:/~BUN/root/chunk-def456.js")',
        'import.meta.require("./missing-file.js")',
        'import.meta.require("a-package-that-is-not-installed")',
      ]) {
        expect(out).toContain(kept);
      }
    },
  });
  // An external stays the lazy call that Bun wrote. It does not become an `import` statement.
  itBundled("bun/RequireWrittenByBunExternalStaysLazy", {
    files: {
      "/entry.js": /* js */ `
        import { react, tiny, bundled } from "./dist/index.js";
        console.log(bundled(), typeof react, typeof tiny);
      `,
      "/dist/index.js": /* js */ `// @bun
        var __require = import.meta.require;
        export function react() { return import.meta.require("react"); }
        export function tiny() { return __require("tinypkg"); }
        export function bundled() { return __require("./bundled.cjs").x; }
      `,
      "/dist/bundled.cjs": `exports.x = "bundled";`,
      "/node_modules/react/index.js": `throw new Error("react is external");`,
      "/node_modules/tinypkg/index.js": `throw new Error("tinypkg is external");`,
    },
    target: "bun",
    external: ["react", "tinypkg"],
    run: { stdout: "bundled function function" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain('return import.meta.require("react")');
      expect(out).toContain('return import.meta.require("tinypkg")');
      expect(out).not.toContain("is external");
      expect(out).not.toMatch(/^import /m);
    },
  });
  itBundled("bun/RequireWrittenByBunDefineWins", {
    files: {
      "/entry.js": `// @bun\nvar __require = import.meta.require;\nconsole.log(__require("./lib/dep.cjs"), import.meta.require("./lib/dep.cjs"));`,
      "/lib/dep.cjs": `exports.x = "not in the bundle";`,
    },
    target: "bun",
    define: { "import.meta.require": "String" },
    run: { stdout: "./lib/dep.cjs ./lib/dep.cjs" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("not in the bundle");
    },
  });
  itBundled("bun/RequireWrittenByBunDropWins", {
    files: {
      "/entry.js": `// @bun\nimport.meta.require("./lib/dep.cjs");\nconsole.log("dropped");`,
      "/lib/dep.cjs": `console.log("loaded");`,
    },
    target: "bun",
    drop: ["import.meta.require"],
    run: { stdout: "dropped" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("loaded");
    },
  });
  // Iife output has no `__require`, so `import.meta.require` keeps its own value there. A string call is still read.
  itBundled("bun/RequireWrittenByBunIife", {
    files: {
      "/entry.js": `import { sep, name } from "./dist/index.js"; console.log("app: " + sep() + " " + name);`,
      "/dist/index.js": `// @bun\nvar __require = import.meta.require;\nfunction sep() {\n  return __require("path").posix.sep;\n}\nvar name = __require("./config.json").name;\nexport {\n  sep,\n  name\n};\n`,
      "/dist/config.json": `{ "name": "world" }`,
    },
    target: "bun",
    format: "iife",
    run: { stdout: "app: / world" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("world");
      expect(out).not.toContain("__require");
    },
  });
  // A direct `eval` in the file changes nothing: the declaration is there for it.
  for (const [target, format] of [
    ["node", "esm"],
    ["bun", "cjs"],
  ] as const) {
    itBundled(`bun/RequireWrittenByBunBesideDirectEval-${target}-${format}`, {
      files: {
        "/entry.js": `import { sep } from "./dist/lib.js"; import "./dist/prelude.js"; console.log("app: " + sep());`,
        "/dist/lib.js": `// @bun\nvar __require = import.meta.require;\n\n// src/lib.js\nfunction sep() {\n  return __require("path").posix.sep;\n}\nfunction inquire(name) {\n  try {\n    return eval("quire".replace(/^/, "re"))(name);\n  } catch (e) {\n    return null;\n  }\n}\nexport {\n  sep,\n  inquire\n};\n`,
        "/dist/prelude.js": `var {require}=import.meta;console.log(eval("typeof require"), require("./dep.cjs").x);`,
        "/dist/dep.cjs": `exports.x = "bundled";`,
      },
      target,
      format,
      run: { runtime: target, stdout: "function bundled\napp: /" },
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
  // Bun 1.4.3 wrote this for a second build over the helper: the value comes from an assignment in `__esm`.
  for (const [target, format] of [
    ["node", "esm"],
    ["bun", "cjs"],
  ] as const) {
    itBundled(`bun/RequireWrittenByBunHelperInEsm-${target}-${format}`, {
      files: {
        "/entry.js": `import { s } from "./dist/pkg.js"; console.log("app: " + s());`,
        "/dist/pkg.js": `// @bun\nvar __esm = (fn, res, err) => () => {\n  if (fn)\n    try {\n      res = fn(fn = 0);\n    } catch (e) {\n      err = [e];\n    }\n  if (err)\n    throw err[0];\n  return res;\n};\n\n// dist1/inner.js\nimport { sep } from "path";\nfunction s() {\n  return __require("path").sep + sep;\n}\nvar __require;\nvar init_inner = __esm(() => {\n  __require = import.meta.require;\n});\n\n// src/pkg.js\nfunction s2() {\n  return init_inner(), s();\n}\nexport {\n  s2 as s\n};\n`,
      },
      target,
      format,
      run: { runtime: target, stdout: "app: //" },
      onAfterBundle(api) {
        api.expectFile("/out.js").not.toContain("import.meta.require");
      },
    });
  }
  // A call that stays for run time keeps its own chunk as the base, in a build with `splitting` as well.
  itBundled("bun/RequireWrittenByBunSplittingKeepsTheBase", {
    files: {
      "/index.js": `import { bundled } from "./lib/shared.js"; console.log("index: " + bundled());`,
      "/pages/a.js": /* js */ `// @bun
        var __require = import.meta.require;
        import { bundled } from "../lib/shared.js";
        const name = "./data" + ".cjs";
        console.log(
          "page:",
          bundled(),
          import.meta.require(name).where,
          __require(name).where,
          import.meta.require("./data.cjs").where,
          __require("./data.cjs").where,
        );
      `,
      "/lib/shared.js": `// @bun\nvar __require = import.meta.require;\nexport function bundled() { return __require("./dep.cjs").x; }`,
      "/lib/dep.cjs": `exports.x = "bundled";`,
    },
    runtimeFiles: {
      "/out/data.cjs": `exports.where = "out";`,
      "/out/pages/data.cjs": `exports.where = "out/pages";`,
    },
    entryPoints: ["/index.js", "/pages/a.js"],
    outputPaths: ["/out/index.js", "/out/pages/a.js"],
    splitting: true,
    target: "bun",
    outdir: "/out",
    run: { file: "/out/pages/a.js", stdout: "page: bundled out/pages out/pages out/pages out/pages" },
  });
  // `import addon from "./addon.node"` is written as a call through the helper. The addon goes to the new output.
  for (const target of ["bun", "node"] as const) {
    itBundled(`bun/RequireWrittenByBunNapiAddon-${target}`, {
      files: {
        "/entry.js": `import addon from "./dist/entry.js"; export default addon;`,
        "/dist/entry.js": `// @bun\nvar __require = import.meta.require;\n\n// addon.node\nvar addon_default = __require("./addon-h1fv52vp.node");\n\n// entry.ts\nvar entry_default = addon_default;\nexport {\n  entry_default as default\n};\n`,
        "/dist/addon-h1fv52vp.node": "not a real addon",
      },
      target,
      outdir: "/out",
      onAfterBundle(api) {
        const [, addon] = api.readFile("/out/entry.js").match(/require\("\.\/(addon-[a-z0-9-]+\.node)"\)/)!;
        expect(api.readFile(join("/out", addon))).toBe("not a real addon");
      },
    });
  }
  // What a `require()` cannot load is the same build error through what Bun wrote.
  itBundled("bun/RequireWrittenByBunNapiAddon-browser", {
    files: {
      "/entry.js": `import addon from "./dist/addon.js"; export default addon;`,
      "/dist/addon.js": `// @bun\nvar __require = import.meta.require;\nvar addon_default = __require("./addon-h1fv52vp.node");\nexport {\n  addon_default as default\n};\n`,
      "/dist/addon-h1fv52vp.node": "not a real addon",
    },
    target: "browser",
    bundleErrors: {
      "/dist/addon-h1fv52vp.node": [
        `Loading .node files won't work in the browser. Make sure to set target to "bun" or "node"`,
      ],
    },
  });
  itBundled("bun/RequireWrittenByBunTopLevelAwait", {
    files: {
      "/entry.js": `import { load } from "./dist/index.js"; console.log(typeof load);`,
      "/dist/index.js": `// @bun\nfunction load() {\n  return import.meta.require("./top-level-await.js");\n}\nexport {\n  load\n};\n`,
      "/dist/top-level-await.js": `export const value = await 1;`,
    },
    target: "bun",
    bundleErrors: {
      "/dist/index.js": [
        `This require call is not allowed because the transitive dependency "dist/top-level-await.js" contains a top-level await`,
      ],
    },
  });

  // `require.resolve()` through the line that Bun's transpiler writes stays a lookup in the executable.
  itBundled("bun/RequireWrittenByBunCompileResolvesEmbeddedFile", {
    compile: true,
    assetNaming: "[name].[ext]",
    files: {
      "/entry.ts": /* js */ `
        import { where, name } from "./lib/lib.js";
        const path = where();
        console.log(name, (await Bun.file(path).text()).trim(), path.includes("$bunfs") || path.includes("~BUN"));
      `,
      "/lib/lib.js": `var {require}=import.meta;import"./foo.file";export const where = () => require.resolve("./foo.file");\nexport const name = require("./config.json").name;\n`,
      "/lib/foo.file": "abcd",
      "/lib/config.json": `{ "name": "world" }`,
    },
    outfile: "dist/out",
    run: { stdout: "world abcd true", setCwd: true },
  });
  // Hand-written \`import.meta.require\` gets the value of \`require\` where the output cannot evaluate it.
  // https://github.com/oven-sh/bun/issues/9416
  for (const target of ["node", "browser"] as const) {
    itBundled(`bun/ImportMetaRequireTarget-${target}#9416`, {
      files: {
        "/entry.ts": /* js */ `
          const events = import.meta.require("events");
          const ref = import.meta.require;
          const path = import.meta.require.resolve("path");
          console.log(typeof events.EventEmitter, typeof ref, typeof path);
        `,
      },
      target,
      run: { stdout: "function function string" },
      onAfterBundle(api) {
        api.expectFile("/out.js").not.toContain("import.meta.require");
      },
    });
  }
  itBundled("bun/ImportMetaRequireTargetBun#9416", {
    files: {
      "/entry.ts": /* js */ `
        const events = import.meta.require("events");
        const ref = import.meta.require;
        const path = import.meta.require.resolve("path");
        console.log(typeof events.EventEmitter, typeof ref, typeof path);
      `,
    },
    target: "bun",
    run: { stdout: "function function string" },
    onAfterBundle(api) {
      // Bun runs \`import.meta.require\`. A file that Bun did not write keeps it
      // (\`.resolve\` is a lookup at run time under \`--compile\`, see #14279).
      api.expectFile("/out.js").toContain("import.meta.require");
    },
  });
  itBundled("bun/ImportMetaRequireRebundle#9416", {
    // A bundle for bun has \`var __require = import.meta.require\`. A second build
    // of it for node must not leave \`import.meta.require\` in the output.
    files: {
      "/entry.ts": /* js */ `
        var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
        var __require = import.meta.require;
        var f = __commonJS(function () {
          var events = __require("events");
          console.log(typeof events.EventEmitter);
        });
        f();
      `,
    },
    target: "node",
    run: { runtime: "node", stdout: "function" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("import.meta.require");
    },
  });

  // Bun writes the library, then a second build is over what it wrote.
  describe("a bundle over files that bun wrote", () => {
    const build = async (cwd: string, config: Omit<Bun.BuildConfig, "entrypoints"> & { entrypoints: string[] }) => {
      const entrypoints = config.entrypoints.map(entry => join(cwd, entry));
      const result = await Bun.build({ ...config, entrypoints, outdir: join(cwd, config.outdir!) });
      expect(result.logs.map(String)).toEqual([]);
      expect(result.success).toBe(true);
    };
    const writers = [
      {
        writer: "Bun.Transpiler for bun",
        files: {
          "dist/config.json": `{ "name": "world" }`,
          "src/lib.ts": `const config = require("./config.json"); export const name: string = config.name;`,
          "app.js": `import { name } from "./dist/lib.js"; console.log("app: hello " + name);`,
        },
        wrote: ["dist/lib.js", /^var \{require\}=import\.meta;/],
        async write(cwd: string) {
          const source = await Bun.file(join(cwd, "src", "lib.ts")).text();
          const written = new Bun.Transpiler({ target: "bun", loader: "ts" }).transformSync(source);
          await Bun.write(join(cwd, "dist", "lib.js"), written);
        },
        stdout: "app: hello world\n",
      },
      {
        writer: "Bun.build for bun with splitting",
        files: {
          "src/settings.js": `export const port = 3000;`,
          "src/index.js": `export function port() { return require("./settings.js").port; }`,
          "app.js": `import { port } from "./dist/index.js"; console.log("app: port " + port());`,
        },
        wrote: ["dist/index.js", /import\.meta\.require\("\.\/chunk-[a-z0-9]+\.js"\)/],
        write: (cwd: string) =>
          build(cwd, { entrypoints: ["src/index.js"], outdir: "dist", target: "bun", splitting: true }),
        stdout: "app: port 3000\n",
      },
      {
        // https://github.com/oven-sh/bun/issues/41236
        writer: "Bun.build for bun with splitting, from CommonJS",
        files: {
          "src/main.ts": `let m;\ntry {\n  m = require("react-dom");\n} catch {}\nconsole.log(typeof m, m.version, m.default());`,
          "node_modules/react-dom/index.js": `console.log("side effect");\nmodule.exports = require("./impl");`,
          "node_modules/react-dom/impl.js": `module.exports = function render() { return "rendered"; };\nmodule.exports.version = "19.0.0";`,
          "app.js": `import "./dist/main.js";`,
        },
        wrote: ["dist/main.js", /__commonJS\([^]*import\.meta\.require\("\.\/chunk-[a-z0-9]+\.js"\)\.default/],
        write: (cwd: string) =>
          build(cwd, { entrypoints: ["src/main.ts"], outdir: "dist", target: "bun", splitting: true }),
        deleted: ["node_modules"],
        stdout: "side effect\nobject 19.0.0 rendered\n",
      },
      {
        writer: "Bun.build for bun",
        files: {
          "src/index.js": `export function sep() { return require("node:path").posix.sep; }`,
          "app.js": `import { sep } from "./dist/index.js"; console.log("app: " + sep());`,
        },
        wrote: ["dist/index.js", /^\/\/ @bun\nvar __require = import\.meta\.require;/],
        write: (cwd: string) => build(cwd, { entrypoints: ["src/index.js"], outdir: "dist", target: "bun" }),
        stdout: "app: /\n",
      },
      {
        writer: "Bun.build for bun, minified",
        files: {
          "src/index.js": `export function sep() { return require("node:path").posix.sep; }`,
          "app.js": `import { sep } from "./dist/index.js"; console.log("app: " + sep());`,
        },
        wrote: ["dist/index.js", /^\/\/ @bun\nvar \w=import\.meta\.require;/],
        write: (cwd: string) =>
          build(cwd, { entrypoints: ["src/index.js"], outdir: "dist", target: "bun", minify: true }),
        stdout: "app: /\n",
      },
      {
        writer: "Bun.build for bun with splitting and two entries",
        files: {
          "src/a.js": `export function sepA(name) { return require(name).posix.sep; }`,
          "src/b.js": `export function sepB(name) { return require(name).win32.sep; }`,
          "app.js": `import { sepA } from "./dist/a.js"; import { sepB } from "./dist/b.js"; console.log("app: " + sepA("node:path") + sepB("node:path"));`,
        },
        wrote: ["dist/b.js", /import \{\s*__require\s*\} from "\.\/chunk-[a-z0-9]+\.js";/],
        write: (cwd: string) =>
          build(cwd, { entrypoints: ["src/a.js", "src/b.js"], outdir: "dist", target: "bun", splitting: true }),
        stdout: "app: /\\\n",
      },
      {
        writer: "Bun.build for bun with an external package",
        files: {
          "node_modules/tinypkg/package.json": `{ "name": "tinypkg", "main": "index.js" }`,
          "node_modules/tinypkg/index.js": `module.exports = { name: "tinypkg body" };`,
          "src/index.js": `export function name() { return require("tinypkg").name; }`,
          "app.js": `import { name } from "./dist/index.js"; console.log("app: " + name());`,
        },
        wrote: ["dist/index.js", /__require\("tinypkg"\)/],
        write: (cwd: string) =>
          build(cwd, { entrypoints: ["src/index.js"], outdir: "dist", target: "bun", packages: "external" }),
        // The package is in the output of the second build. It is not looked up where the output runs.
        deleted: ["node_modules"],
        stdout: "app: tinypkg body\n",
      },
    ];
    const run = async (runtime: string, cwd: string, file: string) => {
      await using proc = Bun.spawn({ cmd: [runtime, file], env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    describe.each(writers)("$writer", ({ files, wrote: [file, form], write, deleted = [], stdout }) => {
      test.each([
        ["bun", "esm", "mjs"],
        ["node", "esm", "mjs"],
        ["bun", "cjs", "cjs"],
        ["node", "cjs", "cjs"],
      ] as const)("built for %s as %s", async (target, format, ext) => {
        const runtime = target === "node" ? nodeExe() : bunExe();
        if (!runtime) return;
        using dir = tempDir("require-written-by-bun", files);
        const cwd = String(dir);
        await write(cwd);
        // The first build has to write the form that the second one reads.
        expect(await Bun.file(join(cwd, file)).text()).toMatch(form);

        await build(cwd, { entrypoints: ["app.js"], outdir: "out", target, format, naming: `[name].${ext}` });
        // The output must not need what it was built from.
        for (const path of ["src", "dist", "dist1", ...deleted])
          await rm(join(cwd, path), { recursive: true, force: true });
        expect(await run(runtime, cwd, join(cwd, "out", `app.${ext}`))).toEqual({ stdout, stderr: "", exitCode: 0 });

        // What the second build wrote builds again.
        if (target === "bun" && format === "esm") {
          await build(cwd, { entrypoints: ["out/app.mjs"], outdir: "again", target });
          await rm(join(cwd, "out"), { recursive: true, force: true });
          expect(await run(runtime, cwd, join(cwd, "again", "app.js"))).toEqual({ stdout, stderr: "", exitCode: 0 });
        }
      });
    });

    // https://github.com/oven-sh/bun/issues/9416
    test.skipIf(!nodeExe())("a library for bun, required by an app for node", async () => {
      using dir = tempDir("require-written-by-bun", {
        "first.js": `export const events = require("events");`,
        "third.js": `console.log(typeof require("./second").events.EventEmitter);`,
      });
      const cwd = String(dir);
      await build(cwd, { entrypoints: ["first.js"], outdir: ".", target: "bun", naming: "second.js" });
      expect(await Bun.file(join(cwd, "second.js")).text()).toContain("var __require = import.meta.require;");
      await build(cwd, { entrypoints: ["third.js"], outdir: "out", target: "node", naming: "[name].mjs" });
      expect(await run(nodeExe()!, cwd, join(cwd, "out", "third.mjs"))).toEqual({
        stdout: "function\n",
        stderr: "",
        exitCode: 0,
      });
    });

    // A macro runs once for a build. A file is not parsed a second time to read these forms.
    test("a macro in a file with the helper and a direct eval runs once", async () => {
      using dir = tempDir("require-written-by-bun", {
        "macro.ts": `import { appendFileSync } from "node:fs";\nexport function stamp() { appendFileSync(process.env.MACRO_LOG!, "ran\\n"); return "stamped"; }`,
        "app.ts": `// @bun\nimport { stamp } from "./macro.ts" with { type: "macro" };\nvar __require = import.meta.require;\nexport const inquire = (name: string) => eval("require")(name);\nconsole.log(__require("./lib/dep.cjs").x, stamp());`,
        "lib/dep.cjs": `exports.x = "bundled";`,
      });
      const cwd = String(dir);
      const log = join(cwd, "macro.log");
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--target=bun", "app.ts", "--outdir=out"],
        env: { ...bunEnv, MACRO_LOG: log },
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await proc.exited).toBe(0);
      expect(await Bun.file(log).text()).toBe("ran\n");
      await rm(join(cwd, "lib"), { recursive: true, force: true });
      expect(await run(bunExe(), cwd, join(cwd, "out", "app.js"))).toEqual({
        stdout: "bundled stamped\n",
        stderr: "",
        exitCode: 0,
      });
    });
  });
});
