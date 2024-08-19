import { itBundled } from "../expectBundled";
import { describe } from "bun:test";

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
    todo: true,
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
    todo: true,
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
    todo: true,
    files: {
      "in.js": `if (require('./eval').foo !== 123) throw 'fail'`,
      "eval.js": `exports.foo=234;eval('exports.foo = 123')`,
    },
    run: true,
  });
  itBundled("extra/CJSEval2", {
    todo: true,
    files: {
      "in.js": `if (require('./eval').foo !== 123) throw 'fail'`,
      "eval.js": `module.exports={foo:234};eval('module.exports = {foo: 123}')`,
    },
    run: true,
  });
  itBundled("extra/EnumerableFalse1", {
    files: {
      "in.js": `
        import {foo} from './esm'
        if (foo !== 123) throw 'fail'
      `,
      "esm.js": `Object.defineProperty(exports, 'foo', {value: 123, enumerable: false})`,
    },
    run: true,
  });
  // Test imports not being able to access the namespace object
  itBundled("extra/EnumerableFalse2", {
    files: {
      "in.js": `
        import * as ns from './esm'
        if (ns[Math.random() < 2 && 'foo'] !== 123) throw 'fail'
      `,
      "esm.js": `Object.defineProperty(exports, 'foo', {value: 123, enumerable: false})`,
    },
    run: true,
  });
  // Test imports of properties from the prototype chain of "module.exports" for Webpack compatibility
  itBundled("extra/PrototypeChain1", {
    files: {
      "in.js": `
        import def from './cjs-proto'
        import {prop} from './cjs-proto'
        if (def.prop !== 123 || prop !== 123) throw 'fail'
      `,
      "cjs-proto.js": `module.exports = Object.create({prop: 123})`,
    },
    run: true,
  });
  itBundled("extra/PrototypeChain2", {
    files: {
      "in.js": `
        import def, {prop} from './cjs-proto' // The TypeScript compiler fails with this syntax
        if (def.prop !== 123 || prop !== 123) throw 'fail'
      `,
      "cjs-proto.js": `module.exports = Object.create({prop: 123})`,
    },
    run: true,
  });
  itBundled("extra/PrototypeChain2", {
    files: {
      "in.js": `
        import * as star from './cjs-proto'
        if (!star.default || star.default.prop !== 123 || star.prop !== 123) throw 'fail'
      `,
      "cjs-proto.js": `module.exports = Object.create({prop: 123})`,
    },
    run: true,
  });
  // This shouldn't cause a syntax error
  // https://github.com/evanw/esbuild/issues/1082
  itBundled("extra/ReturnDynamicImport", {
    files: {
      "in.js": `
        async function foo() {
          return import('./second.js')
        }
      `,
      "second.js": `
        export default 123
      `,
      "third.js": `
        export default 123
      `,
    },
    run: true,
  });
  // Check for file names of wrapped modules in non-minified stack traces (for profiling)
  // Context: https://github.com/evanw/esbuild/pull/1236
  itBundled("extra/UnminifiedNamedModuleFunctions1", {
    todo: true,
    files: {
      "entry.js": `
        try {
          require('./src/a')
        } catch (e) {
          if (!e.stack.includes("__require") || !e.stack.includes("src/a.ts") || !e.stack.includes("src/b.ts"))
            throw new Error(e.stack)
        }
      `,
      "src/a.ts": `require('./b')`,
      "src/b.ts": `throw new Error('fail')`,
    },
    run: true,
  });
  itBundled("extra/UnminifiedNamedModuleFunctions2", {
    minifyIdentifiers: true,
    files: {
      "entry.js": `
        try {
          require('./src/a')
        } catch (e) {
          if (e.stack.includes('__require') || e.stack.includes('src/a.ts') || e.stack.includes('src/b.ts'))
            throw new Error(e.stack)
        }
      `,
      "src/a.ts": `require('./b')`,
      "src/b.ts": `throw new Error('fail')`,
    },
    run: true,
  });
  itBundled("extra/UnminifiedNamedModuleFunctions3", {
    todo: true,
    files: {
      "entry.js": `
        try {
          require('./src/a')
        } catch (e) {
          if (!e.stack.includes('__init') || !e.stack.includes('src/a.ts') || !e.stack.includes('src/b.ts'))
            throw new Error(e.stack)
        }
      `,
      "src/a.ts": `export let esm = true; require('./b')`,
      "src/b.ts": `export let esm = true; throw new Error('fail')`,
    },
    run: true,
  });
  itBundled("extra/UnminifiedNamedModuleFunctions4", {
    minifyIdentifiers: true,
    files: {
      "entry.js": `
        try {
          require('./src/a')
        } catch (e) {
          if (e.stack.includes('__init') || e.stack.includes('src/a.ts') || e.stack.includes('src/b.ts'))
            throw new Error(e.stack)
        }
      `,
      "src/a.ts": `export let esm = true; require('./b')`,
      "src/b.ts": `export let esm = true; throw new Error('fail')`,
    },
    run: true,
  });
  // Define shouldnt crash
  // https://github.com/evanw/esbuild/issues/1080
  itBundled("extra/DefineObject1", {
    files: {
      "in.js": `if (foo.x !== 0) throw 'fail'; this;`,
    },
    define: { foo: '{"x":0}' },
    run: true,
  });
  itBundled("extra/DefineObject2", {
    files: {
      "in.js": `if (foo.bar.x !== 0) throw 'fail'; this;`,
    },
    define: { "foo.bar": '{"x":0}' },
    run: true,
  });
  itBundled("extra/DefineModule1", {
    files: {
      "in.js": `if (module.x !== void 0) throw 'fail'; this;`,
    },
    define: { module: '{"x":0}' },
    run: true,
  });
  itBundled("extra/DefineModule2", {
    files: {
      "in.js": `if (module.foo !== void 0) throw 'fail'; this;`,
    },
    define: { "module.foo": '{"x":0}' },
    run: true,
  });
  itBundled("extra/DefineExports1", {
    todo: true,
    files: {
      "in.js": `if (exports.x !== void 0) throw 'fail'; this;`,
    },
    define: { exports: '{"x":0}' },
    run: true,
  });
  itBundled("extra/DefineExports2", {
    todo: true,
    files: {
      "in.js": `if (exports.foo !== void 0) throw 'fail'; this;`,
    },
    define: { "exports.foo": '{"x":0}' },
    run: true,
  });

  itBundled("extra/DefineArray", {
    files: {
      "in.js": `if (foo[0] !== 'x') throw 'fail'; this`,
    },
    define: { foo: '["x"]' },
    run: true,
  });
  itBundled("extra/DefineArray2", {
    files: {
      "in.js": `if (foo.bar[0] !== 'x') throw 'fail'; this`,
    },
    define: { "foo.bar": '["x"]' },
    run: true,
  });
  itBundled("extra/DefineModuleArray1", {
    files: {
      "in.js": `if (module[0] !== void 0) throw 'fail'; this`,
    },
    define: { module: '["x"]' },
    run: true,
  });
  itBundled("extra/DefineModuleArray2", {
    files: {
      "in.js": `if (module.foo !== void 0) throw 'fail'; this`,
    },
    define: { "module.foo": '["x"]' },
    run: true,
  });
  itBundled("extra/DefineExportsArray1", {
    files: {
      "in.js": `if (exports[0] !== void 0) throw 'fail'; this`,
    },
    define: { exports: '["x"]' },
    run: true,
  });
  itBundled("extra/DefineExportsArray2", {
    todo: true,
    files: {
      "in.js": `if (exports.foo !== void 0) throw 'fail'; this`,
    },
    define: { "exports.foo": '["x"]' },
    run: true,
  });

  // Various ESM cases
  itBundled("extra/CatchScope1", {
    files: {
      "in.js": `
        var x = 0, y = []
        try {
          throw 1
        } catch (x) {
          y.push(x)
          var x = 2
          y.push(x)
        }
        y.push(x)
        if (y + '' !== '1,2,0') throw 'fail: ' + y
      `,
    },
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    run: true,
  });
  itBundled("extra/CatchScope2", {
    files: {
      "in.js": `
        var x = 0, y = []
        try {
          throw 1
        } catch (x) {
          y.push(x)
          var x = 2
          y.push(x)
        }
        finally { x = 3 }
        y.push(x)
        if (y + '' !== '1,2,3') throw 'fail: ' + y
      `,
    },
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    run: true,
  });
  itBundled("extra/CatchScope3", {
    files: {
      "in.js": `
        var y = []
        try {
          throw 1
        } catch (x) {
          y.push(x)
          var x = 2
          y.push(x)
        }
        y.push(x)
        if (y + '' !== '1,2,') throw 'fail: ' + y
      `,
    },
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    run: true,
  });
  itBundled("extra/CatchScope4", {
    files: {
      "in.js": `
        var y = []
        try {
          throw 1
        } catch (x) {
          y.push(x)
          x = 2
          y.push(x)
        }
        y.push(typeof x)
        if (y + '' !== '1,2,undefined') throw 'fail: ' + y
      `,
    },
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    run: true,
  });
  itBundled("extra/CatchScope5", {
    files: {
      "in.js": `
        var y = []
        try {
          throw 1
        } catch (x) {
          y.push(x)
          try {
            throw 2
          } catch (x) {
            y.push(x)
            var x = 3
            y.push(x)
          }
          y.push(x)
        }
        y.push(x)
        if (y + '' !== '1,2,3,1,') throw 'fail: ' + y
      `,
    },
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    run: true,
  });
  itBundled("extra/CatchScope6", {
    files: {
      "in.js": `
        var y = []
        try { x; y.push('fail') } catch (e) {}
        try {
          throw 1
        } catch (x) {
          y.push(x)
        }
        try { x; y.push('fail') } catch (e) {}
        if (y + '' !== '1') throw 'fail: ' + y
      `,
    },
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    run: true,
  });

  // https://github.com/evanw/esbuild/issues/1812
  itBundled("extra/CatchScope7", {
    files: {
      "in.js": `
        let a = 1;
        let def = "PASS2";
        try {
          throw [ "FAIL2", "PASS1" ];
        } catch ({ [a]: b, 3: d = def }) {
          let a = 0, def = "FAIL3";
          if (b !== 'PASS1' || d !== 'PASS2') throw 'fail: ' + b + ' ' + d
        }
      `,
    },
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    run: true,
  });
  itBundled("extra/CatchScope8", {
    files: {
      "in.js": `
        let a = 1;
        let def = "PASS2";
        try {
          throw [ "FAIL2", "PASS1" ];
        } catch ({ [a]: b, 3: d = def }) {
          let a = 0, def = "FAIL3";
          if (b !== 'PASS1' || d !== 'PASS2') throw 'fail: ' + b + ' ' + d
        }
      `,
    },
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    run: true,
  });
  itBundled("extra/CatchScope9", {
    files: {
      "in.js": `
        try {
          throw { x: 'z', z: 123 }
        } catch ({ x, [x]: y }) {
          if (y !== 123) throw 'fail'
        }
      `,
    },
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    run: true,
  });
  itBundled("extra/CyclicImport2", {
    files: {
      "entry.js": `import * as foo from './foo'; export default {foo, bar: require('./bar')}`,
      "foo.js": `import * as a from './entry'; import * as b from './bar'; export default {a, b}`,
      "bar.js": `const entry = require('./entry'); export function foo() { return entry }`,
    },
  });

  // Test certain minification transformations
  for (const minify of [
    {
      value: {
        minifyIdentifiers: true,
        minifySyntax: true,
        minifyWhitespace: true,
      },
      label: "Minify",
    },
    { value: {}, label: "" },
  ]) {
    itBundled(`extra/${minify.label || "NoMinify"}1`, {
      files: {
        "in.js": `let fn = (x) => { if (x && y) return; function y() {} throw 'fail' }; fn(fn)`,
      },
      ...minify.value,
    });
    itBundled(`extra/${minify.label || "NoMinify"}2`, {
      files: {
        "in.js": `let fn = (a, b) => { if (a && (x = () => y) && b) return; var x; let y = 123; if (x() !== 123) throw 'fail' }; fn(fn)`,
      },
      ...minify.value,
    });

    for (const { access, label } of [
      {
        access: ".a",
        label: minify.label + "DotAccess",
      },
      {
        access: "['a']",
        label: minify.label + "BracketAccess",
      },
    ]) {
      function add(n: number, files: Record<string, string>) {
        itBundled(`extra/${label}${n}`, {
          files,
          run: true,
          target: "bun",
        });
      }
      add(1, {
        "in.js": `if ({a: 1}${access} !== 1) throw 'fail'`,
      });
      add(2, {
        "in.js": `if ({a: {a: 1}}${access}${access} !== 1) throw 'fail'`,
      });
      add(3, {
        "in.js": `if ({a: {b: 1}}${access}.b !== 1) throw 'fail'`,
      });
      add(4, {
        "in.js": `if ({b: {a: 1}}.b${access} !== 1) throw 'fail'`,
      });
      add(5, {
        "in.js": `if ({a: 1, a: 2}${access} !== 2) throw 'fail'`,
      });
      add(6, {
        "in.js": `if ({a: 1, [String.fromCharCode(97)]: 2}${access} !== 2) throw 'fail'`,
      });
      add(7, {
        "in.js": `let a = {a: 1}; if ({...a}${access} !== 1) throw 'fail'`,
      });
      add(8, {
        "in.js": `if ({ get a() { return 1 } }${access} !== 1) throw 'fail'`,
      });
      add(9, {
        "in.js": `if ({ __proto__: {a: 1} }${access} !== 1) throw 'fail'`,
      });
      add(10, {
        "in.js": `if ({ __proto__: null, a: 1 }${access} !== 1) throw 'fail'`,
      });
      add(11, {
        "in.js": `if ({ __proto__: null, b: 1 }${access} !== void 0) throw 'fail'`,
      });
      add(12, {
        "in.js": `if ({ __proto__: null }.__proto__ !== void 0) throw 'fail'`,
      });
      add(13, {
        "in.js": `if ({ ['__proto__']: null }.__proto__ !== null) throw 'fail'`,
      });
      add(14, {
        "in.js": `let x = 100; if ({ b: ++x, a: 1 }${access} !== 1 || x !== 101) throw 'fail'`,
      });
      add(15, {
        "in.js": `if ({ a: function() { return this.b }, b: 1 }${access}() !== 1) throw 'fail'`,
      });
      add(16, {
        "in.js": `if ({ a: function() { return this.b }, b: 1 }${access}\`\` !== 1) throw 'fail'`,
      });
      add(17, {
        "in.js": `if (({a: 2}${access} = 1) !== 1) throw 'fail'`,
      });
      add(18, {
        "in.js": `if ({a: 1}${access}++ !== 1) throw 'fail'`,
      });
      add(19, {
        "in.js": `if (++{a: 1}${access} !== 2) throw 'fail'`,
      });
      add(20, {
        "in.js": `
          Object.defineProperty(Object.prototype, 'MIN_OBJ_LIT', {value: 1})
          if ({}.MIN_OBJ_LIT !== 1) throw 'fail'
        `,
      });
      add(21, {
        "in.js": `
          let x = false
          function y() { x = true }
          if ({ b: y(), a: 1 }${access} !== 1 || !x) throw 'fail'
        `,
      });
      add(22, {
        "in.js": `
          try { new ({ a() {} }${access}); throw 'fail' }
          catch (e) { if (e === 'fail') throw e }
        `,
      });
      add(22, {
        "in.js": `
          let x = 1;
          ({ set a(y) { x = y } }${access} = 2);
          if (x !== 2) throw 'fail'
        `,
      });
    }

    // Check try/catch simplification
    itBundled(`extra/${minify.label || "NoMinify"}CatchScope1`, {
      files: {
        "in.js": `
          try {
            try {
              throw 0
            } finally {
              var x = 1
            }
          } catch {
          }
          if (x !== 1) throw 'fail'
        `,
      },
      run: true,
    });
    itBundled(`extra/${minify.label || "NoMinify"}CatchScope2`, {
      todo: true,
      files: {
        "in.js": `
          let y
          try {
            throw 1
          } catch (x) {
            eval('y = x')
          }
          if (y !== 1) throw 'fail'
        `,
      },
      run: true,
    });
    itBundled(`extra/${minify.label || "NoMinify"}CatchScope3`, {
      files: {
        "in.js": `
          try {
            throw 0
          } catch (x) {
            var x = 1
          }
          if (x !== void 0) throw 'fail'
        `,
      },
      run: true,
    });
    itBundled(`extra/${minify.label || "NoMinify"}CatchScope4`, {
      files: {
        "in.js": `
          let works
          try {
            throw { get a() { works = true } }
          } catch ({ a }) {}
          if (!works) throw 'fail'
        `,
      },
      run: true,
    });
    itBundled(`extra/${minify.label || "NoMinify"}CatchScope5`, {
      files: {
        "in.js": `
          let works
          try {
            throw { *[Symbol.iterator]() { works = true } }
          } catch ([x]) {
          }
          if (!works) throw 'fail'
        `,
      },
      run: true,
    });

    // Check variable initializer inlining
    itBundled(`extra/${minify.label || "NoMinify"}VariableInitializerInlining`, {
      files: {
        "in.js": `
          function foo() {
            if (this !== globalThis) throw 'fail'
          }
          function main() {
            let obj = { bar: foo };
            let fn = obj.bar;
            (0, fn)();
          }
          main()
        `,
      },
    });
    // Check global constructor behavior
    itBundled(`extra/${minify.label || "NoMinify"}GlobalConstructorBehavior1`, {
      files: {
        "in.js": `
          const check = (before, after) => {
            if (Boolean(before) !== after) throw 'fail: Boolean(' + before + ') should not be ' + Boolean(before)
            if (new Boolean(before) === after) throw 'fail: new Boolean(' + before + ') should not be ' + new Boolean(before)
            if (new Boolean(before).valueOf() !== after) throw 'fail: new Boolean(' + before + ').valueOf() should not be ' + new Boolean(before).valueOf()
          }
          check(false, false); check(0, false); check(0n, false)
          check(true, true); check(1, true); check(1n, true)
          check(null, false); check(undefined, false)
          check('', false); check('x', true)

          const checkSpread = (before, after) => {
            if (Boolean(...before) !== after) throw 'fail: Boolean(...' + before + ') should not be ' + Boolean(...before)
            if (new Boolean(...before) === after) throw 'fail: new Boolean(...' + before + ') should not be ' + new Boolean(...before)
            if (new Boolean(...before).valueOf() !== after) throw 'fail: new Boolean(...' + before + ').valueOf() should not be ' + new Boolean(...before).valueOf()
          }
          checkSpread([0], false); check([1], true)
          checkSpread([], false)
        `,
      },
      run: true,
    });
    itBundled(`extra/${minify.label || "NoMinify"}GlobalConstructorBehavior2`, {
      files: {
        "in.js": `
          class ToPrimitive { [Symbol.toPrimitive]() { return '100.001' } }
          const someObject = { toString: () => 123, valueOf: () => 321 }

          const check = (before, after) => {
            if (Number(before) !== after) throw 'fail: Number(' + before + ') should not be ' + Number(before)
            if (new Number(before) === after) throw 'fail: new Number(' + before + ') should not be ' + new Number(before)
            if (new Number(before).valueOf() !== after) throw 'fail: new Number(' + before + ').valueOf() should not be ' + new Number(before).valueOf()
          }
          check(-1.23, -1.23)
          check('-1.23', -1.23)
          check(123n, 123)
          check(null, 0)
          check(false, 0)
          check(true, 1)
          check(someObject, 321)
          check(new ToPrimitive(), 100.001)

          const checkSpread = (before, after) => {
            if (Number(...before) !== after) throw 'fail: Number(...' + before + ') should not be ' + Number(...before)
            if (new Number(...before) === after) throw 'fail: new Number(...' + before + ') should not be ' + new Number(...before)
            if (new Number(...before).valueOf() !== after) throw 'fail: new Number(...' + before + ').valueOf() should not be ' + new Number(...before).valueOf()
          }
          checkSpread(['123'], 123)
          checkSpread([], 0)
        `,
      },
      run: true,
    });
    itBundled(`extra/${minify.label || "NoMinify"}GlobalConstructorBehavior3`, {
      files: {
        "in.js": `
          class ToPrimitive { [Symbol.toPrimitive]() { return 100.001 } }
          const someObject = { toString: () => 123, valueOf: () => 321 }

          const check = (before, after) => {
            if (String(before) !== after) throw 'fail: String(' + before + ') should not be ' + String(before)
            if (new String(before) === after) throw 'fail: new String(' + before + ') should not be ' + new String(before)
            if (new String(before).valueOf() !== after) throw 'fail: new String(' + before + ').valueOf() should not be ' + new String(before).valueOf()
          }
          check('', '')
          check('x', 'x')
          check(null, 'null')
          check(false, 'false')
          check(1.23, '1.23')
          check(-123n, '-123')
          check(someObject, '123')
          check(new ToPrimitive(), '100.001')

          const checkSpread = (before, after) => {
            if (String(...before) !== after) throw 'fail: String(...' + before + ') should not be ' + String(...before)
            if (new String(...before) === after) throw 'fail: new String(...' + before + ') should not be ' + new String(...before)
            if (new String(...before).valueOf() !== after) throw 'fail: new String(...' + before + ').valueOf() should not be ' + new String(...before).valueOf()
          }
          checkSpread([123], '123')
          checkSpread([], '')

          const checkAndExpectNewToThrow = (before, after) => {
            if (String(before) !== after) throw 'fail: String(...) should not be ' + String(before)
            try {
              new String(before)
            } catch (e) {
              return
            }
            throw 'fail: new String(...) should not succeed'
          }
          checkAndExpectNewToThrow(Symbol('abc'), 'Symbol(abc)')
        `,
      },
      run: true,
    });
  }
  // Test minification of hoisted top-level symbols declared in nested scopes.
  // Previously this code was incorrectly transformed into this, which crashes:
  //
  //   var c = false;
  //   var d = function a() {
  //     b[a]();
  //   };
  //   for (var a = 0, b = [() => c = true]; a < b.length; a++) {
  //     d();
  //   }
  //   export default c;
  //
  // The problem is that "var i" is declared in a nested scope but hoisted to
  // the top-level scope. So it's accidentally assigned a nested scope slot
  // even though it's a top-level symbol, not a nested scope symbol.
  itBundled(`extra/ToplevelSymbolHoisting`, {
    files: {
      "in.js": `
        var worked = false
        var loop = function fn() {
          array[i]();
        };
        for (var i = 0, array = [() => worked = true]; i < array.length; i++) {
          loop();
        }
        export default worked
      `,
      "node.js": `
        import worked from './out.js'
        if (!worked) throw 'fail'
      `,
    },
    run: { file: "node.js" },
  });
  // Test hoisting variables inside for loop initializers outside of lazy ESM
  // wrappers. Previously this didn't work due to a bug that considered for
  // loop initializers to already be in the top-level scope. For more info
  // see: https://github.com/evanw/esbuild/issues/1455.
  itBundled(`extra/ForLoopInitializerHoisting1`, {
    files: {
      "in.js": `
        if (require('./nested').foo() !== 10) throw 'fail'
      `,
      "nested.js": `
        for (var i = 0; i < 10; i++) ;
        export function foo() { return i }
      `,
    },
    run: true,
  });
  itBundled(`extra/ForLoopInitializerHoisting2`, {
    files: {
      "in.js": `
        if (require('./nested').foo() !== 'c') throw 'fail'
      `,
      "nested.js": `
        for (var i in {a: 1, b: 2, c: 3}) ;
        export function foo() { return i }
      `,
    },
    run: true,
  });
  itBundled(`extra/ForLoopInitializerHoisting3`, {
    files: {
      "in.js": `
        if (require('./nested').foo() !== 3) throw 'fail'
      `,
      "nested.js": `
        for (var i of [1, 2, 3]) ;
        export function foo() { return i }
      `,
    },
    run: true,
  });

  // Test tree shaking
  itBundled(`extra/TreeShaking1`, {
    files: {
      "entry.js": `import * as foo from './foo'; if (global.dce0 !== 123 || foo.abc !== 'abc') throw 'fail'`,
      "foo/index.js": `global.dce0 = 123; export const abc = 'abc'`,
      "foo/package.json": `{ "sideEffects": false }`,
    },
    run: true,
  });
  itBundled(`extra/TreeShaking2`, {
    files: {
      "entry.js": `import * as foo from './foo'; if (global.dce1 !== void 0) throw 'fail'`,
      "foo/index.js": `global.dce1 = 123; export const abc = 'abc'`,
      "foo/package.json": `{ "sideEffects": false }`,
    },
    run: true,
  });
  itBundled(`extra/TreeShaking3`, {
    files: {
      "entry.js": `import * as foo from './foo'; if (global.dce2 !== 123) throw 'fail'`,
      "foo/index.js": `global.dce2 = 123; export const abc = 'abc'`,
      "foo/package.json": `{ "sideEffects": true }`,
    },
    run: true,
  });
  itBundled(`extra/TreeShaking4`, {
    files: {
      "entry.js": `import foo from './foo'; if (global.dce3 !== 123 || foo.abc !== 'abc') throw 'fail'`,
      "foo/index.js": `global.dce3 = 123; exports.abc = 'abc'`,
      "foo/package.json": `{ "sideEffects": false }`,
    },
    run: true,
  });
  itBundled(`extra/TreeShaking5`, {
    files: {
      "entry.js": `import foo from './foo'; if (global.dce4 !== void 0) throw 'fail'`,
      "foo/index.js": `global.dce4 = 123; exports.abc = 'abc'`,
      "foo/package.json": `{ "sideEffects": false }`,
    },
    run: true,
  });
  itBundled(`extra/TreeShaking6`, {
    files: {
      "entry.js": `import foo from './foo'; if (global.dce5 !== 123) throw 'fail'`,
      "foo/index.js": `global.dce5 = 123; exports.abc = 'abc'`,
      "foo/package.json": `{ "sideEffects": true }`,
    },
    run: true,
  });
  // Note: Tree shaking this could technically be considered incorrect because
  // the import is for a property whose getter in this case has a side effect.
  // However, this is very unlikely and the vast majority of the time people
  // would likely rather have the code be tree-shaken. This test case enforces
  // the technically incorrect behavior as documentation that this edge case
  // is being ignored.
  itBundled(`extra/TreeShaking7`, {
    files: {
      "entry.js": `import {foo, bar} from './foo'; let unused = foo; if (bar) throw 'expected "foo" to be tree-shaken'`,
      "foo.js": `module.exports = {get foo() { module.exports.bar = 1 }, bar: 0}`,
    },
    run: true,
  });
  itBundled(`extra/TreeShaking8`, {
    files: {
      "entry.js": `import './foo'; if (global.dce6 !== 123) throw 'fail'`,
      "foo/dir/x.js": `global.dce6 = 123`,
      "foo/package.json": `{ "main": "dir/x", "sideEffects": ["x.*"] }`,
    },
    skipIfWeDidNotImplementWildcardSideEffects: true,
    run: true,
  });
  itBundled(`extra/TreeShaking9`, {
    files: {
      "entry.js": `import './foo'; if (global.dce6 !== 123) throw 'fail'`,
      "foo/dir/x.js": `global.dce6 = 123`,
      "foo/package.json": `{ "main": "dir/x", "sideEffects": ["**/x.*"] }`,
    },
    skipIfWeDidNotImplementWildcardSideEffects: true,
    run: true,
  });
  itBundled(`extra/TreeShaking10`, {
    todo: true,
    files: {
      "entry.js": `
        let [a] = {}; // This must not be tree-shaken
      `,
      "node.js": `
        pass: {
          try {
            require('./out.js')
          } catch (e) {
            break pass
          }
          throw 'fail'
        }
      `,
    },
    run: { file: "node.js" },
  });
  itBundled(`extra/TreeShaking11`, {
    todo: true,
    files: {
      "entry.js": `
        let sideEffect = false
        let { a } = { // This must not be tree-shaken
          get a() {
            sideEffect = true
          },
        };
        if (!sideEffect) throw 'fail'
      `,
    },
    run: true,
  });

  // Test obscure CommonJS symbol edge cases
  itBundled(`extra/CommonJSSymbol1`, {
    files: {
      "in.js": `const ns = require('./foo'); if (ns.foo !== 123 || ns.bar !== 123) throw 'fail'`,
      "foo.js": `var exports, module; module.exports.foo = 123; exports.bar = exports.foo`,
    },
  });
  itBundled(`extra/CommonJSSymbol2`, {
    files: {
      "in.js": `require('./foo'); require('./bar')`,
      "foo.js": `let exports; if (exports !== void 0) throw 'fail'`,
      "bar.js": `let module; if (module !== void 0) throw 'fail'`,
    },
  });
  itBundled(`extra/CommonJSSymbol3`, {
    files: {
      "in.js": `const ns = require('./foo'); if (ns.foo !== void 0 || ns.default.foo !== 123) throw 'fail'`,
      "foo.js": `var exports = {foo: 123}; export default exports`,
    },
  });
  itBundled(`extra/CommonJSSymbol4`, {
    files: {
      "in.js": `const ns = require('./foo'); if (ns !== 123) throw 'fail'`,
      "foo.ts": `let module = 123; export = module`,
    },
  });
  itBundled(`extra/CommonJSSymbol5`, {
    files: {
      "in.js": `require('./foo')`,
      "foo.js": `var require; if (require !== void 0) throw 'fail'`,
    },
  });
  itBundled(`extra/CommonJSSymbol6`, {
    files: {
      "in.js": `require('./foo')`,
      "foo.js": `var require = x => x; if (require('does not exist') !== 'does not exist') throw 'fail'`,
    },
  });
  itBundled(`extra/CommonJSSymbol7`, {
    files: {
      "in.js": `const ns = require('./foo'); if (ns.a !== 123 || ns.b.a !== 123) throw 'fail'`,
      "foo.js": `exports.a = 123; exports.b = this`,
    },
  });
  itBundled(`extra/CommonJSSymbol8`, {
    files: {
      "in.js": `const ns = require('./foo'); if (ns.a !== 123 || ns.b !== void 0) throw 'fail'`,
      "foo.js": `export let a = 123, b = this`,
    },
  });

  // Function hoisting tests
  itBundled(`extra/FunctionHoisting1`, {
    files: {
      "in.js": `
      if (1) {
        function f() {
          return f
        }
        f = null
      }
      if (typeof f !== 'function' || f() !== null) throw 'fail'
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting2`, {
    files: {
      "in.js": `
      'use strict'
      if (1) {
        function f() {
          return f
        }
        f = null
      }
      if (typeof f !== 'undefined') throw 'fail'
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting3`, {
    files: {
      "in.js": `
      export {}
      if (1) {
        function f() {
          return f
        }
        f = null
      }
      if (typeof f !== 'undefined') throw 'fail'
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting4`, {
    files: {
      "in.js": `
      if (1) {
        function f() {
          return f
        }
        f = null
      }
      if (typeof f !== 'function' || f() !== null) throw 'fail'
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting5`, {
    files: {
      "in.js": `
      var f
      if (1) {
        function f() {
          return f
        }
        f = null
      }
      if (typeof f !== 'function' || f() !== null) throw 'fail'
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting6`, {
    files: {
      "in.js": `
      'use strict'
      if (1) {
        function f() {
          return f
        }
      }
      if (typeof f !== 'undefined') throw 'fail'
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting7`, {
    files: {
      "in.js": `
      export {}
      if (1) {
        function f() {
          return f
        }
      }
      if (typeof f !== 'undefined') throw 'fail'
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting8`, {
    files: {
      "in.js": `
      var f = 1
      if (1) {
        function f() {
          return f
        }
        f = null
      }
      if (typeof f !== 'function' || f() !== null) throw 'fail'
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting9`, {
    files: {
      "in.js": `
      'use strict'
      var f = 1
      if (1) {
        function f() {
          return f
        }
      }
      if (f !== 1) throw 'fail'
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting10`, {
    files: {
      "in.js": `
      export {}
      var f = 1
      if (1) {
        function f() {
          return f
        }
      }
      if (f !== 1) throw 'fail'
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting11`, {
    files: {
      "in.js": `
      import {f, g} from './other'
      if (f !== void 0 || g !== 'g') throw 'fail'
    `,
      "other.js": `
      'use strict'
      var f
      if (1) {
        function f() {
          return f
        }
      }
      exports.f = f
      exports.g = 'g'
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting12`, {
    files: {
      "in.js": `
      let f = 1
      // This should not be turned into "if (1) let f" because that's a syntax error
      if (1)
        function f() {
          return f
        }
      if (f !== 1) throw 'fail'
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting13`, {
    files: {
      "in.js": `
      x: function f() { return 1 }
      if (f() !== 1) throw 'fail'
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting14`, {
    files: {
      "in.ts": `
      if (1) {
        var a = 'a'
        for (var b = 'b'; 0; ) ;
        for (var c in { c: 0 }) ;
        for (var d of ['d']) ;
        for (var e = 'e' in {}) ;
        function f() { return 'f' }
      }
      const observed = JSON.stringify({ a, b, c, d, e, f: f() })
      const expected = JSON.stringify({ a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f' })
      if (observed !== expected) throw observed
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoisting15`, {
    files: {
      "in.ts": `
      if (1) {
        var a = 'a'
        for (var b = 'b'; 0; ) ;
        for (var c in { c: 0 }) ;
        for (var d of ['d']) ;
        for (var e = 'e' in {}) ;
        function f() { return 'f' }
      }
      const observed = JSON.stringify({ a, b, c, d, e, f: f() })
      const expected = JSON.stringify({ a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f' })
      if (observed !== expected) throw observed
    `,
    },
    run: true,
  });
  itBundled(`extra/FunctionHoistingKeepNames1`, {
    files: {
      "in.js": `
      var f
      if (1) function f() { return f }
      if (typeof f !== 'function' || f.name !== 'f') throw 'fail: ' + f.name
    `,
    },
    keepNames: true,
    run: true,
  });
  itBundled(`extra/FunctionHoistingKeepNames2`, {
    files: {
      "in.js": `
      var f
      if (1) function f() { return f }
      if (typeof f !== 'function' || f.name !== 'f') throw 'fail: ' + f.name
    `,
    },
    keepNames: true,
    run: true,
  });
  itBundled(`extra/FunctionHoistingKeepNames3`, {
    files: {
      "in.ts": `
      if (1) {
        var a = 'a'
        for (var b = 'b'; 0; ) ;
        for (var c in { c: 0 }) ;
        for (var d of ['d']) ;
        for (var e = 'e' in {}) ;
        function f() {}
      }
      const observed = JSON.stringify({ a, b, c, d, e, f: f.name })
      const expected = JSON.stringify({ a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f' })
      if (observed !== expected) throw observed
    `,
    },
    keepNames: true,
    run: true,
  });
  itBundled(`extra/FunctionHoistingKeepNames4`, {
    files: {
      "in.ts": `
      if (1) {
        var a = 'a'
        for (var b = 'b'; 0; ) ;
        for (var c in { c: 0 }) ;
        for (var d of ['d']) ;
        for (var e = 'e' in {}) ;
        function f() {}
      }
      const observed = JSON.stringify({ a, b, c, d, e, f: f.name })
      const expected = JSON.stringify({ a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f' })
      if (observed !== expected) throw observed
    `,
    },
    keepNames: true,
    run: true,
  });
  // Object rest pattern tests
  // Test the correctness of side effect order for the TypeScript namespace exports
  itBundled(`extra/ObjectRestPattern1`, {
    files: {
      "in.ts": `
        function fn() {
          let trail = []
          let t = k => (trail.push(k), k)
          let [
            { [t('a')]: a } = { a: t('x') },
            { [t('b')]: b, ...c } = { b: t('y') },
            { [t('d')]: d } = { d: t('z') },
          ] = [{ a: 1 }, { b: 2, bb: 3 }]
          return JSON.stringify({a, b, c, d, trail})
        }
        namespace ns {
          let trail = []
          let t = k => (trail.push(k), k)
          export let [
            { [t('a')]: a } = { a: t('x') },
            { [t('b')]: b, ...c } = { b: t('y') },
            { [t('d')]: d } = { d: t('z') },
          ] = [{ a: 1 }, { b: 2, bb: 3 }]
          export let result = JSON.stringify({a, b, c, d, trail})
        }
        if (fn() !== ns.result) throw 'fail'
      `,
    },
    run: true,
  });
  itBundled(`extra/ObjectRestPattern2`, {
    files: {
      "in.ts": `
        let obj = {};
        ({a: obj.a, ...obj.b} = {a: 1, b: 2, c: 3});
        [obj.c, , ...obj.d] = [1, 2, 3];
        ({e: obj.e, f: obj.f = 'f'} = {e: 'e'});
        [obj.g, , obj.h = 'h'] = ['g', 'gg'];
        namespace ns {
          export let {a, ...b} = {a: 1, b: 2, c: 3};
          export let [c, , ...d] = [1, 2, 3];
          export let {e, f = 'f'} = {e: 'e'};
          export let [g, , h = 'h'] = ['g', 'gg'];
        }
        if (JSON.stringify(obj) !== JSON.stringify(ns)) throw 'fail'
      `,
    },
    run: true,
  });
  itBundled(`extra/ObjectRestPattern3`, {
    files: {
      "in.ts": `
        var z = {x: {z: 'z'}, y: 'y'}, {x: z, ...y} = z
        if (y.y !== 'y' || z.z !== 'z') throw 'fail'
      `,
    },
    run: true,
  });
  itBundled(`extra/ObjectRestPattern4`, {
    files: {
      "in.ts": `
        var z = {x: {x: 'x'}, y: 'y'}, {[(z = {z: 'z'}, 'x')]: x, ...y} = z
        if (x.x !== 'x' || y.y !== 'y' || z.z !== 'z') throw 'fail'
      `,
    },
    run: true,
  });

  itBundled("extra/CaseSensitiveImport", {
    files: {
      "in.js": `
        import x from "./File1.js"
        import y from "./file2.js"
        if (x !== 123 || y !== 234) throw 'fail'
      `,
      "file1.js": `export default 123`,
      "File2.js": `export default 234`,
    },
    run: true,
  });
  itBundled("extra/CaseSensitiveImport2", {
    todo: true,
    files: {
      "in.js": `
        import x from "./File1.js"
        import y from "./file2.js"
        import z from "./File3.js"
        console.log(x, y, z)
      `,
      "file1.js": `export default 123`,
      "File1.js": `export default 234`,
      "file2.js": `export default 345`,
      "File2.js": `export default 456`,
      "File3.js": `export default 567`,
    },
    run: {
      stdout: "234 345 567",
    },
  });
  itBundled("extra/CaseSensitiveImport3", {
    todo: true,
    files: {
      "in.js": `
        import x from "./Dir1/file.js"
        import y from "./dir2/file.js"
        if (x !== 123 || y !== 234) throw 'fail'
      `,
      "dir1/file.js": `export default 123`,
      "Dir2/file.js": `export default 234`,
    },
    bundleErrors: {
      "/in.js": [`Could not resolve: "./Dir1/file.js"`, `Could not resolve: "./dir2/file.js"`],
    },
    run: true,
  });
  // Warn when importing something inside node_modules
  itBundled("extra/CaseSensitiveImport4", {
    files: {
      "in.js": `
        import x from "pkg/File1.js"
        import y from "pkg/file2.js"
        if (x !== 123 || y !== 234) throw 'fail'
      `,
      "node_modules/pkg/file1.js": `export default 123`,
      "node_modules/pkg/File2.js": `export default 234`,
    },
    run: true,
  });
});
