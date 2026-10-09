import { Database } from "bun:sqlite";
import { describe, expect } from "bun:test";
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
  itBundled("bun/UnknownBunSpecifierDoesNotLoadThePackageNamedLikeItsSuffix", {
    target: "bun",
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
  itBundled("bun/BunPrefixedBuiltinLoadsTheBuiltin", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        import { existsSync } from "bun:fs";
        const path = require("bun:path");
        const { EventEmitter } = await import("bun:events");
        console.log(typeof existsSync, typeof path.join, typeof EventEmitter);
      `,
    },
    run: { stdout: "function function function" },
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
