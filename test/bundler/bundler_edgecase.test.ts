import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/harness/commands";
import { type BundlerTestInput, decodeSourceMappingsLine, itBundled } from "./expectBundled";

// A public path composes with the referenced file's path relative to the output
// directory, never relative to the importing chunk (esbuild's semantics).
const CDN_PUBLIC_PATH = "https://cdn.example/app/";
const cdnUrls = (source: string) => [...source.matchAll(/"(https:\/\/cdn\.example\/[^"]+)"/g)].map(match => match[1]);

describe("bundler", () => {
  itBundled("edgecase/EmptyFile", {
    files: {
      "/entry.js": "",
    },
  });
  itBundled("edgecase/EmptyCommonJSModule", {
    files: {
      "/entry.js": /* js */ `
        import * as module from './module.cjs';
        console.log(typeof module)
      `,
      "/module.cjs": /* js */ ``,
    },
    run: {
      stdout: "object",
    },
  });
  // A CommonJS module with only hoistable statements still needs a `require_*` wrapper symbol.
  itBundled("edgecase/StatementlessCommonJSModuleRequire", {
    files: {
      "/entry.ts": /* js */ `
        const b = require('./b.cjs');
        console.log(typeof b);
      `,
      "/b.cjs": `;`,
    },
    run: {
      stdout: "object",
    },
  });
  itBundled("edgecase/HoistableOnlyCommonJSModule", {
    files: {
      "/entry.ts": /* js */ `
        import { B } from './b.cjs';
        console.log(typeof B);
      `,
      "/b.cjs": `function foo() {}\n`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("require_b");
    },
    run: {
      stdout: "undefined",
    },
  });
  // These packages parse as ESM, and a default import makes the linker wrap them as CommonJS.
  itBundled("edgecase/HoistableOnlyUnwrapCommonJSPackage", {
    files: {
      "/entry.js": /* js */ `
        import Def from 'scheduler/empty.js';
        console.log(typeof Def);
      `,
      "/node_modules/scheduler/empty.js": `function foo() {}\n`,
      "/node_modules/scheduler/package.json": `{"name":"scheduler","version":"1.0.0"}`,
    },
    target: "browser",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("require_empty");
    },
    run: {
      stdout: "object",
    },
  });
  itBundled("edgecase/NestedRedirectToABuiltin", {
    files: {
      "/entry.js": /* js */ `
        import * as path from './module.cjs';
        console.log(path.join('a', 'b'))
      `,
      "/module.cjs": /* js */ `
        module.exports = require('./2nd')
      `,
      "/2nd.js": /* js */ `
        module.exports = require('path')
      `,
    },
    target: "bun",
    run: {
      stdout: join("a", "b"),
    },
  });
  itBundled("edgecase/ImportStarFunction", {
    files: {
      "/entry.js": /* js */ `
        import * as foo from "./foo.js";
        console.log(foo.fn());
      `,
      "/foo.js": /* js */ `
        export function fn() {
          return "foo";
        }
      `,
    },
    run: { stdout: "foo" },
  });
  itBundled("edgecase/ImportStarSyntaxErrorBug", {
    // bug: 'import {ns}, * as import_x from "x";'
    files: {
      "/entry.js": /* js */ `
        export {ns} from 'x'
        export * as ns2 from 'x'
      `,
    },
    external: ["x"],
    runtimeFiles: {
      "/node_modules/x/index.js": `export const ns = 1`,
    },
    run: true,
  });
  itBundled("edgecase/BunPluginTreeShakeImport", {
    todo: true, // runtime test (not bundler): plugin() now validates its argument so this needs a real setup() before it can exercise the original tree-shake repro
    // This only appears at runtime and not with bun build, even with --no-bundle
    files: {
      "/entry.ts": /* js */ `
        import { A, B } from "./somewhere-else";
        import { plugin } from "bun";

        plugin(B());

        new A().chainedMethods();
      `,
      "/somewhere-else.ts": /* js */ `
        export class A {
          chainedMethods() {
            console.log("hey");
          }
        }
        export function B() {
          return { name: 'hey' }
        }
      `,
    },
    minifySyntax: true,
    target: "bun",
    run: { file: "/entry.ts" },
  });
  itBundled("edgecase/TemplateStringIssue622", {
    files: {
      "/entry.ts": /* js */ `
        capture(\`\\?\`);
        capture(hello\`\\?\`);
      `,
    },
    capture: ["`?`", "hello`\\?`"],
    target: "bun",
  });
  // https://github.com/oven-sh/bun/issues/2699
  itBundled("edgecase/ImportNamedFromExportStarCJS", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from './foo';
        console.log(foo);
      `,
      "/foo.js": /* js */ `
        export * from './bar.cjs';
      `,
      "/bar.cjs": /* js */ `
        module.exports = { foo: 'bar' };
      `,
    },
    run: {
      stdout: "bar",
    },
  });
  itBundled("edgecase/NodeEnvDefaultUnset", {
    files: {
      "/entry.js": /* js */ `
        capture(process.env.NODE_ENV);
        capture(process.env.NODE_ENV === 'production');
        capture(process.env.NODE_ENV === 'development');
      `,
    },
    target: "browser",
    capture: ['"development"', "false", "true"],
    env: {
      // undefined will ensure this variable is not passed to the bundler
      NODE_ENV: undefined,
    },
  });
  itBundled("edgecase/NodeEnvDefaultDevelopment", {
    files: {
      "/entry.js": /* js */ `
        capture(process.env.NODE_ENV);
        capture(process.env.NODE_ENV === 'production');
        capture(process.env.NODE_ENV === 'development');
      `,
    },
    target: "browser",
    capture: ['"development"', "false", "true"],
    env: {
      NODE_ENV: "development",
    },
  });
  itBundled("edgecase/NodeEnvDefaultProduction", {
    files: {
      "/entry.js": /* js */ `
        capture(process.env.NODE_ENV);
        capture(process.env.NODE_ENV === 'production');
        capture(process.env.NODE_ENV === 'development');
      `,
    },
    target: "browser",
    capture: ['"production"', "true", "false"],
    env: {
      NODE_ENV: "production",
    },
  });
  itBundled("edgecase/NodeEnvOptionalChaining", {
    // Matching `process?.env?.NODE_ENV` against the `process.env.NODE_ENV`
    // define would also match `Symbol?.for` etc. as side-effect-free; esbuild
    // bails on optional-chain links for the same reason.
    todo: true,
    files: {
      "/entry.js": /* js */ `
        capture(process?.env?.NODE_ENV);
        capture(process?.env?.NODE_ENV === 'production');
        capture(process?.env?.NODE_ENV === 'development');
        capture(process.env?.NODE_ENV);
        capture(process.env?.NODE_ENV === 'production');
        capture(process.env?.NODE_ENV === 'development');
        capture(process?.env.NODE_ENV);
        capture(process?.env.NODE_ENV === 'production');
        capture(process?.env.NODE_ENV === 'development');
      `,
    },
    target: "browser",
    capture: ['"development"', "false", "true", '"development"', "false", "true", '"development"', "false", "true"],
    env: {
      NODE_ENV: "development",
    },
  });

  itBundled("edgecase/StarExternal", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from './foo';
        import { bar } from './bar';
        console.log(foo);
      `,
    },
    external: ["*"],
  });
  itBundled("edgecase/ImportNamespaceAndDefault", {
    files: {
      "/entry.js": /* js */ `
        import def2, * as ns2 from './c'
        console.log(def2, JSON.stringify(ns2))
      `,
      "/c.js": /* js */ `
        export const ns = 2
        export const def2 = 3
        export default 1
      `,
    },
    runtimeFiles: {},
    run: {
      stdout: '1 {"def2":3,"default":1,"ns":2}',
    },
  });
  itBundled("edgecase/ExternalES6ConvertedToCommonJSSimplified", {
    files: {
      "/entry.js": /* js */ `
        console.log(JSON.stringify(require('./e')));
      `,
      "/e.js": `export * from 'x'`,
    },
    external: ["x"],
    runtimeFiles: {
      "/node_modules/x/index.js": /* js */ `
        export const ns = 123
        export const ns2 = 456
      `,
    },
    run: {
      stdout: `
        {"ns":123,"ns2":456}
      `,
    },
  });
  itBundled("edgecase/ImportTrailingSlash", {
    files: {
      "/entry.js": /* js */ `
        import "slash/"
      `,
      "/node_modules/slash/index.js": /* js */ `console.log(1)`,
    },
    run: {
      stdout: "1",
    },
  });
  itBundled("edgecase/ValidLoaderSeenAsInvalid", {
    files: {
      "/entry.js": /* js */ `console.log(1)`,
    },
    outdir: "/out",
    loader: {
      ".a": "file",
      ".b": "text",
      ".c": "toml",
      ".d": "json",
      ".e": "js",
      ".f": "ts",
      ".g": "jsx",
      ".h": "tsx",
      // ".i": "wasm",
      // ".j": "napi",
      // ".k": "base64",
      // ".l": "dataurl",
      // ".m": "binary",
      // ".n": "empty",
      // ".o": "copy",
    },
  });
  itBundled("edgecase/InvalidLoaderSegfault", {
    files: {
      "/entry.js": /* js */ `console.log(1)`,
    },
    outdir: "/out",
    backend: "cli",
    loader: {
      ".cool": "wtf",
    },
    bundleErrors: {
      "<bun>": ['invalid loader "wtf", expected one of:'],
    },
  });
  itBundled("edgecase/ScriptTagEscape", {
    todo: true, // string printer needs to escape "</script" (and "<!--") in emitted literals; touches the hot-path SIMD escaper
    files: {
      "/entry.js": /* js */ `
        console.log('<script></script>');
        console.log(await import('./text-file.txt'))
      `,
      "/text-file.txt": /* txt */ `
        <script></script>
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      try {
        expect(api.readFile("/out/entry.js")).not.toContain("</script>");
      } catch (error) {
        console.error("Bundle contains </script> which will break if this bundle is placed in a script tag.");
        throw error;
      }
    },
  });
  itBundled("edgecase/JSONDefaultImport", {
    files: {
      "/entry.js": /* js */ `
        import def from './test.json'
        console.log(JSON.stringify(def))
      `,
      "/test.json": `{ "hello": 234, "world": 123 }`,
    },
    run: {
      stdout: '{"hello":234,"world":123}',
    },
  });
  itBundled("edgecase/JSONDefaultKeyImport", {
    files: {
      "/entry.js": /* js */ `
        import def from './test.json'
        console.log(def.hello)
      `,
      "/test.json": `{ "hello": 234, "world": "REMOVE" }`,
    },
    run: {
      stdout: "234",
    },
  });
  itBundled("edgecase/JSONDefaultAndNamedImport", {
    todo: true, // requires per-property tree-shaking on the JSON default object when only some keys are read
    files: {
      "/entry.js": /* js */ `
        import def from './test.json'
        import { hello } from './test.json'
        console.log(def.hello, hello)
      `,
      "/test.json": `{ "hello": 234, "world": "REMOVE" }`,
    },
    dce: true,
    run: {
      stdout: "234 234",
    },
  });
  itBundled("edgecase/JSONWithDefaultKey", {
    files: {
      "/entry.js": /* js */ `
        import def from './test.json'
        console.log(JSON.stringify(def))
      `,
      "/test.json": `{ "default": 234 }`,
    },
    dce: true,
    run: {
      stdout: '{"default":234}',
    },
  });
  itBundled("edgecase/JSONWithDefaultKeyNamespace", {
    todo: true, // semantics undecided: namespace import of JSON currently yields {default: <object>} (matches Node ESM); test expects the raw object
    files: {
      "/entry.js": /* js */ `
        import * as ns from './test.json'
        console.log(JSON.stringify(ns))
      `,
      "/test.json": `{ "default": 234 }`,
    },
    dce: true,
    run: {
      stdout: '{"default":234}',
    },
  });
  itBundled("edgecase/RequireUnknownExtension", {
    files: {
      "/entry.js": /* js */ `
        require('./x.aaaa')
      `,
      "/x.aaaa": `x`,
    },
    outdir: "/out",
  });
  itBundled("edgecase/PackageJSONDefaultConditionRequire", {
    files: {
      "/entry.js": /* js */ `
        const boop = require('boop')
        console.log(boop)
      `,
      "/node_modules/boop/package.json": /* json */ `
        {
          "name": "boop",
          "exports": {
            ".": {
              "boop-server": "./ignore.js",
              "default": "./boop.js"
            }
          }
        }
      `,
      "/node_modules/boop/boop.js": /* js */ `
        module.exports = 123
      `,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("edgecase/PackageJSONDefaultConditionImport", {
    files: {
      "/entry.js": /* js */ `
        import React from 'boop'
        console.log(React)
      `,
      // NOTE: this test fails if the package name is "react"
      // most likely an issue with commonjs unwrapping.
      "/node_modules/boop/package.json": /* json */ `
        {
          "name": "boop",
          "exports": {
            ".": {
              "react-server": "./ignore.js",
              "default": "./boop.js"
            }
          }
        }
      `,
      "/node_modules/boop/boop.js": /* js */ `
        export default 123
      `,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("edgecase/TSConfigPathsStarOnlyInLeft", {
    files: {
      "/entry.ts": /* ts */ `
        import test0 from 'test0/hello'
        console.log(test0)
      `,
      "/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "test0/*": ["./test0-success.ts"]
            }
          }
        }
      `,
      "/test0-success.ts": `export default 'success'`,
    },
    run: {
      stdout: "success",
    },
  });
  itBundled("edgecase/TSConfigPathStarAnywhere", {
    files: {
      "/entry.ts": /* ts */ `
        import test0 from 'test3/foo'
        console.log(test0)
      `,
      "/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "t*t3/foo": ["./test3-succ*s.ts"],
            }
          }
        }
      `,
      "/test3-success.ts": `export default 'success'`,
    },
    run: {
      stdout: "success",
    },
  });
  itBundled("edgecase/TSConfigPathStarBareTargetSlashMatch", {
    // Key prefix without a trailing "/" — matched_text starts with "/", but
    // the target template is relative so the substituted result must still
    // join against baseUrl (not be treated as filesystem-absolute).
    files: {
      "/entry.ts": /* ts */ `
        import x from "~/util";
        console.log(x);
      `,
      "/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": "./packages",
            "paths": { "~*": ["*"] }
          }
        }
      `,
      "/packages/util.ts": `export default "ok";`,
    },
    run: { stdout: "ok" },
  });

  itBundled("edgecase/TSConfigPathAbsoluteTemplateNormalized", {
    // An absolute target template (here via ${configDir}) must be normalized
    // after substitution so it resolves to the same module instance as a
    // relative import of the file (no `/proj//src/...` duplicate).
    files: {
      "/entry.ts": /* ts */ `
        import { inc } from "@lib/state";
        import { count } from "./src/lib/state";
        inc();
        console.log(count);
      `,
      "/tsconfig.json": /* json */ `
        { "compilerOptions": { "paths": { "@lib/*": ["\${configDir}//src/lib/*"], "@up/*": ["\${configDir}/src/../src/lib/*"] } } }
      `,
      "/src/lib/state.ts": `export let count = 0; export function inc() { count++; } console.log("evaluated");`,
      "/entry2.ts": `import { inc } from "@up/state"; import { count } from "./src/lib/state"; inc(); console.log(count);`,
    },
    entryPoints: ["/entry.ts", "/entry2.ts"],
    outdir: "/out",
    run: [
      { file: "/out/entry.js", stdout: "evaluated\n1" },
      { file: "/out/entry2.js", stdout: "evaluated\n1" },
    ],
  });

  itBundled("edgecase/StaticClassNameIssue2806", {
    files: {
      "/entry.ts": /* ts */ `
        new class C {
          set baz(x) {
            C.foo = x;
            C.bar;
          }
          static get bar() {
            console.log(C.foo);
          }
        }().baz = "PASS";

        new class C {
          set baz(x) {
            C.foo = x;
            C.bar;
          }
          static get bar() {
            console.log(C.foo);
          }
        }().baz = "Hello World";
      `,
    },
    minifyIdentifiers: true,
    run: {
      stdout: "PASS\nHello World",
    },
  });
  itBundled("edgecase/DCEVarRedeclarationIssue2814A", {
    files: {
      "/entry.ts": /* ts */ `
        var a = 1;
        if (false) {
          var a;
        }
        console.log(a);
      `,
    },
    target: "bun",
    run: {
      stdout: `1`,
    },
  });
  itBundled("edgecase/DCEVarRedeclarationIssue2814B", {
    files: {
      "/entry.ts": /* ts */ `
        var a = 1;
        switch ("foo") {
          case "foo":
            var a;
        }
        console.log(a);
      `,
    },
    target: "bun",
    run: {
      stdout: `1`,
    },
  });
  itBundled("edgecase/DCEVarRedeclarationIssue2814C", {
    files: {
      "/entry.ts": /* ts */ `
        "use strict";
        var a = 1;
        {
          var a;
        }
        console.log(a);
      `,
    },
    target: "bun",
    run: {
      stdout: `1`,
    },
  });
  itBundled("edgecase/DCEVarRedeclarationIssue2814", {
    files: {
      "/entry.ts": /* ts */ `
        "use strict";
        var a = 1, b = 2;
        switch (b++) {
          case b:
            var c = a;
            var a;
            break;
        }
        console.log(a);

        var x = 123, y = 45;
        switch (console) {
          case 456:
            var x = 789, y = 0;
        }
        var y = 67;
        console.log(x, y);

        var z = 123;
        switch (console) {
          default:
            var z = typeof z;
        }
        console.log(z);

        var A = 1, B = 2;
        switch (A) {
          case A:
            var B;
            break;
          case B:
            break;
        }
        console.log(B);
      `,
    },
    target: "bun",
    run: {
      stdout: `
        1
        123 67
        number
        2
      `,
    },
  });
  itBundled("edgecase/DCEVarRedeclarationIssue2815", {
    files: {
      "/entry.ts": /* ts */ `
        var x = 1;
        try {
          console.blog;
        } catch (x) {
          var x = 2;
        }
        console.log(x);

        var e = 3;
        try {
          console.log("try2");
        } catch (e) {
          var e = 4;
        }
        console.log(e);

        try {
          var z = 5;
          throw "try3";
        } catch (w) {
          z += w;
          var w = 6;
        }
        console.log(z);

        var c = 8;
        try {
          "try4";
        } catch (c) {
          var c = 9;
        }
        console.log(c);
      `,
    },
    target: "bun",
    run: {
      stdout: `
        1
        try2
        3
        5try3
        8
      `,
    },
  });
  // https://github.com/oven-sh/bun/issues/30271
  //
  // When dead-code elimination prunes an if/else body, the scaffolding
  // itself only collapses with --minify-syntax. Even so, the empty `else {}`
  // remnant produced by the prune is ugly — trim it so the output at least
  // says `if (true) { kept }` instead of `if (true) { kept } else {}`.
  itBundled("edgecase/DCEEmptyElseTrimmed#30271", {
    files: {
      "/entry.js": /* js */ `
        if ("foo" === "foo") {
          console.log("success");
        } else {
          console.log("fail");
        }
      `,
    },
    target: "bun",
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // The dead branch body is gone...
      expect(out).not.toContain("fail");
      // ...and so is the empty `else {}` remnant.
      expect(out).not.toContain("else");
    },
    run: {
      stdout: "success",
    },
  });
  // Trimming the empty `else {}` from an inner labeled `if` used to drop the
  // dangling-else guard: `if (a) L: if (b) c(); else {} else d();` would print
  // as `if (a) L: if (b) c(); else d();`, re-binding `else d()` to the inner
  // `if (b)`. `wrapToAvoidAmbiguousElse` needs to traverse `.s_label`.
  itBundled("edgecase/DCEEmptyElseTrimmedLabeledDanglingElse#30271", {
    files: {
      "/entry.js": /* js */ `
        var a = false, b = false;
        if (a)
          L: if (b) console.log("inner-then");
          else {}
        else console.log("outer-else");
      `,
    },
    target: "bun",
    run: {
      stdout: "outer-else",
    },
  });
  itBundled("edgecase/AbsolutePathShouldNotResolveAsRelative", {
    files: {
      "/entry.js": /* js */ `
        console.log(1);
      `,
    },
    entryPointsRaw: ["/entry.js"],
    bundleErrors: {
      "<bun>": ['ModuleNotFound resolving "/entry.js" (entry point)'],
    },
  });
  itBundled("edgecase/AssetEntryPoint", {
    files: {
      "/entry.zig": `
        const std = @import("std");

        pub fn main() void {
          std.log.info("Hello, world!\\n", .{});
        }
      `,
    },
    outdir: "/out",
    entryPointsRaw: ["./entry.zig"],
    runtimeFiles: {
      "/exec.js": `
        import assert from 'node:assert';
        import the_path from './out/entry.js';
        assert.strictEqual(the_path, './entry-z5artd5z.zig');
      `,
    },
    run: {
      file: "./exec.js",
    },
  });
  itBundled("edgecase/ExportDefaultUndefined", {
    files: {
      "/entry.ts": /* ts */ `
        export const a = 1;
      `,
    },
    target: "bun",
  });
  itBundled("edgecase/RuntimeExternalRequire", {
    files: {
      "/entry.ts": /* ts */ `
        console.log(require("hello-1").type);
      `,
    },
    external: ["hello-1"],
    target: "bun",
    runtimeFiles: {
      "/node_modules/hello-1/require.js": `export const type = "require";`,
      "/node_modules/hello-1/package.json": /* json */ `
        {
          "type": "module",
          "exports": {
            ".": {
              "require": "./require.js",
            }
          }
        }
      `,
    },
    run: {
      stdout: `
        require
      `,
    },
  });
  itBundled("edgecase/RuntimeExternalImport", {
    todo: true, // depends on runtime export-condition priority ("bun" vs first-match-wins); not a bundler bug
    files: {
      "/entry.ts": /* ts */ `
        import { type as a1 } from 'hello-1';
        import { type as a2 } from 'hello-2';
        import { type as a3 } from 'hello-3';
        console.log(a1, a2, a3);

        const b1 = require('hello-1').type;
        const b2 = require('hello-2').type;
        const b3 = require('hello-3').type;
        console.log(b1, b2, b3);
      `,
    },
    external: ["hello-1", "hello-2", "hello-3"],
    target: "bun",
    runtimeFiles: {
      "/node_modules/hello-1/node.js": `export const type = "node";`,
      "/node_modules/hello-1/bun.js": `export const type = "bun";`,
      "/node_modules/hello-1/package.json": /* json */ `
        {
          "type": "module",
          "exports": {
            ".": {
              "node": "./node.js",
              "bun": "./bun.js"
            }
          }
        }
      `,
      "/node_modules/hello-2/node.js": `export const type = "node";`,
      "/node_modules/hello-2/bun.js": `export const type = "bun";`,
      "/node_modules/hello-2/package.json": /* json */ `
        {
          "type": "module",
          "exports": {
            ".": {
              "bun": "./bun.js",
              "node": "./node.js"
            }
          }
        }
      `,
      "/node_modules/hello-3/import.js": `export const type = "import";`,
      "/node_modules/hello-3/require.js": `exports.type = "require";`,
      "/node_modules/hello-3/package.json": /* json */ `
        {
          "type": "module",
          "exports": {
            ".": {
              "require": "./require.js",
              "import": "./import.js",
            }
          }
        }
      `,
    },
    run: {
      stdout: `
        bun bun import
        bun bun import
      `,
    },
  });
  itBundled("edgecase/RuntimeExternalImport2", {
    todo: true, // fixture has no default export; expectation needs revisiting (runtime resolver behavior, not bundler)
    files: {
      "/entry.ts": /* ts */ `
        import t from 'hello';
        console.log(t);
      `,
    },
    external: ["hello"],
    target: "bun",
    runtimeFiles: {
      "/node_modules/hello/index.js": /* js */ `
        export const hello = "Hello World";
      `,
    },
    run: {
      stdout: "Hello World",
    },
  });
  itBundled("edgecase/AssetPublicPath", {
    files: {
      "/entry.ts": /* ts */ `
        import hello from "./hello.file";
        console.log(hello);
      `,
      "/hello.file": "Hello World",
    },
    outdir: "/out",
    publicPath: "/www",
    run: {},
  });
  itBundled("edgecase/PublicPathNestedChunkReferences", {
    files: {
      "/src/pages/a/entry.ts": /* ts */ `
        import { shared } from "../../shared";
        import logo from "../../logo.svg";
        console.log(shared(), logo);
      `,
      "/src/pages/b/entry.ts": /* ts */ `
        import { shared } from "../../shared";
        console.log(shared());
      `,
      "/src/shared.ts": /* ts */ `
        import icon from "./icon.svg";
        export const shared = () => icon;
      `,
      "/src/icon.svg": `<svg id="icon" />`,
      "/src/logo.svg": `<svg id="logo" />`,
    },
    entryPoints: ["/src/pages/a/entry.ts", "/src/pages/b/entry.ts"],
    outputPaths: ["/out/pages/a/entry.js", "/out/pages/b/entry.js"],
    root: "/src",
    outdir: "/out",
    splitting: true,
    publicPath: CDN_PUBLIC_PATH,
    chunkNaming: "chunk-[hash].[ext]",
    loader: { ".svg": "file" },
    onAfterBundle(api) {
      // The nested entry references the shared chunk and its own asset. Both
      // must resolve under the public path, not above it.
      const nested = cdnUrls(api.readFile("out/pages/a/entry.js")).map(url => url.slice(CDN_PUBLIC_PATH.length));
      expect(nested.sort()).toEqual([
        expect.stringMatching(/^chunk-[a-z0-9]+\.js$/),
        expect.stringMatching(/^logo-[a-z0-9]+\.svg$/),
      ]);
      for (const rel of nested) {
        api.assertFileExists(join("out", rel));
      }

      // The root-level chunk emits the same form in the same build.
      const chunks = readdirSync(api.outdir).filter(file => file.endsWith(".js"));
      expect(chunks).toHaveLength(1);
      const rootLevel = cdnUrls(api.readFile(join("out", chunks[0]))).map(url => url.slice(CDN_PUBLIC_PATH.length));
      expect(rootLevel).toEqual([expect.stringMatching(/^icon-[a-z0-9]+\.svg$/)]);
      api.assertFileExists(join("out", rootLevel[0]));
    },
  });
  itBundled("edgecase/PublicPathNestedEntryAsset", {
    files: {
      "/src/pages/a/entry.ts": /* ts */ `
        import logo from "../../logo.svg";
        console.log(logo);
      `,
      "/src/logo.svg": `<svg id="logo" />`,
    },
    entryPoints: ["/src/pages/a/entry.ts"],
    outputPaths: ["/out/pages/a/entry.js"],
    root: "/src",
    outdir: "/out",
    publicPath: CDN_PUBLIC_PATH,
    loader: { ".svg": "file" },
    onAfterBundle(api) {
      const urls = cdnUrls(api.readFile("out/pages/a/entry.js")).map(url => url.slice(CDN_PUBLIC_PATH.length));
      expect(urls).toEqual([expect.stringMatching(/^logo-[a-z0-9]+\.svg$/)]);
      api.assertFileExists(join("out", urls[0]));
    },
  });
  itBundled("edgecase/NoPublicPathNestedChunkStaysRelative", {
    files: {
      "/src/pages/a/entry.ts": /* ts */ `
        import { shared } from "../../shared";
        console.log(shared());
      `,
      "/src/pages/b/entry.ts": /* ts */ `
        import { shared } from "../../shared";
        console.log(shared());
      `,
      "/src/shared.ts": `export const shared = () => "shared";`,
    },
    entryPoints: ["/src/pages/a/entry.ts", "/src/pages/b/entry.ts"],
    outputPaths: ["/out/pages/a/entry.js", "/out/pages/b/entry.js"],
    root: "/src",
    outdir: "/out",
    splitting: true,
    chunkNaming: "chunk-[hash].[ext]",
    onAfterBundle(api) {
      api.expectFile("out/pages/a/entry.js").toMatch(/from "\.\.\/\.\.\/chunk-[a-z0-9]+\.js"/);
    },
  });
  itBundled("edgecase/ImportDefaultInDirectory", {
    files: {
      "/a/file.js": `
        import def from './def'
        console.log(def)
      `,
      "/a/def.js": `
        export default 1;
        console.log('inner');
      `,
    },
    run: {
      file: "/out.js",
      stdout: "inner\n1",
    },
  });
  itBundled("edgecase/RequireVarThenExport", {
    files: {
      "/entry.js": /* js */ `
        import { version } from './react';
        console.log(version);
      `,
      "/react.js": /* js */ `
        const a = require('./library.js');
        exports.version = a.version;
      `,
      "/library.js": /* js */ `
        exports.version = '0.6.0';
      `,
    },
    target: "bun",
    run: {
      stdout: `0.6.0`,
    },
  });
  itBundled("edgecase/OverwriteInputWithOutdir", {
    todo: true, // bundler does not yet detect output paths that overwrite inputs
    files: {
      "/entry.js": /* js */ `
        import { version } from './library';
        console.log(version);
      `,
      "/library.js": /* js */ `
        exports.version = '0.6.0';
      `,
    },
    outdir: "/",
    bundleErrors: {
      "<bun>": ['Refusing to overwrite input file "/entry.js"'],
    },
  });
  itBundled("edgecase/OverwriteInputWithOutfile", {
    todo: true, // bundler does not yet detect output paths that overwrite inputs
    files: {
      "/entry.js": /* js */ `
        import { version } from './library';
        console.log(version);
      `,
      "/library.js": /* js */ `
        exports.version = '0.6.0';
      `,
    },
    outfile: "/entry.js",
    bundleErrors: {
      "<bun>": ['Refusing to overwrite input file "/entry.js"'],
    },
  });
  itBundled("edgecase/OverwriteInputNonEntrypoint", {
    todo: true, // bundler does not yet detect output paths that overwrite inputs
    files: {
      "/entry.js": /* js */ `
        import { version } from './library';
        console.log(version);
      `,
      "/library.js": /* js */ `
        exports.version = '0.6.0';
      `,
    },
    outfile: "/entry.js",
    bundleErrors: {
      "<bun>": ['Refusing to overwrite input file "/entry.js"'],
    },
  });
  itBundled("edgecase/ModuleExportsFunctionIssue2911", {
    files: {
      "/entry.js": /* js */ `
         const fn = require('fresh');
         console.log(fn());
         const fn2 = require('./not_in_node_modules');
         console.log(fn2());
         import fn3 from 'fresh';
         console.log(fn());
         import fn4 from './not_in_node_modules';
         console.log(fn2());
       `,
      "/node_modules/fresh/index.js": /* js */ `
         module.exports = function() {
           return 'it worked';
         }
       `,
      "/not_in_node_modules.js": /* js */ `
         module.exports = function() {
           return 'it worked';
         }
       `,
    },
    run: {
      stdout: "it worked\nit worked\nit worked\nit worked",
    },
  });
  itBundled("edgecase/IsBuffer1", {
    files: {
      "/entry.js": /* js */ `
        import isBuffer from 'lodash-es/isBuffer';
        if(isBuffer !== 1) throw 'fail';
        console.log('pass');
      `,
      "/node_modules/lodash-es/isBuffer.js": /* js */ `
        var freeExports = typeof exports == 'object';
        // this is using the 'freeExports' variable but giving a predictable outcome
        const isBuffer = freeExports ? 1 : 1;
        export default isBuffer;
      `,
    },
    run: {
      stdout: "pass",
    },
  });
  itBundled("edgecase/TS_LessThanAmbiguity", {
    files: {
      "/entry.ts": `
        function expectArrow(item) {
          if(typeof item !== 'function') {
            throw new Error('Expected arrow function');
          }
        }
        function expectTypeCast(item) {
          if(typeof item !== 'number') {
            throw new Error('Expected arrow function');
          }
        }
        const x = 1;
        expectTypeCast(<A>(x));
        expectTypeCast(<[]>(x));
        expectTypeCast(<A[]>(x));

        expectArrow(<A>(x) => {})
        expectArrow(<A, B>(x) => {})
        expectArrow(<A = B>(x) => {})
        expectArrow(<A extends B>(x) => {})
        expectArrow(<const A extends B>(x) => {})

        console.log('pass');
      `,
    },
    run: {
      stdout: "pass",
    },
  });
  itBundled("edgecase/TSX_LessThanAmbiguity", {
    files: {
      "/entry.tsx": `
        function expectJSX(item) {
          if(typeof item !== 'object') {
            throw new Error('Expected JSX');
          }
        }
        function expectArrow(item) {
          if(typeof item !== 'function') {
            throw new Error('Expected arrow function');
          }
        }

        const A = 1;
        expectJSX(<A>(x) ...</A>);
        expectJSX(<A extends>(x) ... </A>);
        expectJSX(<A extends={false}>(x) ... </A>);
        expectJSX(<const A extends>(x) ...</const>);
        expectJSX(<const extends T>(x) ...</const>);
        expectJSX(<const A B>(x) ...</const>);
        expectJSX(<const A B C>(x) ...</const>);

        expectArrow(<A, B>(x) => {});
        expectArrow(<A extends B>(x) => {});
        expectArrow(<const A extends B>(x) => {});

        console.log('pass');
      `,
      "/node_modules/react/jsx-dev-runtime.js": `
        export function jsxDEV(type, props, key, isStaticChildren, source, self) {
          return {};
        }
      `,
    },
    run: {
      stdout: "pass",
    },
  });
  itBundled("edgecase/IsBuffer2", {
    files: {
      "/entry.js": /* js */ `
        import isBuffer from 'lodash-es/isBuffer';
        if(isBuffer !== 1) throw 'fail';
        console.log('pass');
      `,
      "/node_modules/lodash-es/package.json": /* json */ `
        { "name": "lodash-es", "type": "module"}
      `,
      "/node_modules/lodash-es/isBuffer.js": /* js */ `
        var freeExports = typeof exports == 'object' && exports && !exports.nodeType && exports;
        var freeModule = freeExports && typeof module == 'object' && module && !module.nodeType && module;

        // this is using the 'freeExports' variable but giving a predictable outcome
        const isBuffer = [freeExports, freeModule] ? 1 : 1;
        export default isBuffer;
      `,
    },
    run: {
      stdout: "pass",
    },
  });
  itBundled("edgecase/YieldKeyword", {
    files: {
      "/entry.js": /* js */ `
        function* foo() {
          yield 1;
          [yield];
          yield yield yield;
          [yield * 2];
          [yield (yield)];
          { x: yield };
          (yield).hello
          yield+1
        }
      `,
    },
  });
  itBundled("edgecase/UsingWithSixImports", {
    files: {
      "/entry.js": /* js */ `
        import { Database } from 'bun:sqlite';

        import 'bun';
        import 'bun:ffi';
        import 'bun:jsc';
        import 'node:assert';
        import 'bun:test';

        using a = new Database();

        export { a };
      `,
    },
    target: "bun",
  });
  itBundled("edgecase/EmitInvalidSourceMap1", {
    files: {
      "/src/index.ts": /* ts */ `
        const y = await import("./second.mts");
        import * as z from "./third.mts";
        const v = await import("./third.mts");
        console.log(z, v, y);
      `,
      "/src/second.mts": /* ts */ `
        export default "swag";
      `,
      "/src/third.mts": /* ts */ `
        export default "bun";
      `,
    },
    outdir: "/out",
    target: "bun",
    sourceMap: "external",
    minifySyntax: true,
    minifyIdentifiers: true,
    minifyWhitespace: true,
    splitting: true,
  });
  // chunk-concat weaved mappings together incorrectly causing the `console`
  // token to be -2, thus breaking the rest of the mappings in the file
  itBundled("edgecase/EmitInvalidSourceMap2", {
    files: {
      "/entry.js": `
        import * as react from "react";
        console.log(react);
      `,
      "/node_modules/react/index.js": `
        var _ = module;
        sideEffect(() =>   {});
      `,
    },
    outdir: "/out",
    sourceMap: "external",
    minifySyntax: true,
    minifyIdentifiers: true,
    minifyWhitespace: true,
    snapshotSourceMap: {
      "entry.js.map": {
        files: ["../node_modules/react/index.js", "../entry.js"],
        mappingsExactMatch: "inBACA,WAAW,IAAQ,EAAE,ICDrB,aACA,QAAQ,IAAI,CAAK",
      },
    },
  });
  // chunk-concat forgets to de-duplicate source indicies
  // chunk-concat ignores all but the first instance of a chunk
  itBundled("edgecase/EmitInvalidSourceMap2", {
    files: {
      "/entry.js": `
        const a = new TextEncoder();
        console.log('hey!')
        const d = new TextEncoder();

        const b = { hello: 'world' };

        const c = new Set([
        ]);
        console.log('hey!')
        console.log('hey!')
        console.log('hey!')
        console.log('hey!')
      `,
    },
    outdir: "/out",
    sourceMap: "external",
    minifySyntax: true,
    minifyIdentifiers: true,
    minifyWhitespace: true,
    snapshotSourceMap: {
      "entry.js.map": {
        files: ["../entry.js"],
        mappingsExactMatch:
          "AACQ,QAAQ,IAAI,MAAM,EAOlB,QAAQ,IAAI,MAAM,EAClB,QAAQ,IAAI,MAAM,EAClB,QAAQ,IAAI,MAAM,EAClB,QAAQ,IAAI,MAAM",
      },
    },
  });
  // SourceMapPieces.finalize advanced the shift cursor at most once per
  // mapping, so a mapping crossing >=2 placeholder substitutions on one
  // minified line was re-encoded against a stale shift and landed out of order.
  itBundled("edgecase/EmitInvalidSourceMapMultipleShifts", {
    files: {
      "/entry.ts": /* ts */ `
        import a from "./a.bin";
        import b from "./b.bin";
        import c from "./c.bin";
        const keep: string[] = [a, b, c];
        console.log(keep);
      `,
      "/a.bin": "AAAA",
      "/b.bin": "BBBB",
      "/c.bin": "CCCC",
    },
    outdir: "/out",
    loader: { ".bin": "file" },
    sourceMap: "external",
    minifyWhitespace: true,
    onAfterBundle(api) {
      const js = api.readFile("/out/entry.js");
      const map = JSON.parse(api.readFile("/out/entry.js.map"));
      expect(map.sources).toEqual(["../entry.ts"]);
      const line1 = decodeSourceMappingsLine(map.mappings.split(";")[0]);
      for (let i = 1; i < line1.length; i++) {
        if (line1[i].gen < line1[i - 1].gen) {
          throw new Error(
            `out-of-order mappings on line 1: generated column ` +
              `${line1[i - 1].gen} -> ${line1[i].gen}\n` +
              line1.map(s => `  col ${s.gen} -> entry.ts:${s.ol + 1}:${s.oc}`).join("\n"),
          );
        }
      }
      // The first mapping after all three substituted asset paths is for
      // `keep` in `const keep`. It must point at the `keep` identifier in
      // the generated output, not at a stale pre-shift column.
      const keepCol = js.split("\n")[0].indexOf("keep=[");
      expect(keepCol).toBeGreaterThan(0);
      expect(line1).toContainEqual({ gen: keepCol, src: 0, ol: 3, oc: 6 });
    },
  });
  itBundled("edgecase/NoUselessConstructorTS", {
    files: {
      "/entry.ts": `
        class A {
          constructor(...args) {
            console.log(JSON.stringify({ args, self: this }));
          }
          field = 1;
        }
        class B extends A {}
        class C extends A { field = 2 }
        class D extends A { public field = 3 }
        class E extends A { constructor(public y: number, a) { super(a); }; public field = 4 }
        new A("arg1", "arg2");
        new B("arg1", "arg2");
        new C("arg1", "arg2");
        new D("arg1", "arg2");
        new E("arg1", "arg2");
      `,
    },
    run: {
      stdout: `
        {"args":["arg1","arg2"],"self":{"field":1}}
        {"args":["arg1","arg2"],"self":{"field":1}}
        {"args":["arg1","arg2"],"self":{"field":1}}
        {"args":["arg1","arg2"],"self":{"field":1}}
        {"args":["arg2"],"self":{"field":1}}
      `,
    },
    onAfterBundle(api) {
      const content = api.readFile("out.js");
      const count = content.split("constructor").length - 1;
      expect(count, "should only emit two constructors: " + content).toBe(2);
    },
  });
  itBundled("edgecase/EnumInliningRopeStringPoison", {
    files: {
      "/entry.ts": `
        const enum A1 {
          B = "1" + "2",
          C = "3" + B,
        };
        console.log(A1.B, A1.C);

        const enum A2 {
          B = "1" + "2",
          C = ("3" + B) + "4",
        };
        console.log(A2.B, A2.C);
      `,
    },
    run: {
      stdout: "12 312\n12 3124",
    },
  });
  // A member initialized with a concatenation is stored as a rope. Folding a
  // template literal that inlines it used to append the template's text onto
  // that rope, changing the member everywhere: its declaration, every inlined
  // use in the same file and every cross-module use.
  itBundled("edgecase/EnumInliningRopeStringTemplateLiteral", {
    files: {
      "/entry.ts": /* ts */ `
        import { Routes, users } from "./routes";
        enum Local {
          X = "x" + "y",
        }
        function tail(prefix: string) {
          return \`\${prefix}-\${Local.X}-z\`;
        }
        console.log(users);
        console.log(Routes.Base);
        console.log(\`\${Routes.Base}/posts\`);
        console.log(JSON.stringify(Routes));
        console.log(tail("p"));
        console.log(Local.X);
        console.log(JSON.stringify(Local));
      `,
      "/routes.ts": /* ts */ `
        export enum Routes {
          Base = "/api" + "/v1",
          Health = "/health",
        }
        export const users = \`\${Routes.Base}/users\`;
      `,
    },
    minifySyntax: true,
    run: {
      stdout: `
        /api/v1/users
        /api/v1
        /api/v1/posts
        {"Base":"/api/v1","Health":"/health"}
        p-xy-z
        xy
        {"X":"xy"}
      `,
    },
  });
  itBundled("edgecase/ProtoNullProtoInlining", {
    files: {
      "/entry.ts": `
        console.log({ __proto__: null }.__proto__ !== void 0)
      `,
    },
    run: {
      stdout: "false",
    },
  });
  itBundled("edgecase/ImportOptionsArgument", {
    files: {
      "/entry.js": `
        import('ext', { with: { get ''() { KEEP } } })
          .then(function (error) {
            console.log(error);
          });
      `,
    },
    dce: true,
    external: ["ext"],
    target: "bun",
  });
  itBundled("edgecase/ConstantFoldingShiftOperations", {
    files: {
      "/entry.ts": `
        capture(421 >> -542)
        capture(421 >>> -542)
        capture(1 << 32)
        capture(1 >> 32)
        capture(1 >>> 32)
        capture(47849312 << 34)
        capture(-9 >> 1)
        capture(-5 >> 1)
      `,
    },
    minifySyntax: true,
    capture: ["105", "105", "1", "1", "1", "191397248", "-5", "-3"],
  });
  itBundled("edgecase/ConstantFoldingBitwiseCoersion", {
    files: {
      "/entry.ts": `
        capture(0 | 0)
        capture(12582912 | 0)
        capture(0xc00000 | 0)
        capture(Infinity | 0)
        capture(-Infinity | 0)
        capture(NaN | 0)
        // u32 limits
        capture(-4294967295 | 0)
        capture(-4294967296 | 0)
        capture(-4294967297 | 0)
        capture(4294967295 | 0)
        capture(4294967296 | 0)
        capture(4294967297 | 0)
        // i32 limits
        capture(-2147483647 | 0)
        capture(-2147483648 | 0)
        capture(-2147483649 | 0)
        capture(2147483647 | 0)
        capture(2147483648 | 0)
        capture(2147483649 | 0)
        capture(0.5 | 0)
      `,
    },
    minifySyntax: true,
    capture: [
      "0",
      "12582912",
      "12582912",
      "0",
      "0",
      "0",
      "1",
      "0",
      "-1",
      "-1",
      "0",
      "1",
      "-2147483647",
      "-2147483648",
      "2147483647",
      "2147483647",
      "-2147483648",
      "-2147483647",
      "0",
    ],
  });
  itBundled("edgecase/EnumInliningNanBoxedEncoding", {
    files: {
      "/main.ts": `
        import { Enum } from './other.ts';
        capture(Enum.a);
        capture(Enum.b);
        capture(Enum.c);
        capture(Enum.d);
        capture(Enum.e);
        capture(Enum.f);
        capture(Enum.g);
      `,
      "/other.ts": `
        export const enum Enum {
          a = 0,
          b = NaN,
          c = (0 / 0) + 1,
          d = Infinity,
          e = -Infinity,
          f = 3e450,
          // https://float.exposed/0xffefffffffffffff
          g = -1.79769313486231570815e+308,
        }
      `,
    },
    minifySyntax: true,
    capture: [
      "0 /* a */",
      "NaN /* b */",
      "NaN /* c */",
      "1 / 0 /* d */",
      "-1 / 0 /* e */",
      "1 / 0 /* f */",
      // should probably fix this
      "-179769313486231570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000 /* g */",
    ],
  });
  // Stack overflow possibility
  itBundled("edgecase/AwsCdkLib", {
    files: {
      "entry.js": `import * as aws from ${JSON.stringify(require.resolve("aws-cdk-lib"))}; aws;`,
    },
    target: "bun",
    run: true,
    timeoutScale: 5,
  });
  itBundled("edgecase/PackageExternalDoNotBundleNodeModules", {
    files: {
      "/entry.ts": /* ts */ `
        import { a } from "foo";
        console.log(a);
      `,
    },
    packages: "external",
    target: "bun",
    runtimeFiles: {
      "/node_modules/foo/index.js": `export const a = "Hello World";`,
      "/node_modules/foo/package.json": /* json */ `
        {
          "name": "foo",
          "version": "2.0.0",
          "main": "index.js"
        }
      `,
    },
    run: {
      stdout: `
        Hello World
      `,
    },
  });
  // #29590: a catch-all `paths` entry (common for ambient .d.ts stubs)
  // whose target doesn't exist must not defeat `packages=external`.
  itBundled("edgecase/PackageExternalStarPathsDoesNotBundleNodeModules#29590", {
    files: {
      "/entry.ts": /* ts */ `
        import { a } from "foo";
        console.log(a);
      `,
      "/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": { "*": ["./types/*"] }
          }
        }
      `,
    },
    packages: "external",
    target: "bun",
    runtimeFiles: {
      "/node_modules/foo/index.js": `export const a = "Hello World";`,
      "/node_modules/foo/package.json": /* json */ `
        {
          "name": "foo",
          "version": "2.0.0",
          "main": "index.js"
        }
      `,
    },
    onAfterBundle(api) {
      // If this regresses, `foo` gets inlined via __commonJS(...) instead.
      api.expectFile("/out.js").toContain(`from "foo"`);
    },
    run: {
      stdout: `
        Hello World
      `,
    },
  });
  // #29590: an explicit --external wildcard must win over a tsconfig `paths`
  // alias, even when the alias resolves to a real local file.
  itBundled("edgecase/ExternalWildcardBeatsTSConfigPaths#29590", {
    files: {
      "/entry.ts": /* ts */ `
        import { add } from "@/src/adder";
        console.log(add(1, 2));
      `,
      "/src/adder.ts": /* ts */ `
        export const add = (a: number, b: number) => a + b;
      `,
      "/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "baseUrl": ".",
            "paths": { "@/*": ["./*"] }
          }
        }
      `,
    },
    packages: "external",
    external: ["@/src/*"],
    target: "bun",
    onAfterBundle(api) {
      // If this regresses, `add` gets inlined from src/adder.ts.
      api.expectFile("/out.js").toContain(`from "@/src/adder"`);
      api.expectFile("/out.js").not.toContain(`= (a, b) => a + b`);
    },
  });
  itBundled("edgecase/EntrypointWithoutPrefixSlashOrDotIsNotConsideredExternal#12734", {
    files: {
      "/src/entry.ts": /* ts */ `
        import { helloWorld } from "./second.ts";
        console.log(helloWorld);
      `,
      "/src/second.ts": /* ts */ `
        export const helloWorld = "Hello World";
      `,
    },
    root: "/src",
    entryPointsRaw: ["src/entry.ts"],
    packages: "external",
    target: "bun",
    run: {
      file: "/src/entry.ts",
      stdout: `
        Hello World
      `,
    },
  });
  // Under --target bun/node the resolver returns a builtin as an external result. An entry point
  // has to be bundled, so that used to be scheduled as a file named after the specifier ("File not
  // found"). "bun:wrap" is the name the bundler registers its runtime under, so that one was dropped
  // instead and the build failed with no entry point named.
  itBundled("edgecase/EntryPointIsNodeBuiltinWithTargetBun", {
    files: {
      "/entry.ts": `console.log("never built");`,
    },
    entryPointsRaw: ["node:fs"],
    target: "bun",
    bundleErrors: {
      "<bun>": ['Cannot use "node:fs" as an entry point: it resolves to a builtin module'],
    },
  });
  itBundled("edgecase/EntryPointIsBareNodeBuiltinWithTargetNode", {
    files: {
      "/entry.ts": `console.log("never built");`,
    },
    entryPointsRaw: ["fs"],
    target: "node",
    bundleErrors: {
      "<bun>": ['Cannot use "fs" as an entry point: it resolves to a builtin module'],
    },
  });
  itBundled("edgecase/EntryPointIsBunWrap", {
    files: {
      "/entry.ts": `console.log("never built");`,
    },
    entryPointsRaw: ["bun:wrap"],
    target: "bun",
    bundleErrors: {
      "<bun>": ['Cannot use "bun:wrap" as an entry point: it resolves to a builtin module'],
    },
  });
  itBundled("edgecase/EntryPointIsBunBuiltinNextToRealEntryPoint", {
    files: {
      "/entry.ts": `console.log("built");`,
    },
    entryPoints: ["/entry.ts"],
    entryPointsRaw: ["bun"],
    outdir: "/out",
    target: "bun",
    bundleErrors: {
      "<bun>": ['Cannot use "bun" as an entry point: it resolves to a builtin module'],
    },
  });
  // A package.json "imports" entry that maps to a builtin resolves to the same external result.
  itBundled("edgecase/EntryPointIsImportsAliasOfBuiltin", {
    files: {
      "/package.json": `{ "name": "app", "imports": { "#fs": "node:fs" } }`,
      "/entry.ts": `console.log("never built");`,
    },
    entryPointsRaw: ["#fs"],
    target: "bun",
    bundleErrors: {
      "<bun>": ['Cannot use "#fs" as an entry point: it resolves to a builtin module'],
    },
  });
  // A bare entry point is retried as "./<name>" when it does not resolve to a package. A name that
  // is also a builtin takes the same retry instead of failing.
  itBundled("edgecase/EntryPointNamedLikeBuiltinIsALocalFile", {
    files: {
      "/util.ts": `console.log("local util");`,
    },
    entryPointsRaw: ["util"],
    target: "bun",
    onAfterBundle(api) {
      api.expectFile("/out/util.js").toContain("local util");
    },
  });
  // --external applies to imports, not to entry points (#12734 did this for the patterns). An exact
  // match on the entry point's package name used to come back as the same unbundleable external result.
  itBundled("edgecase/EntryPointIsExternalPackage", {
    files: {
      "/node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
      "/node_modules/pkg/index.js": `console.log("bundled pkg");`,
    },
    entryPointsRaw: ["pkg"],
    external: ["pkg"],
    target: "bun",
    onAfterBundle(api) {
      api.expectFile("/out/node_modules/pkg/index.js").toContain("bundled pkg");
    },
  });
  // An exact match on the entry point's own file resolved to an external result too. That one was
  // bundled, but without the package.json and tsconfig the normal resolution attaches.
  itBundled("edgecase/EntryPointIsExternalFile", {
    files: {
      "/entry.tsx": `console.log(<div />);`,
      "/tsconfig.json": `{ "compilerOptions": { "jsx": "react", "jsxFactory": "h" } }`,
    },
    external: ["./entry.tsx"],
    target: "bun",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("h(");
    },
  });
  // `bun build --compile --aot` resolves entry points with a resolver of its own, to the same answers.
  const itCompiledAheadOfTime = (id: string, opts: BundlerTestInput) =>
    (unsupported ? itBundled.skip : itBundled)(`edgecase/aot/${id}`, {
      target: "bun",
      compile: { aot: true },
      ...opts,
    });
  for (const [id, entryPoint] of [
    ["EntryPointIsNodeBuiltin", "node:fs"],
    ["EntryPointIsBareNodeBuiltin", "fs"],
    ["EntryPointIsBunWrap", "bun:wrap"],
  ]) {
    itCompiledAheadOfTime(id, {
      files: {
        "/entry.ts": `console.log("never built");`,
      },
      entryPointsRaw: [entryPoint],
      bundleErrors: {
        "<bun>": [`Cannot use "${entryPoint}" as an entry point: it resolves to a builtin module`],
      },
    });
  }
  itCompiledAheadOfTime("EntryPointIsBunBuiltinNextToRealEntryPoint", {
    // The API backend names every entry point after the outfile, which is an error of its own.
    backend: "cli",
    files: {
      "/entry.ts": `console.log("built");`,
    },
    entryPoints: ["/entry.ts"],
    entryPointsRaw: ["bun"],
    bundleErrors: {
      "<bun>": ['Cannot use "bun" as an entry point: it resolves to a builtin module'],
    },
  });
  itCompiledAheadOfTime("EntryPointIsImportsAliasOfBuiltin", {
    files: {
      "/package.json": `{ "name": "app", "imports": { "#fs": "node:fs" } }`,
      "/entry.ts": `console.log("never built");`,
    },
    entryPointsRaw: ["#fs"],
    bundleErrors: {
      "<bun>": ['Cannot use "#fs" as an entry point: it resolves to a builtin module'],
    },
  });
  itCompiledAheadOfTime("EntryPointNamedLikeBuiltinIsALocalFile", {
    files: {
      "/util.ts": `console.log("local util");`,
    },
    entryPointsRaw: ["util"],
    run: { file: "/out", stdout: "local util" },
  });
  itCompiledAheadOfTime("EntryPointIsExternalPackage", {
    files: {
      "/node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
      "/node_modules/pkg/index.js": `console.log("bundled pkg");`,
    },
    entryPointsRaw: ["pkg"],
    external: ["pkg"],
    run: { file: "/out", stdout: "bundled pkg" },
  });
  itBundled("edgecase/IntegerUnderflow#12547", {
    files: {
      "/entry.js": `
        import { a } from 'external';

        function func() {
            const b = 1 + a.c;
            return b;
        }
      `,
    },
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    external: ["external"],
    onAfterBundle(api) {
      // DCE is not yet able to eliminate the `a` or even the `as c`. Equivalent to esbuild as of 2024-07-15
      api.expectFile("/out.js").toBe(`import{a as c}from"external";\n`);
    },
  });
  itBundled("edgecase/TypeScriptNamespaceSiblingFunction", {
    files: {
      "/entry.ts": `
        namespace X {
          export function Y() {
            return 2;
          }
          export namespace Y {
            export const Z = 1;
          }
        }
        console.log(X, X.Y(), X.Y.Z);
      `,
    },
    run: {
      stdout: "{\n  Y: [Function: Y],\n} 2 1",
    },
  });
  itBundled("edgecase/TypeScriptNamespaceSiblingClass", {
    files: {
      "/entry.ts": `
        namespace X {
          export class Y {
            constructor(v) {
              this.value = v;
            }

            toJSON() {
              return this.value;
            }
          }
          export namespace Y {
            export const Z = 1;
          }
        }
        console.log(X, new X.Y(2).toJSON(), X.Y.Z);
      `,
    },
    run: {
      stdout: "{\n  Y: [class Y],\n} 2 1",
    },
  });
  itBundled("edgecase/TypeScriptNamespaceSiblingEnum", {
    files: {
      "/entry.ts": `
        namespace X {
          export enum Y {
            A,
            B,
          }
          export namespace Y {
            export const Z = 1;
          }
        }
        console.log(JSON.stringify([X, X.Y.A, X.Y.Z]));
      `,
    },
    run: {
      stdout: '[{"Y":{"0":"A","1":"B","A":0,"B":1,"Z":1}},0,1]',
    },
  });
  itBundled("edgecase/TypeScriptNamespaceSiblingVariable", {
    files: {
      "/entry.ts": `
        namespace X {
          export let Y = {};
          export namespace Y {
            export const Z = 1;
          }
        }
      `,
    },
    bundleErrors: {
      "/entry.ts": [`"Y" has already been declared`],
    },
  });
  // This specifically only happens with 'export { ... } from ...' syntax
  itBundled("edgecase/EsmSideEffectsFalseWithSideEffectsExportFrom", {
    files: {
      "/file1.js": `
        import("./file2.js");
      `,
      "/file2.js": `
        export { a } from './file3.js';
      `,
      "/file3.js": `
        export function a(input) {
          return 42;
        }
        console.log('side effect');
      `,
      "/package.json": `
        {
          "name": "my-package",
          "sideEffects": false
        }
      `,
    },
    run: {
      stdout: "",
    },
  });
  // A bare `import("./file2.js")` observes none of file2's exports, so — like a
  // bare static `import "./file2.js"` — nothing from a `"sideEffects": false`
  // package is pulled in on its behalf. (Before import() results were tracked
  // the dynamic target kept every export and printed "side effect".)
  itBundled("edgecase/EsmSideEffectsFalseWithSideEffectsExportFromCodeSplitting", {
    files: {
      "/file1.js": `
        import("./file2.js");
        console.log('file1');
      `,
      "/file1b.js": `
        import("./file2.js");
        console.log('file2');
      `,
      "/file2.js": `
        export { a } from './file3.js';
      `,
      "/file3.js": `
        export function a(input) {
          return 42;
        }
        console.log('side effect');
      `,
      "/package.json": `
        {
          "name": "my-package",
          "sideEffects": false
        }
      `,
    },
    splitting: true,
    outdir: "out",
    entryPoints: ["./file1.js", "./file1b.js"],
    run: [
      {
        file: "/out/file1.js",
        stdout: "file1",
      },
      {
        file: "/out/file1b.js",
        stdout: "file2",
      },
    ],
  });
  itBundled("edgecase/RequireSideEffectsFalseWithSideEffectsExportFrom", {
    files: {
      "/file1.js": `
        require("./file2.js");
      `,
      "/file2.js": `
        export { a } from './file3.js';
      `,
      "/file3.js": `
        export function a(input) {
          return 42;
        }
        console.log('side effect');
      `,
      "/package.json": `
        {
          "name": "my-package",
          "sideEffects": false
        }
      `,
    },
    run: {
      stdout: "",
    },
  });
  itBundled("edgecase/SideEffectsFalseWithSideEffectsExportFrom", {
    files: {
      "/file1.js": `
        import("./file2.js");
      `,
      "/file2.js": `
        import * as foo from './file3.js';
        export default foo;
      `,
      "/file3.js": `
        export function a(input) {
          return 42;
        }
        console.log('side effect');
      `,
      "/package.json": `
        {
          "name": "my-package",
          "sideEffects": false
        }
      `,
    },
    run: {
      stdout: "",
    },
  });
  itBundled("edgecase/BuiltinWithTrailingSlash", {
    files: {
      "/entry.js": `
        import * as process from 'process/';
        console.log(JSON.stringify(process));
      `,
      "/node_modules/process/index.js": `
        export default { hello: 'world' };
      `,
    },
    run: {
      stdout: `{"default":{"hello":"world"}}`,
    },
  });
  itBundled("edgecase/EsmWrapperClassHoisting", {
    files: {
      "/entry.ts": `
        async function hi() {
          const { default: MyInherited } = await import('./hello');
          const myInstance = new MyInherited();
          console.log(myInstance.greet())
        }

        hi();
      `,
      "/hello.ts": `
        const MyReassignedSuper = class MySuper {
          greet() {
            return 'Hello, world!';
          }
        };

        class MyInherited extends MyReassignedSuper {};

        export default MyInherited;
      `,
    },
    run: {
      stdout: "Hello, world!",
    },
  });
  itBundled("edgecase/EsmWrapperElimination1", {
    files: {
      "/entry.ts": `
        async function load() {
          return import('./hello');
        }
        load().then(({ default: def }) => console.log(def()));
      `,
      "/hello.ts": `
        export var x = 123;
        export var y = function() { return x; };
        export function z() { return y(); }
        function a() { return z(); }
        export default function c() { return a(); }
      `,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("edgecase/TsEnumTreeShakingUseAndInlineClass", {
    files: {
      "/entry.ts": `
        import { TestEnum } from './enum';

        class TestClass {
          constructor() {
            console.log(JSON.stringify(TestEnum));
          }

          testMethod(name: TestEnum) {
            return name === TestEnum.A;
          }
        }

        // This must use wrapper class
        console.log(new TestClass());
        // This must inline
        console.log(TestClass.prototype.testMethod.toString().includes('TestEnum'));
      `,
      "/enum.ts": `
        export enum TestEnum {
          A,
          B,
        }
      `,
    },
    dce: true,
    run: {
      stdout: `
        {"0":"A","1":"B","A":0,"B":1}
        TestClass {
          testMethod: [Function: testMethod],
        }
        false
      `,
    },
  });
  // this test checks that visit order doesnt matter (inline then use, above is use then inline)
  itBundled("edgecase/TsEnumTreeShakingUseAndInlineClass2", {
    files: {
      "/entry.ts": `
        import { TestEnum } from './enum';

        class TestClass {
          testMethod(name: TestEnum) {
            return name === TestEnum.A;
          }

          constructor() {
            console.log(JSON.stringify(TestEnum));
          }
        }

        // This must use wrapper class
        console.log(new TestClass());
        // This must inline
        console.log(TestClass.prototype.testMethod.toString().includes('TestEnum'));
      `,
      "/enum.ts": `
        export enum TestEnum {
          A,
          B,
        }
      `,
    },
    dce: true,
    run: {
      stdout: `
        {"0":"A","1":"B","A":0,"B":1}
        TestClass {
          testMethod: [Function: testMethod],
        }
        false
      `,
    },
  });
  itBundled("edgecase/TsEnumTreeShakingUseAndInlineNamespace", {
    files: {
      "/entry.ts": `
        import { TestEnum } from './enum';

        namespace TestClass {
          console.log(JSON.stringify(TestEnum));
          console.log((() => TestEnum.A).toString().includes('TestEnum'));
        }
      `,
      "/enum.ts": `
        export enum TestEnum {
          A,
          B,
        }
      `,
    },
    dce: true,
    run: {
      stdout: `
        {"0":"A","1":"B","A":0,"B":1}
        false
      `,
    },
  });
  // https://github.com/oven-sh/bun/issues/31755
  // An object literal whose computed keys are inlined enum members (e.g.
  // `{ [A.FOO]: ... }`) has no side effects, so when the binding is unused it
  // must be tree-shaken along with everything it references. The enum-member
  // key is wrapped in an inlined-enum node; the side-effect check must look
  // through that wrapper just like it does for a bare numeric-literal key.
  itBundled("edgecase/TsEnumKeyedObjectTreeShaking#31755", {
    files: {
      "/entry.ts": `
        import { A } from './lib';
        console.log(JSON.stringify(A));
      `,
      "/lib.ts": `
        export enum A { FOO, BAR }
        export function fooFunctionREMOVE() {}
        export const fooArrowFunctionREMOVE = () => {};
        export const unusedObjectREMOVE = { [A.FOO]: fooFunctionREMOVE, [A.BAR]: fooArrowFunctionREMOVE };
      `,
    },
    dce: true,
    dceKeepMarkerCount: false,
    assertNotPresent: {
      "/out.js": ["fooFunctionREMOVE", "fooArrowFunctionREMOVE", "unusedObjectREMOVE"],
    },
    run: {
      stdout: `{"0":"FOO","1":"BAR","FOO":0,"BAR":1}`,
    },
  });
  // Same as above but with primitive-literal values, isolating the computed
  // enum-member key as the thing that previously blocked removal.
  itBundled("edgecase/TsEnumKeyedLiteralObjectTreeShaking#31755", {
    files: {
      "/entry.ts": `
        import { A } from './lib';
        console.log(JSON.stringify(A));
      `,
      "/lib.ts": `
        export enum A { FOO, BAR }
        export const unusedObjectREMOVE = { [A.FOO]: 1, [A.BAR]: 2 };
      `,
    },
    dce: true,
    dceKeepMarkerCount: false,
    assertNotPresent: {
      "/out.js": ["unusedObjectREMOVE"],
    },
    run: {
      stdout: `{"0":"FOO","1":"BAR","FOO":0,"BAR":1}`,
    },
  });
  // Guard against over-eager removal: a computed key that actually has side
  // effects must keep the object alive even when the binding is unused. The
  // side effect is observed at runtime (the flag it sets is printed) so the
  // test fails if the computed-key call is tree-shaken away.
  itBundled("edgecase/ComputedKeyWithSideEffectsNotTreeShaken#31755", {
    files: {
      "/entry.ts": `
        import './lib';
        console.log(globalThis.hit === true ? 'side-effect-ran' : 'side-effect-missing');
      `,
      "/lib.ts": `
        function sideEffectKept() { globalThis.hit = true; return 'k'; }
        const unusedObject = { [sideEffectKept()]: 1 };
      `,
    },
    onAfterBundle(api) {
      // The side-effecting key call must survive tree-shaking.
      api.expectFile("/out.js").toContain("sideEffectKept");
    },
    run: {
      stdout: `side-effect-ran`,
    },
  });
  itBundled("edgecase/ImportMetaMain", {
    files: {
      "/entry.ts": /* js */ `
        import {other} from './other';
        console.log(capture(import.meta.main), capture(require.main === module), ...other);
      `,
      "/other.ts": `
        globalThis['ca' + 'pture'] = x => x;

        export const other = [capture(require.main === module), capture(import.meta.main)];
      `,
    },
    capture: ["false", "false", "import.meta.main", "import.meta.main"],
    onAfterBundle(api) {
      // This should not be marked as a CommonJS module
      api.expectFile("/out.js").not.toContain("require");
      api.expectFile("/out.js").not.toContain("module");
    },
  });
  itBundled("edgecase/ImportMetaMainTargetNode", {
    files: {
      "/entry.ts": /* js */ `
        import {other} from './other';
        console.log(capture(import.meta.main), capture(require.main === module), ...other);
      `,
      "/other.ts": `
        globalThis['ca' + 'pture'] = x => x;

        export const other = [capture(require.main === module), capture(import.meta.main)];
      `,
    },
    target: "node",
    capture: ["false", "false", "__require.main == __require.module", "__require.main == __require.module"],
    onAfterBundle(api) {
      // This should not be marked as a CommonJS module
      api.expectFile("/out.js").not.toMatch(/\brequire\b/); // __require is ok
      api.expectFile("/out.js").not.toMatch(/[^\.:]module/); // `.module` and `node:module` are ok.
    },
  });
  itBundled("edgecase/build-cjs-module#20308", {
    files: {
      "/entry.ts": /* js */ `
        import {other} from './other';
        console.log(capture(import.meta.main), capture(require.main === module), ...other);
      `,
      "/other.ts": /* js */ `
        globalThis['ca' + 'pture'] = x => x;

        export const other = [capture(require.main === module), capture(import.meta.main)];
      `,
    },
    target: "node",
    format: "cjs",
    capture: ["false", "false", "require.main == module", "require.main == module"],
    onAfterBundle(api) {
      console.log(api.readFile("/out.js"));
      // This should be marked as a CommonJS module
      api.expectFile("/out.js").toMatch(/\brequire\b/); // __require is not ok
      api.expectFile("/out.js").toMatch(/[^\.:]module/); // `.module` and `node:module` are not ok.
    },
  });
  itBundled("edgecase/IdentifierInEnum#13081", {
    files: {
      "/entry.ts": `
        let ZZZZZZZZZ = 1;
        enum B {
          C = ZZZZZZZZZ,
        }
        console.log(B.C);
      `,
    },
    run: { stdout: "1" },
  });
  itBundled("edgecase/DoNotMoveTaggedTemplateLiterals", {
    files: {
      "/entry.ts": `
        globalThis.z = () => console.log(2)
        const y = await import('./second.ts');
      `,
      "/second.ts": `
        console.log(1);
        export const y = z\`zyx\`;
      `,
    },
    run: { stdout: "1\n2" },
  });
  itBundled("edgecase/Latin1StringInImportedJSON", {
    files: {
      "/entry.ts": `
        import x from './second.json';
        console.log(x + 'a');
      `,
      "/second.json": `
        "测试"
      `,
    },
    target: "bun",
    run: { stdout: `测试a` },
  });
  itBundled("edgecase/Latin1StringInImportedJSONBrowser", {
    files: {
      "/entry.ts": `
        import x from './second.json';
        console.log(x + 'a');
      `,
      "/second.json": `
        "测试"
      `,
    },
    target: "browser",
    run: { stdout: `测试a` },
  });
  itBundled("edgecase/Latin1StringKey", {
    files: {
      "/entry.ts": `
        import x from './second.json';
        console.log(x["测试" + "a"]);
      `,
      "/second.json": `
        {"测试a" : 123}
      `,
    },
    target: "bun",
    run: { stdout: `123` },
  });
  itBundled("edgecase/Latin1StringKeyBrowser", {
    files: {
      "/entry.ts": `
        import x from './second.json';
        console.log(x["测试" + "a"]);
      `,
      "/second.json": `
        {"测试a" : 123}
      `,
    },
    target: "browser",
    run: { stdout: `123` },
  });

  itBundled("edgecase/UninitializedVariablesMoved", {
    files: {
      "/entry.ts": `
        await import('./b.js');
      `,
      "/b.js": `
        export var a = 32;
        export var b;
        (function (c) {
            c.d = 1;
        })(b ?? {});
        +a;
      `,
    },
    minifySyntax: true,
    run: true, // pass if no thrown error
  });

  itBundled("edgecase/UsingExportDefault", {
    files: {
      "/entry.ts": `
        import module from "./module.ts";
        console.log(module.x);
      `,
      "/module.ts": `
        using a = {
          [Symbol.dispose]: () => {
            console.log("Disposing");
          }
        };
        export default {x: 1};
      `,
    },
    run: {
      stdout: "Disposing\n1",
    },
  });

  itBundled("edgecase/UsingExportClass", {
    files: {
      "/entry.ts": `
        export class A {
          [Symbol.dispose](){
            console.info("Disposing");
          }
        }
        using a = new A();
      `,
    },
    run: {
      stdout: "Disposing",
    },
  });

  itBundled("edgecase/UsingExportDefaultThrows", {
    files: {
      "/entry.ts": `
        import("./module.ts").catch(error => {
          console.log("Caught error:", error.message);
        });
      `,
      "/module.ts": `
        function somethingThatThrows() {
          throw new Error("This function throws");
        }

        using disposable = {
          [Symbol.dispose]: () => {
            console.log("Disposing");
          }
        };

        export default somethingThatThrows();
      `,
    },
    run: {
      stdout: "Disposing\nCaught error: This function throws",
    },
  });

  itBundled("edgecase/UsingExportDefaultAsync", {
    files: {
      "/entry.ts": `
        const result = await import("./importer.ts");
        console.log(await result.default);
      `,
      "/importer.ts": `
        async function main() {
          using disposable = {
            [Symbol.dispose]: () => {
              console.log("Disposing");
            }
          };
          return "Success";
        }
        export default main();
      `,
    },
    run: {
      stdout: "Disposing\nSuccess",
    },
  });

  // `--target=bun` does not lower `using`, and the declaration stays inside
  // the `__esm` wrapper. A module whose other statements all hoist still
  // needs that wrapper, even when the initializer could move out of it.
  itBundled("edgecase/UsingWithHoistableInitializerKeepsWrapper", {
    files: {
      "/entry.ts": `
        const { f } = await import("./async.ts");
        console.log(f());
        try {
          await import("./sync.ts");
        } catch (error) {
          console.log(error instanceof TypeError);
        }
      `,
      "/async.ts": `
        await using a = null;
        export function f() { return "f"; }
      `,
      "/sync.ts": `
        using b = 1;
        export function g() {}
      `,
    },
    target: "bun",
    run: {
      stdout: "f\ntrue",
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("await init_async()");
      expect(out).toContain("init_sync()");
    },
  });

  itBundled("edgecase/UsingDisposeThrowDoesntMask", {
    files: {
      "/entry.ts": `
        using a = {
          [Symbol.dispose]: () => {
            throw new Error("Error");
          }
        };
        using b = {
          [Symbol.dispose]: () => {
            console.log("Disposing");
          }
        }
      `,
    },
    run: {
      error: "error: Error",
      stdout: "Disposing",
    },
  });

  itBundled("edgecase/UsingExportFails", {
    files: {
      "/entry.ts": `
        import a from "./import.ts";
        console.log(a.ok);
      `,
      "/import.ts": `
        using a = {
          [Symbol.dispose]: () => {
            console.log("Disposing");
          },
          ok: true,
        };
        export default a;
      `,
    },
    run: {
      stdout: "Disposing\ntrue",
    },
  });

  itBundled("edgecase/NoOutWithTwoFiles", {
    files: {
      "/entry.ts": `
        import index from './index.html' with { type: 'file' }
        console.log(index);
      `,
      "/index.html": `
        <head></head>
      `,
    },
    generateOutput: false,
    backend: "api",
    onAfterApiBundle: async build => {
      expect(build.success).toEqual(true);
      expect(build.outputs).toBeArrayOfSize(2);

      expect(build.outputs[0].path).toEqual("./entry.js");
      expect(build.outputs[0].loader).toEqual("ts");
      expect(build.outputs[0].kind).toEqual("entry-point");

      expect(build.outputs[1].loader).toEqual("file");
      expect(build.outputs[1].kind).toEqual("asset");
      expect(await build.outputs[1].text()).toEqual("<head></head>");
    },
  });

  itBundled("edgecase/OutWithTwoFiles", {
    backend: "cli",
    files: {
      "/entry.ts": `
        import index from './index.html' with { type: 'file' }
        console.log(index);
      `,
      "/index.html": `
        <head></head>
      `,
    },
    generateOutput: true,
    bundleErrors: {
      "<bun>": ["cannot write multiple output files without an output directory"],
    },
    run: true,
  });

  itBundled("edgecase/TSConfigPathsConfigDir", {
    files: {
      "/src/entry.ts": /* ts */ `
        import { value } from "alias/foo";
        import { other } from "@scope/bar";
        import { nested } from "deep/path";
        import { absolute } from "abs/path";
        console.log(value, other, nested, absolute);
      `,
      "/src/actual/foo.ts": `export const value = "foo";`,
      "/src/lib/bar.ts": `export const other = "bar";`,
      "/src/nested/deep/file.ts": `export const nested = "nested";`,
      "/src/absolute.ts": `export const absolute = "absolute";`,
      "/src/tsconfig.json": /* json */ `{
        "compilerOptions": {
          "baseUrl": "\${configDir}",
          "paths": {
            "alias/*": ["actual/*"],
            "@scope/*": ["lib/*"],
            "deep/path": ["nested/deep/file.ts"],
            "abs/*": ["\${configDir}/absolute.ts"]
          }
        }
      }`,
    },
    run: {
      stdout: "foo bar nested absolute",
    },
  });

  itBundled("edgecase/TSConfigBaseUrlConfigDir", {
    files: {
      "/entry.ts": /* ts */ `
        import { value } from "./src/subdir/module";
        console.log(value);
      `,
      "/src/lib/module.ts": `export const value = "found";`,
      "/src/subdir/module.ts": `
        import { value } from "absolute";
        export { value };
      `,
      "tsconfig.json": /* json */ `{
        "compilerOptions": {
          "baseUrl": "\${configDir}/src/lib",
          "paths": {
            "absolute": ["./module.ts"]
          }
        }
      }`,
    },
    run: {
      stdout: "found",
    },
  });

  itBundled("edgecase/TSConfigPathsConfigDirWildcard", {
    files: {
      "/src/entry.ts": /* ts */ `
        import { one } from "prefix/one";
        import { two } from "prefix/two";
        import { three } from "other/three";
        console.log(one, two, three);
      `,
      "/src/modules/one.ts": `export const one = "one";`,
      "/src/modules/two.ts": `export const two = "two";`,
      "/src/alternate/three.ts": `export const three = "three";`,
      "/src/tsconfig.json": /* json */ `{
        "compilerOptions": {
          "baseUrl": "\${configDir}",
          "paths": {
            "prefix/*": ["modules/*"],
            "other/*": ["\${configDir}/alternate/*"]
          }
        }
      }`,
    },
    run: {
      stdout: "one two three",
    },
  });

  itBundled("edgecase/TSConfigPathsConfigDirNested", {
    files: {
      "/deeply/nested/src/entry.ts": /* ts */ `
        import { value } from "alias/module";
        console.log(value);
      `,
      "/deeply/nested/src/actual/module.ts": `export const value = "nested";`,
      "/deeply/nested/src/tsconfig.json": /* json */ `{
        "compilerOptions": {
          "baseUrl": "\${configDir}",
          "paths": {
            "alias/*": ["actual/*"]
          }
        }
      }`,
    },
    run: {
      stdout: "nested",
    },
  });

  itBundled("edgecase/TSConfigPathsConfigDirMultiple", {
    files: {
      "/src/entry.ts": /* ts */ `
        import { value } from "multi/module";
        console.log(value);
      `,
      "/src/fallback/module.ts": `export const value = "fallback";`,
      "/src/primary/module.ts": `export const value = "primary";`,
      "/src/tsconfig.json": /* json */ `{
        "compilerOptions": {
          "baseUrl": "\${configDir}",
          "paths": {
            "multi/*": [
              "\${configDir}/primary/*",
              "\${configDir}/fallback/*"
            ]
          }
        }
      }`,
    },
    run: {
      stdout: "primary",
    },
  });

  itBundled("edgecase/TSConfigPathsConfigDirInvalid", {
    files: {
      "/entry.ts": /* ts */ `
        import { value } from "invalid/module";
        console.log(value);
      `,
      "/tsconfig.json": /* json */ `{
        "compilerOptions": {
          "baseUrl": "\${configDir}",
          "paths": {
            "invalid/*": ["\${configDir}/\${configDir}/*"]
          }
        }
      }`,
    },
    bundleErrors: {
      "/entry.ts": ['Could not resolve: "invalid/module". Maybe you need to "bun install"?'],
    },
  });

  itBundled("edgecase/TSConfigPathsConfigDirBackslash", {
    files: {
      "/entry.ts": /* ts */ `
        import { value } from "windows/style";
        console.log(value);
      `,
      "/win/style.ts": `export const value = "windows";`,
      "/tsconfig.json": /* json */ `{
        "compilerOptions": {
          "baseUrl": "\${configDir}",
          "paths": {
            "windows/*": ["win\\\\*"]
          }
        }
      }`,
    },
    run: {
      stdout: "windows",
    },
  });

  itBundled("edgecase/TSPublicFieldMinification", {
    files: {
      "/entry.ts": /* ts */ `
        export class Foo {
          constructor(public name: string) {}
        }

        const keys = Object.keys(new Foo('test'))
        if (keys.length !== 1) throw new Error('Keys length is not 1')
        if (keys[0] !== 'name') throw new Error('keys[0] is not "name"')
        console.log('success')
      `,
    },
    minifySyntax: true,
    minifyIdentifiers: true,
    target: "bun",
    run: {
      stdout: "success",
    },
  });
  // https://github.com/oven-sh/bun/issues/14585
  itBundled("identifiers/SameNameDifferentModulesWithMinifyIdentifiersDisabled", {
    files: {
      "/foo.js": `
        {
            var d = 0;
        }

        export const foo = () => {}
      `,
      "/bar.js": `
        // bar.js - The collision happens with this function declaration
        function d() {}
        export function bar() {d.length;}
      `,
      "/index.js": `
        import { foo } from "./foo.js";
        import { bar } from "./bar.js";

        // Execute in order
        foo();
        bar();
      `,
    },
    entryPoints: ["/index.js"],
    outfile: "/out.js",
    minifyIdentifiers: false,
    run: {
      stdout: "",
    },
  });
  // https://github.com/oven-sh/bun/issues/14588
  // A function parameter must not be collision-renamed into the name of a
  // hoisted top-level function that is declared later in the same file.
  itBundled("identifiers/NestedParamDoesNotShadowLaterHoistedFunction", {
    files: {
      "/dep.js": `
        export var e = "outer_e";
        export var e2 = "outer_e2";
      `,
      "/entry.js": `
        import { e as _e, e2 as _e2 } from "./dep.js";

        function ZI(t, e, n) {
          return e3(t, e, n);
        }

        function e3(a, b, c) {
          return "range:" + b;
        }

        console.log(ZI(1, 2, 3), _e, _e2);
      `,
    },
    entryPoints: ["/entry.js"],
    minifyIdentifiers: false,
    run: { stdout: "range:2 outer_e outer_e2" },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("function ZI(t, e3, n)");
    },
  });
  // https://github.com/oven-sh/bun/issues/14588
  // Same bug for a module wrapped in `__esm` via dynamic `import()`: the
  // module's own top-level declarations are hoisted outside the closure, so a
  // parameter in that module must not be renamed into one of them.
  itBundled("identifiers/NestedParamDoesNotShadowLaterHoistedFunctionInEsmWrap", {
    files: {
      "/names.js": `
        export var e = "E";
        export var e2 = "E2";
      `,
      "/lib.js": `
        var sideEffect = Date.now();
        export function ZI(t, e, n) {
          return e3(t, e, n);
        }
        function e3(a, b, c) {
          return "range:" + b;
        }
      `,
      "/entry.js": `
        import { e as _e, e2 as _e2 } from "./names.js";
        const mod = await import("./lib.js");
        console.log(mod.ZI(1, 2, 3), _e, _e2);
      `,
    },
    entryPoints: ["/entry.js"],
    target: "bun",
    minifyIdentifiers: false,
    run: { stdout: "range:2 E E2" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("__esm");
      expect(out).not.toMatch(/function ZI\(\w+, e3,/);
    },
  });
  // A module wrapped in `__esm` has its top-level declarations hoisted outside
  // the closure. A destructuring pattern runs code on its value (a getter
  // here), so the pattern must run when the module is first evaluated, not
  // when the bundle loads. This holds for an unused pattern and for an
  // exported one, and for a module that holds nothing else.
  itBundled("edgecase/EsmWrapDestructuringRunsOnInit", {
    files: {
      "/lazy.js": `
        const { x } = class { static get x() { console.log("EFFECT1"); return 1 } };
        export const y = 2;
      `,
      "/lazy2.js": `
        export const { z } = class { static get z() { console.log("EFFECT2"); return 3 } };
      `,
      "/entry.js": `
        console.log("before");
        const a = await import("./lazy.js");
        console.log(a.y);
        const b = await import("./lazy2.js");
        console.log(b.z);
      `,
    },
    entryPoints: ["/entry.js"],
    target: "bun",
    run: { stdout: "before\nEFFECT1\n2\nEFFECT2\n3" },
  });
  // https://github.com/oven-sh/bun/issues/30269
  // Same bug for a nested `let` binding instead of a function parameter.
  itBundled("identifiers/NestedLocalDoesNotShadowLaterHoistedFunction", {
    files: {
      "/conflict.js": `
        export function r() { return "top-level r"; }
      `,
      "/module.js": `
        class Expression {}

        export function run() {
          const result = typecheck({ left: new Expression(), op: {}, right: {} });
          if (result !== true) throw new Error("expected true, got " + result);
          return result;
        }

        function typecheck(node) {
          let r, t, c;
          block: {
            r = node.left;
            t = node.op;
            c = node.right;
            break block;
          }
          return r2().bo4(r, t, c).a();
        }

        function r2() {
          return { bo4() { return { a() { return true; } }; } };
        }
      `,
      "/entry.js": `
        import * as conflict from "./conflict.js";
        import { run } from "./module.js";
        conflict.r();
        console.log("ok:" + run());
      `,
    },
    entryPoints: ["/entry.js"],
    minifyIdentifiers: false,
    run: { stdout: "ok:true" },
  });
  // https://github.com/oven-sh/bun/issues/41054
  // Same bug in a single file: the local `n` collides with the top-level `n`,
  // so the renamer numbers it. The numbered name must not collide with `n2`,
  // a top-level symbol declared in a later part and called from the same
  // function. The broken output renamed the local to `n2`, which shadowed the
  // `n2` function.
  itBundled("identifiers/NestedLocalDoesNotShadowLaterTopLevelSymbol", {
    files: {
      "/entry.js": /* js */ `
        const n = 1;
        export function f() {
          let n = 2;
          return n2(n);
        }
        function n2(x) {
          return x + n + 40;
        }
        console.log(f());
      `,
    },
    target: "bun",
    minifyIdentifiers: false,
    run: { stdout: "43" },
  });
  // Same bug for a module scope deferred as one nested scope because the
  // module is wrapped in a CommonJS closure: a local inside the closure must
  // not be renamed into the name of another module's wrapper (`require_*`),
  // which is registered as a top-level symbol only when its own file is
  // reached. The circular require makes a.js's closure call entry.js's
  // wrapper, which is registered later.
  itBundled("identifiers/CjsClosureLocalDoesNotShadowLaterWrapper", {
    files: {
      "/entry.js": /* js */ `
        module.exports.val = 2;
        const a = require("./a.js");
        console.log(a.f());
      `,
      "/a.js": /* js */ `
        module.exports.f = function f() {
          let require_entry = 40;
          const e = require("./entry.js");
          return e.val + require_entry + 1;
        };
      `,
    },
    entryPoints: ["/entry.js"],
    target: "bun",
    minifyIdentifiers: false,
    run: { stdout: "43" },
  });
  // A binding in a nested scope keeps its name when the enclosing bindings of
  // that name (top-level ones included, from any file in the chunk) are never
  // referenced inside its scope, so `Function#name` / `constructor.name`
  // survive bundling. Class and function expression names are bound in their
  // own scope, not at top level.
  itBundled("identifiers/NestedBindingKeepsNameWhenOuterIsNotReferencedInside", {
    files: {
      "/entry.js": /* js */ `
        import { make } from "./dep.js";
        const factory = () => { class Model {} return Model; };
        const Model = factory();
        var Foo = class Foo { static self() { return Foo; } };
        var fn = function fn() { return fn; };
        let User = class User { me() { return User; } };
        User = ((c) => c)(User);
        class Bar { static { Bar.tag = "bar"; } }
        function outer() { const make = () => "local"; return make(); }
        console.log(JSON.stringify([
          Model.name, Foo.name, Foo.self() === Foo, fn.name, fn() === fn, User.name,
          new User().me() === User, Bar.name, Bar.tag, make().name, outer(),
        ]));
      `,
      "/dep.js": /* js */ `
        export function make() { class Model {} return Model; }
      `,
    },
    minifyIdentifiers: false,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toMatch(/\b(Model|Foo|fn|User|Bar|make)[0-9]\b/);
    },
    run: { stdout: `["Model","Foo",true,"fn",true,"User",true,"Bar","bar","Model","local"]` },
  });
  // The other direction: when the scope does reference the outer binding (as
  // the printer will write it: a linked import, a namespace member, a CommonJS
  // namespace object, a runtime helper, a class field moved into the
  // constructor), the nested binding is renamed out of the way.
  itBundled("identifiers/NestedBindingRenamedWhenOuterIsReferencedInside", {
    files: {
      "/entry.ts": /* ts */ `
        import { T as U, value } from "./dep.ts";
        import * as ns from "./ns.ts";
        import cjs from "./cjs.cjs";
        const lazy = () => require("./ns.ts");
        var C = class T { m() { return U; } };
        function a() { const parse = "local"; return [parse, ns.parse()]; }
        function b() { let x = value; { let value = "inner"; return [value, x]; } }
        function c() { { let value = "inner"; return [value, U.name]; } }
        function d() { const import_cjs = "local"; return [import_cjs, cjs.kind]; }
        function e() { const __toCommonJS = "local"; return [__toCommonJS, lazy().parse()]; }
        function dec(target: unknown, key?: unknown) {}
        class F {
          @dec prop = value;
          @dec lazy = () => value;
          constructor(value: string) { this.arg = value; }
          arg: string;
        }
        const f = new F("arg");
        console.log(JSON.stringify([C.name, new C().m().name, a(), b(), c(), d(), e(), f.prop, f.lazy(), f.arg]));
      `,
      "/tsconfig.json": /* json */ `
        { "compilerOptions": { "experimentalDecorators": true } }
      `,
      "/dep.ts": /* ts */ `
        export class T {}
        export const value = "dep";
      `,
      "/ns.ts": /* ts */ `
        export function parse() { return "parsed"; }
      `,
      "/cjs.cjs": /* js */ `
        module.exports = { kind: "cjs" };
      `,
    },
    minifyIdentifiers: false,
    run: {
      stdout: `["T2","T",["local","parsed"],["inner","dep"],["inner","T"],["local","cjs"],["local","parsed"],"dep","dep","arg"]`,
    },
  });
  // References that print under a name owned by an enclosing scope even
  // though the symbol is declared beside the reference: imports inside a
  // CommonJS-wrapped module (linked to another file's top-level symbol, or
  // hoisted out of the closure when external), `import()` destructuring bound
  // to the target's export, Annex B block functions hoisted to the function
  // scope, and the TypeScript namespace closure parameter.
  itBundled("identifiers/NestedBindingRenamedAroundLinkedAndHoistedNames", {
    files: {
      "/entry.ts": /* ts */ `
        import { fn as viaStatic } from "./fn.ts";
        import { join } from "node:path";
        const { foo, p } = require("./a.js");
        const block = require("./c.cjs");
        async function g() {
          const fn2 = 1;
          const { fn } = await import("./fn.ts");
          return [fn(), fn2, viaStatic()];
        }
        namespace NS {
          export let a = 1;
          a++;
          export function f() { const NS = "local"; return [NS, a]; }
        }
        namespace M { export const M = "selfname"; export const other = 1; }
        namespace M { export function f() { return [M, other]; } }
        namespace V { export const y = 1; if (globalThis) { var V = 6 as any; } export const seen = [y, typeof V]; }
        console.log(JSON.stringify([foo, p, block, await g(), NS.f(), typeof join, M.f(), V.seen]));
      `,
      "/a.js": /* js */ `
        import make from "./b.js";
        import { join } from "node:path";
        var foo = make();
        var join2 = "local";
        module.exports = { foo, p: [join("x", "y").length, join2] };
      `,
      "/c.cjs": /* js */ `
        function outer() {
          if (true) { function make() { return "block"; } }
          return make();
        }
        module.exports = outer();
      `,
      "/b.js": /* js */ `
        export default function foo() { return "from b"; }
      `,
      "/fn.ts": /* ts */ `
        export function fn() { return "fn"; }
      `,
    },
    target: "node",
    minifyIdentifiers: false,
    run: { stdout: `["from b",[3,"local"],"block",["fn",1,"fn"],["local",2],"function",["selfname",1],[1,"number"]]` },
  });
  // The enclosing reference may come after the nested scope (a smaller scope
  // index recorded later), through `module.exports` (printed as `exports`), or
  // from a TypeScript type position resolved during the parse pass.
  itBundled("identifiers/NestedBindingRenamedWhenOuterIsReferencedLater", {
    files: {
      "/entry.js": /* js */ `
        import "./a.js";
        import { calc, v, f } from "./b.js";
        import m from "./c.cjs";
        console.log(JSON.stringify([calc("-arg"), f(), v, m.run()]));
      `,
      "/a.js": /* js */ `
        export var value = "a";
        export let v = "a";
        console.log(value, v);
      `,
      "/b.js": /* js */ `
        export var value = "b";
        export function calc(value2) { return value + value2; }
        export let v = "outer";
        export function f() { const v2 = "local"; return [v2, v].join(); }
        console.log(value, v);
      `,
      "/c.cjs": /* js */ `
        module.exports.foo = "F";
        module.exports.run = function () { return g(); };
        function g() { const exports = { foo: "L" }; return [exports.foo, module.exports.foo].join(); }
      `,
    },
    minifyIdentifiers: false,
    run: { stdout: `a a\nb outer\n["b-arg","local,outer","outer","L,F"]` },
  });
  // A `var` hoisted out of a block still prints its declaration inside that
  // block, so a block-scoped binding there cannot take the hoisted name
  // (#41351). The same holds for a function's parameters and its body, and a
  // catch binding and its block. A sibling block that does not mention the
  // `var` may still reuse the name.
  itBundled("identifiers/NestedBindingRenamedAroundHoistedVarDeclaration", {
    files: {
      "/entry.js": /* js */ `
        import * as L from "./lib.js";
        import { Check } from "./other.js";
        const { blockFn } = require("./sloppy.cjs");
        console.log(JSON.stringify([
          L.make(true)(1), L.loop(), L.deep(), L.sibling(), L.param("p"), L.arrow("a"), L.dflt(),
          L.caught(), L.caughtVar(), L.paramUnused("p"), L.caughtUnused(), L.paramVar("p"),
          L.catchParamVar(), L.destructured(), L.forIn(), L.inSwitch(1), L.inTry(), L.klass(),
          L.nested(), blockFn(), Check(2),
        ]));
      `,
      "/lib.js": /* js */ `
        import { Check as OuterCheck } from "./other.js";
        // In every function the top-level "Check" is referenced, so the local
        // "Check" is renamed to "Check2" and meets a block-scoped "Check2".
        export function make(cond) {
          OuterCheck(0);
          if (cond) {
            let Check2 = function (value) { return value; };
            var Check = Check2;
          }
          return Check;
        }
        export function loop() {
          OuterCheck(0);
          for (let Check2 = 0; Check2 < 1; Check2++) { var Check = Check2 + 1; }
          return Check;
        }
        export function deep() {
          OuterCheck(0);
          {
            let Check2 = "mid";
            { var Check = "var"; }
            return [Check2, Check];
          }
        }
        export function sibling() {
          OuterCheck(0);
          { var Check = "var"; }
          let seen;
          { let Check2 = "let"; seen = Check2; }
          return [seen, Check];
        }
        export function param(Check) {
          OuterCheck(0);
          let Check2 = "body";
          return [Check, Check2];
        }
        export const arrow = (Check) => {
          OuterCheck(0);
          let Check2 = "arrow";
          return [Check, Check2];
        };
        export function dflt(Check = "default") {
          OuterCheck(0);
          { let Check2 = "inner"; return [Check, Check2]; }
        }
        export function caught() {
          try { throw "err"; } catch (Check) {
            OuterCheck(0);
            let Check2 = "catch";
            return [Check, Check2];
          }
        }
        export function caughtVar() {
          OuterCheck(0);
          try { throw "t"; } catch (Check) { var Check = "v"; let Check2 = Check; return Check2; }
        }
        // The body never mentions the parameter or the catch binding, so only
        // its declaration stops the body's "Check2" from taking that name.
        export function paramUnused(Check) {
          OuterCheck(0);
          let Check2 = "unused-param";
          return Check2;
        }
        export function caughtUnused() {
          try { throw "err"; } catch (Check) {
            OuterCheck(0);
            let Check2 = "unused-catch";
            return Check2;
          }
        }
        // Here the renamed "var Check" is the one that would take a
        // parameter's or catch binding's name "Check2". That output loads but
        // merges the var with the parameter (or assigns the catch binding), so
        // the values are wrong instead of a SyntaxError.
        export function paramVar(Check2) {
          OuterCheck(0);
          var Check;
          return Check;
        }
        export function catchParamVar() {
          OuterCheck(0);
          try { throw 0; } catch (Check2) { var Check = "set"; }
          return Check;
        }
        export function destructured() {
          OuterCheck(0);
          { let Check2 = 5; var { a: Check = Check2, ...rest } = { b: 1 }; }
          return [Check, rest];
        }
        export function forIn() {
          OuterCheck(0);
          { let Check2 = "k"; for (var Check in { [Check2]: 1 }) {} }
          return Check;
        }
        export function inSwitch(x) {
          OuterCheck(0);
          switch (x) { case 1: let Check2 = "sw"; var Check = Check2; }
          return Check;
        }
        export function inTry() {
          OuterCheck(0);
          try { let Check2 = "try"; var Check = Check2; } finally {}
          return Check;
        }
        export function klass() {
          OuterCheck(0);
          { class Check2 { static tag = "cls"; } var Check = Check2; }
          return Check.tag;
        }
        export function nested() {
          OuterCheck(0);
          {
            let Check2 = "nested";
            function inner() { var Check = "v"; return Check; }
            return [Check2, inner()];
          }
        }
      `,
      // Sloppy mode: a function declaration in a block is also hoisted to the
      // enclosing function as a var (annex B), assigned where the block
      // declares it.
      "/sloppy.cjs": /* js */ `
        const { g: outerG } = require("./other2.cjs");
        exports.blockFn = function () {
          outerG();
          { let g2 = "let"; function g() { return "g-inner"; } var r = [g2, g()]; }
          return [r, g()];
        };
      `,
      "/other2.cjs": /* js */ `
        exports.g = function () { return "g-outer"; };
      `,
      "/other.js": /* js */ `
        export function Check(x) { return "other " + x; }
      `,
    },
    minifyIdentifiers: false,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // The sibling block does not mention the var, so its binding keeps the name.
      expect(out).toContain('let Check2 = "let"');
      // No scope declares one name twice.
      expect(out).not.toMatch(/let Check2 = [^;]+;\s*var Check2\b/);
      expect(out).not.toMatch(/function param\(Check2\) \{\s*[^}]*let Check2\b/);
      expect(out).not.toMatch(/function paramUnused\(Check2\) \{\s*[^}]*let Check2\b/);
      expect(out).not.toMatch(/catch \(Check2\) \{\s*[^}]*let Check2\b/);
    },
    run: {
      stdout: `[1,1,["mid","var"],["let","var"],["p","body"],["a","arrow"],["default","inner"],["err","catch"],"v","unused-param","unused-catch",null,"set",[5,{"b":1}],"k","sw","try","cls",["nested","v"],[["let","g-inner"],"g-inner"],"other 2"]`,
    },
  });
  itBundled("edgecase/MacroProtoKeyIsOwnProperty", {
    files: {
      "/entry.ts": /* js */ `
        import { getData } from "./macro.ts" with { type: "macro" };
        const data = getData();
        console.write(JSON.stringify([
          Object.getPrototypeOf(data) === Object.prototype,
          Object.hasOwn(data, "__proto__"),
          data.x,
          JSON.stringify(data),
        ]));
      `,
      "/macro.ts": /* js */ `
        export function getData() {
          return JSON.parse('{"__proto__": {"x": 1}, "a": 2}');
        }
      `,
    },
    target: "bun",
    run: { stdout: '[true,true,null,"{\\"__proto__\\":{\\"x\\":1},\\"a\\":2}"]' },
  });
  // A macro result or a folded constant that is NaN, ±Infinity or undefined
  // prints as the bare global name. The renamer reserves those names, so a
  // user binding called NaN, Infinity or undefined is renamed instead of
  // capturing the printed value.
  for (const minify of [false, true]) {
    itBundled(`edgecase/MacroNaNInfinityUndefinedShadowed${minify ? "Minified" : ""}`, {
      files: {
        "/entry.ts": /* js */ `
          import { nan, inf, ninf, undef } from "./macro.ts" with { type: "macro" };
          import * as top from "./top-level.ts";
          function f(NaN, Infinity, undefined) {
            return [
              typeof nan(), typeof undef(),
              String(nan()), String(inf()), String(ninf()), String(undef()),
              String(+"x"), String(void 0),
              NaN, Infinity, undefined,
            ];
          }
          console.write(JSON.stringify([f("n", "i", "u"), top.NaN, top.Infinity, top.undefined, String(nan()), String(inf())]));
        `,
        "/macro.ts": /* js */ `
          export function nan() { return NaN; }
          export function inf() { return Infinity; }
          export function ninf() { return -Infinity; }
          export function undef() { return undefined; }
        `,
        "/top-level.ts": /* js */ `
          export const NaN = "N", Infinity = "I";
          export var undefined = "U";
        `,
      },
      target: "bun",
      minifySyntax: minify,
      minifyIdentifiers: minify,
      run: {
        stdout:
          '[["number","undefined","NaN","Infinity","-Infinity","undefined","NaN","undefined","n","i","u"],"N","I","U","NaN","Infinity"]',
      },
    });
  }
  // The macro module is transpiled by the macro VM, not by the bundler. That
  // VM has to be created from the build's transform options, or the macro
  // module does not see `--define` and `--loader`. The `Bun.build()` variant
  // lives in transpiler/macro-test.test.ts: the macro VM of a worker thread
  // outlives the build that created it, so that test needs its own process.
  itBundled("edgecase/MacroSeesBuildDefinesAndLoaders", {
    files: {
      "/entry.ts": /* js */ `
        import { mode, banner } from "./macro.ts" with { type: "macro" };
        console.log(mode(), banner());
      `,
      "/macro.ts": /* js */ `
        import banner_ from "./banner.dat";
        export function mode() {
          return process.env.MODE ?? "none";
        }
        export function banner() {
          return banner_;
        }
      `,
      "/banner.dat": "hello from a text loader",
    },
    backend: "cli",
    define: { "process.env.MODE": '"prod"' },
    loader: { ".dat": "text" },
    target: "bun",
    run: { stdout: "prod hello from a text loader" },
  });
  // `--external` and `--packages=external` describe the output bundle, not the
  // macro VM. A package the macro module imports has to resolve at build time.
  itBundled("edgecase/MacroImportsPackageMarkedExternal", {
    files: {
      "/entry.ts": /* js */ `
        import { fooAtBuildTime } from "./macro.ts" with { type: "macro" };
        import foo from "foo";
        console.log(fooAtBuildTime(), foo);
      `,
      "/macro.ts": /* js */ `
        import foo from "foo";
        export function fooAtBuildTime() {
          return foo;
        }
      `,
      "/node_modules/foo/package.json": `{ "name": "foo", "version": "1.0.0", "main": "index.js" }`,
      "/node_modules/foo/index.js": `module.exports = "foo-value";`,
    },
    backend: "cli",
    external: ["foo"],
    packages: "external",
    target: "bun",
    run: { stdout: "foo-value foo-value" },
  });
  itBundled("edgecase/NodeBuiltinWithoutPrefix", {
    files: {
      "/entry.ts": `
        import * as hello from "node:test";
        import * as world from "node:fs";
        import * as etc from "console";
        import * as blah from "bun:jsc";
        +[hello,world,etc,blah];
      `,
    },
    target: "bun",
    onAfterBundle(api) {
      api.expectFile("out.js").toMatchInlineSnapshot(`
        "// @bun
        // entry.ts
        import * as hello from "node:test";
        import * as world from "fs";
        import * as etc from "console";
        import * as blah from "bun:jsc";
        +[hello, world, etc, blah];
        "
      `);
    },
  });
  itBundled("edgecase/NodeBuiltinWithoutPrefix2", {
    files: {
      "/entry.ts": `
        import * as hello from "node:test";
        import * as world from "node:fs";
        import * as etc from "console";
        +[hello,world,etc];
      `,
    },
    target: "node",
    onAfterBundle(api) {
      api.expectFile("out.js").toMatchInlineSnapshot(`
        "// entry.ts
        import * as hello from "node:test";
        import * as world from "node:fs";
        import * as etc from "console";
        +[hello, world, etc];
        "
      `);
    },
  });
  itBundled("edgecase/PrefixOperatorAtOutputStart", {
    files: {
      "/entry.js": `
        ++globalThis.x;
        +globalThis.y;
      `,
    },
    target: "node",
    onAfterBundle(api) {
      api.expectFile("out.js").toMatchInlineSnapshot(`
        "// entry.js
        ++globalThis.x;
        +globalThis.y;
        "
      `);
    },
  });
  itBundled("edgecase/NonAsciiIdentifierPreserved", {
    files: {
      "/entry.js": /* js */ `
        class Café {}
        function naïve(x) { return x }
        class Cafá {}
        class 模块 {}
        const aπ = 1;
        const a𝒜 = 2;
        const élan = 3;
        console.log(JSON.stringify([Café.name, naïve.name, Cafá.name, 模块.name, aπ, a𝒜, élan]));
      `,
    },
    target: "node",
    run: { stdout: '["Café","naïve","Cafá","模块",1,2,3]' },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("class Café");
      expect(out).toContain("function naïve");
      expect(out).toContain("class Cafá");
      expect(out).toContain("class 模块");
      expect(out).toContain("var aπ");
      expect(out).toContain("var a𝒜");
      expect(out).toContain("var élan");
      expect(out).not.toContain("Caf_");
      expect(out).not.toContain("na_ve");
      expect(out).not.toContain("模_");
      expect(out).not.toContain("var a_");
    },
  });
  itBundled("edgecase/NonAsciiIdentifierPreservedBunTarget", {
    files: {
      "/entry.js": /* js */ `
        class Café {}
        function naïve(x) { return x }
        console.log(JSON.stringify([Café.name, naïve.name]));
      `,
    },
    target: "bun",
    run: { stdout: '["Café","naïve"]' },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("Caf_");
      expect(out).not.toContain("na_ve");
    },
  });
  // The bundler's per-edge graph walks (reachable files, tree-shaking /
  // code-splitting liveness, chunk part ordering, CSS discovery, TLA
  // validation, async propagation, dependency wrapping) used to recurse once
  // per import-graph edge, overflowing the stack on long linear chains. 7000
  // reliably crashed the old recursive form under debug+ASAN.
  const deepChainDepth = 7000;
  const deepChainFiles = {
    ...Object.fromEntries(
      Array.from({ length: deepChainDepth - 1 }, (_, i) => [
        `/m${i}.js`,
        `import { v${i + 1} } from "./m${i + 1}.js"; export const v${i} = v${i + 1} + 1;`,
      ]),
    ),
    [`/m${deepChainDepth - 1}.js`]: `export const v${deepChainDepth - 1} = 1;`,
  };
  itBundled("edgecase/DeepImportChain", {
    files: {
      "/entry.js": `import { v0 } from "./m0.js"; console.log(v0);`,
      ...deepChainFiles,
    },
    backend: "cli",
    // (local runs: writing 7000 fixture files is slow on Windows; the build itself is well under a second)
    timeoutScale: 6,
    run: { stdout: String(deepChainDepth) },
  });
  // Top-level await in the entry makes `validate_tla` / `propagate_async` walk
  // the chain; `await import()` of an ESM head without splitting wraps the
  // whole chain, driving `DependencyWrapper::wrap` through it. The wrapped
  // output initializes module N by calling module N+1's init, so running it
  // would recurse at runtime; checking for the deepest wrapper is enough.
  itBundled("edgecase/DeepImportChainWrappedTLA", {
    files: {
      // The namespace escapes (`ns` is logged whole) so the import() is not
      // hoisted to a static import and the chain really is wrapped.
      "/entry.js": `await 0; const ns = await import("./m0.js"); console.log(ns.v0, ns);`,
      ...deepChainFiles,
    },
    backend: "cli",
    timeoutScale: 6,
    onAfterBundle(api) {
      const out = api.readFile("out.js");
      expect(out).toContain(`init_m${deepChainDepth - 2}`);
    },
  });
  // Diamond-shaped DAG (half the modules have two importers). The code-
  // splitting reachability pass tracks min distance-from-entry for each file;
  // a LIFO walk with distance relaxation does O(V*E) re-visits here, so this
  // guards that the pass stays O(V+E). Plain fs writes because itBundled's
  // fixture pipeline is too slow at this scale under debug+ASAN.
  test.concurrent(
    "edgecase/DeepImportDiamondDAG",
    async () => {
      const N = 20000;
      using dir = tempDir("deep-import-dag", {});
      const root = String(dir);
      for (let i = 0; i < N; i++) {
        const deps: number[] = [];
        if (i + 1 < N) deps.push(i + 1);
        if (2 * i + 3 < N) deps.push(2 * i + 3);
        writeFileSync(
          join(root, `m${i}.js`),
          deps.map(d => `import { v as v${d} } from "./m${d}.js";`).join("\n") +
            `\nexport const v = ${i}${deps.map(d => ` + v${d}`).join("")};\n`,
        );
      }
      writeFileSync(join(root, "entry.js"), `import { v } from "./m0.js"; console.log(typeof v);\n`);

      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "entry.js", "--outfile=out.js"],
        cwd: root,
        env: bunEnv,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      });
      const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect({ stderr, exitCode, signalCode: build.signalCode }).toEqual({ stderr: "", exitCode: 0, signalCode: null });

      await using run = Bun.spawn({
        cmd: [bunExe(), "out.js"],
        cwd: root,
        env: bunEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [stdout, runStderr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
      expect({ stdout, stderr: runStderr, exitCode: runExit }).toEqual({
        stdout: "number\n",
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );
  // esbuild reports the same error for both cycles.
  itBundled("edgecase/ExportStarAmbiguityCycleIntoBarrel", {
    files: {
      "/entry.js": `import { x } from "./barrel.js"; console.log(x);`,
      "/barrel.js": `export * from "./a.js"; export * from "./b.js";`,
      "/a.js": `export const x = 1;`,
      "/b.js": `export { x } from "./barrel.js";`,
    },
    backend: "cli",
    bundleErrors: {
      "/b.js": ['Ambiguous import "x" has multiple matching exports'],
    },
  });
  itBundled("edgecase/ExportStarAmbiguityCycleAcrossBarrels", {
    files: {
      "/entry.js": `import { x } from "./barrel1.js"; console.log(x);`,
      "/a.js": `export const x = 1;`,
      "/barrel1.js": `export * from "./a.js"; export * from "./b1.js";`,
      "/b1.js": `export { x } from "./barrel2.js";`,
      "/barrel2.js": `export * from "./a.js"; export * from "./b2.js";`,
      "/b2.js": `export { x } from "./barrel1.js";`,
    },
    backend: "cli",
    bundleErrors: {
      "/b2.js": ['Ambiguous import "x" has multiple matching exports'],
    },
  });
  // Two candidates that resolve through the same re-export aren't a cycle.
  itBundled("edgecase/ExportStarAmbiguityAlternativesShareReExport", {
    files: {
      "/entry.js": `import { x } from "./barrel.js"; console.log(x);`,
      "/barrel.js": `export * from "./a.js"; export * from "./b.js"; export * from "./c.js";`,
      "/a.js": `export const x = 1;`,
      "/b.js": `export { x } from "./shared.js";`,
      "/c.js": `export { x } from "./shared.js";`,
      "/shared.js": `export { x } from "./a.js";`,
    },
    run: { stdout: "1" },
  });
  itBundled("edgecase/NonAsciiPathDerivedWrapperName", {
    files: {
      "/entry.ts": /* js */ `
        const a = require("./模块.cjs");
        const b = require("./foo\u2014bar.cjs");
        console.log(a.x, b.y);
      `,
      "/模块.cjs": /* js */ `
        module.exports = { x: 42 };
      `,
      "/foo\u2014bar.cjs": /* js */ `
        module.exports = { y: 7 };
      `,
    },
    target: "node",
    run: { stdout: "42 7" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // ID_Continue code points in the path basename are preserved.
      expect(out).toContain("require_模块");
      expect(out).not.toContain("require_模_");
      expect(out).not.toContain("require___");
      // Non-ID_Continue code points (U+2014 em dash) are still replaced with _.
      expect(out).toContain("require_foo_bar");
      expect(out).not.toContain("require_foo\u2014bar");
    },
  });
  // `delete (null ?? ns.x)` evaluates its operand to a value, so the result is
  // `true` with no side effect. When bundling rewrites `ns.x` to the local
  // binding (EImportIdentifier) after folding `??`, the printer must re-wrap
  // the operand so `delete` still sees a value instead of the binding itself.
  // Without the wrap the output is `delete x`, a strict-mode SyntaxError.
  itBundled("edgecase/DeleteFoldedNamespacePropertyRef", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from "./m.js";
        console.log(delete (null ?? ns.x), ns.x);
        console.log(delete (0, ns.x), ns.x);
        console.log(delete (true ? ns.x : 0), ns.x);
      `,
      "/m.js": /* js */ `
        export let x = 1;
      `,
    },
    onAfterBundle: api => {
      const code = api.readFile("out.js");
      expect(code).not.toMatch(/delete\s+x\b/);
      expect(code).not.toMatch(/delete\s+ns\.x\b/);
    },
    run: { stdout: "true 1\ntrue 1\ntrue 1" },
  });
  itBundled("edgecase/DeleteFoldedNamespacePropertyRefMinify", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from "./m.js";
        console.log(delete (null ?? ns.x), ns.x);
      `,
      "/m.js": /* js */ `
        export let x = 1;
      `,
    },
    minifySyntax: true,
    minifyWhitespace: true,
    run: { stdout: "true 1" },
  });
  // Same path via a direct named import: the identifier becomes an
  // EImportIdentifier during the visit pass.
  itBundled("edgecase/DeleteFoldedImportedBindingRef", {
    files: {
      "/entry.js": /* js */ `
        import { x } from "./m.js";
        console.log(delete (null ?? x), x);
      `,
      "/m.js": /* js */ `
        export let x = 1;
      `,
    },
    onAfterBundle: api => {
      expect(api.readFile("out.js")).not.toMatch(/delete\s+x\b/);
    },
    run: { stdout: "true 1" },
  });
  // The bundler rewrites bare `require`/`require.main`/`require.resolve` to an
  // ERequireCallTarget / ERequireMain / ERequireResolveCallTarget that prints
  // as `__require` / `__require.main` / `__require.resolve`.
  itBundled("edgecase/DeleteFoldedRequireRefs", {
    files: {
      "/entry.js": /* js */ `
        console.log(delete (null ?? require));
        console.log(delete (null ?? require.main));
        console.log(delete (null ?? require.resolve));
      `,
    },
    onAfterBundle: api => {
      const code = api.readFile("out.js");
      expect(code).not.toMatch(/delete\s+__require\b/);
      expect(code).not.toMatch(/delete\s+require\b/);
    },
    run: { stdout: "true\ntrue\ntrue" },
  });
  // The visit pass substitutes unbound `undefined` to EUndefined, which
  // `print_undefined` emits as the bare identifier when not minifying.
  itBundled("edgecase/DeleteFoldedUndefinedRef", {
    files: {
      "/entry.js": /* js */ `
        console.log(delete (null ?? undefined));
      `,
    },
    onAfterBundle: api => {
      expect(api.readFile("out.js")).not.toMatch(/delete\s+undefined\b/);
    },
    run: { stdout: "true" },
  });
  // `import.meta.main` is rewritten to EImportMetaMain; under `target: node`
  // that prints as `__require.main == __require.module` without its own paren
  // wrap, so an unwrapped `delete` would bind to `__require.main`.
  itBundled("edgecase/DeleteFoldedImportMetaMainRef", {
    files: {
      "/entry.js": /* js */ `
        console.log(delete (null ?? import.meta.main));
      `,
    },
    onAfterBundle: api => {
      expect(api.readFile("out.js")).not.toMatch(/delete\s+import\.meta\.main\b/);
    },
    run: { stdout: "true" },
  });
  itBundled("edgecase/DeleteFoldedImportMetaMainRefNode", {
    files: {
      "/entry.js": /* js */ `
        console.log(delete (null ?? import.meta.main));
      `,
    },
    target: "node",
    onAfterBundle: api => {
      expect(api.readFile("out.js")).not.toMatch(/delete\s+__require\.main\b/);
    },
    run: { runtime: "node", stdout: "true" },
  });
  // A same-file `const enum` member is inlined to an EInlinedEnum wrapping an
  // ENumber during the visit pass, so the NaN/Infinity check has to look
  // through the wrapper.
  itBundled("edgecase/DeleteFoldedInlinedConstEnumNaN", {
    files: {
      "/entry.ts": /* ts */ `
        const enum E { N = 0/0, I = 1/0, V = 1 }
        console.log(delete (null ?? E.N), delete (null ?? E.I), delete (null ?? E.V));
      `,
    },
    onAfterBundle: api => {
      const code = api.readFile("out.js");
      expect(code).not.toMatch(/delete\s+NaN\b/);
      expect(code).not.toMatch(/delete\s+Infinity\b/);
    },
    run: { stdout: "true true true" },
  });
  // https://github.com/oven-sh/bun/issues/14509
  // A require() in the catch handler of a try/catch is the common "fallback
  // require" pattern and should not fail the build when unresolvable.
  itBundled("edgecase/RequireInCatchBody", {
    files: {
      "/entry.js": /* js */ `
        let v;
        try {
          v = require('pkg');
        } catch (e) {
          v = require('pkg/sub.cjs');
        }
        console.log(v);
      `,
      "/node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        exports: { ".": "./index.js" },
      }),
      "/node_modules/pkg/index.js": `module.exports = "main";`,
    },
    target: "bun",
    run: { stdout: "main" },
  });
  itBundled("edgecase/RequireInCatchBodyFromNodeModules", {
    files: {
      "/entry.js": `console.log(require('lib'));`,
      "/node_modules/lib/package.json": JSON.stringify({ name: "lib", main: "index.js" }),
      "/node_modules/lib/index.js": /* js */ `
        let v;
        try {
          v = require('pkg');
        } catch (e) {
          v = require('pkg/dist/node/pkg.cjs');
        }
        module.exports = v;
      `,
      "/node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        exports: { ".": "./index.js" },
      }),
      "/node_modules/pkg/index.js": `module.exports = "pkg-main";`,
    },
    target: "bun",
    run: { stdout: "pkg-main" },
  });
  itBundled("edgecase/RequireInCatchBodyBothUnresolved", {
    files: {
      "/entry.js": /* js */ `
        exports.load = function () {
          try {
            return require('does-not-exist-a');
          } catch (e) {
            return require('does-not-exist-b');
          }
        };
      `,
    },
    target: "bun",
    runtimeFiles: {
      "/test.js": /* js */ `
        const { load } = require('./out.js');
        try {
          load();
          console.log("no throw");
        } catch (e) {
          console.log("threw: " + e.message.includes("does-not-exist-b"));
        }
      `,
    },
    run: { file: "/test.js", stdout: "threw: true" },
  });
  itBundled("edgecase/RequireResolveInCatchBody", {
    files: {
      "/entry.js": /* js */ `
        let v;
        try {
          v = require.resolve('does-not-exist-a');
        } catch (e) {
          v = require.resolve('does-not-exist-b');
        }
        console.log(typeof v);
      `,
    },
    target: "bun",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("does-not-exist-b");
    },
  });
  itBundled("edgecase/AwaitImportInCatchBody", {
    files: {
      "/entry.js": /* js */ `
        async function load() {
          try {
            return await import('does-not-exist-a');
          } catch (e) {
            return await import('does-not-exist-b');
          }
        }
        load().catch(e => console.log("caught"));
      `,
    },
    target: "bun",
    run: { stdout: "caught" },
  });
  itBundled("edgecase/RequireInFinallyStillErrors", {
    files: {
      "/entry.js": /* js */ `
        try {
          console.log("ok");
        } catch (e) {
        } finally {
          require('does-not-exist');
        }
      `,
    },
    target: "bun",
    bundleErrors: {
      "/entry.js": [`Could not resolve: "does-not-exist". Maybe you need to "bun install"?`],
    },
  });
  itBundled("edgecase/RequireAfterCatchBodyStillErrors", {
    files: {
      "/entry.js": /* js */ `
        try {
          require('does-not-exist-a');
        } catch (e) {
          require('does-not-exist-b');
        }
        require('does-not-exist-c');
      `,
    },
    target: "bun",
    bundleErrors: {
      "/entry.js": [`Could not resolve: "does-not-exist-c". Maybe you need to "bun install"?`],
    },
  });
  // A resolved-but-disabled path (node builtin under --target=browser, or a
  // `"browser": { "pkg": false }` remap) in a try/catch body must keep emitting
  // the empty-module stub, not a runtime throw.
  itBundled("edgecase/RequireDisabledInCatchBodyStaysEmpty", {
    files: {
      "/entry.js": /* js */ `
        try {
          throw 0;
        } catch (e) {
          const a = require('fs');
          const b = require('mapped-false');
          if (a instanceof Error || b instanceof Error) throw new Error("unreachable");
          console.log("ok");
        }
      `,
      "/package.json": JSON.stringify({ name: "app", browser: { "mapped-false": false } }),
      "/node_modules/mapped-false/package.json": JSON.stringify({ name: "mapped-false", main: "index.js" }),
      "/node_modules/mapped-false/index.js": `module.exports = "real";`,
    },
    target: "browser",
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("Cannot require module");
    },
    run: { stdout: "ok" },
  });
  itBundled("edgecase/RequireDisabledInTryBodyStaysEmpty", {
    files: {
      "/entry.js": /* js */ `
        let hit = "";
        try {
          const x = require('mapped-false');
          hit = "try:" + (x instanceof Error);
        } catch (e) {
          hit = "catch:" + e.message;
        }
        console.log(hit);
      `,
      "/package.json": JSON.stringify({ name: "app", browser: { "mapped-false": false } }),
      "/node_modules/mapped-false/package.json": JSON.stringify({ name: "mapped-false", main: "index.js" }),
      "/node_modules/mapped-false/index.js": `module.exports = "real";`,
    },
    target: "browser",
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("Cannot require module");
    },
    run: { stdout: "try:false" },
  });
  // A sloppy-mode file may declare `arguments`/`eval`. ESM output is always
  // strict, so bundling such a file to ESM is an error in the file, while the
  // non-strict output formats keep the declaration as written.
  itBundled("edgecase/SloppyArgumentsDeclarationESMOutputIsAnError", {
    files: {
      "/entry.js": /* js */ `
        var arguments = 1;
        console.log(arguments);
      `,
    },
    format: "esm",
    bundleErrors: {
      "/entry.js": [
        'Declarations with the name "arguments" cannot be used with the ESM output format due to strict mode',
      ],
    },
  });
  itBundled("edgecase/SloppyEvalFunctionDeclarationESMOutputIsAnError", {
    files: {
      "/entry.js": /* js */ `
        function eval() {}
        console.log(typeof eval);
      `,
    },
    format: "esm",
    bundleErrors: {
      "/entry.js": ['Declarations with the name "eval" cannot be used with the ESM output format due to strict mode'],
    },
  });
  itBundled("edgecase/SloppyArgumentsDeclarationCJSOutput", {
    files: {
      "/entry.js": /* js */ `
        var arguments = 1;
        console.log(arguments);
      `,
    },
    format: "cjs",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("var arguments = 1;");
    },
  });
  itBundled("edgecase/SloppyArgumentsDeclarationIIFEOutput", {
    files: {
      "/entry.js": /* js */ `
        var arguments = 1;
        console.log(arguments);
      `,
    },
    format: "iife",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("var arguments = 1;");
    },
  });

  // Without code splitting, each entry point gets its own output file, even when
  // entry points import each other. Each file runs its modules in the order that
  // its own entry point imports them, so it prints what the unbundled entry prints.
  itBundled("edgecase/EntryPointsImportEachOther", {
    files: {
      "/a.ts": /* ts */ `
        import { b } from "./b.ts";
        export function a() { return "a"; }
        console.log("a runs, b() is", b());
      `,
      "/b.ts": /* ts */ `
        import { a } from "./a.ts";
        export function b() { return "b"; }
        console.log("b runs, a() is", a());
      `,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "b runs, a() is a\na runs, b() is b" },
      { file: "/out/b.js", stdout: "a runs, b() is b\nb runs, a() is a" },
    ],
  });
  itBundled("edgecase/EntryPointImportsEntryPointModuleOrder", {
    files: {
      "/a.ts": `import "./c.ts"; import "./b.ts"; console.log("a");`,
      "/b.ts": `import "./d.ts"; console.log("b");`,
      "/c.ts": `console.log("c");`,
      "/d.ts": `console.log("d");`,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "c\nd\nb\na" },
      { file: "/out/b.js", stdout: "d\nb" },
    ],
  });
  itBundled("edgecase/CSSEntryPointsImportEachOther", {
    files: {
      "/a.css": `@import "./b.css"; .a { color: red }`,
      "/b.css": `@import "./a.css"; .b { color: blue }`,
    },
    entryPoints: ["/a.css", "/b.css"],
    outdir: "/out",
    minifyWhitespace: true,
    onAfterBundle(api) {
      api.expectFile("/out/a.css").toEqualIgnoringWhitespace(".b{color:#00f}.a{color:red}");
      api.expectFile("/out/b.css").toEqualIgnoringWhitespace(".a{color:red}.b{color:#00f}");
    },
  });
  // With --format=cjs, the module.exports of each output holds the exports of its
  // own entry point, also when the file of another entry point prints in it.
  itBundled("edgecase/EntryPointsImportEachOtherCommonJS", {
    files: {
      "/a.ts": `import { b } from "./b.ts"; export function a() { return b(); }`,
      "/b.ts": `import { a } from "./a.ts"; export function b() { return "b"; } export const useA = () => a;`,
    },
    runtimeFiles: {
      "/check.js": `console.log(JSON.stringify([require("./out/a.js"), require("./out/b.js")].map(Object.keys)));`,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    outdir: "/out",
    format: "cjs",
    run: { file: "/check.js", stdout: `[["a"],["b","useA"]]` },
  });
  itBundled("edgecase/EntryPointImportsEntryPointCommonJS", {
    files: {
      "/index.ts": `import { x } from "./lib.ts"; export const y = x + 1;`,
      "/lib.ts": `export * from "ext"; export const x = 1;`,
    },
    runtimeFiles: {
      "/node_modules/ext/index.js": `module.exports = { fromExt: true };`,
      "/check.js": `console.log(JSON.stringify([require("./out/index.js"), require("./out/lib.js")]));`,
    },
    entryPoints: ["/index.ts", "/lib.ts"],
    outdir: "/out",
    external: ["ext"],
    target: "node",
    format: "cjs",
    run: { file: "/check.js", stdout: `[{"y":2},{"x":1,"fromExt":true}]` },
  });
  // A file that something require()s gets an ESM wrapper. When all of its
  // top-level statements hoist, the wrapper is empty and is not printed, so the
  // output of that entry point has no wrapper to call.
  itBundled("edgecase/EntryPointRequiredByEntryPointCommonJS", {
    files: {
      "/a.ts": `const b = require("./b.ts"); export const fromA = b.x;`,
      "/b.ts": `export const x = 1; export const y = 2;`,
    },
    runtimeFiles: {
      "/check.js": `console.log(JSON.stringify([require("./out/a.js"), require("./out/b.js")]));`,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    outdir: "/out",
    format: "cjs",
    run: { file: "/check.js", stdout: `[{"fromA":1},{"x":1,"y":2}]` },
  });
  itBundled("edgecase/RequiredEntryPointWithoutWrapperCommonJS", {
    files: {
      "/entry.ts": `export function load() { return require("./c.ts"); } export const x = 1;`,
      "/c.ts": `module.exports = require("./entry.ts");`,
    },
    runtimeFiles: {
      "/check.js": `const m = require("./out.js"); console.log(JSON.stringify(m), m.load() === m);`,
    },
    format: "cjs",
    run: { file: "/check.js", stdout: `{"x":1} true` },
  });
  // With --format=esm, the exports of each output are the exports of its own
  // entry point. An `export * from` of a module outside the bundle prints in the
  // output of the entry point that re-exports it. Where the file of that entry
  // point prints in the output of another one, it only loads the module.
  for (const backend of ["cli", "api"] as const) {
    itBundled(`edgecase/EntryPointImportsEntryPointExternalExportStar${backend === "api" ? "API" : ""}`, {
      backend,
      files: {
        "/lib.js": `export * from "pkx"; export const b = 2;`,
        "/namespace.js": `import * as lib from "./lib.js"; console.log("namespace", lib.b);`,
        "/bare.js": `import "./lib.js"; console.log("bare");`,
        "/named.js": `import { b } from "./lib.js"; console.log("named", b);`,
        "/own-star.js": `import "./lib.js"; export * from "pky";`,
        "/chain.js": `export * from "./lib.js"; export const c = 3;`,
      },
      runtimeFiles: {
        "/node_modules/pkx/index.js": `console.log("pkx"); export const a = "pkx";`,
        "/node_modules/pky/index.js": `export const a = "pky"; export const y = 1;`,
        "/check.js": /* js */ `
          import * as lib from "./out/lib.js";
          import * as namespace from "./out/namespace.js";
          import * as bare from "./out/bare.js";
          import * as named from "./out/named.js";
          import * as ownStar from "./out/own-star.js";
          import * as chain from "./out/chain.js";
          console.log(JSON.stringify([lib, namespace, bare, named, ownStar, chain]));
        `,
      },
      entryPoints: ["/lib.js", "/namespace.js", "/bare.js", "/named.js", "/own-star.js", "/chain.js"],
      outdir: "/out",
      external: ["pkx", "pky"],
      onAfterBundle(api) {
        // In its own output the statement stays where lib.js has it.
        const lib = api.readFile("/out/lib.js");
        expect(lib.match(/export \* from "pkx";/g)).toHaveLength(1);
        expect(lib.indexOf(`export * from "pkx";`)).toBeLessThan(lib.indexOf("var b = 2"));
      },
      run: [
        { file: "/out/namespace.js", stdout: "pkx\nnamespace 2" },
        { file: "/out/bare.js", stdout: "pkx\nbare" },
        {
          file: "/check.js",
          stdout: `pkx\nnamespace 2\nbare\nnamed 2\n[{"a":"pkx","b":2},{},{},{},{"a":"pky","y":1},{"a":"pkx","b":2,"c":3}]`,
        },
      ],
    });
  }
  for (const [name, specifier, target] of [
    ["Node", "node:path", "node"],
    ["Bun", "bun", "bun"],
  ] as const) {
    itBundled(`edgecase/EntryPointImportsEntryPointBuiltinExportStar${name}`, {
      files: {
        "/lib.js": `export * from "${specifier}"; export const b = 2;`,
        "/namespace.js": `import * as lib from "./lib.js"; console.log("namespace", lib.b);`,
      },
      runtimeFiles: {
        "/check.js": /* js */ `
          import * as lib from "./out/lib.js";
          import * as namespace from "./out/namespace.js";
          console.log(JSON.stringify([Object.keys(lib).length > 1, lib.b, Object.keys(namespace)]));
        `,
      },
      entryPoints: ["/lib.js", "/namespace.js"],
      outdir: "/out",
      target,
      run: { file: "/check.js", stdout: `namespace 2\n[true,2,[]]` },
    });
  }
  // An entry point re-exports the names of an external module that it reaches
  // through `export *` of a bundled file too. A file of a package with
  // "sideEffects": false does not print where nothing reads its exports. The
  // statement at the end of index.js is then the only import of "pkx" in that
  // output, so "pkx" loads after "pky".
  itBundled("edgecase/EntryPointExternalExportStarThroughBundledFile", {
    files: {
      "/lib/package.json": `{ "name": "lib", "type": "module", "sideEffects": false }`,
      "/lib/index.js": `export * from "./sub.js"; import "pky"; export const c = 3;`,
      "/lib/only.js": `export * from "./sub.js";`,
      "/lib/sub.js": `export * from "pkx";`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `console.log("pkx"); export const a = 1;`,
      "/node_modules/pky/index.js": `console.log("pky");`,
      "/check.js": /* js */ `
        import * as index from "./out/index.js";
        import * as only from "./out/only.js";
        import * as sub from "./out/sub.js";
        console.log(JSON.stringify([index, only, sub]));
      `,
    },
    entryPoints: ["/lib/index.js", "/lib/only.js", "/lib/sub.js"],
    outdir: "/out",
    external: ["pkx", "pky"],
    run: [
      { file: "/out/index.js", stdout: "pky\npkx" },
      { file: "/check.js", stdout: `pky\npkx\n[{"a":1,"c":3},{"a":1},{"a":1}]` },
    ],
  });
  // The file with the statement does not have to be an entry point.
  itBundled("edgecase/EntryPointExternalExportStarThroughNonEntryFile", {
    files: {
      "/index.js": `export * from "./mid.js"; export const c = 3;`,
      "/mid.js": `export * from "bun"; export const m = 1;`,
    },
    runtimeFiles: {
      "/check.js": /* js */ `
        import * as index from "./out/index.js";
        console.log(typeof index.file, index.c, index.m);
      `,
    },
    entryPoints: ["/index.js"],
    outdir: "/out",
    target: "bun",
    run: { file: "/check.js", stdout: "function 3 1" },
  });
  itBundled("edgecase/EntryPointExternalExportStarThroughNonEntryFilePackage", {
    files: {
      "/index.js": `export * from "./mid.js"; export const c = 3;`,
      "/mid.js": `export * from "pkx"; export const m = 1;`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `export const a = 1;`,
      "/check.js": /* js */ `
        import * as index from "./out/index.js";
        console.log(JSON.stringify(index));
      `,
    },
    entryPoints: ["/index.js"],
    outdir: "/out",
    external: ["pkx"],
    onAfterBundle(api) {
      const index = api.readFile("/out/index.js");
      expect(index.match(/export \* from "pkx";/g)).toHaveLength(1);
      // mid.js only loads the module. No exports object copies its names.
      expect(index).not.toContain("__reExport");
    },
    run: { file: "/check.js", stdout: `{"a":1,"c":3,"m":1}` },
  });
  // A relative path of an external module prints as written. The end of an
  // output file repeats one only when that file already imports it: there the
  // statement is sure to name the same file. lib.js has a wrapper here.
  itBundled("edgecase/EntryPointExternalExportStarRelativePathOfWrappedFile", {
    files: {
      "/lib.js": `export * from "./ext.js"; export const b = 2;`,
      "/required.js": `export const b = require("./lib.js").b;`,
      "/ext.js": `export const a = 1;`,
    },
    runtimeFiles: {
      "/out/ext.js": `export const a = 1;`,
      "/check.js": /* js */ `
        import * as lib from "./out/lib.js";
        import * as required from "./out/required.js";
        console.log(JSON.stringify([lib, required]));
      `,
    },
    entryPoints: ["/lib.js", "/required.js"],
    outdir: "/out",
    external: ["{{root}}/ext.js"],
    target: "bun",
    onAfterBundle(api) {
      expect(api.readFile("/out/required.js")).not.toContain("export *");
    },
    run: { file: "/check.js", stdout: `[{"a":1,"b":2},{"b":2}]` },
  });
  // Nothing of mid.js prints in the output of index.js, so no statement there
  // imports "./ext.js", and the name `a` is missing. To print the path of an
  // external module relative to each output file is a change of its own.
  itBundled("edgecase/EntryPointExternalExportStarRelativePath", {
    todo: true,
    files: {
      "/lib/package.json": `{ "name": "lib", "type": "module", "sideEffects": false }`,
      "/lib/index.js": `export * from "./mid.js"; export const c = 3;`,
      "/lib/mid.js": `export * from "./ext.js";`,
      "/lib/ext.js": `export const a = 1;`,
    },
    runtimeFiles: {
      "/out/ext.js": `export const a = 1;`,
      "/check.js": /* js */ `
        import * as index from "./out/index.js";
        console.log(JSON.stringify(index));
      `,
    },
    entryPoints: ["/lib/index.js", "/lib/mid.js"],
    outdir: "/out",
    external: ["{{root}}/lib/ext.js"],
    run: { file: "/check.js", stdout: `{"a":1,"c":3}` },
  });
  // The output of index.js has the code of sub/mid.js, and so its import of
  // "./ext.js" as written. The statement at the end names that same file.
  itBundled("edgecase/EntryPointExternalExportStarRelativePathBesideItsImport", {
    files: {
      "/lib/index.js": `export * from "./sub/mid.js"; export const c = 3;`,
      "/lib/sub/mid.js": `export * from "./ext.js";`,
      "/lib/sub/ext.js": `export const a = 1;`,
    },
    runtimeFiles: {
      "/out/ext.js": `export const a = 1;`,
      "/check.js": /* js */ `
        import * as index from "./out/index.js";
        console.log(JSON.stringify(index));
      `,
    },
    entryPoints: ["/lib/index.js", "/lib/sub/mid.js"],
    outputPaths: ["/out/index.js", "/out/sub/mid.js"],
    outdir: "/out",
    external: ["{{root}}/lib/sub/ext.js"],
    onAfterBundle(api) {
      const statements = (file: string) => api.readFile(file).match(/^(?:import|export \* from) ?"[^"]+";/gm);
      expect(statements("/out/index.js")).toEqual([`import"./ext.js";`, `export * from "./ext.js";`]);
      expect(statements("/out/sub/mid.js")).toEqual([`export * from "./ext.js";`]);
    },
    run: { file: "/check.js", stdout: `{"a":1,"c":3}` },
  });
  itBundled("edgecase/EntryPointExternalExportStarRelativePathOfOtherDirectory", {
    // The same with mid.js in another directory: the statement that the output
    // of index.js needs names "./sub/ext.js".
    todo: true,
    files: {
      "/lib/package.json": `{ "name": "lib", "type": "module", "sideEffects": false }`,
      "/lib/index.js": `export * from "./sub/mid.js"; export const c = 3;`,
      "/lib/sub/mid.js": `export * from "./ext.js";`,
      "/lib/sub/ext.js": `export const a = 1;`,
    },
    runtimeFiles: {
      "/out/sub/ext.js": `export const a = 1;`,
      "/check.js": /* js */ `
        import * as index from "./out/index.js";
        console.log(JSON.stringify(index));
      `,
    },
    entryPoints: ["/lib/index.js", "/lib/sub/mid.js"],
    outputPaths: ["/out/index.js", "/out/sub/mid.js"],
    outdir: "/out",
    external: ["{{root}}/lib/sub/ext.js"],
    run: { file: "/check.js", stdout: `{"a":1,"c":3}` },
  });
  // `require()` and, without --splitting, `import()` put the file they load in
  // a wrapper function. An `export * from` cannot print there: the file imports
  // the module next to its wrapper and the tail of its output re-exports it.
  itBundled("edgecase/EntryPointExternalExportStarOfWrappedFile", {
    files: {
      "/lib.js": `export * from "pkx"; export const b = 2;`,
      "/required.js": `export const b = require("./lib.js").b;`,
      "/imported.js": `export const b = import("./lib.js").then(lib => lib.b);`,
      "/self.js": `export * from "pkx"; export const b = 2; export const self = import("./self.js");`,
      "/commonjs.js": `module.exports = { b: require("./lib.js").b };`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `console.log("pkx"); export const a = 1;`,
      "/check.js": /* js */ `
        import * as lib from "./out/lib.js";
        import * as required from "./out/required.js";
        import * as imported from "./out/imported.js";
        import * as self from "./out/self.js";
        import commonjs from "./out/commonjs.js";
        console.log(
          JSON.stringify([lib, required, await imported.b, Object.keys(self), (await self.self).b, commonjs]),
        );
      `,
    },
    entryPoints: ["/lib.js", "/required.js", "/imported.js", "/self.js", "/commonjs.js"],
    outdir: "/out",
    external: ["pkx"],
    target: "bun",
    run: [
      { file: "/out/required.js", stdout: "pkx" },
      { file: "/out/imported.js", stdout: "pkx" },
      { file: "/check.js", stdout: `pkx\n[{"a":1,"b":2},{"b":2},2,["a","b","self"],2,{"b":2}]` },
    ],
  });
  // A file that uses `exports` gets a CommonJS wrapper, and the namespace of
  // its output is its default export alone. The import prints next to the wrapper.
  itBundled("edgecase/EntryPointExternalExportStarInCommonJSWrapper", {
    files: {
      "/entry.js": `exports.b = 2; console.log(typeof exports); export * from "pkx";`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `console.log("pkx"); export const a = 1;`,
      "/check.js": /* js */ `
        import * as entry from "./out/entry.js";
        console.log(JSON.stringify(entry));
      `,
    },
    outdir: "/out",
    external: ["pkx"],
    target: "bun",
    run: { file: "/check.js", stdout: `pkx\nobject\n{"default":{"b":2}}` },
  });
  // top.js reaches "pkx" through its own statement and through mid.js. Its
  // output re-exports each module once, in the order of the statements.
  for (const [name, options, other] of [
    ["", {}, `export const t = 1;`],
    ["Wrapped", {}, `export const t = require("./top.js").t;`],
    ["Splitting", { splitting: true }, `import { t } from "./top.js"; export { t };`],
  ] as const) {
    itBundled(`edgecase/EntryPointExternalExportStarOncePerModule${name}`, {
      files: {
        "/top.js": `export * from "pkx"; export * from "./mid.js"; export const t = 1;`,
        "/mid.js": `export * from "pkx"; export * from "pky"; export const m = 2;`,
        "/other.js": other,
      },
      runtimeFiles: {
        "/node_modules/pkx/index.js": `export const a = 1;`,
        "/node_modules/pky/index.js": `export const y = 3;`,
        "/check.js": /* js */ `
          import * as top from "./out/top.js";
          import * as mid from "./out/mid.js";
          console.log(JSON.stringify([top, mid]));
        `,
      },
      entryPoints: ["/top.js", "/mid.js", "/other.js"],
      outdir: "/out",
      external: ["pkx", "pky"],
      target: "bun",
      ...options,
      onAfterBundle(api) {
        const statements = (file: string) => api.readFile(file).match(/export \* from "pk.";/g);
        expect(statements("/out/top.js")).toEqual([`export * from "pkx";`, `export * from "pky";`]);
        expect(statements("/out/mid.js")).toEqual([`export * from "pkx";`, `export * from "pky";`]);
      },
      run: { file: "/check.js", stdout: `[{"a":1,"m":2,"t":1,"y":3},{"a":1,"m":2,"y":3}]` },
    });
  }
  // A re-export that no export of a TypeScript file matches can be a type. If
  // the file has an external `export *`, it can also be a value of that module,
  // which only that module knows. So the output reads it off the namespace of
  // the module: a type is an export with the value `undefined`. That holds
  // through through.ts too, and value-again.ts re-exports what value.ts has.
  for (const splitting of [false, true]) {
    itBundled(`edgecase/EntryPointExternalExportStarValueReExportTypeScript${splitting ? "Splitting" : ""}`, {
      files: {
        "/lib.ts": `export * from "pkx"; export const b = 2; export type Options = { b: number };`,
        "/through.ts": `export * from "./lib.ts";`,
        "/value.ts": `export { a } from "./lib.ts"; export * from "pky"; export const d = 4;`,
        "/value-again.ts": `export { a } from "./value.ts"; export const g = 7;`,
        "/value-through.ts": `export { a } from "./through.ts"; export const e = 5;`,
        "/types.ts": `export { Options } from "./lib.ts"; export const own = 1;`,
      },
      runtimeFiles: {
        "/node_modules/pkx/index.js": `export const a = 1;`,
        "/node_modules/pky/index.js": `export const y = 3;`,
        "/check.js": /* js */ `
          import * as value from "./out/value.js";
          import * as valueAgain from "./out/value-again.js";
          import * as valueThrough from "./out/value-through.js";
          import * as types from "./out/types.js";
          console.log(JSON.stringify([value, valueAgain, valueThrough, types, Object.keys(types)]));
        `,
      },
      entryPoints: ["/lib.ts", "/value.ts", "/value-again.ts", "/value-through.ts", "/types.ts"],
      outdir: "/out",
      external: ["pkx", "pky"],
      splitting,
      run: {
        file: "/check.js",
        stdout: `[{"a":1,"d":4,"y":3},{"a":1,"g":7},{"a":1,"e":5},{"own":1},["Options","own"]]`,
      },
    });
  }
  // index.ts has the name `Options`: its own re-export of a type of types.ts.
  // The linker drops that one in index.ts, where no external module can have
  // the name, so extra.ts does not read it off "pkx" either.
  itBundled("edgecase/EntryPointExternalExportStarTypeReExportOfOtherFileTypeScript", {
    files: {
      "/index.ts": `export * from "pkx"; export { Options } from "./types.ts"; export const b = 2;`,
      "/types.ts": `export interface Options { b: number } export const t = 1;`,
      "/extra.ts": `export { Options } from "./index.ts"; export const extra = 1;`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `export const a = 1;`,
      "/check.js": /* js */ `
        import * as index from "./out/index.js";
        import * as extra from "./out/extra.js";
        console.log(JSON.stringify([index, extra]));
      `,
    },
    entryPoints: ["/index.ts", "/extra.ts"],
    outdir: "/out",
    external: ["pkx"],
    run: { file: "/check.js", stdout: `[{"a":1,"b":2},{"extra":1}]` },
  });
  // `export *` does not re-export `default`, so no external module can have it:
  // both reads are as silent as they are without the `export *`.
  itBundled("edgecase/EntryPointExternalExportStarDefaultIsNotReExported", {
    files: {
      "/lib.ts": `export * from "pkx"; export const b = 2;`,
      "/reexport.ts": `export { default } from "./lib.ts"; export const h = 8;`,
      "/imported.js": `import("./lib.ts").then(lib => console.log(lib.default, lib.b));`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `export const a = 1; export default "pkx";`,
      "/check.js": /* js */ `
        import * as reexport from "./out/reexport.js";
        console.log(JSON.stringify(reexport));
      `,
    },
    entryPoints: ["/lib.ts", "/reexport.ts", "/imported.js"],
    outdir: "/out",
    external: ["pkx"],
    target: "bun",
    run: [
      { file: "/out/imported.js", stdout: "undefined 2" },
      { file: "/check.js", stdout: `{"h":8}` },
    ],
  });
  // Only an external module knows the names that `export * from` takes from
  // it. Another file of the bundle still reads them through the file that has
  // the statement: a name is a property of the namespace that the statement
  // imports, and an exports object gets the names when the output loads.
  for (const [name, options] of [
    ["", {}],
    ["Splitting", { splitting: true }],
    ["Node", { target: "node" }],
    ["NodeSplitting", { target: "node", splitting: true }],
    ["Bun", { target: "bun" }],
    ["BunSplitting", { target: "bun", splitting: true }],
    ["API", { backend: "api" }],
    ["Minify", { minifyIdentifiers: true, minifySyntax: true, minifyWhitespace: true }],
  ] as const) {
    itBundled(`edgecase/ExternalExportStarNameReadThroughEntryPoint${name}`, {
      files: {
        "/lib.js": `export * from "pkx"; export const b = 2;`,
        "/named.js": `import { a, b } from "./lib.js"; console.log("named", a, b);`,
        "/namespace.js": `import * as lib from "./lib.js"; console.log("namespace", lib.a, lib.b);`,
        "/keys.js": `import * as lib from "./lib.js"; console.log("keys", Object.keys(lib).sort().join());`,
        "/required.js": `const lib = require("./lib.js"); console.log("required", lib.a, lib.b);`,
        "/imported.js": `const lib = await import("./lib.js"); console.log("imported", lib.a, lib.b);`,
        "/reexport.js": `export { a } from "./lib.js";`,
      },
      runtimeFiles: {
        "/node_modules/pkx/index.js": `export const a = 1;`,
        "/check.js": /* js */ `
          const exports = {};
          for (const name of ["lib", "named", "namespace", "keys", "required", "imported", "reexport"]) {
            exports[name] = Object.keys(await import("./out/" + name + ".js")).join();
          }
          console.log(JSON.stringify(exports));
        `,
      },
      entryPoints: [
        "/lib.js",
        "/named.js",
        "/namespace.js",
        "/keys.js",
        "/required.js",
        "/imported.js",
        "/reexport.js",
      ],
      outdir: "/out",
      external: ["pkx"],
      ...options,
      run: {
        file: "/check.js",
        stdout:
          "named 1 2\nnamespace 1 2\nkeys a,b\nrequired 1 2\nimported 1 2\n" +
          `{"lib":"a,b","named":"","namespace":"","keys":"","required":"default","imported":"","reexport":"a"}`,
      },
    });
  }
  // Each reader is also the one file that reads through lib.js: every other
  // reader changes what lib.js keeps and which namespace the output imports.
  for (const [name, options] of [
    ["", {}],
    ["Bun", { target: "bun" }],
  ] as const) {
    for (const [reader, source, stdout] of [
      ["Named", `import { a, b } from "./lib.js"; console.log("named", a, b);`, `named 1 2\n{"lib":"a,b","reader":""}`],
      [
        "Namespace",
        `import * as lib from "./lib.js"; console.log("namespace", lib.a, lib.b);`,
        `namespace 1 2\n{"lib":"a,b","reader":""}`,
      ],
      [
        "Keys",
        `import * as lib from "./lib.js"; console.log("keys", Object.keys(lib).sort().join());`,
        `keys a,b\n{"lib":"a,b","reader":""}`,
      ],
      [
        "Required",
        `const lib = require("./lib.js"); console.log("required", lib.a, lib.b);`,
        `required 1 2\n{"lib":"a,b","reader":"default"}`,
      ],
      [
        "Imported",
        `const lib = await import("./lib.js"); console.log("imported", lib.a, lib.b);`,
        `imported 1 2\n{"lib":"a,b","reader":""}`,
      ],
      ["ReExported", `export { a } from "./lib.js";`, `{"lib":"a,b","reader":"a"}`],
    ] as const) {
      itBundled(`edgecase/ExternalExportStarNameReadThroughEntryPoint${reader}${name}`, {
        files: {
          "/lib.js": `export * from "pkx"; export const b = 2;`,
          "/reader.js": source,
        },
        runtimeFiles: {
          "/node_modules/pkx/index.js": `export const a = 1;`,
          "/check.js": /* js */ `
            const exports = {};
            for (const name of ["lib", "reader"]) {
              exports[name] = Object.keys(await import("./out/" + name + ".js")).join();
            }
            console.log(JSON.stringify(exports));
          `,
        },
        entryPoints: ["/lib.js", "/reader.js"],
        outdir: "/out",
        external: ["pkx"],
        ...options,
        run: { file: "/check.js", stdout },
      });
    }
  }
  // A read of a name is a property of the namespace that the statement
  // imports. Each output that has the file imports the module once, and no
  // exports object copies the names.
  itBundled("edgecase/ExternalExportStarNameReadPrintsNamespaceImport", {
    files: {
      "/lib.js": `export * from "pkx"; export const b = 2;`,
      "/named.js": `import { a, c } from "./lib.js"; console.log(a, c);`,
      "/namespace.js": `import * as lib from "./lib.js"; import { a } from "./lib.js"; console.log(lib.a, lib.c, a);`,
      "/static.js": `import { b } from "./lib.js"; console.log(b);`,
    },
    entryPoints: ["/lib.js", "/named.js", "/namespace.js", "/static.js"],
    outdir: "/out",
    external: ["pkx"],
    onAfterBundle(api) {
      for (const file of ["lib", "named", "namespace", "static"]) {
        const code = api.readFile(`/out/${file}.js`);
        expect(code.match(/^import.*"pkx";$/gm)).toEqual([`import * as pkx from "pkx";`]);
        expect(code).not.toContain("exports_lib");
        expect(code).not.toContain("__reExport");
      }
      expect(api.readFile("/out/lib.js")).toContain(`export * from "pkx";`);
      expect(api.readFile("/out/named.js")).toContain("console.log(pkx.a, pkx.c);");
    },
  });
  // Without a read of a name of the module, the statement imports no namespace.
  itBundled("edgecase/ExternalExportStarWithoutNameReadImportsNoNamespace", {
    files: {
      "/lib.js": `export * from "pkx"; export const b = 2;`,
      "/static.js": `import { b } from "./lib.js"; console.log(b);`,
      "/bare.js": `import "./lib.js";`,
    },
    entryPoints: ["/lib.js", "/static.js", "/bare.js"],
    outdir: "/out",
    external: ["pkx"],
    onAfterBundle(api) {
      expect(api.readFile("/out/lib.js").match(/^(?:import|export \*).*"pkx";$/gm)).toEqual([`export * from "pkx";`]);
      for (const file of ["static", "bare"]) {
        const code = api.readFile(`/out/${file}.js`);
        expect(code.match(/^import.*"pkx";$/gm)).toEqual([`import"pkx";`]);
        expect(code).not.toContain("exports_lib");
      }
    },
  });
  // The same holds when the file with the statement is not an entry point.
  // Each reader is also the one entry point of a build.
  {
    const readers = {
      named: [`import { a, own } from "./barrel.js"; console.log("named", a, own);`, "named 1 5\n0"],
      namespace: [
        `import * as barrel from "./barrel.js"; console.log("namespace", barrel.a, barrel.own);`,
        "namespace 1 5\n0",
      ],
      keys: [
        `import * as barrel from "./barrel.js"; console.log("keys", Object.keys(barrel).sort().join());`,
        "keys a,own\n0",
      ],
      required: [
        `const barrel = require("./barrel.js"); console.log("required", barrel.a, barrel.own);`,
        "required 1 5\n1",
      ],
      imported: [
        `const barrel = await import("./barrel.js"); console.log("imported", barrel.a, barrel.own);`,
        "imported 1 5\n0",
      ],
      bare: [`import "./barrel.js"; console.log("bare");`, "bare\n0"],
      static: [`import { own } from "./barrel.js"; console.log("static", own);`, "static 5\n0"],
      through: [
        `import { a } from "./through-star.js"; import { a as a2 } from "./through-name.js"; console.log("through", a, a2);`,
        "through 1 1\n0",
      ],
    };
    for (const entries of [Object.keys(readers), ...Object.keys(readers).map(reader => [reader])]) {
      const name = entries.length === 1 ? entries[0][0].toUpperCase() + entries[0].slice(1) : "";
      itBundled(`edgecase/ExternalExportStarNameReadThroughNonEntryFile${name}`, {
        files: {
          ...Object.fromEntries(Object.entries(readers).map(([reader, [source]]) => [`/${reader}.js`, source])),
          "/through-star.js": `export * from "./barrel.js";`,
          "/through-name.js": `export { a } from "./barrel.js";`,
          "/barrel.js": `export * from "pkx"; export const own = 5;`,
        },
        runtimeFiles: {
          "/node_modules/pkx/index.js": `console.log("pkx"); export const a = 1;`,
          "/check.js": /* js */ `
            for (const name of ${JSON.stringify(entries)}) {
              console.log(Object.keys(await import("./out/" + name + ".js")).length);
            }
          `,
        },
        entryPoints: entries.map(reader => `/${reader}.js`),
        outdir: "/out",
        external: ["pkx"],
        onAfterBundle(api) {
          // A name read off `require()` or `import()` is a property of the exports object, which copies the names.
          for (const file of ["required", "imported"].filter(file => entries.includes(file))) {
            const code = api.readFile(`/out/${file}.js`);
            expect(code).toContain("__reExport(exports_barrel, pkx);");
            expect(code).toContain(`console.log("${file}", barrel.a, own);`);
          }
        },
        run: { file: "/check.js", stdout: "pkx\n" + entries.map(reader => readers[reader][1]).join("\n") },
      });
    }
  }
  // Without a reader of its exports object, such a file only imports the module.
  itBundled("edgecase/ExternalExportStarOfNonEntryFileHasNoExportsObject", {
    files: {
      "/named.js": `import { a, own } from "./barrel.js"; console.log("named", a, own);`,
      "/namespace.js": `import * as barrel from "./barrel.js"; console.log("namespace", barrel.a, barrel.own);`,
      "/bare.js": `import "./barrel.js"; console.log("bare");`,
      "/barrel.js": `export * from "pkx"; export const own = 5;`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `export const a = 1;`,
    },
    entryPoints: ["/named.js", "/namespace.js", "/bare.js"],
    outdir: "/out",
    external: ["pkx"],
    onAfterBundle(api) {
      for (const file of ["named", "namespace", "bare"]) {
        const code = api.readFile(`/out/${file}.js`);
        expect(code.match(/^import.*"pkx";$/gm)).toEqual([`import * as pkx from "pkx";`]);
        expect(code).not.toContain("exports_barrel");
        expect(code).not.toContain("__reExport");
      }
    },
    run: [
      { file: "/out/named.js", stdout: "named 1 5" },
      { file: "/out/namespace.js", stdout: "namespace 1 5" },
      { file: "/out/bare.js", stdout: "bare" },
    ],
  });
  // A file of a package with "sideEffects": false prints only what a reader
  // needs. A read of a name keeps the statement, which imports the module.
  // Each reader is also the one entry point of a build: every other reader
  // changes what the file keeps.
  {
    const readers = {
      named: [`import { a } from "lib"; console.log("named", a);`, "named 1"],
      namespace: [`import * as lib from "lib"; console.log("namespace", lib.a);`, "namespace 1"],
      keys: [`import * as lib from "lib"; console.log("keys", Object.keys(lib).sort().join());`, "keys a,own"],
      required: [`const lib = require("lib"); console.log("required", lib.a, lib.own);`, "required 1 1"],
      imported: [`const lib = await import("lib"); console.log("imported", lib.a, lib.own);`, "imported 1 1"],
      through: [`import { a } from "through"; console.log("through", a);`, "through 1"],
      throughKeys: [
        `import * as through from "through"; console.log("throughKeys", Object.keys(through).sort().join());`,
        "throughKeys a,own",
      ],
    };
    for (const [entries, splitting] of [
      [Object.keys(readers), false],
      ...Object.keys(readers).map(reader => [[reader], false]),
      [["through"], true],
      [["throughKeys"], true],
    ] as [string[], boolean][]) {
      const name =
        (entries.length === 1 ? entries[0][0].toUpperCase() + entries[0].slice(1) : "") +
        (splitting ? "Splitting" : "");
      itBundled(`edgecase/ExternalExportStarNameReadThroughSideEffectFreeFile${name}`, {
        files: {
          ...Object.fromEntries(Object.entries(readers).map(([reader, [source]]) => [`/${reader}.js`, source])),
          "/node_modules/lib/package.json": `{ "name": "lib", "type": "module", "sideEffects": false }`,
          "/node_modules/lib/index.js": `export * from "pkx"; export const own = 1;`,
          "/node_modules/through/package.json": `{ "name": "through", "type": "module", "sideEffects": false }`,
          "/node_modules/through/index.js": `export * from "lib";`,
        },
        runtimeFiles: {
          "/node_modules/pkx/index.js": `export const a = 1;`,
        },
        entryPoints: entries.map(reader => `/${reader}.js`),
        outdir: "/out",
        external: ["pkx"],
        splitting,
        run: entries.map(reader => ({ file: `/out/${reader}.js`, stdout: readers[reader][1] })),
      });
    }
  }
  // The file with the statement is lazily initialized, and the read reaches it
  // through an `export *` of a package with "sideEffects": false. Nothing keeps
  // that `export *`, which is what initializes the file: its code does not run.
  // The same holds for a name of the file itself, without an external module.
  for (const [name, reader, stdout] of [
    ["NamedRead", `import { a, own } from "hop"; console.log(a, own);`, "lib runs\n1 1"],
    [
      "KeysThroughTwoFiles",
      `import * as hops from "hops"; console.log(Object.keys(hops).sort().join());`,
      "lib runs\na,own",
    ],
  ] as const) {
    itBundled(`edgecase/ExternalExportStarOfLazyFileBehindSideEffectFreeExportStar${name}`, {
      todo: true,
      files: {
        "/entry.js": `${reader} export const later = () => import("./lib.js");`,
        "/lib.js": `console.log("lib runs"); export * from "pkx"; export const own = Math.max(1, 1);`,
        "/node_modules/hop/package.json": `{ "name": "hop", "type": "module", "sideEffects": false }`,
        "/node_modules/hop/index.js": `export * from "../../lib.js";`,
        "/node_modules/hops/package.json": `{ "name": "hops", "type": "module", "sideEffects": false }`,
        "/node_modules/hops/index.js": `export * from "hop";`,
      },
      runtimeFiles: {
        "/node_modules/pkx/index.js": `export const a = 1;`,
      },
      outdir: "/out",
      external: ["pkx"],
      run: { file: "/out/entry.js", stdout },
    });
  }
  // A name that the module does not have reads `undefined`, as every property
  // of a namespace does. Node fails to link a named import of such a name.
  itBundled("edgecase/ExternalExportStarMissingName", {
    files: {
      "/lib.js": `export * from "pkx"; export const b = 2;`,
      "/ok.js": `import { a } from "./lib.js"; console.log("ok", a);`,
      "/missing.js": `import { zz } from "./lib.js"; console.log("missing", zz);`,
      "/property.js": `import * as lib from "./lib.js"; console.log("property", lib.zz);`,
      "/default.js": `import * as lib from "./lib.js"; console.log("default", lib.default);`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `export const a = 1; export default "pkx";`,
      "/check.js": /* js */ `
        for (const name of ["lib", "ok", "missing", "property", "default"]) {
          await import("./out/" + name + ".js").catch(error => console.log(name, error.name));
        }
      `,
    },
    entryPoints: ["/lib.js", "/ok.js", "/missing.js", "/property.js", "/default.js"],
    outdir: "/out",
    external: ["pkx"],
    bundleWarnings: {
      "/default.js": [`Import "default" will always be undefined because there is no matching export in "lib.js"`],
    },
    run: { file: "/check.js", stdout: "ok 1\nmissing undefined\nproperty undefined\ndefault undefined" },
  });
  // `export *` does not re-export `default`, so the module cannot give it:
  // the import fails to link, as in node. lib.js is an entry point or not.
  // Each reader is its own build: the linker stops at the first file that fails.
  for (const [name, lib] of [
    ["", ["/lib.js"]],
    ["OfNonEntryFile", []],
  ] as const) {
    for (const [reader, file, target] of [
      ["Imported", "/imported.js", "lib.js"],
      ["ReExported", "/reexported.js", "lib.js"],
      ["Through", "/through.js", "star.js"],
    ] as const) {
      itBundled(`edgecase/ExternalExportStarDefaultImportIsNotAName${reader}${name}`, {
        files: {
          "/lib.js": `export * from "pkx"; export const b = 2;`,
          "/imported.js": `import value, { b } from "./lib.js"; console.log(value, b);`,
          "/reexported.js": `export { default } from "./lib.js";`,
          "/through.js": `import value from "./star.js"; console.log(value);`,
          "/star.js": `export * from "./lib.js";`,
        },
        entryPoints: [...lib, file],
        outdir: "/out",
        external: ["pkx"],
        bundleErrors: {
          [file]: [`No matching export in "${target}" for import "default"`],
        },
      });
    }
  }
  // In CommonJS output the statement runs, and the read is `undefined`.
  itBundled("edgecase/ExternalExportStarDefaultImportCommonJSOutput", {
    files: {
      "/lib.js": `export * from "pkx"; export const b = 2;`,
      "/entry.js": `import value, { a, b } from "./lib.js"; console.log(value, a, b);`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `export const a = 1; export default "pkx";`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    format: "cjs",
    external: ["pkx"],
    run: { file: "/out/entry.js", stdout: "undefined 1 2" },
  });
  // A call of the name prints `pkx.who()`, so `this` is the namespace of the
  // module. Node gives `undefined` there.
  itBundled("edgecase/ExternalExportStarNameCalledWithNamespaceAsThis", {
    files: {
      "/lib.js": `export * from "pkx";`,
      "/entry.js": `import { who } from "./lib.js"; console.log(who());`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `export function who() { return this === undefined ? "undefined" : typeof this; }`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    external: ["pkx"],
    run: { file: "/out/entry.js", stdout: "object" },
  });
  // The file with the statement reads the names through itself, and a file
  // that it imports reads them before the rest of it runs.
  itBundled("edgecase/ExternalExportStarNameReadInOwnChunk", {
    files: {
      "/self.js": /* js */ `
        import * as self from "./self.js";
        import { a } from "./self.js";
        export * from "pkx";
        export const shared = 2;
        console.log("self", a, self.a, Object.keys(self).sort().join());
      `,
      "/cycle.js": `export * from "pkx"; import "./cycle-reader.js"; export const b = 1;`,
      "/cycle-reader.js": `import * as cycle from "./cycle.js"; import { a } from "./cycle.js"; console.log("cycle", cycle.a, a, "a" in cycle);`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `export const a = 1;`,
      "/check.js": /* js */ `
        import * as self from "./out/self.js";
        import * as cycle from "./out/cycle.js";
        console.log(JSON.stringify([self, cycle]));
      `,
    },
    entryPoints: ["/self.js", "/cycle.js"],
    outdir: "/out",
    external: ["pkx"],
    run: { file: "/check.js", stdout: `self 1 1 a,shared\ncycle 1 1 true\n[{"a":1,"shared":2},{"a":1,"b":1}]` },
  });
  // Two re-exports of one name of the module are one binding, so the name is
  // not ambiguous where `export *` of both re-exports gives it twice.
  itBundled("edgecase/ExternalExportStarNameThroughTwoReExports", {
    files: {
      "/named.js": `import { a } from "./top.js"; console.log("named", a);`,
      "/namespace.js": `import * as top from "./top.js"; console.log("namespace", top.a, Object.keys(top).join());`,
      "/nested.js": `import { ns } from "./nested-namespace.js"; console.log("nested", ns.a, Object.keys(ns).join());`,
      "/reexport.js": `export { a } from "./top.js";`,
      "/nested-namespace.js": `export * as ns from "./top.js";`,
      "/top.js": `export * from "./first.js"; export * from "./second.js";`,
      "/first.js": `export { a } from "./lib.js";`,
      "/second.js": `export { a } from "./lib.js";`,
      "/lib.js": `export * from "pkx"; export const b = 1;`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `export const a = 1;`,
      "/check.js": /* js */ `
        import "./out/named.js";
        import "./out/namespace.js";
        import "./out/nested.js";
        import * as reexport from "./out/reexport.js";
        console.log(JSON.stringify(reexport));
      `,
    },
    entryPoints: ["/named.js", "/namespace.js", "/nested.js", "/reexport.js"],
    outdir: "/out",
    external: ["pkx"],
    run: { file: "/check.js", stdout: `named 1\nnamespace 1 a\nnested 1 a\n{"a":1}` },
  });
  // An entry point exports the name through `export *` of a file that
  // re-exports it by name. The export is a copy of the property too.
  for (const splitting of [false, true]) {
    itBundled(`edgecase/ExternalExportStarNameReExportedThroughExportStar${splitting ? "Splitting" : ""}`, {
      files: {
        "/entry.js": `export * from "./named.js"; export const own = 1;`,
        "/other.js": `import { n } from "./named.js"; console.log(n);`,
        "/named.js": `export { a } from "./lib.js"; export const n = 2;`,
        "/lib.js": `export * from "pkx";`,
      },
      runtimeFiles: {
        "/node_modules/pkx/index.js": `export const a = 1;`,
        "/check.js": /* js */ `
          import * as entry from "./out/entry.js";
          console.log(JSON.stringify(entry));
        `,
      },
      entryPoints: ["/entry.js", "/other.js"],
      outdir: "/out",
      external: ["pkx"],
      splitting,
      run: { file: "/check.js", stdout: `{"a":1,"n":2,"own":1}` },
    });
  }
  // A read in the bundle is a live read of the module. A re-export of the name
  // by an entry point is a copy, taken when the output loads. Node gives 3 there.
  itBundled("edgecase/ExternalExportStarNameReadIsLive", {
    files: {
      "/lib.js": `export * from "pkx";`,
      "/entry.js": /* js */ `
        import { n } from "./lib.js";
        import { increment } from "pkx";
        export { n } from "./lib.js";
        increment();
        console.log(n);
      `,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `export let n = 1; export function increment() { n++; }`,
      "/check.js": /* js */ `
        import { n } from "./out/entry.js";
        import { increment } from "pkx";
        increment();
        console.log(n);
      `,
    },
    entryPoints: ["/lib.js", "/entry.js"],
    outdir: "/out",
    external: ["pkx"],
    run: { file: "/check.js", stdout: "2\n2" },
  });
  // With two modules, only the modules know which of them has a name. A read
  // takes it off the exports object, which has the names of both.
  itBundled("edgecase/ExternalExportStarOfTwoModules", {
    files: {
      "/lib.js": `export * from "pkx"; export * from "pky"; export const b = 2;`,
      "/named.js": `import { a, y, b } from "./lib.js"; console.log("named", a, y, b);`,
      "/namespace.js": `import * as lib from "./lib.js"; console.log("namespace", lib.a, lib.y, lib.zz, Object.keys(lib).sort().join());`,
      "/reexport.js": `export { a, y } from "./lib.js";`,
      "/through.js": `import { y } from "./reexport.js"; import { a } from "./star.js"; console.log("through", a, y);`,
      "/star.js": `export * from "./lib.js";`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `export const a = 1;`,
      "/node_modules/pky/index.js": `export const y = 3;`,
      "/check.js": /* js */ `
        import * as lib from "./out/lib.js";
        import "./out/named.js";
        import "./out/namespace.js";
        import * as reexport from "./out/reexport.js";
        import "./out/through.js";
        console.log(JSON.stringify([lib, reexport]));
      `,
    },
    entryPoints: ["/lib.js", "/named.js", "/namespace.js", "/reexport.js", "/through.js"],
    outdir: "/out",
    external: ["pkx", "pky"],
    run: {
      file: "/check.js",
      stdout: `named 1 3 2\nnamespace 1 3 undefined a,b,y\nthrough 1 3\n[{"a":1,"b":2,"y":3},{"a":1,"y":3}]`,
    },
  });
  // A file that has an `export *` of a CommonJS file too copies the exports of
  // that file where the statement runs. Its exports object has the names of
  // the module before any file runs, so the module wins a name that both have,
  // whatever the order of the two statements.
  for (const [name, lib, entryPoints] of [
    ["", `export * from "./commonjs.cjs"; export * from "pkx"; export const b = 2;`, ["/lib.js", "/entry.js"]],
    [
      "ExternalFirst",
      `export * from "pkx"; export * from "./commonjs.cjs"; export const b = 2;`,
      ["/lib.js", "/entry.js"],
    ],
    ["OfNonEntryFile", `export * from "./commonjs.cjs"; export * from "pkx"; export const b = 2;`, ["/entry.js"]],
    [
      "ExternalFirstOfNonEntryFile",
      `export * from "pkx"; export * from "./commonjs.cjs"; export const b = 2;`,
      ["/entry.js"],
    ],
  ] as const) {
    itBundled(`edgecase/ExternalExportStarBesideCommonJSExportStar${name}`, {
      files: {
        "/lib.js": lib,
        "/commonjs.cjs": `const keys = ["c", "both"]; module.exports[keys[0]] = 7; module.exports[keys[1]] = "commonjs";`,
        "/entry.js": /* js */ `
          import { a, c, both } from "./lib.js";
          import * as lib from "./lib.js";
          console.log(a, c, both, Object.keys(lib).sort().join());
        `,
      },
      runtimeFiles: {
        "/node_modules/pkx/index.js": `export const a = 1; export const both = "external";`,
      },
      entryPoints: [...entryPoints],
      outdir: "/out",
      external: ["pkx"],
      run: { file: "/out/entry.js", stdout: "1 7 external a,b,both,c" },
    });
  }
  // Such a file in a package with "sideEffects": false: a read by name does not
  // keep the exports object that it prints (the CommonJS half of #18008).
  itBundled("edgecase/ExternalExportStarBesideCommonJSExportStarSideEffectFree", {
    todo: true,
    files: {
      "/entry.js": `import { a, c } from "lib"; console.log(a, c);`,
      "/node_modules/lib/package.json": `{ "name": "lib", "sideEffects": false }`,
      "/node_modules/lib/index.js": `export * from "./commonjs.cjs"; export * from "pkx";`,
      "/node_modules/lib/commonjs.cjs": `const key = "c"; module.exports[key] = 7;`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `export const a = 1;`,
    },
    outdir: "/out",
    external: ["pkx"],
    run: { file: "/out/entry.js", stdout: "1 7" },
  });
  // `import()` returns the names too, next to a static import of one of them.
  for (const splitting of [false, true]) {
    itBundled(`edgecase/ExternalExportStarNameBesideDynamicImport${splitting ? "Splitting" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          import { a } from "./lib.js";
          const lib = await import("./lib.js");
          console.log(a, lib.a, Object.keys(lib).sort().join());
        `,
        "/lib.js": `export * from "pkx"; export const own = 5;`,
      },
      runtimeFiles: {
        "/node_modules/pkx/index.js": `export const a = 1;`,
      },
      outdir: "/out",
      external: ["pkx"],
      splitting,
      run: { file: "/out/entry.js", stdout: "1 1 a,own" },
    });
  }
  // A relative path prints as written, so only an output that has the
  // statement is sure to name the same file with it. Every read is a property
  // of the namespace that the statement imports, so no other path prints.
  // With --splitting, `import()` returns the exports of the chunk of lib.js,
  // and the end of that chunk repeats a relative path only beside its import.
  for (const [name, options, readers] of [
    ["", {}, ["named", "namespace", "keys", "required", "imported"]],
    ["Splitting", { splitting: true }, ["named", "namespace", "keys", "required"]],
    ["OfNonEntryFile", { entryPoints: [] }, ["named", "namespace", "keys", "required", "imported"]],
  ] as const) {
    const stdout = {
      named: "named 1 2 undefined",
      namespace: "namespace 1 2 undefined",
      keys: "keys a,b",
      required: "required 1 2",
      imported: "imported 1 2",
    };
    itBundled(`edgecase/ExternalExportStarRelativePathNameRead${name}`, {
      files: {
        "/lib.js": `export * from "./ext.js"; export const b = 2;`,
        "/named.js": `import { a, b, zz } from "./lib.js"; console.log("named", a, b, zz);`,
        "/namespace.js": `import * as lib from "./lib.js"; console.log("namespace", lib.a, lib.b, lib.zz);`,
        "/keys.js": `import * as lib from "./lib.js"; console.log("keys", Object.keys(lib).sort().join());`,
        "/required.js": `const lib = require("./lib.js"); console.log("required", lib.a, lib.b);`,
        "/imported.js": `const lib = await import("./lib.js"); console.log("imported", lib.a, lib.b);`,
        "/ext.js": `export const a = 1;`,
      },
      runtimeFiles: {
        "/out/ext.js": `export const a = 1;`,
      },
      outdir: "/out",
      external: ["{{root}}/ext.js"],
      ...options,
      entryPoints: [...(options.entryPoints ?? ["/lib.js"]), ...readers.map(reader => `/${reader}.js`)],
      run: readers.map(reader => ({ file: `/out/${reader}.js`, stdout: stdout[reader] })),
    });
  }
  // Two files of one directory name one file with one relative path: that is
  // one module. Its names bind to the namespace of the first statement, and
  // the exports object copies them once.
  for (const splitting of [false, true]) {
    itBundled(`edgecase/ExternalExportStarRelativePathTwoStatements${splitting ? "Splitting" : ""}`, {
      files: {
        "/named.js": `import { a, one, two } from "./root.js"; console.log("named", a, one, two);`,
        "/namespace.js": `import * as root from "./root.js"; console.log("namespace", root.a, root.one, root.two);`,
        "/keys.js": `import * as root from "./root.js"; console.log("keys", Object.keys(root).sort().join());`,
        "/root.js": `export * from "./first.js"; export * from "./second.js";`,
        "/first.js": `export * from "./ext.js"; export const one = 1;`,
        "/second.js": `export * from "./ext.js"; export const two = 2;`,
        "/ext.js": `export const a = 1;`,
      },
      runtimeFiles: {
        "/out/ext.js": `console.log("ext"); export const a = 1;`,
      },
      entryPoints: ["/named.js", "/namespace.js", "/keys.js"],
      outdir: "/out",
      external: ["{{root}}/ext.js"],
      splitting,
      onAfterBundle(api) {
        if (splitting) return;
        expect(api.readFile("/out/named.js")).toContain(`console.log("named", ext.a, one, two);`);
        expect(api.readFile("/out/keys.js").match(/^__reExport\(.*$/gm)).toEqual(["__reExport(exports_root, ext);"]);
      },
      run: [
        { file: "/out/named.js", stdout: "ext\nnamed 1 1 2" },
        { file: "/out/namespace.js", stdout: "ext\nnamespace 1 1 2" },
        { file: "/out/keys.js", stdout: "ext\nkeys a,one,two" },
      ],
    });
  }
  // Two directories give the one path two meanings. Both print as written, so
  // the output names one file twice and the second module's names are lost (#25144).
  itBundled("edgecase/ExternalExportStarRelativePathOfTwoDirectories", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        import { fromA, fromB } from "./root.js";
        import * as root from "./root.js";
        console.log(fromA, fromB, Object.keys(root).sort().join());
      `,
      "/root.js": `export * from "./a/lib.js"; export * from "./b/lib.js";`,
      "/a/lib.js": `export * from "./ext.js";`,
      "/b/lib.js": `export * from "./ext.js";`,
      "/a/ext.js": `export const fromA = "A";`,
      "/b/ext.js": `export const fromB = "B";`,
    },
    outdir: "/out",
    external: ["{{root}}/a/ext.js", "{{root}}/b/ext.js"],
    run: { file: "/out/entry.js", stdout: "A B fromA,fromB" },
  });
  // Issue #15997, the comment of 2026-10-30: an `external` pattern that is a relative path.
  itBundled("edgecase/ExternalExportStarRelativeExternalPattern", {
    files: {
      "/entry.ts": `import { answer } from "./barrel"; console.log(answer);`,
      "/barrel.ts": `export * from "./core";`,
      "/core.ts": `export const answer = 42;`,
    },
    runtimeFiles: {
      "/out/core.js": `export const answer = 42;`,
    },
    outdir: "/out",
    external: ["./core"],
    target: "browser",
    backend: "api",
    run: { file: "/out/entry.js", stdout: "42" },
  });
  // Issue #15997: the file with the statement also imports a name of the module.
  itBundled("edgecase/ExternalExportStarBesideImportOfTheModule", {
    files: {
      "/entry.ts": `import { convertPrivateKey, createHash } from "./http.ts"; console.log(typeof createHash, convertPrivateKey());`,
      "/http.ts": /* ts */ `
        export * from "node:crypto";
        import { createPrivateKey } from "node:crypto";
        export function convertPrivateKey() { return typeof createPrivateKey; }
      `,
    },
    target: "bun",
    run: { stdout: "function function" },
  });
  // Two files in CommonJS wrappers read one name, beside a binding of the
  // entry point with that name. The module has one import in the output.
  for (const splitting of [false, true]) {
    itBundled(`edgecase/ExternalExportStarNameReadInCommonJSWrappers${splitting ? "Splitting" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          const first = require("./first.js");
          const second = require("./second.js");
          const a = "own";
          console.log(first.a, second.a, second.keys, a);
        `,
        "/first.js": `import { a } from "./lib.js"; module.exports = { a };`,
        "/second.js": /* js */ `
          import { a } from "./lib.js";
          import * as lib from "./lib.js";
          module.exports = { a: lib.a + a, keys: Object.keys(lib).sort().join() };
        `,
        "/lib.js": `export * from "pkx"; export const own = 5;`,
      },
      runtimeFiles: {
        "/node_modules/pkx/index.js": `export const a = 1;`,
      },
      outdir: "/out",
      external: ["pkx"],
      splitting,
      onAfterBundle(api) {
        expect(api.readFile("/out/entry.js").match(/^import.*"pkx";$/gm)).toEqual([`import * as pkx from "pkx";`]);
      },
      run: { file: "/out/entry.js", stdout: "1 2 a,own own" },
    });
  }
  // A read of a name keeps the statement: the module loads where the statement
  // loads it, before "pkz". setup.js has no wrapper, so its code runs too. Tree
  // shaking drops lib/index.js, which has no side effects.
  itBundled("edgecase/ExternalExportStarNameReadKeepsLoadOrder", {
    files: {
      "/named.js": `import { a } from "lib"; import "pkz"; console.log("named", a);`,
      "/namespace.js": `import * as lib from "lib"; import "pkz"; console.log("namespace", lib.a);`,
      "/node_modules/lib/package.json": `{ "name": "lib", "type": "module", "sideEffects": ["./setup.js"] }`,
      "/node_modules/lib/index.js": `export * from "./setup.js"; export const own = 1;`,
      "/node_modules/lib/setup.js": `export * from "pkx"; console.log("setup");`,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `console.log("pkx"); export const a = 1;`,
      "/node_modules/pkz/index.js": `console.log("pkz");`,
    },
    entryPoints: ["/named.js", "/namespace.js"],
    outdir: "/out",
    external: ["pkx", "pkz"],
    run: [
      { file: "/out/named.js", stdout: "pkx\npkz\nsetup\nnamed 1" },
      { file: "/out/namespace.js", stdout: "pkx\npkz\nsetup\nnamespace 1" },
    ],
  });
  // A module that the browser target disables has no names: a read of one is
  // `undefined`, and the exports object copies nothing. A property of the
  // namespace says so at build time, and a TypeScript file drops the
  // re-export, as it does without the statement.
  itBundled("edgecase/ExternalExportStarOfDisabledModule", {
    files: {
      "/package.json": `{ "browser": { "./disabled.js": false } }`,
      "/lib.js": `export * from "./disabled.js"; export const b = 1;`,
      "/lib-ts.ts": `export * from "./disabled.js"; export const b = 1;`,
      "/disabled.js": `export const a = 1;`,
      "/named.js": `import { a, b } from "./lib.js"; console.log("named", a, b);`,
      "/namespace.js": `import * as lib from "./lib.js"; console.log("namespace", Object.keys(lib).join(), lib.a, lib.b);`,
      "/imported.js": `const lib = await import("./lib.js"); console.log("imported", Object.keys(lib).join(), lib.a, lib.b);`,
      "/reexported.js": `export { a, b } from "./lib.js";`,
      "/reexported-ts.ts": `export { a, b } from "./lib-ts.ts";`,
    },
    runtimeFiles: {
      "/check.js": /* js */ `
        for (const name of ["reexported", "reexported-ts"]) {
          console.log(name, JSON.stringify(Object.entries(await import("./out/" + name + ".js"))));
        }
      `,
    },
    entryPoints: ["/named.js", "/namespace.js", "/imported.js", "/reexported.js", "/reexported-ts.ts"],
    outdir: "/out",
    target: "browser",
    bundleWarnings: {
      "/namespace.js": [`Import "a" will always be undefined because there is no matching export in "lib.js"`],
    },
    run: [
      { file: "/out/named.js", stdout: "named undefined 1" },
      { file: "/out/namespace.js", stdout: "namespace b undefined 1" },
      { file: "/out/imported.js", stdout: "imported b undefined 1" },
      { file: "/check.js", stdout: `reexported [["a",null],["b",1]]\nreexported-ts [["b",1]]` },
    ],
  });
  // Beside a module that has names, the disabled module adds none: the names
  // bind to the namespace of the other statement.
  itBundled("edgecase/ExternalExportStarOfDisabledModuleBesideExternalModule", {
    files: {
      "/package.json": `{ "browser": { "./disabled.js": false } }`,
      "/lib.js": `export * from "./disabled.js"; export * from "pkx"; export const b = 1;`,
      "/disabled.js": `export const a = "disabled";`,
      "/entry.js": /* js */ `
        import { a, b } from "./lib.js";
        import * as lib from "./lib.js";
        console.log(a, b, lib.a, Object.keys(lib).sort().join());
      `,
    },
    runtimeFiles: {
      "/node_modules/pkx/index.js": `export const a = 1;`,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    target: "browser",
    external: ["pkx"],
    onAfterBundle(api) {
      const code = api.readFile("/out/entry.js");
      expect(code.match(/^__reExport\(.*$/gm)).toEqual(["__reExport(exports_lib, pkx);"]);
      expect(code).toContain("console.log(pkx.a, b, pkx.a, ");
    },
    run: { file: "/out/entry.js", stdout: "1 1 1 a,b" },
  });
  // In a lifted CommonJS file, `module.exports = require("ext")` is an
  // `export *` that shares the import record of the `require()`. The chunk of
  // the file names the module once, and imports no namespace of it.
  itBundled("edgecase/ExternalExportStarOfLiftedCommonJSNamesTheModuleOnce", {
    files: {
      "/entry.js": `const lib = await import("react-dom"); console.log(lib.a);`,
      "/node_modules/react-dom/package.json": `{ "name": "react-dom", "main": "index.js" }`,
      "/node_modules/react-dom/index.js": `console.log("side effect"); module.exports = require("ext");`,
    },
    runtimeFiles: {
      "/node_modules/ext/index.js": `exports.a = 1;`,
    },
    outdir: "/out",
    target: "node",
    splitting: true,
    external: ["ext"],
    onAfterBundle(api) {
      const chunk = readdirSync(api.outdir).find(file => file.startsWith("index-"));
      expect(api.readFile(`/out/${chunk}`).match(/^.*"ext".*$/gm)).toEqual([`export * from "ext";`]);
    },
    run: { file: "/out/entry.js", stdout: "side effect\n1" },
  });
  // No external module here. An entry point exports, through `export *`, a name
  // that a file re-exports from a CommonJS file that does not have it: the
  // export stays `undefined`.
  itBundled("edgecase/EntryPointExportStarOfMissingCommonJSReExport", {
    files: {
      "/entry.js": `export * from "./named.js"; export const own = 1;`,
      "/named.js": `export { missing, foo } from "./commonjs.cjs";`,
      "/commonjs.cjs": `exports.foo = 1;`,
    },
    runtimeFiles: {
      "/check.js": /* js */ `
        import * as entry from "./out/entry.js";
        console.log(JSON.stringify(Object.entries(entry)));
      `,
    },
    entryPoints: ["/entry.js"],
    outdir: "/out",
    run: { file: "/check.js", stdout: `[["foo",1],["missing",null],["own",1]]` },
  });
  // Two files re-export one type of lib.ts by name, and index.ts reads it
  // through both. The linker cannot tell the type from a name of "pkx": both
  // re-exports are one property of the namespace of "pkx", so the build has no
  // ambiguous import. The export has the value `undefined`.
  for (const [name, entryPoints] of [
    ["", ["/index.ts"]],
    ["OfEntryPoint", ["/index.ts", "/lib.ts"]],
  ] as const) {
    itBundled(`edgecase/ExternalExportStarTypeReExportedTwiceTypeScript${name}`, {
      files: {
        "/index.ts": `export { Options, one, two } from "./both.ts";`,
        "/both.ts": `export * from "./first.ts"; export * from "./second.ts";`,
        "/first.ts": `export { Options } from "./lib.ts"; export const one = 1;`,
        "/second.ts": `export { Options } from "./lib.ts"; export const two = 2;`,
        "/lib.ts": `export * from "pkx"; export type Options = { b: number }; export const b = 1;`,
      },
      runtimeFiles: {
        "/node_modules/pkx/index.js": `export const a = 1;`,
        "/check.js": /* js */ `
          import * as index from "./out/index.js";
          console.log(Object.keys(index).join(), JSON.stringify(index));
        `,
      },
      entryPoints: [...entryPoints],
      outdir: "/out",
      external: ["pkx"],
      run: { file: "/check.js", stdout: `Options,one,two {"one":1,"two":2}` },
    });
  }
  // "bun" is a module of this kind under --target=bun.
  for (const [name, lib] of [
    ["", ["/lib.js"]],
    ["OfNonEntryFile", []],
  ] as const) {
    itBundled(`edgecase/ExternalExportStarNameOfBunBuiltin${name}`, {
      files: {
        "/lib.js": `export * from "bun"; export const b = 2;`,
        "/named.js": `import { file, b } from "./lib.js"; console.log("named", typeof file, b);`,
        "/namespace.js": `import * as lib from "./lib.js"; console.log("namespace", typeof lib.file, lib.b);`,
        "/keys.js": `import * as lib from "./lib.js"; console.log("keys", Object.keys(lib).includes("file"), lib.b);`,
        "/required.js": `const lib = require("./lib.js"); console.log("required", typeof lib.file, lib.b);`,
        "/imported.js": `const lib = await import("./lib.js"); console.log("imported", typeof lib.file, lib.b);`,
      },
      entryPoints: [...lib, "/named.js", "/namespace.js", "/keys.js", "/required.js", "/imported.js"],
      outdir: "/out",
      target: "bun",
      run: [
        { file: "/out/named.js", stdout: "named function 2" },
        { file: "/out/namespace.js", stdout: "namespace function 2" },
        { file: "/out/keys.js", stdout: "keys true 2" },
        { file: "/out/required.js", stdout: "required function 2" },
        { file: "/out/imported.js", stdout: "imported function 2" },
      ],
    });
  }

  // Standard decorator lowering declares `var _init`, `var _dec` and a WeakMap per
  // accessor or `#private` next to each class. Every class needs its own.
  itBundled("edgecase/StandardDecoratorTemporariesPerClass", {
    files: {
      "/entry.js": /* js */ `
        function Field(_, _c) {}
        function AccessorDecorator(_, c) {
          return { init: () => c.name, get: () => c.name };
        }
        class Entity { @Field id; }
        class Action { @AccessorDecorator accessor success; }
        console.log(new Entity().id);

        const inject = target => (_, ctx) => v => target + ":" + ctx.name + "=" + v;
        class Test1 { @inject("test1") field1 = "a"; }
        class Test2 { @inject("test2") field2 = "b"; }
        console.log(new Test1().field1, new Test2().field2);
      `,
    },
    run: { stdout: "undefined\ntest1:field1=a test2:field2=b" },
  });
  // One decorated class per file: only the bundle puts them in one scope.
  itBundled("edgecase/StandardDecoratorTemporariesAcrossFiles", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./a";
        import { B } from "./b";
        import { Entity } from "./ent";
        import { Action } from "./act";
        new Action();
        console.log(a.x, new B().x, a.read(), new B().read(), new Entity().id);
      `,
      "/a.js": /* js */ `
        function dec(_, _c) {}
        export class A { @dec accessor x = "A.x"; @dec #p = "A.#p"; read() { return this.#p; } }
        export const a = new A();
      `,
      "/b.js": /* js */ `
        function dec(_, _c) {}
        export class B { @dec accessor x = "B.x"; @dec #p = "B.#p"; read() { return this.#p; } }
      `,
      "/ent.js": /* js */ `
        function Field(_, _c) {}
        export class Entity { @Field id; }
      `,
      "/act.js": /* js */ `
        function Acc(_, _c) { return { init: () => "success" }; }
        export class Action { @Acc accessor status; }
      `,
    },
    run: { stdout: "A.x B.x A.#p B.#p undefined" },
  });
  // A `var` in a block belongs to the enclosing function.
  for (const minifyIdentifiers of [false, true]) {
    itBundled(`edgecase/StandardDecoratorTemporariesInSiblingBlocks${minifyIdentifiers ? "Minified" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          function dec(_, _c) {}
          function make() {
            let A, B;
            { A = class { @dec accessor x = "a"; }; }
            { B = class { @dec accessor x = "b"; }; }
            return [new A().x, new B().x];
          }
          let C, D;
          { C = class { @dec accessor x = "c"; }; }
          { D = class { @dec accessor x = "d"; }; }
          console.log(...make(), new C().x, new D().x);
        `,
      },
      minifyIdentifiers,
      run: { stdout: "a b c d" },
    });
  }
  // The `var`s of a class in a parameter default are declared outside the function.
  itBundled("edgecase/StandardDecoratorTemporariesInParameterDefaults", {
    files: {
      "/entry.js": /* js */ `
        function dec(_, _c) {}
        function f(C = class { @dec accessor x = "f"; }) { return C; }
        function g(C = class { @dec accessor x = "g"; }) { return C; }
        const F = f(), G = g();
        console.log(new F().x, new G().x);
      `,
    },
    run: { stdout: "f g" },
  });
  // `recv.#m()` on a lowered private method captures the receiver in a `var _obj`
  // inside the calling method.
  itBundled("edgecase/StandardDecoratorReceiverTemporaryVsUserBinding", {
    files: {
      "/entry.js": /* js */ `
        const _obj = "user";
        function dec(_, _c) {}
        class A {
          @dec #m() { return "m"; }
          call(o) { return o.get().#m() + " " + _obj; }
        }
        const a = new A();
        console.log(a.call({ get: () => a }));
      `,
    },
    run: { stdout: "m user" },
  });

  for (const splitting of [false, true]) {
    itBundled(`edgecase/ImportCycleKeepsEvaluationOrder${splitting ? "Splitting" : ""}`, {
      files: {
        "/entry.ts": /* ts */ `
          import * as all from "./barrel.ts";
          console.log(all.atLoad, all.mentionsDebug(), all.ranAtLoad);
        `,
        "/barrel.ts": /* ts */ `
          export * from "./core.ts";
          export * from "./debug.ts";
          export * from "./later.ts";
        `,
        "/core.ts": /* ts */ `
          import { debugValue, laterValue } from "./barrel.ts";
          export function mentionsDebug() {
            return debugValue();
          }
          export const mentionsLater = () => laterValue;
          const hasOwnProperty = Object.prototype.hasOwnProperty;
          export function hasProperty(object: object, key: string) {
            return hasOwnProperty.call(object, key);
          }
        `,
        "/debug.ts": /* ts */ `
          import { hasProperty } from "./barrel.ts";
          export function debugValue() {
            return 1;
          }
          export const atLoad = hasProperty({ a: 1 }, "a");
        `,
        "/later.ts": /* ts */ `
          import { atLoad, mentionsLater } from "./barrel.ts";
          export const laterValue = "later";
          export const ranAtLoad = String(atLoad) + " " + mentionsLater();
        `,
      },
      splitting,
      format: "esm",
      target: "bun",
      outdir: "/out",
      run: { file: "/out/entry.js", stdout: "true 1 true later" },
    });
  }
});

for (const backend of ["api", "cli"] as const) {
  describe(`bundler_edgecase/${backend}`, () => {
    itBundled("edgecase/ProcessEnvArbitrary", {
      files: {
        "/entry.js": /* js */ `
        capture(process.env.ARBITRARY);
      `,
      },
      target: "browser",
      backend,
      capture: ["process.env.ARBITRARY"],
      env: {
        ARBITRARY: "secret environment stuff!",
      },
    });
  });
}
