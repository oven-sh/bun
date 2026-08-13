import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
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

  // The sqlite loader is also selected without an import attribute: by a `.sqlite`
  // extension, `--loader .db:sqlite`, bunfig `[loader]` or `Bun.build({ loader })`.
  // The database is never part of the bundle, so the import has to stay as
  // written (it is resolved next to the bundle at runtime) and carry the type,
  // the same as `with { type: "sqlite" }`. It used to be bundled as a module
  // holding the absolute path of the file on the build machine.
  describe("sqlite loader selected by extension or loader map", () => {
    function database(message: string): Buffer {
      const db = new Database(":memory:");
      db.run("create table messages (message text)");
      db.run("insert into messages values (?)", [message]);
      return db.serialize();
    }
    // The file that exists while bundling and the one next to the bundle hold
    // different rows, so the program's output tells which file the bundle opens.
    const buildTimeCopy = database("build-time copy");
    const runtimeCopy = database("copy next to the bundle");
    const entry = (load: string) => /* js */ `
      ${load}
      console.log(db.query("select message from messages").get().message);
    `;

    itBundled("bun/sqlite-extension-import", {
      target: "bun",
      files: {
        "/src/entry.ts": entry(`import db from './db.sqlite';`),
        "/src/db.sqlite": buildTimeCopy,
      },
      runtimeFiles: { "/db.sqlite": runtimeCopy },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toMatch(/^import \w+ from "\.\/db\.sqlite" with \{ type: "sqlite" \};$/m);
        expect(out).not.toContain("import.meta.require");
      },
      run: { stdout: "copy next to the bundle" },
    });

    itBundled("bun/sqlite-extension-import-cjs", {
      target: "bun",
      format: "cjs",
      files: {
        "/src/entry.ts": entry(`import db from './db.sqlite';`),
        "/src/db.sqlite": buildTimeCopy,
      },
      runtimeFiles: { "/db.sqlite": runtimeCopy },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain('require("./db.sqlite", { type: "sqlite" })');
        expect(out).not.toContain("import.meta");
      },
      run: { stdout: "copy next to the bundle" },
    });

    itBundled("bun/sqlite-extension-require", {
      target: "bun",
      minifyWhitespace: true,
      files: {
        "/src/entry.ts": entry(`const { db } = require('./db.sqlite');`),
        "/src/db.sqlite": buildTimeCopy,
      },
      runtimeFiles: { "/db.sqlite": runtimeCopy },
      onAfterBundle(api) {
        api.expectFile("/out.js").toContain('require("./db.sqlite",{type:"sqlite"})');
      },
      run: { stdout: "copy next to the bundle" },
    });

    itBundled("bun/sqlite-extension-dynamic-import", {
      target: "bun",
      files: {
        "/src/entry.ts": entry(`const { default: db } = await import('./db.sqlite');`),
        "/src/db.sqlite": buildTimeCopy,
      },
      runtimeFiles: { "/db.sqlite": runtimeCopy },
      onAfterBundle(api) {
        api.expectFile("/out.js").toContain('import("./db.sqlite", { with: { type: "sqlite" } })');
      },
      run: { stdout: "copy next to the bundle" },
    });

    // External without side effects, like the attribute form: an unused import
    // does not make the bundle open the database.
    itBundled("bun/sqlite-extension-unused-import", {
      target: "bun",
      files: {
        "/src/entry.ts": /* js */ `
          import db from './db.sqlite';
          console.log("unused");
        `,
        "/src/db.sqlite": buildTimeCopy,
      },
      onAfterBundle(api) {
        api.expectFile("/out.js").not.toContain("db.sqlite");
      },
      run: { stdout: "unused" },
    });

    // `.db` is not a sqlite extension by itself; these map it through each of
    // the loader-map surfaces.
    const loaderMapProject = {
      "src/entry.ts": entry(`import db from "./app.db";`),
      "src/app.db": buildTimeCopy,
      "out/app.db": runtimeCopy,
    };

    async function bunBuild(dir: string, ...args: string[]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./src/entry.ts", "--outfile", "./out/entry.js", ...args],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stderr, exitCode };
    }

    async function expectExternalSqliteImport(dir: string, bundle: string) {
      expect(bundle).toMatch(/^import \w+ from "\.\/app\.db" with \{ type: "sqlite" \};$/m);
      expect(bundle).not.toContain("import.meta.require");

      await using proc = Bun.spawn({
        cmd: [bunExe(), join(dir, "out/entry.js")],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("copy next to the bundle\n");
      expect(exitCode).toBe(0);
    }

    test.concurrent("--loader .db:sqlite", async () => {
      using dir = tempDir("sqlite-loader-flag", loaderMapProject);
      const { stderr, exitCode } = await bunBuild(String(dir), "--target", "bun", "--loader", ".db:sqlite");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      await expectExternalSqliteImport(String(dir), await Bun.file(join(String(dir), "out/entry.js")).text());
    });

    test.concurrent("bunfig [loader]", async () => {
      using dir = tempDir("sqlite-loader-bunfig", {
        ...loaderMapProject,
        "bunfig.toml": `[loader]\n".db" = "sqlite"\n`,
      });
      const { stderr, exitCode } = await bunBuild(String(dir), "--target", "bun");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      await expectExternalSqliteImport(String(dir), await Bun.file(join(String(dir), "out/entry.js")).text());
    });

    test.concurrent("Bun.build({ loader })", async () => {
      using dir = tempDir("sqlite-loader-api", loaderMapProject);
      const result = await Bun.build({
        entrypoints: [join(String(dir), "src/entry.ts")],
        outdir: join(String(dir), "out"),
        target: "bun",
        loader: { ".db": "sqlite" as any },
      });
      expect(result.outputs.map(output => output.path)).toEqual([join(String(dir), "out/entry.js")]);
      await expectExternalSqliteImport(String(dir), await result.outputs[0].text());
    });

    test.concurrent("still requires target bun", async () => {
      using dir = tempDir("sqlite-loader-node-target", loaderMapProject);
      const { stderr, exitCode } = await bunBuild(String(dir), "--target", "node", "--loader", ".db:sqlite");
      expect(stderr).toContain('To use the "sqlite" loader, set target to "bun"');
      expect(exitCode).toBe(1);
    });
  });
});
