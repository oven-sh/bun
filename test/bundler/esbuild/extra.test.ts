import assert from "assert";
import dedent from "dedent";
import { itBundled, testForFile } from "../expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

// Tests ported from:
// https://github.com/evanw/esbuild
// most of these are from scripts/end-to-end-tests.js but some are from other files

// For debug, all files are written to $TEMP/bun-bundle-tests/extra
describe("bundler", () => {
  itBundled("extra/FileAsDirectoryBreak", {
    files: {
      "/index.js": `
        import foo from "./file.js/what/is/this";
      `,
      "/file.js": `
        export default 123;
      `,
    },
    bundleErrors: {
      "/index.js": [`Could not resolve: "./file.js/what/is/this"`],
    },
  });
  itBundled("extra/PathWithQuestionMark", {
    files: {
      "/index.js": `
        import foo from "./file.js?ignore-me";
        console.log(foo);
      `,
      "/file.js": `
        export default 123;
      `,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("extra/JSXEscaping1", {
    files: {
      "/index.js": `
        let button = <Button content="some so-called \\"button text\\"" />
        console.log(button);
      `,
    },
    external: ["react"],
    bundleErrors: {
      "/index.js": [`Invalid JSX escape - use XML entity codes quotes or pass a JavaScript string instead`],
    },
  });
  itBundled("extra/JSXEscaping2", {
    files: {
      "/index.js": `
        let button = <Button content='some so-called \\'button text\\'' />
        console.log(button);
      `,
    },
    external: ["react"],
    bundleErrors: {
      "/index.js": [`Invalid JSX escape - use XML entity codes quotes or pass a JavaScript string instead`],
    },
  });
  // Test arbitrary module namespace identifier names
  // See https://github.com/tc39/ecma262/pull/2154
  itBundled("extra/ArbitraryModuleNamespaceIdentifiers1", {
    files: {
      "entry.js": `import {'*' as star} from './export.js'; if (star !== 123) throw 'fail'`,
      "export.js": `let foo = 123; export {foo as '*'}`,
    },
    run: true,
  });
  itBundled("extra/ArbitraryModuleNamespaceIdentifiers2", {
    files: {
      "entry.js": `import {'\\0' as bar} from './export.js'; if (bar !== 123) throw 'fail'`,
      "export.js": `let foo = 123; export {foo as '\\0'}`,
    },
    run: true,
  });
  itBundled("extra/ArbitraryModuleNamespaceIdentifiers3", {
    files: {
      "entry.js": `import {'\\uD800\\uDC00' as bar} from './export.js'; if (bar !== 123) throw 'fail'`,
      "export.js": `let foo = 123; export {foo as '\\uD800\\uDC00'}`,
    },
    run: true,
  });
  itBundled("extra/ArbitraryModuleNamespaceIdentifiers4", {
    files: {
      "entry.js": `import {'🍕' as bar} from './export.js'; if (bar !== 123) throw 'fail'`,
      "export.js": `let foo = 123; export {foo as '🍕'}`,
    },
    run: true,
  });
  itBundled("extra/ArbitraryModuleNamespaceIdentifiers5", {
    files: {
      "entry.js": `import {' ' as bar} from './export.js'; if (bar !== 123) throw 'fail'`,
      "export.js": `export let foo = 123; export {foo as ' '} from './export.js'`,
    },
    run: true,
  });
  itBundled("extra/ArbitraryModuleNamespaceIdentifiers6", {
    files: {
      "entry.js": `import {'' as ab} from './export.js'; if (ab.foo !== 123 || ab.bar !== 234) throw 'fail'`,
      "export.js": `export let foo = 123, bar = 234; export * as '' from './export.js'`,
    },
    run: true,
  });

  itBundled("extra/RemoveASMDirective", {
    files: {
      "entry.js": `
        function foo() { 'use asm'; eval("/* not asm.js */") }
        if(foo.toString().indexOf("use asm") !== -1) throw 'fail'
      `,
    },
    run: true,
  });

  // See https://github.com/evanw/esbuild/issues/421
  itBundled("extra/ImportOrder1", {
    files: {
      "in.js": `
        import {foo} from './cjs'
        import {bar} from './esm'
        if (foo !== 1 || bar !== 2) throw 'fail'
      `,
      "cjs.js": `exports.foo = 1; global.internal_import_order_test1 = 2`,
      "esm.js": `export let bar = global.internal_import_order_test1`,
    },
    run: true,
  });
  itBundled("extra/ImportOrder2", {
    files: {
      "in.js": `
        if (foo !== 3 || bar !== 4) throw 'fail'
        import {foo} from './cjs'
        import {bar} from './esm'
      `,
      "cjs.js": `exports.foo = 3; global.internal_import_order_test2 = 4`,
      "esm.js": `export let bar = global.internal_import_order_test2`,
    },
    run: true,
  });
  // See https://github.com/evanw/esbuild/issues/542
  let simpleCyclicImportTestCase542 = {
    "in.js": `
      import {Test} from './lib';
      export function fn() {
        return 42;
      }
      export const foo = [Test];
      if (Test.method() !== 42) throw 'fail'
    `,
    "lib.js": `
      import {fn} from './in';
      export class Test {
        static method() {
          return fn();
        }
      }
    `,
  };
  itBundled("extra/CyclicImport1", {
    files: simpleCyclicImportTestCase542,
    run: true,
  });
  itBundled("extra/TypeofRequireESM", {
    // we do not have require defined in target browser
    notImplemented: true,
    files: {
      "in.js": `check(typeof require)`,
      "runtime.js": `
        import fs from 'fs'
        import path from 'path'
        import url from 'url'
        const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
        const out = fs.readFileSync(__dirname + '/out.js', 'utf8')
        const check = x => value = x
        let value
        new Function('check', 'require', out)(check)
        if (value !== 'function') throw 'fail'
      `,
    },
    run: { file: "runtime.js" },
  });
  itBundled("extra/CJSExport1", {
    files: {
      "in.js": `const out = require('./foo'); if (out.__esModule || out.foo !== 123) throw 'fail'`,
      "foo.js": `exports.foo = 123`,
    },
    run: true,
  });
  itBundled("extra/CJSExport2", {
    files: {
      "in.js": `const out = require('./foo'); if (out.__esModule || out !== 123) throw 'fail'`,
      "foo.js": `module.exports = 123`,
    },
    run: true,
  });
  itBundled("extra/CJSExport3", {
    files: {
      "in.js": `const out = require('./foo'); if (!out.__esModule || out.foo !== 123) throw 'fail'`,
      "foo.js": `export const foo = 123`,
    },
    run: true,
  });
  itBundled("extra/CJSExport4", {
    files: {
      "in.js": `const out = require('./foo'); if (!out.__esModule || out.default !== 123) throw 'fail'`,
      "foo.js": `export default 123`,
    },
    run: true,
  });
  itBundled("extra/CJSExport5", {
    files: {
      "in.js": `const out = require('./foo'); if (!out.__esModule || out.default !== null) throw 'fail'`,
      "foo.js": `export default function x() {} x = null`,
    },
    run: true,
  });
  itBundled("extra/CJSExport6", {
    files: {
      "in.js": `const out = require('./foo'); if (!out.__esModule || out.default !== null) throw 'fail'`,
      "foo.js": `export default class x {} x = null`,
    },
    run: true,
  });
  itBundled("extra/CJSExport7", {
    files: {
      "in.js": `
      // This is the JavaScript generated by "tsc" for the following TypeScript:
      //
      //   import fn from './foo'
      //   if (typeof fn !== 'function') throw 'fail'
      //
      "use strict";
      var __importDefault = (this && this.__importDefault) || function (mod) {
        return (mod && mod.__esModule) ? mod : { "default": mod };
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      const foo_1 = __importDefault(require("./foo"));
      if (typeof foo_1.default !== 'function')
        throw 'fail';
    `,
      "foo.js": `export default function fn() {}`,
    },
    run: true,
  });
  itBundled("extra/CJSSelfExport1", {
    files: {
      "in.js": `exports.foo = 123; const out = require('./in'); if (out.__esModule || out.foo !== 123) throw 'fail'`,
    },
    run: true,
  });
  itBundled("extra/CJSSelfExport2", {
    files: {
      "in.js": `module.exports = 123; const out = require('./in'); if (out.__esModule || out !== 123) throw 'fail'`,
    },
    run: true,
  });
  itBundled("extra/CJSSelfExport3", {
    files: {
      "in.js": `export const foo = 123; const out = require('./in'); if (!out.__esModule || out.foo !== 123) throw 'fail'`,
    },
    run: true,
  });
  itBundled("extra/CJSSelfExport4", {
    files: {
      "in.js": `export const foo = 123; const out = require('./in'); if (!out.__esModule || out.foo !== 123) throw 'fail'`,
    },
    run: true,
  });
  itBundled("extra/CJSSelfExport5", {
    files: {
      "in.js": `export default 123; const out = require('./in'); if (!out.__esModule || out.default !== 123) throw 'fail'`,
    },
    run: true,
  });
  itBundled("extra/CJSSelfExport6", {
    files: {
      "in.js": `export const foo = 123; const out = require('./in'); if (!out.__esModule || out.foo !== 123) throw 'fail'`,
    },
    run: true,
  });
  itBundled("extra/CJSSelfExport7", {
    files: {
      "in.js": `export const foo = 123; const out = require('./in'); if (!out.__esModule || out.foo !== 123) throw 'fail'`,
    },
    run: true,
  });
  itBundled("extra/CJSSelfExport8", {
    files: {
      "in.js": `export default 123; const out = require('./in'); if (!out.__esModule || out.default !== 123) throw 'fail'`,
    },
    run: true,
  });
  itBundled("extra/DoubleExportStar1", {
    files: {
      "node.ts": `
        import {a, b} from './re-export'
        if (a !== 'a' || b !== 'b') throw 'fail'
      `,
      "re-export.ts": `
        export * from './a'
        export * from './b'
      `,
      "a.ts": `
        export let a = 'a'
      `,
      "b.ts": `
        export let b = 'b'
      `,
    },
    run: true,
  });
  itBundled("extra/DoubleExportStar2", {
    files: {
      "node.ts": `
        import {a, b} from './re-export'
        if (a !== 'a' || b !== 'b') throw 'fail'

        // Try forcing all of these modules to be wrappers
        require('./node')
        require('./re-export')
        require('./a')
        require('./b')
      `,
      "re-export.ts": `
        export * from './a'
        export * from './b'
      `,
      "a.ts": `
        export let a = 'a'
      `,
      "b.ts": `
        export let b = 'b'
    `,
    },
    run: true,
  });
  itBundled("extra/DoubleExportStar3", {
    files: {
      "node.ts": `
        import {a, b, c, d} from './re-export'
        if (a !== 'a' || b !== 'b' || c !== 'c' || d !== 'd') throw 'fail'

        // Try forcing all of these modules to be wrappers
        require('./node')
        require('./re-export')
        require('./a')
        require('./b')
      `,
      "re-export.ts": `
        export * from './a'
        export * from './b'
        export * from './d'
      `,
      "a.ts": `
        export let a = 'a'
      `,
      "b.ts": `
        exports.b = 'b'
      `,
      "c.ts": `
        exports.c = 'c'
      `,
      "d.ts": `
        export * from './c'
        export let d = 'd'
      `,
    },
    run: true,
  });
  // Complex circular bundled and non-bundled import case (https://github.com/evanw/esbuild/issues/758)
  itBundled("extra/ESBuildIssue758", {
    files: {
      "node.ts": `
        import {a} from './re-export'
        let fn = a()
        if (fn === a || fn() !== a) throw 'fail'
      `,
      "re-export.ts": `
        export * from './a'
      `,
      "a.ts": `
        import {b} from './b'
        export let a = () => b
      `,
      "b.ts": `
        import {a} from './re-export'
        export let b = () => a
      `,
    },
    format: "cjs",
    run: true,
  });
  itBundled("extra/ESBuildIssue1894", {
    files: {
      "in.ts": `
        export * from './a.cjs'
        import * as inner from './inner.js'
        export { inner }
      `,
      "inner.ts": `export * from './b.cjs'`,
      "a.cjs": `exports.a = 'a'`,
      "b.cjs": `exports.b = 'b'`,
      "node.js": `
        const out = require('./out.js')
        if (out.a !== 'a' || out.inner === void 0 || out.inner.b !== 'b' || out.b !== void 0) throw 'fail'
      `,
    },
    format: "cjs",
    run: true,
  });
  // Validate internal and external export correctness regarding "__esModule".
  // An ES module importing itself should not see "__esModule". But a CommonJS
  // module importing an ES module should see "__esModule".
  itBundled("extra/ESModuleSelfImport1", {
    files: {
      "in.ts": `
        export * from './a.cjs'
        import * as us from './in.js'
        if (us.a !== 'a' || us.__esModule !== void 0) throw 'fail'
      `,
      "a.cjs": `exports.a = 'a'`,
      "node.js": `
        const out = require('./out.js')
        if (out.a !== 'a' || out.__esModule !== true) throw 'fail'
      `,
    },
    format: "cjs",
    run: { file: "node.js" },
  });

  // Use "eval" to access CommonJS variables
  itBundled("extra/CJSEval1", {
    notImplemented: true,
    files: {
      "in.js": `if (require('./eval').foo !== 123) throw 'fail'`,
      "eval.js": `exports.foo=234;eval('exports.foo = 123')`,
    },
    run: true,
  });
  itBundled("extra/CJSEval2", {
    notImplemented: true,
    files: {
      "in.js": `if (require('./eval').foo !== 123) throw 'fail'`,
      "eval.js": `module.exports={foo:234};eval('module.exports = {foo: 123}')`,
    },
    run: true,
  });
  // Test "default" exports in ESM-to-CommonJS conversion scenarios
  // i left off at line 1814
});
