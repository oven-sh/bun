import { describe } from "bun:test";
import { itBundled } from "../expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild
// most of these are from scripts/end-to-end-tests.js but some are from other files

/**
 * Bundles a group of the suite's single-file programs as one bundle and runs it
 * once, instead of one bundle and one subprocess per program. Each program
 * becomes its own module, `in.js` imports them in order, and each program logs
 * its file name after its checks. The exact stdout proves that every program
 * ran, and when one throws, stdout ends at the program before it.
 *
 * `support` holds the files the programs import or require.
 *
 * The export keeps the output an ES module. Without it, bun runs an output whose
 * top level declares a hoisted `exports`, `module` or `require` (CommonJSSymbol)
 * as a CommonJS module, where those names are the wrapper's.
 */
function programs(sources: Record<string, string>, support: Record<string, string> = {}) {
  const names = Object.keys(sources);
  const files: Record<string, string> = {
    "in.js": [...names.map(name => `import './${name}'`), `export const ran = ${JSON.stringify(names)}`].join("\n"),
  };
  for (const name of names) {
    files[name] = `${sources[name]}\nconsole.log(${JSON.stringify(name)})`;
  }
  return { files: { ...files, ...support }, run: { stdout: names.join("\n") } };
}

// For debug, all files are written to $TEMP/bun-bundle-tests/extra
describe.concurrent("bundler", () => {
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
  itBundled("extra/ArbitraryModuleNamespaceIdentifiers", {
    ...programs(
      {
        "1.js": `import {'*' as star} from './export1.js'; if (star !== 123) throw 'fail'`,
        "2.js": `import {'\\0' as bar} from './export2.js'; if (bar !== 123) throw 'fail'`,
        "3.js": `import {'\\uD800\\uDC00' as bar} from './export3.js'; if (bar !== 123) throw 'fail'`,
        "4.js": `import {'🍕' as bar} from './export4.js'; if (bar !== 123) throw 'fail'`,
        "5.js": `import {' ' as bar} from './export5.js'; if (bar !== 123) throw 'fail'`,
        "6.js": `import {'' as ab} from './export6.js'; if (ab.foo !== 123 || ab.bar !== 234) throw 'fail'`,
      },
      {
        "export1.js": `let foo = 123; export {foo as '*'}`,
        "export2.js": `let foo = 123; export {foo as '\\0'}`,
        "export3.js": `let foo = 123; export {foo as '\\uD800\\uDC00'}`,
        "export4.js": `let foo = 123; export {foo as '🍕'}`,
        "export5.js": `export let foo = 123; export {foo as ' '} from './export5.js'`,
        "export6.js": `export let foo = 123, bar = 234; export * as '' from './export6.js'`,
      },
    ),
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
  itBundled("extra/CJSExport", {
    ...programs(
      {
        "1.js": `const out = require('./foo1'); if (out.__esModule || out.foo !== 123) throw 'fail'`,
        "2.js": `const out = require('./foo2'); if (out.__esModule || out !== 123) throw 'fail'`,
        "3.js": `const out = require('./foo3'); if (!out.__esModule || out.foo !== 123) throw 'fail'`,
        "4.js": `const out = require('./foo4'); if (!out.__esModule || out.default !== 123) throw 'fail'`,
        "5.js": `const out = require('./foo5'); if (!out.__esModule || out.default !== null) throw 'fail'`,
        "6.js": `const out = require('./foo6'); if (!out.__esModule || out.default !== null) throw 'fail'`,
      },
      {
        "foo1.js": `exports.foo = 123`,
        "foo2.js": `module.exports = 123`,
        "foo3.js": `export const foo = 123`,
        "foo4.js": `export default 123`,
        "foo5.js": `export default function x() {} x = null`,
        "foo6.js": `export default class x {} x = null`,
      },
    ),
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
  // The `export *` in inner.ts also lands on the entry's module.exports, so out.b is 'b'.
  itBundled("extra/ESBuildIssue1894", {
    todo: true,
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
    run: { file: "node.js" },
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
    files: {
      "in.js": `if (require('./eval').foo !== 123) throw 'fail'`,
      "eval.js": `exports.foo=234;eval('exports.foo = 123')`,
    },
    run: true,
  });
  itBundled("extra/CJSEval2", {
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
  itBundled("extra/CatchScope", {
    ...programs({
      "1.js": `
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
      "2.js": `
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
      "3.js": `
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
      "4.js": `
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
      "5.js": `
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
      "6.js": `
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
      // https://github.com/evanw/esbuild/issues/1812
      "7.js": `
        let a = 1;
        let def = "PASS2";
        try {
          throw [ "FAIL2", "PASS1" ];
        } catch ({ [a]: b, 3: d = def }) {
          let a = 0, def = "FAIL3";
          if (b !== 'PASS1' || d !== 'PASS2') throw 'fail: ' + b + ' ' + d
        }
      `,
      "8.js": `
        let a = 1;
        let def = "PASS2";
        try {
          throw [ "FAIL2", "PASS1" ];
        } catch ({ [a]: b, 3: d = def }) {
          let a = 0, def = "FAIL3";
          if (b !== 'PASS1' || d !== 'PASS2') throw 'fail: ' + b + ' ' + d
        }
      `,
      "9.js": `
        try {
          throw { x: 'z', z: 123 }
        } catch ({ x, [x]: y }) {
          if (y !== 123) throw 'fail'
        }
      `,
    }),
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
  });
  // Test cyclic import issues (shouldn't crash on evaluation)
  itBundled("extra/CyclicImport2", {
    files: {
      "entry.js": `import * as foo from './foo'; export default {foo, bar: require('./bar')}`,
      "foo.js": `import * as a from './entry'; import * as b from './bar'; export default {a, b}`,
      "bar.js": `const entry = require('./entry'); export function foo() { return entry }`,
    },
    run: true,
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
    const prefix = minify.label || "NoMinify";
    itBundled(`extra/${prefix}Hoisting`, {
      ...programs({
        "1.js": `let fn = (x) => { if (x && y) return; function y() {} throw 'fail' }; fn(fn)`,
        "2.js": `let fn = (a, b) => { if (a && (x = () => y) && b) return; var x; let y = 123; if (x() !== 123) throw 'fail' }; fn(fn)`,
      }),
      ...minify.value,
    });

    // Check property access simplification
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
      // All of the snippets below go into one bundle, `extra/${label}`, as the modules `1.js`, `2.js`, ...
      const snippets: Record<string, string> = {};
      function add(n: number, files: Record<string, string>) {
        if (`${n}.js` in snippets) throw new Error(`${label}${n} is defined twice`);
        snippets[`${n}.js`] = files["in.js"];
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
      add(23, {
        "in.js": `
          let x = 1;
          ({ set a(y) { x = y } }${access} = 2);
          if (x !== 2) throw 'fail'
        `,
      });
      itBundled(`extra/${label}`, {
        ...programs(snippets),
        ...minify.value,
        target: "bun",
      });
    }

    // Check try/catch simplification
    itBundled(`extra/${prefix}CatchScope`, {
      ...programs({
        "1.js": `
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
        "3.js": `
          try {
            throw 0
          } catch (x) {
            var x = 1
          }
          if (x !== void 0) throw 'fail'
        `,
        "4.js": `
          let works
          try {
            throw { get a() { works = true } }
          } catch ({ a }) {}
          if (!works) throw 'fail'
        `,
        "5.js": `
          let works
          try {
            throw { *[Symbol.iterator]() { works = true } }
          } catch ([x]) {
          }
          if (!works) throw 'fail'
        `,
      }),
      ...minify.value,
    });
    // Minified, this fails: the direct eval does not stop `y` from being renamed (#35955 fixes that).
    itBundled(`extra/${prefix}CatchScope2`, {
      todo: minify.label === "Minify",
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
      ...minify.value,
      run: true,
    });

    // Check variable initializer inlining. `fn` must not be inlined as the call `obj.bar()`, which
    // would pass `obj` as `this`. Bun runs out.js as an ES module, so a plain call gets `undefined`
    // instead of the `globalThis` the esbuild version expects.
    itBundled(`extra/${prefix}VariableInitializerInlining`, {
      files: {
        "in.js": `
          function foo() {
            if (this !== globalThis && this !== undefined) throw 'fail'
          }
          function main() {
            let obj = { bar: foo };
            let fn = obj.bar;
            (0, fn)();
          }
          main()
        `,
      },
      ...minify.value,
      run: true,
    });
    // Check global constructor behavior
    itBundled(`extra/${prefix}GlobalConstructorBehavior`, {
      ...programs({
        "1.js": `
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
        "2.js": `
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
        "3.js": `
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
      }),
      ...minify.value,
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
  itBundled(`extra/ForLoopInitializerHoisting`, {
    ...programs(
      {
        "1.js": `if (require('./nested1').foo() !== 10) throw 'fail'`,
        "2.js": `if (require('./nested2').foo() !== 'c') throw 'fail'`,
        "3.js": `if (require('./nested3').foo() !== 3) throw 'fail'`,
      },
      {
        "nested1.js": `
          for (var i = 0; i < 10; i++) ;
          export function foo() { return i }
        `,
        "nested2.js": `
          for (var i in {a: 1, b: 2, c: 3}) ;
          export function foo() { return i }
        `,
        "nested3.js": `
          for (var i of [1, 2, 3]) ;
          export function foo() { return i }
        `,
      },
    ),
  });

  // Test tree shaking
  itBundled(`extra/TreeShaking`, {
    ...programs(
      {
        // Keep because used (ES6)
        "1.js": `import * as foo from './foo1'; if (global.dce0 !== 123 || foo.abc !== 'abc') throw 'fail'`,
        // Remove because unused (ES6)
        "2.js": `import * as foo from './foo2'; if (global.dce1 !== void 0) throw 'fail'`,
        // Keep because side effects (ES6)
        "3.js": `import * as foo from './foo3'; if (global.dce2 !== 123) throw 'fail'`,
        // Keep because used (CommonJS)
        "4.js": `import foo from './foo4'; if (global.dce3 !== 123 || foo.abc !== 'abc') throw 'fail'`,
        // Remove because unused (CommonJS)
        "5.js": `import foo from './foo5'; if (global.dce4 !== void 0) throw 'fail'`,
        // Keep because side effects (CommonJS)
        "6.js": `import foo from './foo6'; if (global.dce5 !== 123) throw 'fail'`,
        // Note: Tree shaking this could technically be considered incorrect because
        // the import is for a property whose getter in this case has a side effect.
        // However, this is very unlikely and the vast majority of the time people
        // would likely rather have the code be tree-shaken. This test case enforces
        // the technically incorrect behavior as documentation that this edge case
        // is being ignored.
        "7.js": `import {foo, bar} from './foo7'; let unused = foo; if (bar) throw 'expected "foo" to be tree-shaken'`,
      },
      {
        "foo1/index.js": `global.dce0 = 123; export const abc = 'abc'`,
        "foo1/package.json": `{ "sideEffects": false }`,
        "foo2/index.js": `global.dce1 = 123; export const abc = 'abc'`,
        "foo2/package.json": `{ "sideEffects": false }`,
        "foo3/index.js": `global.dce2 = 123; export const abc = 'abc'`,
        "foo3/package.json": `{ "sideEffects": true }`,
        "foo4/index.js": `global.dce3 = 123; exports.abc = 'abc'`,
        "foo4/package.json": `{ "sideEffects": false }`,
        "foo5/index.js": `global.dce4 = 123; exports.abc = 'abc'`,
        "foo5/package.json": `{ "sideEffects": false }`,
        "foo6/index.js": `global.dce5 = 123; exports.abc = 'abc'`,
        "foo6/package.json": `{ "sideEffects": true }`,
        "foo7.js": `module.exports = {get foo() { module.exports.bar = 1 }, bar: 0}`,
      },
    ),
    // foo2 and foo5 are removed from the bundle, and so is `let unused = foo` in 7.js.
    assertNotPresent: {
      "/out.js": ["dce1 = 123", "dce4 = 123", "unused"],
    },
  });
  // Test for an implicit and explicit "**/" prefix (see https://github.com/evanw/esbuild/issues/1184)
  itBundled(`extra/TreeShaking8`, {
    // Bun joins the pattern onto the package directory, so "x.*" does not match dir/x.js.
    todo: true,
    files: {
      "entry.js": `import './foo'; if (global.dce6 !== 123) throw 'fail'`,
      "foo/dir/x.js": `global.dce6 = 123`,
      "foo/package.json": `{ "main": "dir/x", "sideEffects": ["x.*"] }`,
    },
    run: true,
  });
  itBundled(`extra/TreeShaking9`, {
    files: {
      "entry.js": `import './foo'; if (global.dce6 !== 123) throw 'fail'`,
      "foo/dir/x.js": `global.dce6 = 123`,
      "foo/package.json": `{ "main": "dir/x", "sideEffects": ["**/x.*"] }`,
    },
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
  itBundled(`extra/CommonJSSymbol`, {
    ...programs(
      {
        "1.js": `const ns = require('./foo1'); if (ns.foo !== 123 || ns.bar !== 123) throw 'fail'`,
        "2.js": `require('./foo2'); require('./bar2')`,
        "3.js": `const ns = require('./foo3'); if (ns.foo !== void 0 || ns.default.foo !== 123) throw 'fail'`,
        "4.js": `const ns = require('./foo4'); if (ns !== 123) throw 'fail'`,
        "5.js": `require('./foo5')`,
        "6.js": `require('./foo6')`,
        "7.js": `const ns = require('./foo7'); if (ns.a !== 123 || ns.b.a !== 123) throw 'fail'`,
      },
      {
        "foo1.js": `var exports, module; module.exports.foo = 123; exports.bar = exports.foo`,
        "foo2.js": `let exports; if (exports !== void 0) throw 'fail'`,
        "bar2.js": `let module; if (module !== void 0) throw 'fail'`,
        "foo3.js": `var exports = {foo: 123}; export default exports`,
        "foo4.ts": `let module = 123; export = module`,
        "foo5.js": `var require; if (require !== void 0) throw 'fail'`,
        "foo6.js": `var require = x => x; if (require('does not exist') !== 'does not exist') throw 'fail'`,
        "foo7.js": `exports.a = 123; exports.b = this`,
      },
    ),
  });
  // The top-level `this` of the ES module becomes null instead of undefined, so this one only bundles.
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
    todo: true, // keepNames requires Object.defineProperty implementation
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
    todo: true, // keepNames requires Object.defineProperty implementation
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
  itBundled(`extra/ObjectRestPattern`, {
    ...programs({
      "1.ts": `
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
      "2.ts": `
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
      "3.ts": `
        var z = {x: {z: 'z'}, y: 'y'}, {x: z, ...y} = z
        if (y.y !== 'y' || z.z !== 'z') throw 'fail'
      `,
      "4.ts": `
        var z = {x: {x: 'x'}, y: 'y'}, {[(z = {z: 'z'}, 'x')]: x, ...y} = z
        if (x.x !== 'x' || y.y !== 'y' || z.z !== 'z') throw 'fail'
      `,
    }),
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
