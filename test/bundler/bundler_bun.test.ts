import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

  // An import that gets the sqlite loader from its `.sqlite` name stays external too, and the
  // build warns. It used to become a module that holds the path of the database on the build
  // machine. The database of the build and the one next to the bundle hold different rows, so
  // the output of the program tells which of the two the bundle opened.
  const sqliteDatabase = (row: string) => {
    const db = new Database(":memory:");
    db.exec("create table t (x text)");
    db.exec(`insert into t values ('${row}')`);
    return db.serialize();
  };
  const ofTheBuild = sqliteDatabase("of the build");
  const nextToTheBundle = sqliteDatabase("next to the bundle");
  const importsDatabase = /* js */ `
    import db from './db.sqlite';
    console.log(db.query("select x from t").get().x);
  `;
  const notBundled = `"./db.sqlite" is not bundled: the program opens it at run time, relative to the bundle`;

  itBundled("bun/sqlite-file-without-type-attribute", {
    target: "bun",
    outdir: "/out",
    files: { "/src/entry.ts": importsDatabase, "/src/db.sqlite": ofTheBuild },
    runtimeFiles: { "/out/db.sqlite": nextToTheBundle },
    bundleWarnings: { "/src/entry.ts": [notBundled] },
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain(`import db from "./db.sqlite";`);
    },
    run: { stdout: "next to the bundle" },
  });
  // The bundle prints what bun prints when it runs this file next to the database.
  for (const format of ["esm", "cjs"] as const) {
    itBundled(`bun/sqlite-file-without-type-attribute-every-import-kind-${format}`, {
      target: "bun",
      format,
      outdir: "/out",
      files: {
        "/src/entry.ts": /* js */ `
          import viaDefault from "./db.sqlite";
          import { db as viaNamed } from "./db.sqlite";
          import * as viaNamespace from "./db.sqlite";
          const viaRequire = require("./db.sqlite");
          const { dirname, join } = require("node:path");
          const row = db => db.query("select x from t").get().x;
          console.log(row(viaDefault), row(viaNamed), row(viaNamespace.default), row(viaRequire.db));
          console.log(viaRequire.default === viaDefault, Object.keys(viaRequire).sort().join());
          console.log(require.resolve("./db.sqlite") === join(dirname(process.argv[1]), "db.sqlite"));
          import("./db.sqlite").then(viaImport => console.log(row(viaImport.default), viaImport.default === viaDefault));
        `,
        "/src/db.sqlite": ofTheBuild,
      },
      runtimeFiles: { "/out/db.sqlite": nextToTheBundle },
      onAfterApiBundle(build) {
        expect(build.logs.map(log => log.message)).toEqual(Array(6).fill(notBundled));
      },
      run: {
        stdout: `
          next to the bundle next to the bundle next to the bundle next to the bundle
          true __esModule,db,default
          true
          next to the bundle true
        `,
      },
    });
  }
  itBundled("bun/sqlite-file-without-type-attribute-onresolve-declines", {
    target: "bun",
    outdir: "/out",
    files: { "/src/entry.ts": importsDatabase, "/src/db.sqlite": ofTheBuild },
    runtimeFiles: { "/out/db.sqlite": nextToTheBundle },
    plugins(builder) {
      builder.onResolve({ filter: /.*/ }, () => undefined);
    },
    onAfterApiBundle(build) {
      expect(build.logs.map(log => log.message)).toEqual([notBundled]);
    },
    run: { stdout: "next to the bundle" },
  });
  // The executable opens the database of its working directory.
  itBundled("bun/sqlite-file-without-type-attribute-compile", {
    compile: true,
    files: { "/src/entry.ts": importsDatabase, "/src/db.sqlite": ofTheBuild },
    runtimeFiles: { "/db.sqlite": nextToTheBundle },
    bundleWarnings: {
      "/src/entry.ts": [
        `"./db.sqlite" is not bundled: the program opens it at run time, relative to the working directory`,
      ],
    },
    run: { stdout: "next to the bundle", setCwd: true },
  });
  itBundled("bun/sqlite-file-without-type-attribute-zero-bytes", {
    target: "bun",
    outdir: "/out",
    files: { "/src/entry.ts": importsDatabase, "/src/db.sqlite": "" },
    runtimeFiles: { "/out/db.sqlite": nextToTheBundle },
    bundleWarnings: { "/src/entry.ts": [notBundled] },
    run: { stdout: "next to the bundle" },
  });
  // The embed import copies the database. The other import of the same file does not use the copy.
  const embedImport = `import embedded from "./db.sqlite" with { type: "sqlite", embed: "true" };`;
  const plainImport = `import plain from "./db.sqlite";`;
  for (const [order, imports] of [
    ["embed-first", [embedImport, plainImport]],
    ["embed-last", [plainImport, embedImport]],
  ] as const) {
    itBundled(`bun/sqlite-file-without-type-attribute-${order}`, {
      target: "bun",
      outdir: "/out",
      files: {
        "/src/entry.ts": /* js */ `
          ${imports.join("\n")}
          const row = db => db.query("select x from t").get().x;
          console.log(row(embedded), row(plain));
        `,
        "/src/db.sqlite": ofTheBuild,
      },
      runtimeFiles: { "/out/db.sqlite": nextToTheBundle },
      run: { stdout: "of the build next to the bundle" },
    });
  }
  // `Bun.build({ files })` resolves an import in another place than the file system does.
  for (const declines of [false, true]) {
    test(`bun/sqlite-file-without-type-attribute-in-memory${declines ? "-onresolve-declines" : ""}`, async () => {
      using dir = tempDir("sqlite-without-type-attribute", {
        "src/entry.ts": importsDatabase,
        "out/db.sqlite": nextToTheBundle,
      });
      const build = await Bun.build({
        entrypoints: [join(String(dir), "src/entry.ts")],
        outdir: join(String(dir), "out"),
        target: "bun",
        files: { [join(String(dir), "src/db.sqlite")]: ofTheBuild },
        plugins: declines
          ? [{ name: "declines", setup: b => void b.onResolve({ filter: /.*/ }, () => undefined) }]
          : [],
      });
      expect(build.logs.map(log => log.message)).toEqual([notBundled]);

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "out/entry.js")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "next to the bundle\n", stderr: "", exitCode: 0 });
    });
  }

  // These do not print the import as written, so the database stays a module of the bundle.
  itBundled("bun/sqlite-file-without-type-attribute-export-star", {
    backend: "cli",
    target: "bun",
    outdir: "/out",
    files: {
      "/src/entry.ts": /* js */ `
        import * as all from "./reexport";
        console.log(Object.keys(all).join());
      `,
      "/src/reexport.ts": /* js */ `
        export * from "./db.sqlite";
        export const other = 1;
      `,
      "/src/db.sqlite": ofTheBuild,
    },
    run: { stdout: "other" },
  });
  itBundled("bun/sqlite-file-without-type-attribute-require-shim", {
    backend: "cli",
    target: "bun",
    outdir: "/out",
    files: {
      "/src/entry.ts": /* js */ `
        import db from "./shim.cjs";
        console.log(db.query("select x from t").get().x);
      `,
      "/src/shim.cjs": `module.exports = require("./db.sqlite");`,
      "/src/db.sqlite": ofTheBuild,
    },
    runtimeFiles: { "/out/db.sqlite": nextToTheBundle },
    run: { stdout: "of the build" },
  });

  // What the user or a plugin says about the file goes first. The CLI backend fails on a warning.
  itBundled("bun/sqlite-file-without-type-attribute-explicit-external", {
    backend: "cli",
    target: "bun",
    outdir: "/out",
    external: ["*.sqlite"],
    files: { "/src/entry.ts": importsDatabase, "/src/db.sqlite": ofTheBuild },
    runtimeFiles: { "/out/db.sqlite": nextToTheBundle },
    run: { stdout: "next to the bundle" },
  });
  itBundled("bun/sqlite-file-with-type-attribute-does-not-warn", {
    backend: "cli",
    target: "bun",
    outdir: "/out",
    files: {
      "/src/entry.ts": /* js */ `
        import db from './db.sqlite' with { type: "sqlite" };
        console.log(db.query("select x from t").get().x);
      `,
    },
    runtimeFiles: { "/out/db.sqlite": nextToTheBundle },
    run: { stdout: "next to the bundle" },
  });
  for (const [name, entry, loader] of [
    ["file-type-attribute", `import path from './db.sqlite' with { type: "file" };`, undefined],
    ["file-loader", `import path from './db.sqlite';`, { ".sqlite": "file" }],
  ] as const) {
    itBundled(`bun/sqlite-file-without-type-attribute-${name}`, {
      backend: "cli",
      target: "bun",
      outdir: "/out",
      loader,
      files: {
        "/src/entry.ts": `${entry}\nconsole.log(require("node:path").extname(path));`,
        "/src/db.sqlite": ofTheBuild,
      },
      run: { stdout: ".sqlite" },
    });
  }
  itBundled("bun/sqlite-file-without-type-attribute-onresolve-external", {
    target: "bun",
    outdir: "/out",
    files: { "/src/entry.ts": importsDatabase, "/src/db.sqlite": ofTheBuild },
    runtimeFiles: { "/out/db.sqlite": nextToTheBundle },
    plugins(builder) {
      builder.onResolve({ filter: /\.sqlite$/ }, ({ path }) => ({ path, external: true }));
    },
    onAfterApiBundle(build) {
      expect(build.logs).toEqual([]);
    },
    run: { stdout: "next to the bundle" },
  });
  itBundled("bun/sqlite-file-without-type-attribute-onload", {
    target: "bun",
    outdir: "/out",
    files: { "/src/entry.ts": importsDatabase, "/src/db.sqlite": ofTheBuild },
    plugins(builder) {
      builder.onLoad({ filter: /\.sqlite$/ }, () => ({
        contents: `export default { query: () => ({ get: () => ({ x: "from the plugin" }) }) };`,
        loader: "js",
      }));
    },
    onAfterApiBundle(build) {
      expect(build.logs).toEqual([]);
    },
    run: { stdout: "from the plugin" },
  });
  itBundled("bun/sqlite-file-without-type-attribute-target-node", {
    target: "node",
    outdir: "/out",
    files: { "/src/entry.ts": importsDatabase, "/src/db.sqlite": ofTheBuild },
    bundleErrors: { "/src/db.sqlite": [`To use the "sqlite" loader, set target to "bun"`] },
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
