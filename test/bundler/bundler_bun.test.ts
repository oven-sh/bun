import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { itBundled } from "./expectBundled";

/** The `// @bun @bun-cjs` file that `bun build --target=bun --format=cjs` writes for `source`. */
async function bunCjsFile(name: string, source: string, options: Partial<Bun.BuildConfig> = {}) {
  using dir = tempDir("bun-cjs-file", { [name]: source });
  const build = await Bun.build({
    entrypoints: [join(String(dir), name)],
    target: "bun",
    format: "cjs",
    ...options,
  });
  return await build.outputs.find(output => output.kind === "entry-point")!.text();
}

const bunCjsLibrary = /* js */ `
  export const version = "1.2.3";
  export function add(a, b) { return a + b; }
  export default "the default";
`;
const bunCjs = {
  library: await bunCjsFile("lib.mjs", bunCjsLibrary),
  bytecode: await bunCjsFile("lib.mjs", bunCjsLibrary, { bytecode: true }),
  hashbang: await bunCjsFile("lib.mjs", "#!/usr/bin/env bun\n" + bunCjsLibrary),
  banner: await bunCjsFile("lib.mjs", bunCjsLibrary, { banner: "var fromBanner = 1;" }),
  useStrict: await bunCjsFile("lib.mjs", `"use strict";\n` + bunCjsLibrary),
  minified: await bunCjsFile("lib.mjs", bunCjsLibrary, { minify: true }),
  sourcemap: await bunCjsFile("lib.mjs", bunCjsLibrary, { sourcemap: "linked" }),
  commentFooter: await bunCjsFile("lib.mjs", bunCjsLibrary, { footer: "/*! a license */" }),
  sideEffect: await bunCjsFile("side.mjs", `console.log("side effect");`),
  empty: await bunCjsFile("empty.mjs", `function unused() {}`),
  topLevelReturn: await bunCjsFile("return.cjs", `exports.a = 1;\nif (exports.a) return;\nexports.b = 2;`),
  assignments: await bunCjsFile("assignments.cjs", `exports.add = (a, b) => a + b;\nexports.version = "1.2.3";`),
  // Only the pragma makes this one CommonJS: it has no `module`, `exports` or `require`.
  cli: await bunCjsFile(
    "cli.cjs",
    `console.log("cli ran");\nif (process.argv.length < 99) return;\nconsole.log("NOT REACHED");`,
  ),
  externalRequire: await bunCjsFile(
    "external.mjs",
    `import { dependency } from "a-dependency";\nexport const fromDependency = dependency;`,
    { packages: "external" },
  ),
};
/** Every way to load `./dist/lib.cjs`, in one file with no top-level await. */
const bunCjsEveryImport = /* js */ `
  import theDefault, { add, version } from "./dist/lib.cjs";
  import * as namespace from "./dist/lib.cjs";
  const required = require("./dist/lib.cjs");
  import("./dist/lib.cjs").then(imported => {
    console.log(add(1, 2), version, theDefault, namespace.add === add, required.add === add, imported.version);
  });
`;
const bunCjsEveryImportOutput = "3 1.2.3 the default true true 1.2.3";
/** The header that every released version writes. A test that writes a file by hand uses it, so the reader
 *  keeps those files when the writer changes. */
const bunCjsHeader = "(function(exports, require, module, __filename, __dirname) {";
const bunCjsWrapper = (body: string) => `// @bun @bun-cjs\n${bunCjsHeader}${body}})\n`;
const notTheBunCjsWrapper =
  '"// @bun @bun-cjs" must be followed by the CommonJS wrapper "(function(exports, require, module, __filename, __dirname) {...})"';
const codeAfterBunCjsWrapper = 'Unexpected code after the CommonJS wrapper of a "// @bun @bun-cjs" file';
const awaitInBunCjsWrapper = '"await" can only be used inside an "async" function';

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

  // A `// @bun @bun-cjs` file is one function expression that the module loader calls. The bundler reads the
  // CommonJS module inside the function.
  test("bun/BunCjsFile fixtures are `// @bun @bun-cjs` files", () => {
    for (const [name, text] of Object.entries(bunCjs)) {
      const pragma = name === "bytecode" ? "// @bun @bytecode @bun-cjs\n" : "// @bun @bun-cjs\n";
      const hashbang = name === "hashbang" ? "#!/usr/bin/env bun\n" : "";
      expect(text).toStartWith(hashbang + pragma + bunCjsHeader);
      if (name !== "sourcemap" && name !== "commentFooter") expect(text.trimEnd()).toEndWith("})");
    }
    expect(bunCjs.sourcemap).toMatch(/\n\}\)\n\n\/\/# debugId=[0-9A-F]{32}\n\/\/# sourceMappingURL=lib\.js\.map\n$/);
    expect(bunCjs.commentFooter).toEndWith("})\n\n/*! a license */\n");
    expect(bunCjs.banner).toContain(bunCjsHeader + "var fromBanner = 1;");
    expect(bunCjs.useStrict).toContain(bunCjsHeader + '"use strict";');
    expect(bunCjs.assignments).toContain("\nexports.add = ");
    expect(bunCjs.cli.slice(bunCjs.cli.indexOf(bunCjsHeader) + bunCjsHeader.length)).not.toMatch(
      /\b(module|exports|require)\b/,
    );
  });
  for (const backend of ["cli", "api"] as const) {
    itBundled(`bun/BunCjsFileNamedImport-${backend}`, {
      backend,
      target: "bun",
      files: {
        "/entry.ts": /* js */ `
          import { add, version } from "./dist/lib.cjs";
          console.log("app: " + add(1, 2) + " " + version);
        `,
        "/dist/lib.cjs": bunCjs.library,
      },
      run: { stdout: "app: 3 1.2.3" },
    });
    itBundled(`bun/BunCjsFileEveryImport-${backend}`, {
      backend,
      target: "bun",
      files: { "/entry.ts": bunCjsEveryImport, "/dist/lib.cjs": bunCjs.library },
      run: { stdout: bunCjsEveryImportOutput },
    });
    itBundled(`bun/BunCjsFileEntryPoint-${backend}`, {
      backend,
      target: "bun",
      files: { "/main.cjs": bunCjs.sideEffect },
      run: { stdout: "side effect" },
    });
  }
  itBundled("bun/BunCjsFileDefaultImport", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import theDefault from "./dist/lib.cjs";
        console.log(theDefault);
      `,
      "/dist/lib.cjs": bunCjs.library,
    },
    run: { stdout: "the default" },
  });
  itBundled("bun/BunCjsFileNamespaceImport", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import * as namespace from "./dist/lib.cjs";
        console.log(namespace.add(1, 2), namespace.version, namespace.default);
      `,
      "/dist/lib.cjs": bunCjs.library,
    },
    run: { stdout: "3 1.2.3 the default" },
  });
  itBundled("bun/BunCjsFileBareImport", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import "./dist/side.cjs";
        console.log("app");
      `,
      "/dist/side.cjs": bunCjs.sideEffect,
    },
    run: { stdout: "side effect\napp" },
  });
  itBundled("bun/BunCjsFileRequire", {
    target: "bun",
    files: {
      "/entry.cjs": /* js */ `
        const lib = require("./dist/lib.cjs");
        console.log(lib.add(1, 2), lib.version, lib.default);
      `,
      "/dist/lib.cjs": bunCjs.library,
    },
    run: { stdout: "3 1.2.3 the default" },
  });
  itBundled("bun/BunCjsFileDynamicImport", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        const lib = await import("./dist/lib.cjs");
        console.log(lib.add(1, 2), lib.version);
      `,
      "/dist/lib.cjs": bunCjs.library,
    },
    run: { stdout: "3 1.2.3" },
  });
  for (const variant of ["bytecode", "hashbang", "banner", "useStrict", "minified", "sourcemap"] as const) {
    itBundled(`bun/BunCjsFileBuiltWith-${variant}`, {
      target: "bun",
      files: { "/entry.ts": bunCjsEveryImport, "/dist/lib.cjs": bunCjs[variant] },
      run: { stdout: bunCjsEveryImportOutput },
    });
  }
  // What can follow the wrapper: `;` and comments. A legal comment stays in the bundle.
  itBundled("bun/BunCjsFileTails", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import { version as commentFooter } from "./comment-footer.cjs";
        import { version as semicolon } from "./semicolon.cjs";
        import { version as crlf } from "./crlf.cjs";
        console.log(commentFooter, semicolon, crlf);
      `,
      "/comment-footer.cjs": bunCjs.commentFooter,
      "/semicolon.cjs": bunCjs.library.trimEnd() + ";\n",
      "/crlf.cjs": (bunCjs.library.trimEnd() + ";\n").replaceAll("\n", "\r\n"),
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("/*! a license */");
    },
    run: { stdout: "1.2.3 1.2.3 1.2.3" },
  });
  itBundled("bun/BunCjsFileToCjs", {
    target: "bun",
    format: "cjs",
    files: { "/entry.ts": bunCjsEveryImport, "/dist/lib.cjs": bunCjs.library },
    run: { stdout: bunCjsEveryImportOutput },
  });
  itBundled("bun/BunCjsFileToNode", {
    target: "node",
    files: { "/entry.ts": bunCjsEveryImport, "/dist/lib.cjs": bunCjs.library },
    run: { stdout: bunCjsEveryImportOutput },
  });
  itBundled("bun/BunCjsFileSplitting", {
    target: "bun",
    splitting: true,
    outdir: "/out",
    files: { "/entry.ts": bunCjsEveryImport, "/dist/lib.cjs": bunCjs.library },
    run: { file: "/out/entry.js", stdout: bunCjsEveryImportOutput },
  });
  itBundled("bun/BunCjsFileMinify", {
    target: "bun",
    minifySyntax: true,
    minifyIdentifiers: true,
    minifyWhitespace: true,
    files: { "/entry.ts": bunCjsEveryImport, "/dist/lib.cjs": bunCjs.library },
    run: { stdout: bunCjsEveryImportOutput },
  });
  // The file as the only entry point: what the second build exports.
  for (const format of ["cjs", "esm"] as const) {
    itBundled(`bun/BunCjsFileEntryPointExports-${format}`, {
      target: "bun",
      format,
      files: { "/lib.cjs": bunCjs.hashbang },
      runtimeFiles: {
        "/importer.mjs": /* js */ `
          import * as namespace from "./out.js";
          const lib = ${format === "cjs" ? "namespace" : "namespace.default"};
          console.log(Object.keys(namespace).sort().join(","), lib.add(1, 2), lib.version, lib.default);
        `,
      },
      onAfterBundle(api) {
        api.expectFile("/out.js").toStartWith("#!/usr/bin/env bun\n// @bun");
      },
      run: {
        file: "/importer.mjs",
        stdout: (format === "cjs" ? "add,default,version" : "default") + " 3 1.2.3 the default",
      },
    });
  }
  // No `exports.name = value` is lifted out of the wrapper: the second build exports `module.exports` only.
  itBundled("bun/BunCjsFileEntryPointExportsOfAssignments", {
    target: "bun",
    files: { "/lib.cjs": bunCjs.assignments },
    runtimeFiles: {
      "/importer.mjs": /* js */ `
        import * as namespace from "./out.js";
        console.log(Object.keys(namespace).sort().join(","), namespace.default.add(1, 2), namespace.default.version);
      `,
    },
    run: { file: "/importer.mjs", stdout: "default 3 1.2.3" },
  });
  // The file is CommonJS whatever its extension or its package.json says.
  itBundled("bun/BunCjsFileInTypeModulePackage", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import { add, version } from "lib";
        import { add as addFromMjs } from "./dist/lib.mjs";
        console.log(add(1, 2), version, addFromMjs(2, 3));
      `,
      "/node_modules/lib/package.json": JSON.stringify({ name: "lib", type: "module", main: "./index.js" }),
      "/node_modules/lib/index.js": bunCjs.library,
      "/dist/lib.mjs": bunCjs.library,
    },
    run: { stdout: "3 1.2.3 5" },
  });
  // The same for a file that uses no CommonJS name. Its top-level `return` is valid only in a function.
  for (const [name, path] of [
    ["Js", "/dist/cli.js"],
    ["Mjs", "/dist/cli.mjs"],
    ["TypeModule", "/pkg/cli.js"],
  ] as const) {
    const files = { [path]: bunCjs.cli, "/pkg/package.json": JSON.stringify({ name: "pkg", type: "module" }) };
    itBundled(`bun/BunCjsFileWithNoCommonJSName-${name}-BareImport`, {
      target: "bun",
      files: { "/entry.ts": `import ${JSON.stringify("." + path)};\nconsole.log("app");`, ...files },
      run: { stdout: "cli ran\napp" },
    });
    itBundled(`bun/BunCjsFileWithNoCommonJSName-${name}-EntryPoint`, {
      target: "bun",
      files,
      entryPoints: [path],
      run: { stdout: "cli ran" },
    });
  }
  itBundled("bun/BunCjsFileWithNoCommonJSName-TypeModule-Compile", {
    backend: "cli",
    compile: true,
    files: { "/pkg/cli.js": bunCjs.cli, "/pkg/package.json": JSON.stringify({ name: "pkg", type: "module" }) },
    entryPoints: ["/pkg/cli.js"],
    run: { stdout: "cli ran", stderr: "" },
  });
  // Released versions write `import.meta` into the wrapper. It does not make the file an ES module.
  itBundled("bun/BunCjsFileImportMeta", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import "./lib.js";
        console.log("app");
      `,
      "/lib.js": bunCjsWrapper(
        `console.log(typeof import.meta.url); if (process.argv.length < 99) return; console.log("NOT REACHED");`,
      ),
    },
    run: { stdout: "string\napp" },
  });
  // The first build left this `require()` for run time. The second build sees it.
  itBundled("bun/BunCjsFileExternalRequire", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import { fromDependency } from "./dist/external.cjs";
        console.log(fromDependency);
      `,
      "/dist/external.cjs": bunCjs.externalRequire,
      "/node_modules/a-dependency/index.js": `exports.dependency = "bundled dependency";`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("bundled dependency");
    },
    run: { stdout: "bundled dependency" },
  });
  // An empty wrapper is a CommonJS module with no statements. It still gets its `require_*` symbol.
  itBundled("bun/BunCjsFileEmptyWrapper", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import "./dist/empty.js";
        import "./dist/empty.cjs";
        console.log(JSON.stringify(require("./dist/empty.js")), JSON.stringify(require("./dist/empty.cjs")));
      `,
      "/dist/empty.js": bunCjs.empty,
      "/dist/empty.cjs": bunCjs.empty,
    },
    run: { stdout: "{} {}" },
  });
  // A statement that is valid only in a function: the module stays in one.
  itBundled("bun/BunCjsFileTopLevelReturn", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import * as returned from "./dist/return.cjs";
        console.log(returned.a, returned.b);
      `,
      "/dist/return.cjs": bunCjs.topLevelReturn,
    },
    run: { stdout: "1 undefined" },
  });
  // The pragma decides. Below it, only the wrapper that `bun build` writes is read.
  for (const [name, file, error] of [
    ["CodeAfter", bunCjs.library + `console.log("after");\n`, codeAfterBunCjsWrapper],
    // What a debug ID injector writes: its statement goes between the pragma and the wrapper.
    [
      "CodeBefore",
      bunCjs.library.replace("\n", `\n;!function(){try{globalThis._debugIds={}}catch(e){}}();\n`),
      notTheBunCjsWrapper,
    ],
    ["NoWrapper", `// @bun @bun-cjs\nmodule.exports = { plain: "plain" };\n`, notTheBunCjsWrapper],
    ["TopLevelAwait", bunCjsWrapper(`module.exports = await 1;`), awaitInBunCjsWrapper],
    ["ForAwait", bunCjsWrapper(`for await (const x of []) {}`), awaitInBunCjsWrapper],
  ] as const) {
    itBundled(`bun/BunCjsFileRefused-${name}`, {
      backend: "cli",
      target: "bun",
      files: {
        "/entry.ts": `import lib from "./lib.cjs"; console.log(lib);`,
        "/lib.cjs": file,
      },
      bundleErrors: { "/lib.cjs": [error] },
    });
  }

  // One file under the pragma per row: what the module loader does with it, and what the bundler does.
  // The loader calls the value of the file's last statement, so it runs more texts than `bun build` writes.
  describe("bun/BunCjsFile shapes", () => {
    const source = `module.exports = { v: 42 };`;
    const json = '{"v":42}';
    let written!: Record<"plain" | "bytecode" | "hashbang" | "banner" | "sourcemap" | "footer", string>;
    let declarationFooter = "";
    let statementFooter = "";
    const shapes: Record<string, [file: () => string, loader: "runs" | "throws", bundler: "unwraps" | string]> = {
      "written by bun build": [() => written.plain, "runs", "unwraps"],
      "written with --bytecode": [() => written.bytecode, "runs", "unwraps"],
      "written for a source with a hashbang": [() => written.hashbang, "runs", "unwraps"],
      "written with a code --banner": [() => written.banner, "runs", "unwraps"],
      "written with --sourcemap=linked": [() => written.sourcemap, "runs", "unwraps"],
      "written with a comment --footer": [() => written.footer, "runs", "unwraps"],
      "written with a declaration --footer": [() => declarationFooter, "runs", codeAfterBunCjsWrapper],
      "written with a statement --footer": [() => statementFooter, "throws", codeAfterBunCjsWrapper],
      "`;` after the wrapper": [() => written.plain.trimEnd() + ";\n", "runs", "unwraps"],
      "CRLF line ends": [() => written.plain.replaceAll("\n", "\r\n"), "runs", "unwraps"],
      "a statement before the wrapper": [
        () => written.plain.replace("\n", "\nvar before = 1;\n"),
        "runs",
        notTheBunCjsWrapper,
      ],
      "a directive before the wrapper": [
        () => written.plain.replace("\n", `\n"use strict";\n`),
        "runs",
        notTheBunCjsWrapper,
      ],
      "other parameter names": [
        () => `// @bun @bun-cjs\n(function(a, b, c, d, e) {c.exports = { v: 42 };})\n`,
        "runs",
        notTheBunCjsWrapper,
      ],
      "a sixth parameter": [
        () => `// @bun @bun-cjs\n${bunCjsHeader.replace(")", ", importMeta)")}${source}})\n`,
        "runs",
        notTheBunCjsWrapper,
      ],
      "an arrow function": [
        () => `// @bun @bun-cjs\n((exports, require, module, __filename, __dirname) => {${source}})\n`,
        "runs",
        notTheBunCjsWrapper,
      ],
      "a named function": [
        () => `// @bun @bun-cjs\n${bunCjsHeader.replace("function(", "function wrapper(")}${source}})\n`,
        "runs",
        notTheBunCjsWrapper,
      ],
      "the wrapper called": [() => bunCjsWrapper(source).trimEnd() + "();\n", "throws", codeAfterBunCjsWrapper],
      "no wrapper": [() => `// @bun @bun-cjs\n${source}\n`, "throws", notTheBunCjsWrapper],
      "`await` in the wrapper": [
        () => bunCjsWrapper(`module.exports = { v: await 42 };`),
        "throws",
        awaitInBunCjsWrapper,
      ],
      "an import statement in the wrapper": [
        () => bunCjsWrapper(`import fs from "node:fs"; ${source}`),
        "throws",
        "Unexpected fs",
      ],
      "`import.meta` in the wrapper": [
        () => bunCjsWrapper(`module.exports = { v: typeof import.meta === "object" ? 42 : 0 };`),
        "throws",
        "unwraps",
      ],
    };

    test("fixtures", async () => {
      written = {
        plain: await bunCjsFile("lib.cjs", source),
        bytecode: await bunCjsFile("lib.cjs", source, { bytecode: true }),
        hashbang: await bunCjsFile("lib.cjs", "#!/usr/bin/env bun\n" + source),
        banner: await bunCjsFile("lib.cjs", source, { banner: "var fromBanner = 1;" }),
        sourcemap: await bunCjsFile("lib.cjs", source, { sourcemap: "linked" }),
        footer: await bunCjsFile("lib.cjs", source, { footer: "// a comment" }),
      };
      declarationFooter = await bunCjsFile("lib.cjs", source, { footer: "var after = 1;" });
      statementFooter = await bunCjsFile("lib.cjs", source, { footer: `console.log("after");` });
      expect(declarationFooter).toEndWith("})\n\nvar after = 1;\n");
    });

    for (const [name, [file, loader, bundler]] of Object.entries(shapes)) {
      test(name, async () => {
        using dir = tempDir("bun-cjs-file-shape", {
          "lib.cjs": file(),
          "entry.cjs": `console.log(JSON.stringify(require("./lib.cjs")));`,
        });
        const run = async (entry: string) => {
          await using proc = Bun.spawn({
            cmd: [bunExe(), entry],
            env: bunEnv,
            cwd: String(dir),
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          return exitCode === 0 && stdout.trimEnd().endsWith(json) ? "runs" : "throws";
        };
        const build = await Bun.build({
          entrypoints: [join(String(dir), "entry.cjs")],
          outdir: join(String(dir), "out"),
          target: "bun",
          throw: false,
        });
        expect({
          loader: await run("entry.cjs"),
          bundler: build.success
            ? (await run(join("out", "entry.js"))) === "runs"
              ? "unwraps"
              : "the bundle throws"
            : build.logs.map(log => log.message).join("\n"),
        }).toEqual({ loader, bundler });
      });
    }
  });

  test("bun/BunCjsFile from a plugin and from the `files` map", async () => {
    using dir = tempDir("bun-cjs-file-virtual", {
      "entry.ts": /* js */ `
        import { add } from "virtual:lib";
        import { version } from "./in-memory.cjs";
        console.log(add(1, 2), version);
      `,
    });
    const build = await Bun.build({
      entrypoints: [join(String(dir), "entry.ts")],
      outdir: join(String(dir), "out"),
      target: "bun",
      files: { [join(String(dir), "in-memory.cjs")]: bunCjs.library },
      plugins: [
        {
          name: "virtual",
          setup(builder) {
            builder.onResolve({ filter: /^virtual:lib$/ }, () => ({ path: "lib", namespace: "virtual" }));
            builder.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
              contents: bunCjs.library,
              loader: "js",
            }));
          },
        },
      ],
    });
    expect(build.success).toBe(true);
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "out", "entry.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("3 1.2.3\n");
    expect(exitCode).toBe(0);
  });
  itBundled("bun/BunCjsFileCompileEntryPoint", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.cjs": bunCjsWrapper(`console.log("Hello from", require("node:path").basename("/dist/main.cjs"));`),
    },
    run: { stdout: "Hello from main.cjs", stderr: "" },
  });
  itBundled("bun/BunCjsFileCompileImported", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        import { add, version } from "./dist/lib.cjs";
        console.log(add(1, 2), version);
      `,
      "/dist/lib.cjs": bunCjs.library,
    },
    run: { stdout: "3 1.2.3", stderr: "" },
  });
  describe("bun/BunCjsFile with --no-bundle", () => {
    const body = `exports.add = (a, b) => a + b;\nexports.version = "1.2.3";\n`;
    async function noBundle(file: string) {
      using dir = tempDir("bun-cjs-file-no-bundle", { "lib.cjs": file });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--no-bundle", "--target=bun", "lib.cjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    test("prints the CommonJS module inside the wrapper", async () => {
      expect(await noBundle(bunCjsWrapper(body))).toEqual({ stdout: body, stderr: "", exitCode: 0 });
    });

    test("fails for a text that is not the wrapper", async () => {
      const { stdout, stderr, exitCode } = await noBundle(bunCjsWrapper(body).replace("\n", "\nvar before = 1;\n"));
      expect(stderr).toContain(notTheBunCjsWrapper);
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    });
  });
  // `// @bun` without `@bun-cjs` is ordinary source, as before.
  itBundled("bun/BunPragmaWithoutBunCjsIsOrdinarySource", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        import { esm } from "./esm.mjs";
        console.log(esm);
      `,
      "/esm.mjs": `// @bun\nexport const esm = "esm";\n`,
    },
    run: { stdout: "esm" },
  });
});
