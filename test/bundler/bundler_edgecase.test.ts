import assert from "assert";
import dedent from "dedent";
import { itBundled, testForFile } from "./expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

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
    notImplemented: true,
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
    notImplemented: true,
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
              "default": "./boop.js",
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
        import React from 'react'
        console.log(React)
      `,
      "/node_modules/react/package.json": /* json */ `
        {
          "name": "react",
          "exports": {
            ".": {
              "react-server": "./ignore.js",
              "default": "./react.js",
            }
          }
        }
      `,
      "/node_modules/react/react.js": /* js */ `
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
        123 67
        number
        2
      `,
    },
  });
  itBundled("edgecase/AbsolutePathShouldNotResolveAsRelative", {
    notImplemented: true,
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
});
