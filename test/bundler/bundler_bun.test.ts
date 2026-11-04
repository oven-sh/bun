import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
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
  // cjs output is wrapped in the `@bun-cjs` function wrapper, where `import.meta`
  // is a SyntaxError, so the synthesized module has to use the wrapper's `require`.
  itBundled("bun/embedded-sqlite-file-cjs", {
    target: "bun",
    format: "cjs",
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
    onAfterBundle(api) {
      const out = api.readFile("/out/entry.js");
      expect(out).toContain("// @bun @bun-cjs\n");
      expect(out).not.toContain("import.meta");
      expect(out).toMatch(/^var db_default = require\("\.\/db-[a-z0-9]+\.sqlite", \{ type: "sqlite" \}\)\.db;$/m);
    },
    run: { stdout: "Hello, world!" },
  });
  // A dynamic import turns the synthesized module into `module.exports = ...`
  // inside a __commonJS wrapper; that is the other shape the linker gives it.
  itBundled("bun/embedded-sqlite-file-cjs-dynamic-import", {
    target: "bun",
    format: "cjs",
    outfile: "",
    outdir: "/out",
    files: {
      "/entry.ts": /* js */ `
        import('./db.sqlite', { with: {type: "sqlite", embed: "true"} }).then(({ default: db }) => {
          console.log(db.query("select message from messages LIMIT 1").get().message);
        });
      `,
      "/db.sqlite": (() => {
        const db = new Database(":memory:");
        db.exec("create table messages (message text)");
        db.exec("insert into messages values ('Hello, world!')");
        return db.serialize();
      })(),
    },
    onAfterBundle(api) {
      const out = api.readFile("/out/entry.js");
      expect(out).toContain("// @bun @bun-cjs\n");
      expect(out).not.toContain("import.meta");
      expect(out).toMatch(/\bmodule\d*\.exports = require\("\.\/db-[a-z0-9]+\.sqlite", \{ type: "sqlite" \}\)\.db;$/m);
    },
    run: { stdout: "Hello, world!" },
  });
  // `--compile --bytecode` is CommonJS output: the bytecode is used only when the whole file compiles.
  itBundled("bun/embedded-sqlite-file-compile-bytecode", {
    compile: true,
    bytecode: true,
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
    run: {
      stdout: "Hello, world!",
      env: { BUN_JSC_verboseDiskCache: "1" },
      validate({ stderr }) {
        expect(stderr).toContain("[Disk Cache] Cache hit for sourceCode");
      },
    },
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

  // Hand-written `import.meta.require` is the `require` of the output where the output has one and cannot evaluate `import.meta.require`.
  // https://github.com/oven-sh/bun/issues/9416
  itBundled("bun/ImportMetaRequireTarget-node#9416", {
    files: {
      "/entry.ts": /* js */ `
        const events = import.meta.require("events");
        const ref = import.meta.require;
        const path = import.meta.require.resolve("path");
        console.log(typeof events.EventEmitter, typeof ref, typeof path);
      `,
    },
    target: "node",
    run: [
      { runtime: "node", stdout: "function function string" },
      { runtime: "bun", stdout: "function function string" },
    ],
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("import.meta.require");
    },
  });
  // A file for the browser can end in a module script, which has no `require`. A build for the browser keeps `import.meta.require`, and code that tests for it takes its other path.
  for (const format of ["esm", "cjs"] as const) {
    itBundled(`bun/ImportMetaRequireTargetBrowser-${format}`, {
      files: {
        "/entry.js": /* js */ `
          const load = import.meta.require ?? globalThis.require ?? null;
          console.log(typeof import.meta.require, load ? "require" : "web fallback");
        `,
      },
      target: "browser",
      format,
      run: format === "esm" && { runtime: "node", stdout: "undefined web fallback" },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain("import.meta.require ?? globalThis.require ?? null");
        expect(out).not.toContain("__require");
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
      // Bun runs `import.meta.require`. Each use stays as written.
      const out = api.readFile("/out.js");
      expect(out).toContain('import.meta.require("events")');
      expect(out).toContain("var ref = import.meta.require;");
      expect(out).toContain('import.meta.require.resolve("path")');
      expect(out).not.toContain("__require");
    },
  });
  itBundled("bun/ImportMetaRequireRebundle#9416", {
    // A bundle for bun has `var __require = import.meta.require`. A second build
    // of it for node must not leave `import.meta.require` in the output.
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
    run: [
      { runtime: "node", stdout: "function" },
      { runtime: "bun", stdout: "function" },
    ],
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("import.meta.require");
    },
  });
  // Code that asks for Bun at run time builds for node as before. Each string stays a lookup at run time.
  itBundled("bun/ImportMetaRequireForNode", {
    files: {
      "/entry.js": /* js */ `
        const isBun = typeof Bun !== "undefined";
        const ws = isBun ? import.meta.require("ws") : null;
        const sqlite = isBun ? import.meta.require("bun:sqlite") : null;
        const optional = isBun ? import.meta.require("a-package-that-is-not-installed") : null;
        const local = isBun ? import.meta.require("./lib/left.cjs") : null;
        const load = import.meta.require;
        console.log(ws, sqlite, optional, local, typeof load, typeof load("node:path").sep);
      `,
      "/lib/left.cjs": `exports.x = "left";`,
    },
    target: "node",
    run: { runtime: "node", stdout: "null null null null function string" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("import.meta.require");
      expect(out).toContain('__require("ws")');
      expect(out).toContain('__require("./lib/left.cjs")');
      expect(out).not.toContain('"left"');
      // A call behind a test for Bun brings the `__require` of the bundle too, as a `require()` there does.
      expect(out).toContain('import { createRequire } from "node:module";');
      expect(out).toContain("var __require = /* @__PURE__ */ createRequire(import.meta.url);");
    },
  });
  // That holds in every position that a fold or `--minify-syntax` gives the value, and with `--reject-unresolved`.
  for (const minifySyntax of [false, true]) {
    itBundled(`bun/ImportMetaRequireStaysAtRunTime${minifySyntax ? "-minify-syntax" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          export function viaBun() {
            const ws = typeof Bun !== "undefined" && import.meta.require("ws");
            return ws;
          }
          export function where() {
            const found = typeof Bun !== "undefined" ? import.meta.require.resolve("a-package-that-is-not-installed") : null;
            return found;
          }
          export function folded() {
            return [
              (null ?? import.meta.require)("a-package-that-is-not-installed"),
              (0 || import.meta.require)("a-package-that-is-not-installed"),
              (1 && import.meta.require)("a-package-that-is-not-installed"),
              (true ? import.meta.require : null)("a-package-that-is-not-installed"),
            ];
          }
          export function named(name) {
            return import.meta.require(name);
          }
          export function tested() {
            return [import.meta.require ? "has require" : "no require", !import.meta.require];
          }
          console.log(typeof import.meta.require === "function", viaBun(), where(), import.meta.require.resolve("./lib/dep.cjs").endsWith("dep.cjs"), tested().join(" "));
        `,
        "/lib/dep.cjs": `exports.x = "not in the bundle";`,
      },
      target: "node",
      minifySyntax,
      allowUnresolved: [],
      run: { runtime: "node", stdout: "true false null true has require false" },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).not.toContain("import.meta.require");
        expect(out).not.toContain("not in the bundle");
        expect(out).toContain('__require("ws")');
        expect(out).toContain('__require.resolve("a-package-that-is-not-installed")');
        // The path is the one in the source, not the path of the file on the build machine.
        expect(out).toContain('__require.resolve("./lib/dep.cjs")');
        expect(out).toContain("typeof __require");
        expect(out).toContain("return __require(name)");
        // The value is not known at build time.
        expect(out).toContain('__require ? "has require" : "no require"');
        expect(out).toContain("!__require");
        expect(out.split('__require("a-package-that-is-not-installed")').length).toBe(5);
      },
    });
  }
  // An assignment to `import.meta.require` and a `delete` of it stay on `import.meta`. They do not reach the `__require` of the bundle.
  itBundled("bun/ImportMetaRequireAssigned", {
    files: {
      "/entry.js": /* js */ `
        import "./other.js";
        import.meta.require = name => "assigned " + name;
        import.meta.require ||= null;
        delete import.meta.require;
        console.log(typeof import.meta.require);
      `,
      "/other.js": `const load = import.meta.require;\nconst name = "node:path";\nconsole.log(typeof load(name).sep);`,
    },
    target: "node",
    run: { runtime: "node", stdout: "string\nfunction" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("import.meta.require = ");
      expect(out).toContain("import.meta.require ||= null");
      expect(out).toContain("delete import.meta.require");
    },
  });
  // A value at the top level that nothing uses goes, like the `import.meta.require` that it stands for. The `__require` of the bundle goes with it.
  itBundled("bun/ImportMetaRequireUnused", {
    files: {
      "/entry.js": /* js */ `
        import.meta.require;
        var unused = import.meta.require;
        const alsoUnused = /* @__PURE__ */ import.meta.require("./not-there.cjs");
        console.log("built");
      `,
    },
    target: "node",
    run: { runtime: "node", stdout: "built" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("equire");
    },
  });
  itBundled("bun/ImportMetaRequireDefineWins", {
    files: {
      "/entry.js": `console.log(import.meta.require("./lib/dep.cjs"), typeof import.meta.require);`,
    },
    target: "node",
    define: { "import.meta.require": "String" },
    run: { runtime: "node", stdout: "./lib/dep.cjs function" },
  });
  // `--define import.meta.require=undefined` gives output for node the value that `import.meta.require` has under node.
  itBundled("bun/ImportMetaRequireDefinedAsUndefined", {
    files: {
      "/entry.js": `console.log(typeof import.meta.require, import.meta.require ? "has require" : "no require");`,
    },
    target: "node",
    define: { "import.meta.require": "undefined" },
    run: { runtime: "node", stdout: "undefined no require" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__require");
    },
  });
  itBundled("bun/ImportMetaRequireDropWins", {
    files: {
      "/entry.js": `import.meta.require("./lib/dep.cjs");\nconsole.log("dropped");`,
    },
    target: "node",
    drop: ["import.meta.require"],
    run: { runtime: "node", stdout: "dropped" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("equire");
    },
  });
  // `--minify-syntax` puts `import.meta` in place of a name and visits the access again. That access stays on `import.meta`, as in the build that is not minified.
  itBundled("bun/ImportMetaRequireThroughNameOfImportMeta", {
    files: {
      "/entry.js": /* js */ `
        export function orNull() {
          const meta = import.meta;
          return meta.require || null;
        }
        export function negated() {
          const meta = import.meta;
          return !meta.require;
        }
        export function chosen() {
          const meta = import.meta;
          return meta.require ? "has require" : "no require";
        }
        export function called(name) {
          const meta = import.meta;
          return meta.require?.(name) ?? null;
        }
        console.log(orNull(), negated(), chosen(), called("node:path"));
      `,
    },
    target: "node",
    minifySyntax: true,
    run: { runtime: "node", stdout: "null true no require null" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__require");
    },
  });
  // A production build takes `import.meta.hot.accept()` out. The `import.meta.require` after it is the `require` of the output.
  itBundled("bun/ImportMetaRequireAfterImportMetaHot", {
    files: {
      "/entry.js": /* js */ `
        import.meta.hot.accept();
        const load = import.meta.require;
        console.log(typeof load);
      `,
    },
    target: "node",
    run: { runtime: "node", stdout: "function" },
  });
  // With `--splitting` the `__require` of the bundle is in a shared chunk. A relative name resolves from the output directory at run time.
  itBundled("bun/ImportMetaRequireForNodeWithSplitting", {
    files: {
      "/first.js": `console.log("first", typeof import.meta.require("node:path").sep, import.meta.require("./data.json").n);`,
      "/second.js": `console.log("second", typeof import.meta.require("node:events").EventEmitter);`,
    },
    runtimeFiles: {
      "/out/data.json": `{ "n": 42 }`,
    },
    entryPoints: ["/first.js", "/second.js"],
    target: "node",
    splitting: true,
    outdir: "/out",
    run: [
      { runtime: "node", file: "/out/first.js", stdout: "first string 42" },
      { runtime: "node", file: "/out/second.js", stdout: "second function" },
      { runtime: "bun", file: "/out/first.js", stdout: "first string 42" },
    ],
    onAfterBundle(api) {
      expect(api.readFile("/out/first.js")).toMatch(/import \{\s*__require\s*\} from "\.\/[^"]+\.js";/);
    },
  });
  // `--bytecode` output is CommonJS. https://github.com/oven-sh/bun/pull/38200#issuecomment-6105454599
  itBundled("bun/ImportMetaRequireWithFallbackInBytecode", {
    files: {
      "/entry.js": /* js */ `
        import { createRequire } from "node:module";
        const req = import.meta.require ?? createRequire(import.meta.url);
        console.log(typeof req, typeof req("node:path").sep);
      `,
    },
    target: "bun",
    format: "cjs",
    bytecode: true,
    outdir: "/out",
    run: { stdout: "function string" },
    onAfterBundle(api) {
      const out = api.readFile("/out/entry.js");
      expect(out).toContain("= require ?? ");
      expect(out).not.toContain("import.meta");
    },
  });

  // `bun build --target=bun` writes `require` as `import.meta.require`. A second build for other output gives that value `require`.
  const writtenForBun = {
    // `var __require = import.meta.require;`
    Helper: {
      files: {
        "/entry.js": `import { sep } from "./dist/index.js"; console.log("app: " + sep());`,
        "/dist/index.js": `// @bun\nvar __require = import.meta.require;\nfunction sep() {\n  return __require("path").posix.sep;\n}\nexport {\n  sep\n};\n`,
      },
      stdout: "app: /",
    },
    // With `--splitting` and two entries, the helper is in a chunk of its own.
    SharedHelper: {
      files: {
        "/entry.js": `import { sep } from "./dist/index.js"; console.log("app: " + sep());`,
        "/dist/index.js": `// @bun\nimport {\n  __require\n} from "./index-pb1dcdw6.js";\nfunction sep() {\n  return __require("path").posix.sep;\n}\nexport {\n  sep\n};\n`,
        "/dist/index-pb1dcdw6.js": `// @bun\nvar __require = import.meta.require;\n\nexport { __require };\n`,
      },
      stdout: "app: /",
    },
    // A second build for Bun puts the helper inside `__esm`.
    HelperInEsm: {
      files: {
        "/entry.js": `import { s } from "./dist/pkg.js"; console.log("app: " + s());`,
        "/dist/pkg.js": `// @bun\nvar __esm = (fn, res, err) => () => {\n  if (fn)\n    try {\n      res = fn(fn = 0);\n    } catch (e) {\n      err = [e];\n    }\n  if (err)\n    throw err[0];\n  return res;\n};\n\n// dist1/inner.js\nimport { posix } from "path";\nfunction s() {\n  return __require("path").posix.sep + posix.sep;\n}\nvar __require;\nvar init_inner = __esm(() => {\n  __require = import.meta.require;\n});\n\n// src/pkg.js\nfunction s2() {\n  return init_inner(), s();\n}\nexport {\n  s2 as s\n};\n`,
      },
      stdout: "app: //",
    },
    // The file that Bun wrote has a direct `eval`.
    HelperBesideDirectEval: {
      files: {
        "/entry.js": `import { sep } from "./dist/lib.js"; console.log("app: " + sep());`,
        "/dist/lib.js": `// @bun\nvar __require = import.meta.require;\n\n// src/lib.js\nfunction sep() {\n  return __require("path").posix.sep;\n}\nfunction inquire(name) {\n  try {\n    return eval("quire".replace(/^/, "re"))(name);\n  } catch (e) {\n    return null;\n  }\n}\nexport {\n  sep,\n  inquire\n};\n`,
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
  for (const [target, format] of [
    ["node", "esm"],
    ["bun", "cjs"],
    ["node", "cjs"],
  ] as const) {
    for (const [form, { files, stdout }] of Object.entries(writtenForBun)) {
      itBundled(`bun/ImportMetaRequireWrittenForBun${form}-${target}-${format}`, {
        files,
        target,
        format,
        // Node output runs under Bun as well.
        run:
          target === "node"
            ? [
                { runtime: "node", stdout },
                { runtime: "bun", stdout },
              ]
            : { stdout },
        onAfterBundle(api) {
          const out = api.readFile("/out.js");
          expect(out).not.toContain("import.meta.require");
          if (format === "cjs") expect(out).not.toContain("import.meta");
        },
      });
    }
  }
  itBundled("bun/ImportMetaRequireWrittenForBunBytecode", {
    files: writtenForBun.Helper.files,
    target: "bun",
    format: "cjs",
    bytecode: true,
    outdir: "/out",
    run: { stdout: "app: /" },
  });
  // `.resolve()` in an executable is a lookup where the executable runs, in CommonJS output as well.
  itBundled("bun/ImportMetaRequireResolveInCompiledBytecode", {
    compile: true,
    bytecode: true,
    assetNaming: "[name].[ext]",
    files: {
      "/entry.ts": /* js */ `
        import "./foo.file";
        const path = import.meta.require.resolve("./foo.file");
        console.log(path.includes("$bunfs") || path.includes("~BUN"));
      `,
      "/foo.file": "abcd",
    },
    outfile: "dist/out",
    run: { stdout: "true", setCwd: true },
  });
  // Iife output has no `__require` for a value, so `import.meta.require` stays there.
  itBundled("bun/ImportMetaRequireWrittenForBunIife", {
    files: writtenForBun.Helper.files,
    target: "bun",
    format: "iife",
    run: { stdout: "app: /" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("var __require = import.meta.require;");
    },
  });

  // The browser files of a server build go to a module script with no `require`. `import.meta.require` stays as written there. The server file of the same build is lowered as in a build with no page.
  for (const [target, format, onServer] of [
    ["bun", "esm", "import.meta.require"],
    ["bun", "cjs", "require"],
    ["node", "esm", "__require"],
  ] as const) {
    itBundled(`bun/ImportMetaRequireInBrowserFileOfServerBuild-${target}-${format}`, {
      files: {
        "/main.js": `import page from "./index.html"; const load = import.meta.require; console.log(typeof page, typeof load);`,
        "/index.html": `<script type="module" src="./client.js"></script>`,
        "/client.js": `const viaBun = import.meta.require ? "has require" : "no require"; console.log("client:", viaBun);`,
      },
      entryPoints: ["/main.js"],
      target,
      format,
      outdir: "/out",
      onAfterBundle(api) {
        const client = readdirSync(api.outdir, { recursive: true })
          .map(String)
          .filter(file => file.endsWith(".js"))
          .map(file => api.readFile(join("/out", file)))
          .filter(text => text.includes('"client:"'));
        expect(client).toHaveLength(1);
        expect(client[0]).toContain('var viaBun = import.meta.require ? "has require" : "no require";');
        expect(api.readFile("/out/main.js")).toContain(`var load = ${onServer};`);
      },
    });
  }
  // An entry that starts with `#!/usr/bin/env bun` makes its chunk a module for Bun. The target of the build decides what `import.meta.require` is there.
  const behindBunHashbang = {
    "/cli.js": `#!/usr/bin/env bun\nimport { platform } from "./dep.js";\nimport { sep } from "./dist/index.js";\nconsole.log("cli:", platform(), sep("node:path"));`,
    "/dep.js": `export function platform() { return typeof import.meta.require("node:os").platform(); }`,
    "/dist/index.js": `// @bun\nvar __require = import.meta.require;\nfunction sep(name) {\n  return __require(name).posix.sep;\n}\nexport {\n  sep\n};\n`,
  };
  itBundled("bun/ImportMetaRequireBehindBunHashbang", {
    files: behindBunHashbang,
    entryPoints: ["/cli.js"],
    target: "browser",
    run: { stdout: "cli: string /" },
    onAfterBundle(api) {
      // The default target is the browser: no file of the build is lowered.
      const out = api.readFile("/out.js");
      expect(out).toContain('import.meta.require("node:os")');
      expect(out).toContain("var __require = import.meta.require;");
    },
  });
  // In CommonJS output that entry is a file for Bun, also with no `--target`. Its chunk has the `require` of Bun's CommonJS wrapper.
  itBundled("bun/ImportMetaRequireInBunHashbangEntryAsCjs", {
    files: {
      "/cli.js": `#!/usr/bin/env bun\n// @bun\nvar __require = import.meta.require;\nconsole.log("cli:", typeof __require("node:fs").readFileSync);`,
    },
    target: "browser",
    format: "cjs",
    run: { stdout: "cli: function" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("import.meta");
    },
  });
  // In a build for node that entry is lowered like its dependencies. Here it has the helper that Bun writes.
  itBundled("bun/ImportMetaRequireBehindBunHashbangForNode", {
    files: {
      ...behindBunHashbang,
      "/cli.js": `#!/usr/bin/env bun\n// @bun\nvar __require = import.meta.require;\nimport { platform } from "./dep.js";\nimport { sep } from "./dist/index.js";\nconsole.log("cli:", platform(), sep("node:path"), typeof __require("node:fs").readFileSync);`,
    },
    entryPoints: ["/cli.js"],
    target: "node",
    run: [
      { runtime: "node", stdout: "cli: string / function" },
      { runtime: "bun", stdout: "cli: string / function" },
    ],
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("import.meta.require");
    },
  });

  describe("a bundle over files that bun wrote for bun", () => {
    const build = async (cwd: string, config: Omit<Bun.BuildConfig, "entrypoints"> & { entrypoints: string[] }) => {
      const entrypoints = config.entrypoints.map(entry => join(cwd, entry));
      const result = await Bun.build({ ...config, entrypoints, outdir: join(cwd, config.outdir!) });
      expect(result.logs.map(String)).toEqual([]);
      expect(result.success).toBe(true);
    };
    const run = async (runtime: string, cwd: string, file: string) => {
      await using proc = Bun.spawn({ cmd: [runtime, file], env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const writers: {
      writer: string;
      files: Record<string, string>;
      wrote: [file: string, form: RegExp];
      write(cwd: string): Promise<void>;
      stdout: string;
    }[] = [
      {
        writer: "Bun.build",
        files: {
          "src/index.js": `export function sep() { return require("node:path").posix.sep; }`,
          "app.js": `import { sep } from "./dist/index.js"; console.log("app: " + sep());`,
        },
        wrote: ["dist/index.js", /^\/\/ @bun\nvar __require = import\.meta\.require;/],
        write: (cwd: string) => build(cwd, { entrypoints: ["src/index.js"], outdir: "dist", target: "bun" }),
        stdout: "app: /\n",
      },
      {
        writer: "Bun.build, minified",
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
        writer: "Bun.build with splitting and two entries",
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
    ];
    describe.each(writers)("$writer", ({ files, wrote: [file, form], write, stdout }) => {
      for (const [target, format, ext] of [
        ["node", "esm", "mjs"],
        ["bun", "cjs", "cjs"],
        ["node", "cjs", "cjs"],
      ] as const) {
        test(`built for ${target} as ${format}`, async () => {
          const runtime = target === "node" ? nodeExe()! : bunExe();
          using dir = tempDir("import-meta-require-written-for-bun", files);
          const cwd = String(dir);
          await write(cwd);
          // The first build has to write the form that the second one reads.
          expect(await Bun.file(join(cwd, file)).text()).toMatch(form);

          await build(cwd, { entrypoints: ["app.js"], outdir: "out", target, format, naming: `[name].${ext}` });
          // The output must not need what it was built from.
          for (const path of ["src", "dist"]) await rm(join(cwd, path), { recursive: true, force: true });
          expect(await run(runtime, cwd, join(cwd, "out", `app.${ext}`))).toEqual({ stdout, stderr: "", exitCode: 0 });
        });
      }
    });

    // https://github.com/oven-sh/bun/issues/9416
    test("a library for bun, required by an app for node", async () => {
      using dir = tempDir("import-meta-require-written-for-bun", {
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
  });
});
