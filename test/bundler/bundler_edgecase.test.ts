import { describe, expect } from "bun:test";
import { join } from "node:path";
import { itBundled } from "./expectBundled";
import { isBroken, isWindows } from "harness";

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
    todo: true,
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
      stdout: '1 {"ns":2,"default":1,"def2":3}',
    },
  });
  itBundled("edgecase/ExternalES6ConvertedToCommonJSSimplified", {
    todo: true,
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
    loader: {
      ".cool": "wtf",
    },
    bundleErrors: {
      "<bun>": ['invalid loader "wtf", expected one of:'],
    },
  });
  itBundled("edgecase/ScriptTagEscape", {
    todo: true,
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
    todo: true,
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
    todo: true,
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
    todo: true,
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
    todo: true,
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
        123 67
        number
        2
      `,
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
    todo: true,
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
    todo: true,
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
    todo: true,
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
    todo: true,
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
    todo: true,
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
        mappingsExactMatch: "qYACA,WAAW,IAAQ,EAAE,ICDrB,eACA,QAAQ,IAAI,CAAK",
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
    todo: isBroken && isWindows,
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
      stdout: "side effect",
    },
  });
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
        stdout: "file1\nside effect",
      },
      {
        file: "/out/file1b.js",
        stdout: "file2\nside effect",
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
      stdout: "side effect",
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
      stdout: "side effect",
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
        import index from './index.html'
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
    files: {
      "/entry.ts": `
        import index from './index.html'
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

  // TODO(@paperclover): test every case of this. I had already tested it manually, but it may break later
  const requireTranspilationListESM = [
    // input, output:bun, output:node
    ["require", "import.meta.require", "__require"],
    ["typeof require", "import.meta.require", "typeof __require"],
    ["typeof require", "import.meta.require", "typeof __require"],
  ];

  // // itBundled('edgecase/RequireTranspilation')

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
    target: 'bun',
    onAfterBundle(api) {
      api.expectFile('out.js').toMatchInlineSnapshot(`
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
    target: 'node',
    onAfterBundle(api) {
      api.expectFile('out.js').toMatchInlineSnapshot(`
        "// entry.ts
        import * as hello from "node:test";
        import * as world from "node:fs";
        import * as etc from "console";
        +[hello, world, etc];
        "
      `);
    },
  });
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
