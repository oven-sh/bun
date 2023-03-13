import { it, describe } from "bun:test";
import { itBundled } from "./expectBundled";
import dedent from "dedent";
import { appendFileSync } from "fs";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_default_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests

describe("bundler", () => {
  itBundled("default/SimpleES6", {
    files: {
      "/entry.js": /* js */ `
          import {fn} from './foo';
          console.log(fn());
        `,
      "/foo.js": /* js */ `
          export function fn() {
            return 123
          }
        `,
    },
    run: {
      stdout: "123",
    },
  });

  itBundled("default/SimpleCommonJS", {
    files: {
      "/entry.js": /* js */ `
          const fn = require('./foo')
				  console.log(fn())
        `,
      "/foo.js": /* js */ `
          module.exports = function() {
            return 123
          }
        `,
    },
    run: {
      stdout: "123",
    },
  });

  // This test makes sure that require() calls are still recognized in nested
  // scopes. It guards against bugs where require() calls are only recognized in
  // the top-level module scope.
  itBundled("default/NestedCommonJS", {
    files: {
      "/entry.js": /* js */ `
          function nestedScope() {
            const fn = require('./foo')
            console.log(fn())
          }
          nestedScope()
        `,
      "/foo.js": /* js */ `
          module.exports = function() {
            return 123
          }
        `,
    },
    run: {
      stdout: "123",
    },
  });

  itBundled("default/NewExpressionCommonJS", {
    files: {
      "/entry.js": /* js */ `
        new (require("./foo.js")).Foo();
      `,
      "/foo.js": /* js */ `
        class Foo {}
        module.exports = {Foo};
      `,
    },
    run: true,
  });

  itBundled("default/CommonJSFromES6", {
    files: {
      "/entry.js": /* js */ `
        const {foo} = require('./foo')
        console.log(foo(), bar())
        const {bar} = require('./bar') // This should not be hoisted
      `,
      "/foo.js": /* js */ `
        export function foo() {
          return 'foo'
        }
      `,
      "/bar.js": /* js */ `
          export function bar() {
            return 'bar'
          }
        `,
    },
    run: {
      error: "TypeError: bar2 is not a function. (In 'bar2()', 'bar2' is undefined)",
      errorLineMatch: /console\.log/,
    },
  });

  itBundled("default/ES6FromCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import {foo} from './foo'
        console.log(foo(), bar())
        import {bar} from './bar' // This should be hoisted
      `,
      "/foo.js": /* js */ `
        exports.foo = function() {
          return 'foo'
        }
      `,
      "/bar.js": /* js */ `
        exports.bar = function() {
          return 'bar'
        }
      `,
    },
    run: {
      stdout: "foo bar",
    },
  });

  itBundled("default/NestedES6FromCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import {fn} from './foo'
        (() => {
          console.log(fn())
        })()
      `,
      "/foo.js": /* js */ `
        exports.fn = function() {
          return 123
        }
      `,
    },
    run: {
      stdout: "123",
    },
  });

  itBundled("default/ExportFormsES6", {
    files: {
      "/entry.js": /* js */ `
        export default 123
        export var v = 234
        export let l = 345
        export const c = 456
        export {Class as C}
        export function Fn() {}
        export class Class {}
        export * from './a'
        export * as b from './b'
      `,
      "/a.js": "export const abc = undefined",
      "/b.js": "export const xyz = null",

      "/test.js": /* js */ `
        import * as module from "./out";
        import { strictEqual } from "node:assert";
        
        strictEqual(module.default, 123, ".default");
        strictEqual(module.v, 234, ".v");
        strictEqual(module.l, 345, ".l");
        strictEqual(module.c, 456, ".c");
        module.Fn();
        new module.C();
        strictEqual('abc' in module, true, ".abc exists");
        strictEqual(module.abc, undefined, ".abc");
        strictEqual(module.b.xyz, null, ".xyz");
      `,
    },
    format: "esm",
    run: {
      file: "/test.js",
    },
  });

  itBundled("default/ExportFormsIIFE", {
    files: {
      "/entry.js": /* js */ `
        export default 123
        export var v = 234
        export let l = 345
        export const c = 456
        export {Class as C}
        export function Fn() {}
        export class Class {}
        export * from './a'
        export * as b from './b'
      `,
      "/a.js": "export const abc = undefined",
      "/b.js": "export const xyz = null",
    },
    format: "iife",
    globalName: "globalName",
    run: true,
    onAfterBundle({ outfile }) {
      appendFileSync(
        outfile,
        dedent/* js */ `
          import { strictEqual } from "node:assert";
          strictEqual(globalName.default, 123, ".default");
          strictEqual(globalName.v, 234, ".v");
          strictEqual(globalName.l, 345, ".l");
          strictEqual(globalName.c, 456, ".c");
          globalName.Fn();
          new globalName.C();
          strictEqual("abc" in globalName, true, ".abc exists");
          strictEqual(globalName.abc, undefined, ".abc");
          strictEqual(globalName.b.xyz, null, ".xyz");
        `,
      );
    },
  });

  itBundled("default/ExportFormsWithMinifyIdentifiersAndNoBundle", {
    files: {
      "/a.js": `
        export default 123
        export var varName = 234
        export let letName = 345
        export const constName = 456
        function Func2() {}
        class Class2 {}
        export {Class as Cls, Func2 as Fn2, Class2 as Cls2}
        export function Func() {}
        export class Class {}
        export * from './f'
        export * as fromF from './f'
      `,
      "/b.js": "export default function() {}",
      "/c.js": "export default function foo() {}",
      "/d.js": "export default class {}",
      "/e.js": "export default class Foo {}",
    },
    entryPaths: ["/a.js", "/b.js", "/c.js", "/d.js", "/e.js"],
    bundle: false,
    runtimeFiles: {
      "./out/f.js": /* js */ `
        export const f = 987;
      `,
      "/test.js": /* js */ `
        import * as a from './out/a';
        import { deepEqual } from 'node:assert';
        deepEqual(a.varName, 234, "a.default");
        deepEqual(a.letName, 345, "a.letName");
        deepEqual(a.constName, 456, "a.constName");
        a.Fn2();
        new a.Cls();
        new a.Cls2();
        new a.Class();
        deepEqual(a.f, 987, "a.f");
        deepEqual(a.fromF, { f: 987 }, "a.fromF");
      `,
    },
    run: {
      file: "/test.js",
    },
  });

  // this one is edited heavily. used to be all importing from `foo`, but here i have it
  // so the modules can actually be resolved at runtime.
  itBundled("default/ImportFormsWithMinifyIdentifiersAndNoBundle", {
    files: {
      "/entry.js": /* js */ `
        import './a'
        import {} from './b'
        import * as ns from './c'
        import {a, b as c} from './c'
        import def from './c'
        import def2, * as ns2 from './c'
        import def3, {a2, b as c3} from './c'
        const imp = [
          await import('./c'),
          function nested() { return import('./c') },
        ]

        import { deepEqual } from 'node:assert'
        deepEqual(a, 1, 'a');
        deepEqual(a2, 4, 'a2');
        deepEqual(c3, 2, 'c3');
        deepEqual(def, 3, 'def');
        deepEqual(def2, 3, 'def2');
        deepEqual(def3, 3, 'def3');
        deepEqual(ns, ns2, 'ns and ns2');
        deepEqual(ns, imp[0], 'ns and first await import');
        deepEqual(ns, await imp[1](), 'ns and second import');
      `,
    },
    runtimeFiles: {
      "/a.js": /* js */ `
        globalThis.aWasImported = true;
      `,
      "/b.js": /* js */ `
        globalThis.bWasImported = true;
      `,
      "/c.js": /* js */ `
        export const a = 1;
        export const b = 2;
        export default 3;
        export const a2 = 4;
      `,
      "./test.js": String.raw/* js */ `
        import './out.js';
        if (!globalThis.aWasImported) {
          throw new Error('"import \'./a\'" was tree-shaken when it should not have been.')
        }
        if (!globalThis.bWasImported) {
          throw new Error('"import {} from \'./b\'" was tree-shaken when it should not have been.')
        }
      `,
    },
    bundle: false,
    minifyIdentifiers: true,
    run: {
      file: "./test.js",
    },
  });
});
