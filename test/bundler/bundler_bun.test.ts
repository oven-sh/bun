import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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
  // cjs and iife output turn an import statement of an external module into a
  // require() call. The `type` attribute has to go with it, as the second
  // argument: the runtime cannot tell a sqlite database from the name `my.db`.
  const messagesDb = (() => {
    const db = new Database(":memory:");
    db.exec("create table messages (message text)");
    db.exec("insert into messages values ('Hello, world!')");
    return db.serialize();
  })();
  const sqliteEntry = /* js */ `
    import db from './my.db' with {type: "sqlite"};
    console.log(db.query("select message from messages LIMIT 1").get().message);
  `;
  for (const bytecode of [false, true]) {
    itBundled(`bun/sqlite-type-attribute-cjs${bytecode ? "-bytecode" : ""}`, {
      target: "bun",
      format: "cjs",
      bytecode,
      outdir: "/out",
      files: { "/entry.ts": sqliteEntry },
      runtimeFiles: { "/out/my.db": messagesDb },
      onAfterBundle(api) {
        api.expectFile("/out/entry.js").toContain(`__toESM(require("./my.db", { type: "sqlite" }));`);
      },
      run: { stdout: "Hello, world!" },
    });
  }
  itBundled("bun/sqlite-type-attribute-iife", {
    target: "bun",
    format: "iife",
    files: { "/entry.ts": sqliteEntry },
    runtimeFiles: { "/my.db": messagesDb },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain(`__toESM(__require("./my.db", { type: "sqlite" }));`);
    },
    run: { stdout: "Hello, world!" },
  });
  for (const minifyWhitespace of [false, true]) {
    const call = (path: string, type: string) =>
      minifyWhitespace ? `require("${path}",{type:"${type}"})` : `require("${path}", { type: "${type}" })`;
    itBundled(`bun/external-type-attribute-cjs${minifyWhitespace ? "-minify-whitespace" : ""}`, {
      target: "bun",
      format: "cjs",
      minifyWhitespace,
      external: ["*.conf"],
      files: {
        "/entry.ts": /* js */ `
          import './bare.conf' with { type: "text" };
          import toml from './default.conf' with { type: "toml" };
          import * as json from './star.conf' with { type: "json" };
          console.log(toml.a, json.b);
        `,
      },
      runtimeFiles: {
        "/bare.conf": "not JavaScript\n",
        "/default.conf": "a = 1\n",
        "/star.conf": `{ "b": 2 }`,
      },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain(call("./bare.conf", "text"));
        expect(out).toContain(call("./default.conf", "toml"));
        expect(out).toContain(call("./star.conf", "json"));
      },
      run: { stdout: "1 2" },
    });
  }
  // "type": "module" makes the importer an ES module by type, so `__toESM`
  // gets `, 1` and takes what require() returns as the default import. For
  // sqlite, text and md that is an ES module namespace, which has its own default.
  itBundled("bun/type-attribute-cjs-es-module-importer", {
    target: "bun",
    format: "cjs",
    external: ["*.conf", "*.db"],
    files: {
      "/package.json": `{ "type": "module" }`,
      "/entry.ts": /* js */ `
        import db from './my.db' with { type: "sqlite" };
        import embedded from './embedded.db' with { type: "sqlite", embed: "true" };
        import text from './text.conf' with { type: "text" };
        import md from './md.conf' with { type: "md" };
        import toml from './toml.conf' with { type: "toml" };
        const message = db => db.query("select message from messages LIMIT 1").get().message;
        console.log([message(db), message(embedded), text.trim(), md.trim(), toml.a].join(" | "));
      `,
    },
    entryPoints: ["/entry.ts"],
    runtimeFiles: {
      "/my.db": messagesDb,
      "/embedded.db": messagesDb,
      "/text.conf": "plain\n",
      "/md.conf": "# Title\n",
      "/toml.conf": "a = 1\n",
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain(`__toESM(require("./my.db", { type: "sqlite" }));`);
      expect(out).toContain(`__toESM(require("./embedded.db", { type: "sqlite" }));`);
      expect(out).toContain(`__toESM(require("./text.conf", { type: "text" }));`);
      expect(out).toContain(`__toESM(require("./md.conf", { type: "md" }));`);
      expect(out).toContain(`__toESM(require("./toml.conf", { type: "toml" }), 1);`);
    },
    run: { stdout: "Hello, world! | Hello, world! | plain | <h1>Title</h1> | 1" },
  });
  // The printer leaves `, 1` off for the types in `Loader::require_returns_generated_es_module`
  // (src/ast/loader.rs). That list is a copy of what the runtime does, which this pins.
  test("require(path, { type }) returns a module namespace for text, md and sqlite only", async () => {
    const types = [
      ["css", "a { color: red }"],
      ["file", "file"],
      ["json", `{ "a": 1 }`],
      ["jsonc", `{ "a": 1 /* comment */ }`],
      ["json5", "{ a: 1 }"],
      ["toml", "a = 1\n"],
      ["yaml", "a: 1\n"],
      ["xml", "<a>1</a>"],
      ["wasm", Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])],
      ["base64", "base64"],
      ["dataurl", "dataurl"],
      ["text", "text"],
      ["sh", "echo hi\n"],
      ["sqlite", messagesDb],
      ["html", "<p>hi</p>"],
      ["md", "# hi\n"],
    ] as const;
    using dir = tempDir("require-type-namespace", {
      ...Object.fromEntries(types.map(([type, contents]) => [type + ".data", contents])),
      "main.cjs": `
        const isNamespace = value =>
          value != null && typeof value === "object" && !!value.__esModule && Object.hasOwn(value, "default");
        const namespaces = ${JSON.stringify(types.map(([type]) => type))}.filter(type =>
          isNamespace(require("./" + type + ".data", { type })),
        );
        console.log(JSON.stringify(namespaces));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: `["text","sqlite","md"]\n`, stderr: "" });
    expect(exitCode).toBe(0);
  });
  // Node's require() takes one argument.
  itBundled("bun/type-attribute-cjs-target-node", {
    target: "node",
    format: "cjs",
    external: ["*.conf"],
    files: {
      "/entry.ts": /* js */ `
        import toml from './default.conf' with { type: "toml" };
        console.log(toml.a);
      `,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain(`__toESM(require("./default.conf"));`);
    },
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
