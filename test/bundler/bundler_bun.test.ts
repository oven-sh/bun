import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";
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
  // Only the Bun runtime can open a database the bundle leaves external, so a
  // sqlite import attribute fails the build for the other targets, the way
  // `embed: "true"` and `--loader .db:sqlite` do, unless the database is external.
  //
  // The fixture is `app.db` on purpose: `.sqlite` selects the loader by
  // extension alone, while a `.db` file only gets it from the attribute.
  describe("sqlite import attribute requires target bun", () => {
    const database = (() => {
      const db = new Database(":memory:");
      db.exec("create table messages (message text)");
      db.exec("insert into messages values ('Hello, world!')");
      return db.serialize();
    })();
    const targetErrorText = 'To use the "sqlite" loader, set target to "bun"';
    const targetError = { "/app.db": [targetErrorText] };
    // A .js entry: an unused import in a .ts file is always dropped.
    const unusedImport = {
      "/entry.js": /* js */ `
        import db from './app.db' with {type: "sqlite"};
        console.log("ran");
      `,
      "/app.db": database,
    };
    for (const target of ["node", "browser"] as const) {
      itBundled(`bun/sqlite-attribute-target-${target}`, {
        target,
        files: {
          "/entry.ts": /* js */ `
            import db from './app.db' with {type: "sqlite"};
            console.log(db);
          `,
          "/app.db": database,
        },
        bundleErrors: targetError,
      });
      itBundled(`bun/sqlite-attribute-dynamic-import-target-${target}`, {
        target,
        files: {
          "/entry.ts": /* js */ `
            const { default: db } = await import('./app.db', {with: {type: "sqlite"}});
            console.log(db);
          `,
          "/app.db": database,
        },
        bundleErrors: targetError,
      });
      itBundled(`bun/sqlite-attribute-embed-target-${target}`, {
        target,
        files: {
          "/entry.ts": /* js */ `
            import db from './app.db' with {type: "sqlite", embed: "true"};
            console.log(db);
          `,
          "/app.db": database,
        },
        bundleErrors: targetError,
      });
      // For these targets the import is resolved like any other, so a database
      // that is not there is a resolution error (target bun never looks for it:
      // see bun/sqlite-file below, which only creates the file at run time).
      itBundled(`bun/sqlite-attribute-missing-file-target-${target}`, {
        target,
        files: {
          "/entry.ts": /* js */ `
            import db from './app.db' with {type: "sqlite"};
            console.log(db);
          `,
        },
        bundleErrors: {
          "/entry.ts": ['Could not resolve: "./app.db"'],
        },
      });
      // The way out that the error's note names. This program opens the
      // database only under Bun, so its bundle runs on the target and under Bun.
      itBundled(`bun/sqlite-attribute-external-dynamic-import-target-${target}`, {
        target,
        external: ["./app.db"],
        files: {
          "/entry.ts": /* js */ `
            if (typeof Bun !== "undefined") {
              const { default: db } = await import('./app.db', {with: {type: "sqlite"}});
              console.log(db.query("select message from messages LIMIT 1").get().message);
            } else {
              console.log("no database");
            }
          `,
          "/app.db": database,
        },
        run: [
          { stdout: "Hello, world!" },
          ...(target === "node" ? [{ runtime: "node", stdout: "no database" } as const] : []),
        ],
      });
      // An external sqlite import has no side effects on any target, so an
      // unused one is dropped.
      itBundled(`bun/sqlite-attribute-external-unused-import-target-${target}`, {
        target,
        external: ["./app.db"],
        files: unusedImport,
        onAfterBundle(api) {
          api.expectFile("out.js").not.toContain("app.db");
        },
        run: { stdout: "ran" },
      });
    }
    // The same import, left external through the two plugin exits.
    itBundled("bun/sqlite-attribute-external-unused-import-plugin-declines", {
      target: "node",
      external: ["./app.db"],
      files: unusedImport,
      plugins(builder) {
        builder.onResolve({ filter: /app\.db$/ }, () => undefined);
      },
      onAfterBundle(api) {
        api.expectFile("out.js").not.toContain("app.db");
      },
      run: { stdout: "ran" },
    });
    itBundled("bun/sqlite-attribute-external-unused-import-plugin-external", {
      target: "node",
      files: unusedImport,
      plugins(builder) {
        builder.onResolve({ filter: /app\.db$/ }, args => ({ path: args.path, external: true }));
      },
      onAfterBundle(api) {
        api.expectFile("out.js").not.toContain("app.db");
      },
      run: { stdout: "ran" },
    });
    // Loading the shared chunk has no side effects either: the entry that uses
    // nothing from it does not import it.
    itBundled("bun/sqlite-attribute-external-splitting", {
      target: "node",
      splitting: true,
      outdir: "/out",
      external: ["./app.db"],
      entryPoints: ["/a.js", "/b.js", "/c.js"],
      files: {
        "/a.js": `import { query } from "./shared.js"; console.log("a", query);`,
        "/b.js": `import { query } from "./shared.js"; console.log("b");`,
        "/c.js": `import { query } from "./shared.js"; console.log("c", query);`,
        "/shared.js": /* js */ `
          import db from './app.db' with {type: "sqlite"};
          export function query() { return db; }
        `,
        "/app.db": database,
      },
      onAfterBundle(api) {
        api.expectFile("out/b.js").not.toContain("import");
      },
      run: { file: "/out/b.js", runtime: "node", stdout: "b" },
    });
    // `embed: "true"` is the same import once the database is external.
    for (const target of ["bun", "node"] as const) {
      itBundled(`bun/sqlite-attribute-embed-external-unused-import-target-${target}`, {
        target,
        external: ["./app.db"],
        files: {
          "/entry.js": /* js */ `
            import db from './app.db' with {type: "sqlite", embed: "true"};
            console.log("ran");
          `,
          "/app.db": database,
        },
        onAfterBundle(api) {
          api.expectFile("out.js").not.toContain("app.db");
        },
        run: { stdout: "ran" },
      });
    }
    test("the target error names `external` in a note, except for an entry point", async () => {
      using dir = tempDir("sqlite-target-error-note", {
        "entry.js": `import db from './app.db' with {type: "sqlite"};\nconsole.log(db);\n`,
        "app.db": "x",
        "entry.sqlite": "x",
      });
      const note =
        'To build for another target, mark the database as external (pass "--external <path>" to the CLI, or add it to "external" in Bun.build) and load it with import(), which keeps { with: { type: "sqlite" } } in the output';
      const build = async (entry: string) => {
        const { logs } = await Bun.build({
          entrypoints: [path.join(String(dir), entry)],
          target: "node",
          throw: false,
        });
        return logs.map(log => ({
          message: log.message,
          notes: (log as unknown as { notes: BuildMessage[] }).notes.map(note => note.message),
        }));
      };
      expect(await build("entry.js")).toEqual([{ message: targetErrorText, notes: [note] }]);
      // An entry point cannot be external.
      expect(await build("entry.sqlite")).toEqual([{ message: targetErrorText, notes: [] }]);

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./entry.js", "--target", "node"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(`error: ${targetErrorText}`);
      expect(stderr).toContain(`note: ${note}`);
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    });
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
