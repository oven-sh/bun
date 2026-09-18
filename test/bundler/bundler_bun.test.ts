import { Database } from "bun:sqlite";
import { describe, expect } from "bun:test";
import { readdirSync } from "node:fs";
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

  // cjs output for bun (which --bytecode implies) gets the output file's import.meta
  // as the sixth argument of the @bun-cjs wrapper, like esm output gets it natively.
  // It used to inline the source file's paths from the build machine instead.
  const importMetaFiles = {
    "/entry.ts": /* js */ `
      import { basename, dirname } from "node:path";
      import { pathOfDep } from "./lib/dep.cjs";
      var $Bun_import_meta = "user variable";
      function shadowed() {
        let $Bun_import_meta = "shadowed";
        return import.meta.file;
      }
      console.log(
        import.meta.path === Bun.main,
        import.meta.dir === dirname(Bun.main),
        import.meta.file === basename(Bun.main),
        import.meta.url === Bun.pathToFileURL(Bun.main).href,
        import.meta.filename === Bun.main,
        import.meta.dirname === dirname(Bun.main),
        import.meta.main,
        typeof import.meta,
        import.meta.env.IMPORT_META_PROBE,
        typeof import.meta.resolve,
        shadowed() === basename(Bun.main),
        $Bun_import_meta,
        pathOfDep() === Bun.main,
      );
    `,
    "/lib/dep.cjs": /* js */ `
      exports.pathOfDep = () => import.meta.path;
    `,
  };
  const importMetaStdout = "true true true true true true true object from-env function true user variable true";
  const importMetaEnv = { IMPORT_META_PROBE: "from-env" };
  const expectBytecodeCacheHit = {
    env: { ...importMetaEnv, BUN_JSC_verboseDiskCache: "1" },
    validate({ stderr }: { stderr: string }) {
      expect(stderr).toContain("[Disk Cache] Cache hit for sourceCode");
    },
  };
  const bunCjsWrapper = (pragma: string, arg: string) =>
    `// @bun ${pragma}@bun-cjs\n(function(exports, require, module, __filename, __dirname${arg}) {`;
  for (const variant of ["", "+minify", "+bytecode"] as const) {
    const bytecode = variant === "+bytecode";
    const minify = variant === "+minify";
    itBundled(`bun/ImportMetaFormatCjs${variant}`, {
      target: "bun",
      format: "cjs",
      minifySyntax: minify,
      minifyWhitespace: minify,
      minifyIdentifiers: minify,
      bytecode,
      // --bytecode writes a second file, which the CLI only allows with --outdir.
      ...(bytecode ? { outdir: "/out" } : {}),
      files: importMetaFiles,
      onAfterBundle(api) {
        const out = api.readFile(bytecode ? "/out/entry.js" : "/out.js");
        expect(out).toStartWith(bunCjsWrapper(bytecode ? "@bytecode " : "", ", $Bun_import_meta"));
        expect(out).not.toContain("import.meta");
        // The build directory must not end up in the output.
        expect(out).not.toContain(api.root);
      },
      run: { stdout: importMetaStdout, env: importMetaEnv, ...(bytecode ? expectBytecodeCacheHit : {}) },
    });
  }
  itBundled("bun/ImportMetaFormatCjsUnused", {
    target: "bun",
    format: "cjs",
    files: {
      "/entry.ts": /* js */ `
        import { value } from "./dep.cjs";
        console.log(value);
      `,
      "/dep.cjs": /* js */ `
        exports.value = "no import.meta here";
      `,
    },
    onAfterBundle(api) {
      // The runtime helpers linked into this chunk use import.meta in their
      // source, but cjs output never keeps that part, so the wrapper does not
      // take the argument.
      expect(api.readFile("/out.js")).toStartWith(bunCjsWrapper("", ""));
    },
    run: { stdout: "no import.meta here" },
  });
  // The sqlite loader builds its module out of `import.meta.require(...)` itself.
  itBundled("bun/ImportMetaFormatCjsEmbeddedSqlite", {
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
        db.exec("insert into messages values ('Hello from cjs!')");
        return db.serialize();
      })(),
    },
    run: { stdout: "Hello from cjs!" },
  });
  // The browser chunk of an HTML import is loaded as a module script, so it
  // keeps `import.meta`. Only the server chunk is wrapped.
  itBundled("bun/ImportMetaFormatCjsHtmlImport", {
    target: "bun",
    format: "cjs",
    outdir: "/out",
    entryPoints: ["/server.ts"],
    files: {
      "/server.ts": /* js */ `
        import html from "./index.html";
        console.log(typeof html, import.meta.path === Bun.main);
      `,
      "/index.html": `<!DOCTYPE html><html><head><script type="module" src="./client.ts"></script></head><body></body></html>`,
      "/client.ts": /* js */ `
        console.log(typeof import.meta.env, import.meta);
      `,
    },
    onAfterBundle(api) {
      expect(api.readFile("/out/server.js")).toStartWith(bunCjsWrapper("", ", $Bun_import_meta"));
      const browserChunk = readdirSync(api.outdir).find(name => name !== "server.js" && name.endsWith(".js"))!;
      const browser = api.readFile("/out/" + browserChunk);
      expect(browser).toContain("typeof import.meta.env, import.meta");
      expect(browser).not.toContain("$Bun_import_meta");
    },
    run: { stdout: "object true" },
  });
  // `bun build --compile --bytecode` is the documented production command.
  // https://github.com/oven-sh/bun/issues/21097
  itBundled("bun/ImportMetaCompileBytecode", {
    compile: true,
    bytecode: true,
    files: {
      "/entry.ts": /* js */ `
        import { basename, dirname } from "node:path";
        const slashes = (s) => s.replaceAll("\\\\", "/");
        console.log(
          slashes(import.meta.path) === slashes(Bun.main),
          slashes(import.meta.dir) === slashes(dirname(Bun.main)),
          import.meta.file === basename(Bun.main),
          import.meta.url === Bun.pathToFileURL(Bun.main).href,
          import.meta.env.IMPORT_META_PROBE,
          slashes(import.meta.dir),
        );
      `,
    },
    run: {
      stdout: /^true true true true from-env (\/\$bunfs|[A-Z]:\/~BUN)\/root$/,
      ...expectBytecodeCacheHit,
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
