import { join } from "node:path";
import { itBundled } from "./expectBundled";
import { describe, expect } from "bun:test";

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
  itBundled("edgecase/ProcessEnvArbitrary", {
    files: {
      "/entry.js": /* js */ `
        capture(process.env.ARBITRARY);
      `,
    },
    target: "browser",
    capture: ["process.env.ARBITRARY"],
    env: {
      ARBITRARY: "secret environment stuff!",
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
        mappingsExactMatch: "uYACA,WAAW,IAAQ,EAAE,ICDrB,eACA,QAAQ,IAAI,CAAK",
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
  });

  // TODO(@paperdave): test every case of this. I had already tested it manually, but it may break later
  const requireTranspilationListESM = [
    // input, output:bun, output:node
    ["require", "import.meta.require", "__require"],
    ["typeof require", "import.meta.require", "typeof __require"],
    ["typeof require", "import.meta.require", "typeof __require"],
  ];

  // itBundled('edgecase/RequireTranspilation')
});
