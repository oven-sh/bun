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

  // Hand-written `import.meta.require` is the `require` of the output where the output cannot evaluate it.
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
    run: { runtime: "node", stdout: "function" },
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
          console.log(typeof import.meta.require === "function", viaBun(), where(), import.meta.require.resolve("./lib/dep.cjs").endsWith("dep.cjs"));
        `,
        "/lib/dep.cjs": `exports.x = "not in the bundle";`,
      },
      target: "node",
      minifySyntax,
      allowUnresolved: [],
      run: { runtime: "node", stdout: "true false null true" },
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
  // The value that nothing uses goes, like the `import.meta.require` that it stands for. The output then has no `__require`.
  itBundled("bun/ImportMetaRequireUnused", {
    files: {
      "/entry.js": /* js */ `
        import.meta.require;
        var unused = import.meta.require;
        const alsoUnused = /* @__PURE__ */ import.meta.require("./not-there.cjs");
        function build() {
          import.meta.require;
          return "built";
        }
        console.log(build());
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

  // The React Compiler keeps that node, as it keeps `require`.
  itBundled("bun/ImportMetaRequireWithReactCompiler", {
    files: {
      "/entry.jsx": /* jsx */ `
        export function Comp({ name }) {
          const load = import.meta.require;
          return <div>{typeof load}{name}</div>;
        }
      `,
    },
    reactCompiler: true,
    backend: "cli",
    target: "browser",
    external: ["react", "react/compiler-runtime", "react/jsx-runtime", "react/jsx-dev-runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatch(/\b_c\(\d+\)/);
      expect(out).toContain("typeof __require");
      expect(out).not.toContain("import.meta.require");
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
        "/dist/pkg.js": `// @bun\nvar __esm = (fn, res, err) => () => {\n  if (fn)\n    try {\n      res = fn(fn = 0);\n    } catch (e) {\n      err = [e];\n    }\n  if (err)\n    throw err[0];\n  return res;\n};\n\n// dist1/inner.js\nimport { sep } from "path";\nfunction s() {\n  return __require("path").sep + sep;\n}\nvar __require;\nvar init_inner = __esm(() => {\n  __require = import.meta.require;\n});\n\n// src/pkg.js\nfunction s2() {\n  return init_inner(), s();\n}\nexport {\n  s2 as s\n};\n`,
      },
      stdout: "app: //",
    },
    // A direct `eval` keeps the name of the helper.
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
        run: { runtime: target, stdout },
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

  // The browser files of a server build go to a module script with no `require`. `import.meta.require` stays as written there.
  for (const [target, format] of [
    ["bun", "esm"],
    ["bun", "cjs"],
    ["node", "esm"],
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
        expect(client[0]).not.toContain("node:module");
      },
    });
  }
  // An entry that starts with `#!/usr/bin/env bun` makes its chunk a module for Bun, whatever the target of the build is.
  itBundled("bun/ImportMetaRequireBehindBunHashbang", {
    files: {
      "/cli.js": `#!/usr/bin/env bun\nimport { platform } from "./dep.js";\nimport { sep } from "./dist/index.js";\nconsole.log("cli:", platform(), sep("node:path"));`,
      "/dep.js": `export function platform() { return typeof import.meta.require("node:os").platform(); }`,
      "/dist/index.js": `// @bun\nvar __require = import.meta.require;\nfunction sep(name) {\n  return __require(name).posix.sep;\n}\nexport {\n  sep\n};\n`,
    },
    entryPoints: ["/cli.js"],
    target: "browser",
    run: { stdout: "cli: string /" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain('import.meta.require("node:os")');
      expect(out).toMatch(/^var __require\d* = import\.meta\.require;$/m);
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
        test.skipIf(target === "node" && !nodeExe())(`built for ${target} as ${format}`, async () => {
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
    test.skipIf(!nodeExe())("a library for bun, required by an app for node", async () => {
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
