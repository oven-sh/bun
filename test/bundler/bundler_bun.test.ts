import { Database } from "bun:sqlite";
import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
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
  // https://github.com/oven-sh/bun/issues/8058
  for (const minifyIdentifiers of [false, true]) {
    const suffix = minifyIdentifiers ? "Minified" : "";
    itBundled(`bun/RequireBunWithShadowedGlobalThis${suffix}`, {
      target: "bun",
      minifyIdentifiers,
      files: {
        "/entry.ts": /* js */ `
          {
            let globalThis = { Bun: "intercepted" };
            const b = require("bun");
            if (b === "intercepted") throw new Error("require('bun') captured local globalThis");
            if (typeof b.version !== "string") throw new Error("require('bun') did not return Bun");
            void globalThis;
          }
          console.log("PASS");
        `,
      },
      run: { stdout: "PASS" },
    });
    itBundled(`bun/DynamicImportBunWithShadowedGlobalThis${suffix}`, {
      target: "bun",
      minifyIdentifiers,
      files: {
        "/entry.ts": /* js */ `
          (async () => {
            let globalThis = { Bun: "intercepted" };
            const b = await import("bun");
            if (b === "intercepted") throw new Error("import('bun') captured local globalThis");
            if (typeof b.version !== "string") throw new Error("import('bun') did not return Bun");
            void globalThis;
            console.log("PASS");
          })();
        `,
      },
      run: { stdout: "PASS" },
    });
    itBundled(`bun/ImportBunWithShadowedGlobalThis${suffix}`, {
      target: "bun",
      minifyIdentifiers,
      files: {
        "/entry.ts": /* js */ `
          import * as b from "bun";
          var globalThis = { Bun: "intercepted" };
          console.log((globalThis as any).Bun);
          if ((b as any) === "intercepted") throw new Error("import 'bun' captured local globalThis");
          if (typeof b?.version !== "string") throw new Error("import 'bun' did not return Bun");
          console.log("PASS");
        `,
      },
      run: { stdout: "intercepted\nPASS" },
    });
  }
  itBundled("bun/InlinedRequireErrorWithShadowedError", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        {
          let Error = function (this: any, msg: string) { this.intercepted = true; this.message = msg; };
          let caught: any;
          try { require("does-not-exist-pkg") } catch (e) { caught = e; }
          console.log(typeof Error);
          if (caught.intercepted) throw new globalThis.Error("require shim captured local Error");
          if (!(caught instanceof globalThis.Error)) throw new globalThis.Error("not a real Error");
        }
        console.log("PASS");
      `,
    },
    run: { stdout: "function\nPASS" },
  });
  itBundled("bun/InfinityLiteralWithShadowedInfinity", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        {
          let Infinity = 5;
          let trap = Infinity;
          if (1e400 === trap) throw new Error("Infinity literal captured local Infinity");
          if (1e400 !== globalThis.Infinity) throw new Error("1e400 is not Infinity");
        }
        console.log("PASS");
      `,
    },
    run: { stdout: "PASS" },
  });
  itBundled("bun/NaNLiteralWithShadowedNaN", {
    target: "bun",
    minifySyntax: true,
    files: {
      "/entry.ts": /* js */ `
        function check(NaN: any) {
          if (!globalThis.Number.isNaN(0/0)) throw new Error("folded NaN captured local NaN");
          return NaN;
        }
        console.log(check(6) === 6 ? "PASS" : "FAIL");
      `,
    },
    run: { stdout: "PASS" },
  });
  itBundled("bun/SynthesizedUndefinedWithShadowedUndefined", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        {
          let undefined = 5;
          let trap = undefined;
          const h = import.meta.hot;
          if (h === trap) throw new Error("synthesized undefined captured local");
          if (h !== globalThis.undefined) throw new Error("import.meta.hot is not undefined");
        }
        console.log("PASS");
      `,
    },
    run: { stdout: "PASS" },
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
