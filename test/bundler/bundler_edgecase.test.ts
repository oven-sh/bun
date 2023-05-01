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
    // This only appears at runtime and not with bun build, even with --transform
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
    external: ["external"],
    mode: "transform",
    minifySyntax: true,
    target: "bun",
    run: { file: "/entry.ts" },
  });
  itBundled("edgecase/TemplateStringIssue622", {
    notImplemented: true,
    files: {
      "/entry.ts": /* js */ `
        capture(\`\\?\`);
        capture(hello\`\\?\`);
      `,
    },
    capture: ["`\\\\?`", "hello`\\\\?`"],
    target: "bun",
  });
  itBundled("edgecase/StringNullBytes", {
    files: {
      "/entry.ts": /* js */ `
        capture("Hello\0");
      `,
    },
    capture: ['"Hello\0"'],
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
    },
    external: ["*"],
    runtimeFiles: {
      "/c.js": /* js */ `
        export default 1
        export const ns = 2
        export const def2 = 3
      `,
    },
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
      ".a": "file", // segfaults
      ".b": "text", // InvalidLoader
      ".c": "toml", // InvalidLoader
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
      // todo: get the exact error
      "<bun>": ["InvalidLoader"],
    },
  });
  itBundled("edgecase/ScriptTagEscape", {
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
});
