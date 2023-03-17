import dedent from "dedent";
import { appendFileSync } from "fs";
import { bundlerTest, expectBundled, itBundled, testForFile } from "./expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_default_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/default

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
      "/a.js": /* js */ `
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
    entryPoints: ["/a.js", "/b.js", "/c.js", "/d.js", "/e.js"],
    mode: "transform",
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
  // this two were edited heavily. They used to be all importing from `foo`, but here i have it
  // so the modules can actually be resolved at runtime.
  const importFormsConfig = {
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
    mode: "transform",
    run: {
      file: "./test.js",
    },
  } as const;
  itBundled("default/ImportFormsWithNoBundle", {
    ...importFormsConfig,
  });
  itBundled("default/ImportFormsWithMinifyIdentifiersAndNoBundle", {
    ...importFormsConfig,
    minifyIdentifiers: true,
  });
  itBundled("default/ExportFormsCommonJS", {
    files: {
      "/entry.js": /* js */ `
        const commonjs = require("./commonjs");
        const c = require("./c").default;
        const d = require("./d").default;
        const e = require("./e").default;
        const f = require("./f").default;
        const g = require("./g").default;
        const h = require("./h").default;
        
        assert.deepEqual(commonjs.default, 123, "commonjs.default");
        assert.deepEqual(commonjs.v, 234, "commonjs.default");
        assert.deepEqual(commonjs.l, 345, "commonjs.l");
        assert.deepEqual(commonjs.c, 456, "commonjs.c");
        commonjs.Fn();
        new commonjs.Class();
        new commonjs.C();
        assert("abc" in commonjs, "commonjs.abc");
        assert.deepEqual(commonjs.abc, undefined, "commonjs.abc");
        assert.deepEqual(commonjs.b, { xyz: null }, "commonjs.b");
        new c();
        new d();
        assert.deepEqual(d.prop, 567, "d.prop");
        e();
        f();
        assert.deepEqual(f.prop, 678, "f.prop");
        assert(g() instanceof Promise, "g");
        assert(h() instanceof Promise, "h");
        assert.deepEqual(h.prop, 789, "h.prop");
      `,
      "/commonjs.js": /* js */ `
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
      "/a.js": `export const abc = undefined`,
      "/b.js": `export const xyz = null`,
      "/c.js": `export default class {}`,
      "/d.js": `export default class Foo {} Foo.prop = 567`,
      "/e.js": `export default function() {}`,
      "/f.js": `export default function foo() {} foo.prop = 678`,
      "/g.js": `export default async function() {}`,
      "/h.js": `export default async function foo() {} foo.prop = 789`,

      // assert bundles weird as of writing
      "/test.js": /* js */ `
        globalThis.assert = import.meta.require('assert');
        require('./out.js');
      `,
    },
    run: {
      file: "/test.js",
    },
  });
  itBundled("default/ExportChain", {
    files: {
      "/entry.js": `export {b as a} from './foo'`,
      "/foo.js": `export {c as b} from './bar'`,
      "/bar.js": `export const c = 123`,

      "/test.js": `
        import { strictEqual } from 'assert';
        import * as module from './out';
        strictEqual(module.a, 123);
      `,
    },
    run: {
      file: "/test.js",
    },
  });
  itBundled("default/ExportInfiniteCycle1", {
    files: {
      "/entry.js": /* js */ `
        export {a as b} from './entry'
        export {b as c} from './entry'
        export {c as d} from './entry'
        export {d as a} from './entry'
      `,
    },
    bundleErrors: {
      "/entry.js": [
        `Detected cycle while resolving import "a"`,
        `Detected cycle while resolving import "b"`,
        `Detected cycle while resolving import "c"`,
        `Detected cycle while resolving import "d"`,
      ],
    },
  });
  itBundled("default/ExportInfiniteCycle2", {
    files: {
      "/entry.js": /* js */ `
        export {a as b} from './foo'
        export {c as d} from './foo'
      `,
      "/foo.js": /* js */ `
        export {b as c} from './entry'
        export {d as a} from './entry'
      `,
    },
    bundleErrors: {
      "/entry.js": [`Detected cycle while resolving import "a"`, `Detected cycle while resolving import "c"`],
      "/foo.js": [`Detected cycle while resolving import "b"`, `Detected cycle while resolving import "d"`],
    },
  });
  itBundled("default/JSXImportsCommonJS", {
    files: {
      "/entry.jsx": /* jsx */ `
        import {elem, frag} from './custom-react'
        console.log(<div/>, <>fragment</>)
      `,
      "/custom-react.js": /* js */ `
        module.exports = {
          elem: (...args) => console.log('elem', ...args),
          frag: 'frag',
        };
      `,
    },
    jsx: {
      factory: "elem",
      fragment: "frag",
    },
    run: {
      stdout: `
        elem div null
        elem frag null fragment
        undefined undefined
      `,
    },
  });
  itBundled("default/JSXImportsES6", {
    files: {
      "/entry.jsx": /* jsx */ `
        import {elem, frag} from './custom-react'
        console.log(<div/>, <>fragment</>)
      `,
      "/custom-react.js": /* js */ `
        export function elem(...args) {
          console.log('elem', ...args)
        }
        export const frag = "frag";
      `,
    },
    jsx: {
      factory: "elem",
      fragment: "frag",
    },
    run: {
      stdout: `
        elem div null
        elem frag null fragment
        undefined undefined
      `,
    },
  });
  itBundled("default/JSXSyntaxInJS", {
    files: {
      "/entry.js": `console.log(<div/>)`,
    },
    bundleErrors: {
      "/entry.js": ["ERROR: The JSX syntax extension is not currently enabled"],
    },
  });
  itBundled("default/JSXConstantFragments", {
    files: {
      "/entry.js": /* js */ `
        import './default'
        import './null'
        import './boolean'
        import './number'
        import './string-single-empty'
        import './string-double-empty'
        import './string-single-punctuation'
        import './string-double-punctuation'
        import './string-template'
      `,
      "/default.jsx": `console.log(<></>)`,
      "/null.jsx": `console.log(<></>) // @jsxFrag null`,
      "/boolean.jsx": `console.log(<></>) // @jsxFrag true`,
      "/number.jsx": `console.log(<></>) // @jsxFrag 123`,
      "/string-single-empty.jsx": `console.log(<></>) // @jsxFrag ''`,
      "/string-double-empty.jsx": `console.log(<></>) // @jsxFrag ""`,
      "/string-single-punctuation.jsx": `console.log(<></>) // @jsxFrag '['`,
      "/string-double-punctuation.jsx": `console.log(<></>) // @jsxFrag "["`,
      "/string-template.jsx": "console.log(<></>) // @jsxFrag ``",

      "/test.js": /* js */ `
        globalThis.React = {
          createElement: (x) => x,
          Fragment: 'frag'
        }
        await import('./out.js');
      `,
    },
    jsx: {
      fragment: "']'",
    },
    bundleWarnings: {
      "/string-template.jsx": ["Invalid JSX fragment: ``"],
    },
    run: {
      file: "/test.js",
      stdout: "]\nnull\ntrue\n123\n\n\n[\n[\n]",
    },
  });
  itBundled("default/JSXAutomaticImportsCommonJS", {
    files: {
      "/entry.jsx": /* jsx */ `
        import {jsx, Fragment} from './custom-react'
        console.log(<div jsx={jsx}/>, <><Fragment/></>)
      `,
      "/custom-react.js": `module.exports = { jsx: 'jsx', Fragment: 'fragment2' }`,
    },
    jsx: {
      automaticRuntime: true,
    },
    external: ["react/jsx-runtime"],
    run: {
      stdout: `
        <div jsx="jsx" /> <>
          <fragment2 />
        </>
      `,
    },
  });
  itBundled("default/JSXAutomaticImportsES6", {
    files: {
      "/entry.jsx": /* jsx */ `
        import {jsx, Fragment} from './custom-react'
        console.log(<div jsx={jsx}/>, <><Fragment/></>)
      `,
      "/custom-react.js": /* js */ `
        export const jsx = 'jsx function'
        export const Fragment = 'fragment'
      `,
    },
    jsx: {
      automaticRuntime: true,
    },
    external: ["react/jsx-runtime"],
    run: {
      stdout: `
        <div jsx="jsx function" /> <>
          <fragment />
        </>
      `,
    },
  });
  itBundled("default/JSXAutomaticSyntaxInJS", {
    files: {
      "/entry.js": `console.log(<div/>)`,
    },
    jsx: {
      automaticRuntime: true,
    },
    external: ["react/jsx-runtime"],
    bundleErrors: {
      "/entry.js": ["The JSX syntax extension is not currently enabled"],
    },
  });
  itBundled("default/NodeModules", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import fn from 'demo-pkg'
        console.log(fn())
      `,
      "/Users/user/project/node_modules/demo-pkg/index.js": /* js */ `
        module.exports = function() {
          return 123
        }
      `,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("default/RequireChildDirCommonJS", {
    files: {
      "/Users/user/project/src/entry.js": `console.log(require('./dir'))`,
      "/Users/user/project/src/dir/index.js": `module.exports = 123`,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("default/RequireChildDirES6", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import value from './dir'
        console.log(value)
      `,
      "/Users/user/project/src/dir/index.js": `export default 123`,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("default/RequireParentDirCommonJS", {
    files: {
      "/Users/user/project/src/dir/entry.js": `console.log(require('..'))`,
      "/Users/user/project/src/index.js": `module.exports = 123`,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("default/RequireParentDirES6", {
    files: {
      "/Users/user/project/src/dir/entry.js": /* js */ `
        import value from '..'
        console.log(value)
      `,
      "/Users/user/project/src/index.js": `export default 123`,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("default/ImportMissingES6", {
    files: {
      "/entry.js": /* js */ `
        import fn, {x as a, y as b} from './foo'
        console.log(fn(a, b))
      `,
      "/foo.js": `export const x = 123`,
    },
    bundleErrors: {
      "/entry.js": [
        `No matching export "default" in "foo.js" for import "default"`,
        `No matching export "y" in "foo.js" for import "y"`,
      ],
    },
  });
  itBundled("default/ImportMissingUnusedES6", {
    files: {
      "/entry.js": `import fn, {x as a, y as b} from './foo'`,
      "/foo.js": `export const x = 123`,
    },
    bundleErrors: {
      "/entry.js": [
        `No matching export "default" in "foo.js" for import "default"`,
        `No matching export "y" in "foo.js" for import "y"`,
      ],
    },
  });
  itBundled("default/ImportMissingCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import fn, {x as a, y as b} from './foo'
        console.log(fn.x, a, b);
      `,
      "/foo.js": `exports.x = 123`,
    },
    run: {
      stdout: "123 123 undefined",
    },
  });
  itBundled("default/ImportMissingNeitherES6NorCommonJS", {
    files: {
      "/named.js": /* js */ `
        import fn, {x as a, y as b} from './foo'
        console.log(fn(a, b))
      `,
      "/star.js": /* js */ `
        import * as ns from './foo'
        console.log(ns.default(ns.x, ns.y))
      `,
      "/star-capture.js": /* js */ `
        import * as ns from './foo'
        console.log(ns)
      `,
      "/bare.js": `import './foo'`,
      "/require.js": `console.log(require('./foo'))`,
      "/import.js": `console.log(import('./foo'))`,
      "/foo.js": `console.log('no exports here')`,
    },
    entryPoints: ["/named.js", "/star.js", "/star-capture.js", "/bare.js", "/require.js", "/import.js"],
    // TODO: warnings
    bundleWarnings: {
      "/named.js": [
        'Import "x" will always be undefined because the file "foo.js" has no exports',
        'Import "y" will always be undefined because the file "foo.js" has no exports',
      ],
      "/star.js": [
        'Import "x" will always be undefined because the file "foo.js" has no exports',
        'Import "y" will always be undefined because the file "foo.js" has no exports',
      ],
    },
  });
  itBundled("default/ExportMissingES6", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(ns)
      `,
      "/foo.js": `export {nope} from './bar'`,
      "/bar.js": `export const yep = 123`,
    },
    bundleErrors: {
      "/foo.js": [`No matching export "nope" in "bar.js" for import "nope"`],
    },
  });
  itBundled("default/DotImport", {
    files: {
      "/entry.js": /* js */ `
        import {x} from '.'
        console.log(x)
      `,
      "/index.js": `exports.x = 123`,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("default/RequireWithTemplate", {
    files: {
      "/a.js": `
        console.log(require('./b'))
        console.log(require(\` + "\`./b\`" + \`))
      `,
      "/b.js": `exports.x = 123`,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("default/DynamicImportWithTemplateIIFE", {
    // GENERATED
    files: {
      "/a.js": `
        import('./b').then(ns => console.log(ns))
        import(\` + "\`./b\`" + \`).then(ns => console.log(ns))
      `,
      "/b.js": `exports.x = 123`,
    },
    format: "iife",
  });
  itBundled("default/RequireAndDynamicImportInvalidTemplate", {
    // GENERATED
    files: {
      "/entry.js": `
        require(tag\` + "\`./b\`" + \`)
        require(\` + "\`./\$0b}\`" + \`)
  
        try {
          require(tag\` + "\`./b\`" + \`)
          require(\` + "\`./\$0b}\`" + \`)
        } catch {
        }
  
        (async () => {
          import(tag\` + "\`./b\`" + \`)
          import(\` + "\`./\$0b}\`" + \`)
          await import(tag\` + "\`./b\`" + \`)
          await import(\` + "\`./\$0b}\`" + \`)
  
          try {
            import(tag\` + "\`./b\`" + \`)
            import(\` + "\`./\$0b}\`" + \`)
            await import(tag\` + "\`./b\`" + \`)
            await import(\` + "\`./\$0b}\`" + \`)
          } catch {
          }
        })()
      `,
    },
  });
  itBundled("default/DynamicImportWithExpressionCJS", {
    // GENERATED
    files: {
      "/a.js": /* js */ `
        import('foo')
        import(foo())
      `,
    },
    format: "cjs",
    mode: "convertformat",
  });
  itBundled("default/MinifiedDynamicImportWithExpressionCJS", {
    // GENERATED
    files: {
      "/a.js": /* js */ `
        import('foo')
        import(foo())
      `,
    },
    format: "cjs",
    mode: "convertformat",
  });
  itBundled("default/ConditionalRequireResolve", {
    // GENERATED
    files: {
      "/a.js": /* js */ `
        require.resolve(x ? 'a' : y ? 'b' : 'c')
        require.resolve(x ? y ? 'a' : 'b' : c)
      `,
    },
    platform: "node",
    format: "cjs",
  });
  itBundled("default/ConditionalRequire", {
    // GENERATED
    files: {
      "/a.js": /* js */ `
        require(x ? 'a' : y ? './b' : 'c')
        require(x ? y ? 'a' : './b' : c)
      `,
      "/b.js": `exports.foo = 213`,
    },
  });
  itBundled("default/ConditionalImport", {
    // GENERATED
    files: {
      "/a.js": `import(x ? 'a' : y ? './import' : 'c')`,
      "/b.js": `import(x ? y ? 'a' : './import' : c)`,
      "/import.js": `exports.foo = 213`,
    },
    entryPoints: ["/a.js", "/b.js"],
  });
  itBundled("default/RequireBadArgumentCount", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        require()
        require("a", "b")
  
        try {
          require()
          require("a", "b")
        } catch {
        }
      `,
    },
  });
  itBundled("default/RequireJson", {
    // GENERATED
    files: {
      "/entry.js": `console.log(require('./test.json'))`,
      "/test.json": /* json */ `
        {
          "a": true,
          "b": 123,
          "c": [null]
        }
      `,
    },
  });
  itBundled("default/RequireTxt", {
    // GENERATED
    files: {
      "/entry.js": `console.log(require('./test.txt'))`,
      "/test.txt": `This is a test.`,
    },
  });
  itBundled("default/RequireBadExtension", {
    // GENERATED
    files: {
      "/entry.js": `console.log(require('./test.bad'))`,
      "/test.bad": `This is a test.`,
    },
    /* TODO FIX expectedScanLog: `entry.js: ERROR: No loader is configured for ".bad" files: test.bad
  `, */
  });
  itBundled("default/FalseRequire", {
    // GENERATED
    files: {
      "/entry.js": `(require => require('/test.txt'))()`,
      "/test.txt": `This is a test.`,
    },
  });
  itBundled("default/RequireWithoutCall", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        const req = require
        req('./entry')
      `,
    },
  });
  itBundled("default/NestedRequireWithoutCall", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        (() => {
          const req = require
          req('./entry')
        })()
      `,
    },
  });
  itBundled("default/RequireWithCallInsideTry", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        try {
          const supportsColor = require('supports-color');
          if (supportsColor && (supportsColor.stderr || supportsColor).level >= 2) {
            exports.colors = [];
          }
        } catch (error) {
        }
      `,
    },
  });
  itBundled("default/RequireWithoutCallInsideTry", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        try {
          oldLocale = globalLocale._abbr;
          var aliasedRequire = require;
          aliasedRequire('./locale/' + name);
          getSetGlobalLocale(oldLocale);
        } catch (e) {}
      `,
    },
  });
  itBundled("default/RequirePropertyAccessCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        // These shouldn't warn since the format is CommonJS
        console.log(Object.keys(require.cache))
        console.log(Object.keys(require.extensions))
        delete require.cache['fs']
        delete require.extensions['.json']
      `,
    },
    platform: "node",
    format: "cjs",
  });
  itBundled("default/AwaitImportInsideTry", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        async function main(name) {
          try {
            return await import(name)
          } catch {
          }
        }
        main('fs')
      `,
    },
  });
  itBundled("default/ImportInsideTry", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        let x
        try {
          x = import('nope1')
          x = await import('nope2')
        } catch {
        }
      `,
    },
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Could not resolve "nope1"
  NOTE: You can mark the path "nope1" as external to exclude it from the bundle, which will remove this error. You can also add ".catch()" here to handle this failure at run-time instead of bundle-time.
  `, */
  });
  itBundled("default/ImportThenCatch", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import(name).then(pass, fail)
        import(name).then(pass).catch(fail)
        import(name).catch(fail)
      `,
    },
  });
  itBundled("default/SourceMap", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {bar} from './bar'
        function foo() { bar() }
        foo()
      `,
      "/Users/user/project/src/bar.js": `export function bar() { throw new Error('test') }`,
    },
    sourceMap: "linked-with-comment",
  });
  itBundled("default/NestedScopeBug", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        (() => {
          function a() {
            b()
          }
          {
            var b = () => {}
          }
          a()
        })()
      `,
    },
  });
  itBundled("default/HashbangBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        #!/usr/bin/env a
        import {code} from './code'
        process.exit(code)
      `,
      "/code.js": /* js */ `
        #!/usr/bin/env b
        export const code = 0
      `,
    },
  });
  itBundled("default/HashbangNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        #!/usr/bin/env node
        process.exit(0);
      `,
    },
    mode: "transform",
  });
  itBundled("default/HashbangBannerUseStrictOrder", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        #! in file
        'use strict'
        foo()
      `,
    },
    banner: "#! from banner",
  });
  itBundled("default/RequireFSBrowser", {
    // GENERATED
    files: {
      "/entry.js": `console.log(require('fs'))`,
    },
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Could not resolve "fs"
  NOTE: The package "fs" wasn't found on the file system but is built into node. Are you trying to bundle for node? You can use "Platform: api.PlatformNode" to do that, which will remove this error.
  `, */
  });
  itBundled("default/RequireFSNode", {
    // GENERATED
    files: {
      "/entry.js": `return require('fs')`,
    },
    format: "cjs",
  });
  itBundled("default/RequireFSNodeMinify", {
    // GENERATED
    files: {
      "/entry.js": `return require('fs')`,
    },
    minifyWhitespace: true,
    format: "cjs",
  });
  itBundled("default/ImportFSBrowser", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import 'fs'
        import * as fs from 'fs'
        import defaultValue from 'fs'
        import {readFileSync} from 'fs'
        console.log(fs, readFileSync, defaultValue)
      `,
    },
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Could not resolve "fs"
  NOTE: The package "fs" wasn't found on the file system but is built into node. Are you trying to bundle for node? You can use "Platform: api.PlatformNode" to do that, which will remove this error.
  `, */
  });
  itBundled("default/ImportFSNodeCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import 'fs'
        import * as fs from 'fs'
        import defaultValue from 'fs'
        import {readFileSync} from 'fs'
        console.log(fs, readFileSync, defaultValue)
      `,
    },
    format: "cjs",
  });
  itBundled("default/ImportFSNodeES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import 'fs'
        import * as fs from 'fs'
        import defaultValue from 'fs'
        import {readFileSync} from 'fs'
        console.log(fs, readFileSync, defaultValue)
      `,
    },
    format: "esm",
  });
  itBundled("default/ExportFSBrowser", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export * as fs from 'fs'
        export {readFileSync} from 'fs'
      `,
    },
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Could not resolve "fs"
  NOTE: The package "fs" wasn't found on the file system but is built into node. Are you trying to bundle for node? You can use "Platform: api.PlatformNode" to do that, which will remove this error.
  `, */
  });
  itBundled("default/ExportFSNode", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export * as fs from 'fs'
        export {readFileSync} from 'fs'
      `,
    },
  });
  itBundled("default/ReExportFSNode", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export {fs as f} from './foo'
        export {readFileSync as rfs} from './foo'
      `,
      "/foo.js": /* js */ `
        export * as fs from 'fs'
        export {readFileSync} from 'fs'
      `,
    },
  });
  itBundled("default/ExportFSNodeInCommonJSModule", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as fs from 'fs'
        import {readFileSync} from 'fs'
        exports.fs = fs
        exports.readFileSync = readFileSync
        exports.foo = 123
      `,
    },
  });
  itBundled("default/ExportWildcardFSNodeES6", {
    // GENERATED
    files: {
      "/entry.js": `export * from 'fs'`,
    },
    format: "esm",
  });
  itBundled("default/ExportWildcardFSNodeCommonJS", {
    // GENERATED
    files: {
      "/entry.js": `export * from 'fs'`,
    },
    format: "cjs",
  });
  itBundled("default/MinifiedBundleES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import {foo} from './a'
        console.log(foo())
      `,
      "/a.js": /* js */ `
        export function foo() {
          return 123
        }
        foo()
      `,
    },
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
  });
  itBundled("default/MinifiedBundleCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        const {foo} = require('./a')
        console.log(foo(), require('./j.json'))
      `,
      "/a.js": /* js */ `
        exports.foo = function() {
          return 123
        }
      `,
      "/j.json": `{"test": true}`,
    },
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
  });
  itBundled("default/MinifiedBundleEndingWithImportantSemicolon", {
    // GENERATED
    files: {
      "/entry.js": `while(foo()); // This semicolon must not be stripped`,
    },
    minifyWhitespace: true,
    format: "iife",
  });
  itBundled("default/RuntimeNameCollisionNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        function __require() { return 123 }
        console.log(__require())
      `,
    },
    mode: "transform",
  });
  itBundled("default/TopLevelReturnForbiddenImport", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        return
        import 'foo'
      `,
    },
    mode: "passthrough",
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Top-level return cannot be used inside an ECMAScript module
  entry.js: NOTE: This file is considered to be an ECMAScript module because of the "import" keyword here:
  `, */
  });
  itBundled("default/TopLevelReturnForbiddenExport", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        return
        export var foo
      `,
    },
    mode: "passthrough",
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Top-level return cannot be used inside an ECMAScript module
  entry.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  `, */
  });
  itBundled("default/TopLevelReturnForbiddenTLA", {
    // GENERATED
    files: {
      "/entry.js": `return await foo`,
    },
    mode: "passthrough",
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Top-level return cannot be used inside an ECMAScript module
  entry.js: NOTE: This file is considered to be an ECMAScript module because of the top-level "await" keyword here:
  `, */
  });
  itBundled("default/ThisOutsideFunction", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        if (shouldBeExportsNotThis) {
          console.log(this)
          console.log((x = this) => this)
          console.log({x: this})
          console.log(class extends this.foo {})
          console.log(class { [this.foo] })
          console.log(class { [this.foo]() {} })
          console.log(class { static [this.foo] })
          console.log(class { static [this.foo]() {} })
        }
        if (shouldBeThisNotExports) {
          console.log(class { foo = this })
          console.log(class { foo() { this } })
          console.log(class { static foo = this })
          console.log(class { static foo() { this } })
        }
      `,
    },
  });
  itBundled("default/ThisInsideFunction", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        function foo(x = this) { console.log(this) }
        const objFoo = {
          foo(x = this) { console.log(this) }
        }
        class Foo {
          x = this
          static y = this.z
          foo(x = this) { console.log(this) }
          static bar(x = this) { console.log(this) }
        }
        new Foo(foo(objFoo))
        if (nested) {
          function bar(x = this) { console.log(this) }
          const objBar = {
            foo(x = this) { console.log(this) }
          }
          class Bar {
            x = this
            static y = this.z
            foo(x = this) { console.log(this) }
            static bar(x = this) { console.log(this) }
          }
          new Bar(bar(objBar))
        }
      `,
    },
  });
  itBundled("default/ThisWithES6Syntax", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import './cjs'
  
        import './es6-import-stmt'
        import './es6-import-assign'
        import './es6-import-dynamic'
        import './es6-import-meta'
        import './es6-expr-import-dynamic'
        import './es6-expr-import-meta'
  
        import './es6-export-variable'
        import './es6-export-function'
        import './es6-export-async-function'
        import './es6-export-enum'
        import './es6-export-const-enum'
        import './es6-export-module'
        import './es6-export-namespace'
        import './es6-export-class'
        import './es6-export-abstract-class'
        import './es6-export-default'
        import './es6-export-clause'
        import './es6-export-clause-from'
        import './es6-export-star'
        import './es6-export-star-as'
        import './es6-export-assign'
        import './es6-export-import-assign'
  
        import './es6-ns-export-variable'
        import './es6-ns-export-function'
        import './es6-ns-export-async-function'
        import './es6-ns-export-enum'
        import './es6-ns-export-const-enum'
        import './es6-ns-export-module'
        import './es6-ns-export-namespace'
        import './es6-ns-export-class'
        import './es6-ns-export-abstract-class'
      `,
      "/dummy.js": `export const dummy = 123`,
      "/cjs.js": `console.log(this)`,
      "/es6-import-stmt.js": `import './dummy'; console.log(this)`,
      "/es6-import-assign.ts": `import x = require('./dummy'); console.log(this)`,
      "/es6-import-dynamic.js": `import('./dummy'); console.log(this)`,
      "/es6-import-meta.js": `import.meta; console.log(this)`,
      "/es6-expr-import-dynamic.js": `(import('./dummy')); console.log(this)`,
      "/es6-expr-import-meta.js": `(import.meta); console.log(this)`,
      "/es6-export-variable.js": `export const foo = 123; console.log(this)`,
      "/es6-export-function.js": `export function foo() {} console.log(this)`,
      "/es6-export-async-function.js": `export async function foo() {} console.log(this)`,
      "/es6-export-enum.ts": `export enum Foo {} console.log(this)`,
      "/es6-export-const-enum.ts": `export const enum Foo {} console.log(this)`,
      "/es6-export-module.ts": `export module Foo {} console.log(this)`,
      "/es6-export-namespace.ts": `export namespace Foo {} console.log(this)`,
      "/es6-export-class.js": `export class Foo {} console.log(this)`,
      "/es6-export-abstract-class.ts": `export abstract class Foo {} console.log(this)`,
      "/es6-export-default.js": `export default 123; console.log(this)`,
      "/es6-export-clause.js": `export {}; console.log(this)`,
      "/es6-export-clause-from.js": `export {} from './dummy'; console.log(this)`,
      "/es6-export-star.js": `export * from './dummy'; console.log(this)`,
      "/es6-export-star-as.js": `export * as ns from './dummy'; console.log(this)`,
      "/es6-export-assign.ts": `export = 123; console.log(this)`,
      "/es6-export-import-assign.ts": `export import x = require('./dummy'); console.log(this)`,
      "/es6-ns-export-variable.ts": `namespace ns { export const foo = 123; } console.log(this)`,
      "/es6-ns-export-function.ts": `namespace ns { export function foo() {} } console.log(this)`,
      "/es6-ns-export-async-function.ts": `namespace ns { export async function foo() {} } console.log(this)`,
      "/es6-ns-export-enum.ts": `namespace ns { export enum Foo {} } console.log(this)`,
      "/es6-ns-export-const-enum.ts": `namespace ns { export const enum Foo {} } console.log(this)`,
      "/es6-ns-export-module.ts": `namespace ns { export module Foo {} } console.log(this)`,
      "/es6-ns-export-namespace.ts": `namespace ns { export namespace Foo {} } console.log(this)`,
      "/es6-ns-export-class.ts": `namespace ns { export class Foo {} } console.log(this)`,
      "/es6-ns-export-abstract-class.ts": `namespace ns { export abstract class Foo {} } console.log(this)`,
    },
    /* TODO FIX expectedScanLog: `es6-export-abstract-class.ts: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-abstract-class.ts: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-async-function.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-async-function.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-class.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-class.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-clause-from.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-clause-from.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-clause.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-clause.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-const-enum.ts: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-const-enum.ts: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-default.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-default.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-enum.ts: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-enum.ts: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-function.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-function.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-import-assign.ts: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-import-assign.ts: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-module.ts: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-module.ts: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-namespace.ts: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-namespace.ts: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-star-as.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-star-as.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-star.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-star.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-export-variable.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-export-variable.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  es6-expr-import-meta.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-expr-import-meta.js: NOTE: This file is considered to be an ECMAScript module because of the use of "import.meta" here:
  es6-import-meta.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  es6-import-meta.js: NOTE: This file is considered to be an ECMAScript module because of the use of "import.meta" here:
  `, */
  });
  itBundled("default/ArrowFnScope", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        tests = {
          0: ((x = y => x + y, y) => x + y),
          1: ((y, x = y => x + y) => x + y),
          2: ((x = (y = z => x + y + z, z) => x + y + z, y, z) => x + y + z),
          3: ((y, z, x = (z, y = z => x + y + z) => x + y + z) => x + y + z),
          4: ((x = y => x + y, y), x + y),
          5: ((y, x = y => x + y), x + y),
          6: ((x = (y = z => x + y + z, z) => x + y + z, y, z), x + y + z),
          7: ((y, z, x = (z, y = z => x + y + z) => x + y + z), x + y + z),
        };
      `,
    },
    minifyIdentifiers: true,
  });
  itBundled("default/SwitchScopeNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        switch (foo) { default: var foo }
        switch (bar) { default: let bar }
      `,
    },
    minifyIdentifiers: true,
    mode: "transform",
  });
  itBundled("default/ArgumentDefaultValueScopeNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export function a(x = foo) { var foo; return x }
        export class b { fn(x = foo) { var foo; return x } }
        export let c = [
          function(x = foo) { var foo; return x },
          (x = foo) => { var foo; return x },
          { fn(x = foo) { var foo; return x }},
          class { fn(x = foo) { var foo; return x }},
        ]
      `,
    },
    minifyIdentifiers: true,
    mode: "transform",
  });
  itBundled("default/ArgumentsSpecialCaseNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        (() => {
          var arguments;
  
          function foo(x = arguments) { return arguments }
          (function(x = arguments) { return arguments });
          ({foo(x = arguments) { return arguments }});
          class Foo { foo(x = arguments) { return arguments } }
          (class { foo(x = arguments) { return arguments } });
  
          function foo(x = arguments) { var arguments; return arguments }
          (function(x = arguments) { var arguments; return arguments });
          ({foo(x = arguments) { var arguments; return arguments }});
  
          (x => arguments);
          (() => arguments);
          (async () => arguments);
          ((x = arguments) => arguments);
          (async (x = arguments) => arguments);
  
          x => arguments;
          () => arguments;
          async () => arguments;
          (x = arguments) => arguments;
          async (x = arguments) => arguments;
  
          (x => { return arguments });
          (() => { return arguments });
          (async () => { return arguments });
          ((x = arguments) => { return arguments });
          (async (x = arguments) => { return arguments });
  
          x => { return arguments };
          () => { return arguments };
          async () => { return arguments };
          (x = arguments) => { return arguments };
          async (x = arguments) => { return arguments };
        })()
      `,
    },
    minifyIdentifiers: true,
    mode: "transform",
  });
  itBundled("default/WithStatementTaintingNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        (() => {
          let local = 1
          let outer = 2
          let outerDead = 3
          with ({}) {
            var hoisted = 4
            let local = 5
            hoisted++
            local++
            if (1) outer++
            if (0) outerDead++
          }
          if (1) {
            hoisted++
            local++
            outer++
            outerDead++
          }
        })()
      `,
    },
    minifyIdentifiers: true,
    mode: "transform",
  });
  itBundled("default/DirectEvalTaintingNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        function test1() {
          function add(first, second) {
            return first + second
          }
          eval('add(1, 2)')
        }
  
        function test2() {
          function add(first, second) {
            return first + second
          }
          (0, eval)('add(1, 2)')
        }
  
        function test3() {
          function add(first, second) {
            return first + second
          }
        }
  
        function test4(eval) {
          function add(first, second) {
            return first + second
          }
          eval('add(1, 2)')
        }
  
        function test5() {
          function containsDirectEval() { eval() }
          if (true) { var shouldNotBeRenamed }
        }
      `,
    },
    minifyIdentifiers: true,
    mode: "transform",
  });
  itBundled("default/ImportReExportES6Issue149", {
    // GENERATED
    files: {
      "/app.jsx": /* jsx */ `
        import { p as Part, h, render } from './import';
        import { Internal } from './in2';
        const App = () => <Part> <Internal /> T </Part>;
        render(<App />, document.getElementById('app'));
      `,
      "/in2.jsx": /* jsx */ `
        import { p as Part, h } from './import';
        export const Internal = () => <Part> Test 2 </Part>;
      `,
      "/import.js": /* js */ `
        import { h, render } from 'preact';
        export const p = "p";
        export { h, render }
      `,
    },
    jsx: {
      factory: "h",
    },
  });
  itBundled("default/ExternalModuleExclusionPackage", {
    // GENERATED
    files: {
      "/index.js": /* js */ `
        import { S3 } from 'aws-sdk';
        import { DocumentClient } from 'aws-sdk/clients/dynamodb';
        export const s3 = new S3();
        export const dynamodb = new DocumentClient();
      `,
    },
  });
  itBundled("default/ExternalModuleExclusionScopedPackage", {
    // GENERATED
    files: {
      "/index.js": /* js */ `
        import '@a1'
        import '@a1/a2'
        import '@a1-a2'
  
        import '@b1'
        import '@b1/b2'
        import '@b1/b2/b3'
        import '@b1/b2-b3'
  
        import '@c1'
        import '@c1/c2'
        import '@c1/c2/c3'
        import '@c1/c2/c3/c4'
        import '@c1/c2/c3-c4'
      `,
    },
    /* TODO FIX expectedScanLog: `index.js: ERROR: Could not resolve "@a1-a2"
  NOTE: You can mark the path "@a1-a2" as external to exclude it from the bundle, which will remove this error.
  index.js: ERROR: Could not resolve "@b1"
  NOTE: You can mark the path "@b1" as external to exclude it from the bundle, which will remove this error.
  index.js: ERROR: Could not resolve "@b1/b2-b3"
  NOTE: You can mark the path "@b1/b2-b3" as external to exclude it from the bundle, which will remove this error.
  index.js: ERROR: Could not resolve "@c1"
  NOTE: You can mark the path "@c1" as external to exclude it from the bundle, which will remove this error.
  index.js: ERROR: Could not resolve "@c1/c2"
  NOTE: You can mark the path "@c1/c2" as external to exclude it from the bundle, which will remove this error.
  index.js: ERROR: Could not resolve "@c1/c2/c3-c4"
  NOTE: You can mark the path "@c1/c2/c3-c4" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
  itBundled("default/ScopedExternalModuleExclusion", {
    // GENERATED
    files: {
      "/index.js": /* js */ `
        import { Foo } from '@scope/foo';
        import { Bar } from '@scope/foo/bar';
        export const foo = new Foo();
        export const bar = new Bar();
      `,
    },
  });
  itBundled("default/ExternalModuleExclusionRelativePath", {
    // GENERATED
    files: {
      "/Users/user/project/src/index.js": `import './nested/folder/test'`,
      "/Users/user/project/src/nested/folder/test.js": /* js */ `
        import foo from './foo.js'
        import out from '../../../out/in-out-dir.js'
        import sha256 from '../../sha256.min.js'
        import config from '/api/config?a=1&b=2'
        console.log(foo, out, sha256, config)
      `,
    },
    outdir: "/Users/user/project/out",
  });
  itBundled("default/ImportWithHashInPath", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import foo from './file#foo.txt'
        import bar from './file#bar.txt'
        console.log(foo, bar)
      `,
      "/file#foo.txt": `foo`,
      "/file#bar.txt": `bar`,
    },
  });
  itBundled("default/ImportWithHashParameter", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        // Each of these should have a separate identity (i.e. end up in the output file twice)
        import foo from './file.txt#foo'
        import bar from './file.txt#bar'
        console.log(foo, bar)
      `,
      "/file.txt": `This is some text`,
    },
  });
  itBundled("default/ImportWithQueryParameter", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        // Each of these should have a separate identity (i.e. end up in the output file twice)
        import foo from './file.txt?foo'
        import bar from './file.txt?bar'
        console.log(foo, bar)
      `,
      "/file.txt": `This is some text`,
    },
  });
  itBundled("default/ImportAbsPathWithQueryParameter", {
    // GENERATED
    files: {
      "/Users/user/project/entry.js": /* js */ `
        // Each of these should have a separate identity (i.e. end up in the output file twice)
        import foo from '/Users/user/project/file.txt?foo'
        import bar from '/Users/user/project/file.txt#bar'
        console.log(foo, bar)
      `,
      "/Users/user/project/file.txt": `This is some text`,
    },
  });
  itBundled("default/ImportAbsPathAsFile", {
    // GENERATED
    files: {
      "/Users/user/project/entry.js": /* js */ `
        import pkg from '/Users/user/project/node_modules/pkg/index'
        console.log(pkg)
      `,
      "/Users/user/project/node_modules/pkg/index.js": `export default 123`,
    },
  });
  bundlerTest.skip("default/ImportAbsPathAsDir", () => {
    expectBundled("default/ImportAbsPathAsDirUnix", {
      // GENERATED
      host: "unix",
      files: {
        "/Users/user/project/entry.js": /* js */ `
          import pkg from '/Users/user/project/node_modules/pkg'
          console.log(pkg)
        `,
        "/Users/user/project/node_modules/pkg/index.js": `export default 123`,
      },
    });
    expectBundled("default/ImportAbsPathAsDirWindows", {
      // GENERATED
      host: "windows",
      files: {
        "/Users/user/project/entry.js": /* js */ `
          import pkg from 'C:\\Users\\user\\project\\node_modules\\pkg'
          console.log(pkg)
        `,
        "/Users/user/project/node_modules/pkg/index.js": `export default 123`,
      },
    });
  });
  itBundled("default/AutoExternal", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        // These URLs should be external automatically
        import "http://example.com/code.js";
        import "https://example.com/code.js";
        import "//example.com/code.js";
        import "data:application/javascript;base64,ZXhwb3J0IGRlZmF1bHQgMTIz";
      `,
    },
  });
  itBundled("default/AutoExternalNode", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        // These URLs should be external automatically
        import fs from "node:fs/promises";
        fs.readFile();
  
        // This should be external and should be tree-shaken because it's side-effect free
        import "node:path";
  
        // This should be external too, but shouldn't be tree-shaken because it could be a run-time error
        import "node:what-is-this";
      `,
    },
  });
  itBundled("default/ExternalWithWildcard", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        // Should match
        import "/assets/images/test.jpg";
        import "/dir/x/file.gif";
        import "/dir//file.gif";
        import "./file.png";
  
        // Should not match
        import "/sassets/images/test.jpg";
        import "/dir/file.gif";
        import "./file.ping";
      `,
    },
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Could not resolve "/sassets/images/test.jpg"
  entry.js: ERROR: Could not resolve "/dir/file.gif"
  entry.js: ERROR: Could not resolve "./file.ping"
  `, */
  });
  itBundled("default/ExternalWildcardDoesNotMatchEntryPoint", {
    // GENERATED
    files: {
      "/entry.js": `import "foo"`,
    },
  });
  itBundled("default/ManyEntryPoints", {
    // GENERATED
    files: {
      "/shared.js": `export default 123`,
      "/e00.js": `import x from './shared'; console.log(x)`,
      "/e01.js": `import x from './shared'; console.log(x)`,
      "/e02.js": `import x from './shared'; console.log(x)`,
      "/e03.js": `import x from './shared'; console.log(x)`,
      "/e04.js": `import x from './shared'; console.log(x)`,
      "/e05.js": `import x from './shared'; console.log(x)`,
      "/e06.js": `import x from './shared'; console.log(x)`,
      "/e07.js": `import x from './shared'; console.log(x)`,
      "/e08.js": `import x from './shared'; console.log(x)`,
      "/e09.js": `import x from './shared'; console.log(x)`,
      "/e10.js": `import x from './shared'; console.log(x)`,
      "/e11.js": `import x from './shared'; console.log(x)`,
      "/e12.js": `import x from './shared'; console.log(x)`,
      "/e13.js": `import x from './shared'; console.log(x)`,
      "/e14.js": `import x from './shared'; console.log(x)`,
      "/e15.js": `import x from './shared'; console.log(x)`,
      "/e16.js": `import x from './shared'; console.log(x)`,
      "/e17.js": `import x from './shared'; console.log(x)`,
      "/e18.js": `import x from './shared'; console.log(x)`,
      "/e19.js": `import x from './shared'; console.log(x)`,
      "/e20.js": `import x from './shared'; console.log(x)`,
      "/e21.js": `import x from './shared'; console.log(x)`,
      "/e22.js": `import x from './shared'; console.log(x)`,
      "/e23.js": `import x from './shared'; console.log(x)`,
      "/e24.js": `import x from './shared'; console.log(x)`,
      "/e25.js": `import x from './shared'; console.log(x)`,
      "/e26.js": `import x from './shared'; console.log(x)`,
      "/e27.js": `import x from './shared'; console.log(x)`,
      "/e28.js": `import x from './shared'; console.log(x)`,
      "/e29.js": `import x from './shared'; console.log(x)`,
      "/e30.js": `import x from './shared'; console.log(x)`,
      "/e31.js": `import x from './shared'; console.log(x)`,
      "/e32.js": `import x from './shared'; console.log(x)`,
      "/e33.js": `import x from './shared'; console.log(x)`,
      "/e34.js": `import x from './shared'; console.log(x)`,
      "/e35.js": `import x from './shared'; console.log(x)`,
      "/e36.js": `import x from './shared'; console.log(x)`,
      "/e37.js": `import x from './shared'; console.log(x)`,
      "/e38.js": `import x from './shared'; console.log(x)`,
      "/e39.js": `import x from './shared'; console.log(x)`,
    },
    entryPoints: [
      "/e00.js",
      "/e01.js",
      "/e02.js",
      "/e03.js",
      "/e04.js",
      "/e05.js",
      "/e06.js",
      "/e07.js",
      "/e08.js",
      "/e09.js",
      "/e10.js",
      "/e11.js",
      "/e12.js",
      "/e13.js",
      "/e14.js",
      "/e15.js",
      "/e16.js",
      "/e17.js",
      "/e18.js",
      "/e19.js",
      "/e20.js",
      "/e21.js",
      "/e22.js",
      "/e23.js",
      "/e24.js",
      "/e25.js",
      "/e26.js",
      "/e27.js",
      "/e28.js",
      "/e29.js",
      "/e30.js",
      "/e31.js",
      "/e32.js",
      "/e33.js",
      "/e34.js",
      "/e35.js",
      "/e36.js",
      "/e37.js",
      "/e38.js",
      "/e39.js",
    ],
  });
  itBundled("default/RenamePrivateIdentifiersNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #foo
          foo = class {
            #foo
            #foo2
            #bar
          }
          get #bar() {}
          set #bar(x) {}
        }
        class Bar {
          #foo
          foo = class {
            #foo2
            #foo
            #bar
          }
          get #bar() {}
          set #bar(x) {}
        }
      `,
    },
    mode: "transform",
  });
  itBundled("default/MinifyPrivateIdentifiersNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #foo
          foo = class {
            #foo
            #foo2
            #bar
          }
          get #bar() {}
          set #bar(x) {}
        }
        class Bar {
          #foo
          foo = class {
            #foo2
            #foo
            #bar
          }
          get #bar() {}
          set #bar(x) {}
        }
      `,
    },
    minifyIdentifiers: true,
    mode: "transform",
  });
  itBundled("default/RenameLabelsNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        foo: {
          bar: {
            if (x) break bar
            break foo
          }
        }
        foo2: {
          bar2: {
            if (x) break bar2
            break foo2
          }
        }
        foo: {
          bar: {
            if (x) break bar
            break foo
          }
        }
      `,
    },
    mode: "transform",
  });
  itBundled("default/MinifySiblingLabelsNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        foo: {
          bar: {
            if (x) break bar
            break foo
          }
        }
        foo2: {
          bar2: {
            if (x) break bar2
            break foo2
          }
        }
        foo: {
          bar: {
            if (x) break bar
            break foo
          }
        }
      `,
    },
    minifyIdentifiers: true,
    mode: "transform",
  });
  itBundled("default/MinifyNestedLabelsNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        L001:{L002:{L003:{L004:{L005:{L006:{L007:{L008:{L009:{L010:{L011:{L012:{L013:{L014:{L015:{L016:{nl('\n')
        L017:{L018:{L019:{L020:{L021:{L022:{L023:{L024:{L025:{L026:{L027:{L028:{L029:{L030:{L031:{L032:{nl('\n')
        L033:{L034:{L035:{L036:{L037:{L038:{L039:{L040:{L041:{L042:{L043:{L044:{L045:{L046:{L047:{L048:{nl('\n')
        L049:{L050:{L051:{L052:{L053:{L054:{L055:{L056:{L057:{L058:{L059:{L060:{L061:{L062:{L063:{L064:{nl('\n')
        L065:{L066:{L067:{L068:{L069:{L070:{L071:{L072:{L073:{L074:{L075:{L076:{L077:{L078:{L079:{L080:{nl('\n')
        L081:{L082:{L083:{L084:{L085:{L086:{L087:{L088:{L089:{L090:{L091:{L092:{L093:{L094:{L095:{L096:{nl('\n')
        L097:{L098:{L099:{L100:{L101:{L102:{L103:{L104:{L105:{L106:{L107:{L108:{L109:{L110:{L111:{L112:{nl('\n')
        L113:{L114:{L115:{L116:{L117:{L118:{L119:{L120:{L121:{L122:{L123:{L124:{L125:{L126:{L127:{L128:{nl('\n')
        L129:{L130:{L131:{L132:{L133:{L134:{L135:{L136:{L137:{L138:{L139:{L140:{L141:{L142:{L143:{L144:{nl('\n')
        L145:{L146:{L147:{L148:{L149:{L150:{L151:{L152:{L153:{L154:{L155:{L156:{L157:{L158:{L159:{L160:{nl('\n')
        L161:{L162:{L163:{L164:{L165:{L166:{L167:{L168:{L169:{L170:{L171:{L172:{L173:{L174:{L175:{L176:{nl('\n')
        L177:{L178:{L179:{L180:{L181:{L182:{L183:{L184:{L185:{L186:{L187:{L188:{L189:{L190:{L191:{L192:{nl('\n')
        L193:{L194:{L195:{L196:{L197:{L198:{L199:{L200:{L201:{L202:{L203:{L204:{L205:{L206:{L207:{L208:{nl('\n')
        L209:{L210:{L211:{L212:{L213:{L214:{L215:{L216:{L217:{L218:{L219:{L220:{L221:{L222:{L223:{L224:{nl('\n')
        L225:{L226:{L227:{L228:{L229:{L230:{L231:{L232:{L233:{L234:{L235:{L236:{L237:{L238:{L239:{L240:{nl('\n')
        L241:{L242:{L243:{L244:{L245:{L246:{L247:{L248:{L249:{L250:{L251:{L252:{L253:{L254:{L255:{L256:{nl('\n')
        L257:{L258:{L259:{L260:{L261:{L262:{L263:{L264:{L265:{L266:{L267:{L268:{L269:{L270:{L271:{L272:{nl('\n')
        L273:{L274:{L275:{L276:{L277:{L278:{L279:{L280:{L281:{L282:{L283:{L284:{L285:{L286:{L287:{L288:{nl('\n')
        L289:{L290:{L291:{L292:{L293:{L294:{L295:{L296:{L297:{L298:{L299:{L300:{L301:{L302:{L303:{L304:{nl('\n')
        L305:{L306:{L307:{L308:{L309:{L310:{L311:{L312:{L313:{L314:{L315:{L316:{L317:{L318:{L319:{L320:{nl('\n')
        L321:{L322:{L323:{L324:{L325:{L326:{L327:{L328:{L329:{L330:{L331:{L332:{L333:{}}}}}}}}}}}}}}}}}}nl('\n')
        }}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}nl('\n')
        }}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}nl('\n')
        }}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}nl('\n')
        }}}}}}}}}}}}}}}}}}}}}}}}}}}
      `,
    },
    minifyWhitespace: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    mode: "transform",
  });
  itBundled("default/ExportsAndModuleFormatCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as foo from './foo/test'
        import * as bar from './bar/test'
        console.log(exports, module.exports, foo, bar)
      `,
      "/foo/test.js": `export let foo = 123`,
      "/bar/test.js": `export let bar = 123`,
    },
    format: "cjs",
  });
  itBundled("default/MinifiedExportsAndModuleFormatCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as foo from './foo/test'
        import * as bar from './bar/test'
        console.log(exports, module.exports, foo, bar)
      `,
      "/foo/test.js": `export let foo = 123`,
      "/bar/test.js": `export let bar = 123`,
    },
    minifyIdentifiers: true,
    format: "cjs",
  });
  itBundled("default/EmptyExportClauseBundleAsCommonJSIssue910", {
    // GENERATED
    files: {
      "/entry.js": `console.log(require('./types.mjs'))`,
      "/types.mjs": `export {}`,
    },
    format: "cjs",
  });
  itBundled("default/UseStrictDirectiveMinifyNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        'use strict'
        'use loose'
        a
        b
      `,
    },
    minifySyntax: true,
    minifyWhitespace: true,
    mode: "transform",
  });
  itBundled("default/UseStrictDirectiveBundleIssue1837", {
    // GENERATED
    files: {
      "/entry.js": `console.log(require('./cjs'))`,
      "/cjs.js": /* js */ `
        'use strict'
        exports.foo = process
      `,
      "/shims.js": /* js */ `
        import process from 'process'
        export { process }
      `,
    },
    inject: ["/shims.js"],
    platform: "node",
  });
  itBundled("default/UseStrictDirectiveBundleIIFEIssue2264", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        'use strict'
        export let a = 1
      `,
    },
  });
  itBundled("default/UseStrictDirectiveBundleCJSIssue2264", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        'use strict'
        export let a = 1
      `,
    },
  });
  itBundled("default/UseStrictDirectiveBundleESMIssue2264", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        'use strict'
        export let a = 1
      `,
    },
  });
  itBundled("default/NoOverwriteInputFileError", {
    // GENERATED
    files: {
      "/entry.js": `console.log(123)`,
    },
    /* TODO FIX expectedCompileLog: `ERROR: Refusing to overwrite input file "entry.js" (use "AllowOverwrite: true" to allow this)
  `, */
  });
  itBundled("default/DuplicateEntryPoint", {
    // GENERATED
    files: {
      "/entry.js": `console.log(123)`,
    },
    entryPoints: ["/entry.js", "/entry.js"],
  });
  itBundled("default/RelativeEntryPointError", {
    // GENERATED
    files: {
      "/entry.js": `console.log(123)`,
    },
    entryPoints: ["entry"],
    /* TODO FIX expectedScanLog: `ERROR: Could not resolve "entry"
  NOTE: Use the relative path "./entry" to reference the file "entry.js". Without the leading "./", the path "entry" is being interpreted as a package path instead.
  `, */
  });
  itBundled("default/MultipleEntryPointsSameNameCollision", {
    // GENERATED
    files: {
      "/a/entry.js": `import {foo} from '../common.js'; console.log(foo)`,
      "/b/entry.js": `import {foo} from '../common.js'; console.log(foo)`,
      "/common.js": `export let foo = 123`,
    },
    entryPoints: ["/a/entry.js", "/b/entry.js"],
  });
  itBundled("default/ReExportCommonJSAsES6", {
    // GENERATED
    files: {
      "/entry.js": `export {bar} from './foo'`,
      "/foo.js": `exports.bar = 123`,
    },
  });
  itBundled("default/ReExportDefaultInternal", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export {default as foo} from './foo'
        export {default as bar} from './bar'
      `,
      "/foo.js": `export default 'foo'`,
      "/bar.js": `export default 'bar'`,
    },
  });
  itBundled("default/ReExportDefaultExternalES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export {default as foo} from 'foo'
        export {bar} from './bar'
      `,
      "/bar.js": `export {default as bar} from 'bar'`,
    },
    format: "esm",
  });
  itBundled("default/ReExportDefaultExternalCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export {default as foo} from 'foo'
        export {bar} from './bar'
      `,
      "/bar.js": `export {default as bar} from 'bar'`,
    },
    format: "cjs",
  });
  itBundled("default/ReExportDefaultNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export {default as foo} from './foo'
        export {default as bar} from './bar'
      `,
    },
    mode: "transform",
  });
  itBundled("default/ReExportDefaultNoBundleES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export {default as foo} from './foo'
        export {default as bar} from './bar'
      `,
    },
    format: "esm",
    mode: "convertformat",
  });
  itBundled("default/ReExportDefaultNoBundleCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export {default as foo} from './foo'
        export {default as bar} from './bar'
      `,
    },
    format: "cjs",
    mode: "convertformat",
  });
  itBundled("default/ImportMetaCommonJS", {
    // GENERATED
    files: {
      "/entry.js": `console.log(import.meta.url, import.meta.path)`,
    },
    format: "cjs",
    /* TODO FIX expectedScanLog: `entry.js: WARNING: "import.meta" is not available with the "cjs" output format and will be empty
  NOTE: You need to set the output format to "esm" for "import.meta" to work correctly.
  entry.js: WARNING: "import.meta" is not available with the "cjs" output format and will be empty
  NOTE: You need to set the output format to "esm" for "import.meta" to work correctly.
  `, */
  });
  itBundled("default/ImportMetaES6", {
    // GENERATED
    files: {
      "/entry.js": `console.log(import.meta.url, import.meta.path)`,
    },
    format: "esm",
  });
  itBundled("default/ImportMetaNoBundle", {
    // GENERATED
    files: {
      "/entry.js": `console.log(import.meta.url, import.meta.path)`,
    },
    mode: "transform",
  });
  itBundled("default/LegalCommentsNone", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import './a'
        import './b'
        import './c'
      `,
      "/a.js": `console.log('in a') //! Copyright notice 1`,
      "/b.js": `console.log('in b') //! Copyright notice 1`,
      "/c.js": `console.log('in c') //! Copyright notice 2`,
      "/entry.css": /* css */ `
        @import "./a.css";
        @import "./b.css";
        @import "./c.css";
      `,
      "/a.css": `a { zoom: 2 } /*! Copyright notice 1 */`,
      "/b.css": `b { zoom: 2 } /*! Copyright notice 1 */`,
      "/c.css": `c { zoom: 2 } /*! Copyright notice 2 */`,
    },
    entryPoints: ["/entry.js", "/entry.css"],
  });
  itBundled("default/LegalCommentsInline", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import './a'
        import './b'
        import './c'
      `,
      "/a.js": `console.log('in a') //! Copyright notice 1`,
      "/b.js": `console.log('in b') //! Copyright notice 1`,
      "/c.js": `console.log('in c') //! Copyright notice 2`,
      "/entry.css": /* css */ `
        @import "./a.css";
        @import "./b.css";
        @import "./c.css";
      `,
      "/a.css": `a { zoom: 2 } /*! Copyright notice 1 */`,
      "/b.css": `b { zoom: 2 } /*! Copyright notice 1 */`,
      "/c.css": `c { zoom: 2 } /*! Copyright notice 2 */`,
    },
    entryPoints: ["/entry.js", "/entry.css"],
  });
  itBundled("default/LegalCommentsEndOfFile", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import './a'
        import './b'
        import './c'
      `,
      "/a.js": `console.log('in a') //! Copyright notice 1`,
      "/b.js": `console.log('in b') //! Copyright notice 1`,
      "/c.js": `console.log('in c') //! Copyright notice 2`,
      "/entry.css": /* css */ `
        @import "./a.css";
        @import "./b.css";
        @import "./c.css";
      `,
      "/a.css": `a { zoom: 2 } /*! Copyright notice 1 */`,
      "/b.css": `b { zoom: 2 } /*! Copyright notice 1 */`,
      "/c.css": `c { zoom: 2 } /*! Copyright notice 2 */`,
    },
    entryPoints: ["/entry.js", "/entry.css"],
  });
  itBundled("default/LegalCommentsLinked", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import './a'
        import './b'
        import './c'
      `,
      "/a.js": `console.log('in a') //! Copyright notice 1`,
      "/b.js": `console.log('in b') //! Copyright notice 1`,
      "/c.js": `console.log('in c') //! Copyright notice 2`,
      "/entry.css": /* css */ `
        @import "./a.css";
        @import "./b.css";
        @import "./c.css";
      `,
      "/a.css": `a { zoom: 2 } /*! Copyright notice 1 */`,
      "/b.css": `b { zoom: 2 } /*! Copyright notice 1 */`,
      "/c.css": `c { zoom: 2 } /*! Copyright notice 2 */`,
    },
    entryPoints: ["/entry.js", "/entry.css"],
  });
  itBundled("default/LegalCommentsExternal", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import './a'
        import './b'
        import './c'
      `,
      "/a.js": `console.log('in a') //! Copyright notice 1`,
      "/b.js": `console.log('in b') //! Copyright notice 1`,
      "/c.js": `console.log('in c') //! Copyright notice 2`,
      "/entry.css": /* css */ `
        @import "./a.css";
        @import "./b.css";
        @import "./c.css";
      `,
      "/a.css": `a { zoom: 2 } /*! Copyright notice 1 */`,
      "/b.css": `b { zoom: 2 } /*! Copyright notice 1 */`,
      "/c.css": `c { zoom: 2 } /*! Copyright notice 2 */`,
    },
    entryPoints: ["/entry.js", "/entry.css"],
  });
  itBundled("default/LegalCommentsModifyIndent", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export default () => {
          /**
           * @preserve
           */
        }
      `,
      "/entry.css": /* css */ `
        @media (x: y) {
          /**
           * @preserve
           */
          z { zoom: 2 }
        }
      `,
    },
    entryPoints: ["/entry.js", "/entry.css"],
  });
  itBundled("default/LegalCommentsAvoidSlashTagInline", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        //! <script>foo</script>
        export let x
      `,
      "/entry.css": /* css */ `
        /*! <style>foo</style> */
        x { y: z }
      `,
    },
    entryPoints: ["/entry.js", "/entry.css"],
  });
  itBundled("default/LegalCommentsAvoidSlashTagEndOfFile", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        //! <script>foo</script>
        export let x
      `,
      "/entry.css": /* css */ `
        /*! <style>foo</style> */
        x { y: z }
      `,
    },
    entryPoints: ["/entry.js", "/entry.css"],
  });
  itBundled("default/LegalCommentsAvoidSlashTagExternal", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        //! <script>foo</script>
        export let x
      `,
      "/entry.css": /* css */ `
        /*! <style>foo</style> */
        x { y: z }
      `,
    },
    entryPoints: ["/entry.js", "/entry.css"],
  });
  itBundled("default/LegalCommentsManyEndOfFile", {
    // GENERATED
    files: {
      "/project/entry.js": /* js */ `
        import './a'
        import './b'
        import './c'
        import 'some-pkg/js'
      `,
      "/project/a.js": /* js */ `
        console.log('in a') //! Copyright notice 1
        //! Duplicate comment
        //! Duplicate comment
      `,
      "/project/b.js": /* js */ `
        console.log('in b') //! Copyright notice 1
        //! Duplicate comment
        //! Duplicate comment
      `,
      "/project/c.js": /* js */ `
        function foo() {
          /*
           * @license
           * Copyright notice 2
           */
          console.log('in c')
          // @preserve This is another comment
        }
        foo()
      `,
      "/project/node_modules/some-pkg/js/index.js": /* js */ `
        import "some-other-pkg/js" //! (c) Good Software Corp
        //! Duplicate third-party comment
        //! Duplicate third-party comment
      `,
      "/project/node_modules/some-other-pkg/js/index.js": /* js */ `
        function bar() {
          /*
           * @preserve
           * (c) Evil Software Corp
           */
          console.log('some-other-pkg')
        }
        //! Duplicate third-party comment
        //! Duplicate third-party comment
        bar()
      `,
      "/project/entry.css": /* css */ `
        @import "./a.css";
        @import "./b.css";
        @import "./c.css";
        @import 'some-pkg/css';
      `,
      "/project/a.css": /* css */ `
        a { zoom: 2 } /*! Copyright notice 1 */
        /*! Duplicate comment */
        /*! Duplicate comment */
      `,
      "/project/b.css": /* css */ `
        b { zoom: 2 } /*! Copyright notice 1 */
        /*! Duplicate comment */
        /*! Duplicate comment */
      `,
      "/project/c.css": /* css */ `
        /*
         * @license
         * Copyright notice 2
         */
        c {
          zoom: 2
        }
        /* @preserve This is another comment */
      `,
      "/project/node_modules/some-pkg/css/index.css": /* css */ `
        @import "some-other-pkg/css"; /*! (c) Good Software Corp */
        /*! Duplicate third-party comment */
        /*! Duplicate third-party comment */
      `,
      "/project/node_modules/some-other-pkg/css/index.css": /* css */ `
        /*! Duplicate third-party comment */
        /*! Duplicate third-party comment */
        .some-other-pkg {
          zoom: 2
        }
        /** @preserve
         * (c) Evil Software Corp
         */
      `,
    },
    entryPoints: ["/project/entry.js", "/project/entry.css"],
    minifyWhitespace: true,
  });
  itBundled("default/LegalCommentsEscapeSlashScriptAndStyleEndOfFile", {
    // GENERATED
    files: {
      "/project/entry.js": `import "js-pkg"; a /*! </script> */`,
      "/project/node_modules/js-pkg/index.js": `x /*! </script> */`,
      "/project/entry.css": `@import "css-pkg"; a { b: c } /*! </style> */`,
      "/project/node_modules/css-pkg/index.css": `x { y: z } /*! </style> */`,
    },
    entryPoints: ["/project/entry.js", "/project/entry.css"],
    minifyWhitespace: true,
  });
  itBundled("default/LegalCommentsEscapeSlashScriptAndStyleExternal", {
    // GENERATED
    files: {
      "/project/entry.js": `import "js-pkg"; a /*! </script> */`,
      "/project/node_modules/js-pkg/index.js": `x /*! </script> */`,
      "/project/entry.css": `@import "css-pkg"; a { b: c } /*! </style> */`,
      "/project/node_modules/css-pkg/index.css": `x { y: z } /*! </style> */`,
    },
    entryPoints: ["/project/entry.js", "/project/entry.css"],
    minifyWhitespace: true,
  });
  itBundled("default/LegalCommentsNoEscapeSlashScriptEndOfFile", {
    // GENERATED
    files: {
      "/project/entry.js": `import "js-pkg"; a /*! </script> */`,
      "/project/node_modules/js-pkg/index.js": `x /*! </script> */`,
      "/project/entry.css": `@import "css-pkg"; a { b: c } /*! </style> */`,
      "/project/node_modules/css-pkg/index.css": `x { y: z } /*! </style> */`,
    },
    entryPoints: ["/project/entry.js", "/project/entry.css"],
    minifyWhitespace: true,
    legalComments: "eof",
  });
  itBundled("default/LegalCommentsNoEscapeSlashStyleEndOfFile", {
    // GENERATED
    files: {
      "/project/entry.js": `import "js-pkg"; a /*! </script> */`,
      "/project/node_modules/js-pkg/index.js": `x /*! </script> */`,
      "/project/entry.css": `@import "css-pkg"; a { b: c } /*! </style> */`,
      "/project/node_modules/css-pkg/index.css": `x { y: z } /*! </style> */`,
    },
    entryPoints: ["/project/entry.js", "/project/entry.css"],
    minifyWhitespace: true,
    legalComments: "eof",
  });
  itBundled("default/LegalCommentsManyLinked", {
    // GENERATED
    files: {
      "/project/entry.js": /* js */ `
        import './a'
        import './b'
        import './c'
        import 'some-pkg/js'
      `,
      "/project/a.js": `console.log('in a') //! Copyright notice 1`,
      "/project/b.js": `console.log('in b') //! Copyright notice 1`,
      "/project/c.js": /* js */ `
        function foo() {
          /*
           * @license
           * Copyright notice 2
           */
          console.log('in c')
          // @preserve This is another comment
        }
        foo()
      `,
      "/project/node_modules/some-pkg/js/index.js": `import "some-other-pkg/js" //! (c) Good Software Corp`,
      "/project/node_modules/some-other-pkg/js/index.js": /* js */ `
        function bar() {
          /*
           * @preserve
           * (c) Evil Software Corp
           */
          console.log('some-other-pkg')
        }
        bar()
      `,
      "/project/entry.css": /* css */ `
        @import "./a.css";
        @import "./b.css";
        @import "./c.css";
        @import 'some-pkg/css';
      `,
      "/project/a.css": `a { zoom: 2 } /*! Copyright notice 1 */`,
      "/project/b.css": `b { zoom: 2 } /*! Copyright notice 1 */`,
      "/project/c.css": /* css */ `
        /*
         * @license
         * Copyright notice 2
         */
        c {
          zoom: 2
        }
        /* @preserve This is another comment */
      `,
      "/project/node_modules/some-pkg/css/index.css": `@import "some-other-pkg/css"; /*! (c) Good Software Corp */`,
      "/project/node_modules/some-other-pkg/css/index.css": /* css */ `
        .some-other-pkg {
          zoom: 2
        }
        /** @preserve
         * (c) Evil Software Corp
         */
      `,
    },
    entryPoints: ["/project/entry.js", "/project/entry.css"],
    minifyWhitespace: true,
  });
  itBundled("default/IIFE_ES5", {
    // GENERATED
    files: {
      "/entry.js": `console.log('test');`,
    },
    unsupportedJSFeatures: "es5",
    format: "iife",
  });
  itBundled("default/OutputExtensionRemappingFile", {
    // GENERATED
    files: {
      "/entry.js": `console.log('test');`,
    },
    customOutputExtension: ".notjs",
  });
  itBundled("default/OutputExtensionRemappingDir", {
    // GENERATED
    files: {
      "/entry.js": `console.log('test');`,
    },
    customOutputExtension: ".notjs",
  });
  itBundled("default/TopLevelAwaitIIFE", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        await foo;
        for await (foo of bar) ;
      `,
    },
    format: "iife",
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Top-level await is currently not supported with the "iife" output format
  entry.js: ERROR: Top-level await is currently not supported with the "iife" output format
  `, */
  });
  itBundled("default/TopLevelAwaitIIFEDeadBranch", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        if (false) await foo;
        if (false) for await (foo of bar) ;
      `,
    },
    format: "iife",
  });
  itBundled("default/TopLevelAwaitCJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        await foo;
        for await (foo of bar) ;
      `,
    },
    format: "cjs",
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Top-level await is currently not supported with the "cjs" output format
  entry.js: ERROR: Top-level await is currently not supported with the "cjs" output format
  `, */
  });
  itBundled("default/TopLevelAwaitCJSDeadBranch", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        if (false) await foo;
        if (false) for await (foo of bar) ;
      `,
    },
    format: "cjs",
  });
  itBundled("default/TopLevelAwaitESM", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        await foo;
        for await (foo of bar) ;
      `,
    },
    format: "esm",
  });
  itBundled("default/TopLevelAwaitESMDeadBranch", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        if (false) await foo;
        if (false) for await (foo of bar) ;
      `,
    },
    format: "esm",
  });
  itBundled("default/TopLevelAwaitNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        await foo;
        for await (foo of bar) ;
      `,
    },
    mode: "transform",
  });
  itBundled("default/TopLevelAwaitNoBundleDeadBranch", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        if (false) await foo;
        if (false) for await (foo of bar) ;
      `,
    },
    mode: "transform",
  });
  itBundled("default/TopLevelAwaitNoBundleESM", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        await foo;
        for await (foo of bar) ;
      `,
    },
    format: "esm",
    mode: "convertformat",
  });
  itBundled("default/TopLevelAwaitNoBundleESMDeadBranch", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        if (false) await foo;
        if (false) for await (foo of bar) ;
      `,
    },
    format: "esm",
    mode: "convertformat",
  });
  itBundled("default/TopLevelAwaitNoBundleCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        await foo;
        for await (foo of bar) ;
      `,
    },
    format: "cjs",
    mode: "convertformat",
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Top-level await is currently not supported with the "cjs" output format
  entry.js: ERROR: Top-level await is currently not supported with the "cjs" output format
  `, */
  });
  itBundled("default/TopLevelAwaitNoBundleCommonJSDeadBranch", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        if (false) await foo;
        if (false) for await (foo of bar) ;
      `,
    },
    format: "cjs",
    mode: "convertformat",
  });
  itBundled("default/TopLevelAwaitNoBundleIIFE", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        await foo;
        for await (foo of bar) ;
      `,
    },
    format: "iife",
    mode: "convertformat",
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Top-level await is currently not supported with the "iife" output format
  entry.js: ERROR: Top-level await is currently not supported with the "iife" output format
  `, */
  });
  itBundled("default/TopLevelAwaitNoBundleIIFEDeadBranch", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        if (false) await foo;
        if (false) for await (foo of bar) ;
      `,
    },
    format: "iife",
    mode: "convertformat",
  });
  itBundled("default/TopLevelAwaitForbiddenRequire", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        require('./a')
        require('./b')
        require('./c')
        require('./entry')
        await 0
      `,
      "/a.js": `import './b'`,
      "/b.js": `import './c'`,
      "/c.js": `await 0`,
    },
    format: "esm",
    /* TODO FIX expectedScanLog: `entry.js: ERROR: This require call is not allowed because the transitive dependency "c.js" contains a top-level await
  a.js: NOTE: The file "a.js" imports the file "b.js" here:
  b.js: NOTE: The file "b.js" imports the file "c.js" here:
  c.js: NOTE: The top-level await in "c.js" is here:
  entry.js: ERROR: This require call is not allowed because the transitive dependency "c.js" contains a top-level await
  b.js: NOTE: The file "b.js" imports the file "c.js" here:
  c.js: NOTE: The top-level await in "c.js" is here:
  entry.js: ERROR: This require call is not allowed because the imported file "c.js" contains a top-level await
  c.js: NOTE: The top-level await in "c.js" is here:
  entry.js: ERROR: This require call is not allowed because the imported file "entry.js" contains a top-level await
  entry.js: NOTE: The top-level await in "entry.js" is here:
  `, */
  });
  itBundled("default/TopLevelAwaitForbiddenRequireDeadBranch", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        require('./a')
        require('./b')
        require('./c')
        require('./entry')
        if (false) for await (let x of y) await 0
      `,
      "/a.js": `import './b'`,
      "/b.js": `import './c'`,
      "/c.js": `if (false) for await (let x of y) await 0`,
    },
    format: "iife",
  });
  itBundled("default/TopLevelAwaitAllowedImportWithoutSplitting", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import('./a')
        import('./b')
        import('./c')
        import('./entry')
        await 0
      `,
      "/a.js": `import './b'`,
      "/b.js": `import './c'`,
      "/c.js": `await 0`,
    },
    format: "esm",
  });
  itBundled("default/TopLevelAwaitAllowedImportWithSplitting", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import('./a')
        import('./b')
        import('./c')
        import('./entry')
        await 0
      `,
      "/a.js": `import './b'`,
      "/b.js": `import './c'`,
      "/c.js": `await 0`,
    },
    format: "esm",
    splitting: true,
  });
  itBundled("default/AssignToImport", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import "./bad0.js"
        import "./bad1.js"
        import "./bad2.js"
        import "./bad3.js"
        import "./bad4.js"
        import "./bad5.js"
        import "./bad6.js"
        import "./bad7.js"
        import "./bad8.js"
        import "./bad9.js"
        import "./bad10.js"
        import "./bad11.js"
        import "./bad12.js"
        import "./bad13.js"
        import "./bad14.js"
        import "./bad15.js"
  
        import "./good0.js"
        import "./good1.js"
        import "./good2.js"
        import "./good3.js"
        import "./good4.js"
      `,
      "/node_modules/foo/index.js": ``,
      "/bad0.js": `import x from "foo"; x = 1`,
      "/bad1.js": `import x from "foo"; x++`,
      "/bad2.js": `import x from "foo"; ([x] = 1)`,
      "/bad3.js": `import x from "foo"; ({x} = 1)`,
      "/bad4.js": `import x from "foo"; ({y: x} = 1)`,
      "/bad5.js": `import {x} from "foo"; x++`,
      "/bad6.js": `import * as x from "foo"; x++`,
      "/bad7.js": `import * as x from "foo"; x.y = 1`,
      "/bad8.js": `import * as x from "foo"; x[y] = 1`,
      "/bad9.js": `import * as x from "foo"; x['y'] = 1`,
      "/bad10.js": `import * as x from "foo"; x['y z'] = 1`,
      "/bad11.js": `import x from "foo"; delete x`,
      "/bad12.js": `import {x} from "foo"; delete x`,
      "/bad13.js": `import * as x from "foo"; delete x.y`,
      "/bad14.js": `import * as x from "foo"; delete x['y']`,
      "/bad15.js": `import * as x from "foo"; delete x[y]`,
      "/good0.js": `import x from "foo"; ({y = x} = 1)`,
      "/good1.js": `import x from "foo"; ({[x]: y} = 1)`,
      "/good2.js": `import x from "foo"; x.y = 1`,
      "/good3.js": `import x from "foo"; x[y] = 1`,
      "/good4.js": `import x from "foo"; x['y'] = 1`,
      "/good5.js": `import x from "foo"; x['y z'] = 1`,
    },
    /* TODO FIX expectedScanLog: `bad0.js: ERROR: Cannot assign to import "x"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  bad1.js: ERROR: Cannot assign to import "x"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  bad10.js: ERROR: Cannot assign to import "y z"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file and then import and call that function here instead.
  bad11.js: ERROR: Delete of a bare identifier cannot be used in an ECMAScript module
  bad11.js: NOTE: This file is considered to be an ECMAScript module because of the "import" keyword here:
  bad12.js: ERROR: Delete of a bare identifier cannot be used in an ECMAScript module
  bad12.js: NOTE: This file is considered to be an ECMAScript module because of the "import" keyword here:
  bad13.js: ERROR: Cannot assign to import "y"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setY") and then import and call that function here instead.
  bad14.js: ERROR: Cannot assign to import "y"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setY") and then import and call that function here instead.
  bad15.js: ERROR: Cannot assign to property on import "x"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file and then import and call that function here instead.
  bad2.js: ERROR: Cannot assign to import "x"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  bad3.js: ERROR: Cannot assign to import "x"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  bad4.js: ERROR: Cannot assign to import "x"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  bad5.js: ERROR: Cannot assign to import "x"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  bad6.js: ERROR: Cannot assign to import "x"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  bad7.js: ERROR: Cannot assign to import "y"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setY") and then import and call that function here instead.
  bad8.js: ERROR: Cannot assign to property on import "x"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file and then import and call that function here instead.
  bad9.js: ERROR: Cannot assign to import "y"
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setY") and then import and call that function here instead.
  `, */
  });
  itBundled("default/AssignToImportNoBundle", {
    // GENERATED
    files: {
      "/bad0.js": `import x from "foo"; x = 1`,
      "/bad1.js": `import x from "foo"; x++`,
      "/bad2.js": `import x from "foo"; ([x] = 1)`,
      "/bad3.js": `import x from "foo"; ({x} = 1)`,
      "/bad4.js": `import x from "foo"; ({y: x} = 1)`,
      "/bad5.js": `import {x} from "foo"; x++`,
      "/bad6.js": `import * as x from "foo"; x++`,
      "/uncaught7.js": `import * as x from "foo"; x.y = 1`,
      "/uncaught8.js": `import * as x from "foo"; x[y] = 1`,
      "/uncaught9.js": `import * as x from "foo"; x['y'] = 1`,
      "/uncaught10.js": `import * as x from "foo"; x['y z'] = 1`,
      "/bad11.js": `import x from "foo"; delete x`,
      "/bad12.js": `import {x} from "foo"; delete x`,
      "/uncaught13.js": `import * as x from "foo"; delete x.y`,
      "/uncaught14.js": `import * as x from "foo"; delete x['y']`,
      "/uncaught15.js": `import * as x from "foo"; delete x[y]`,
      "/good0.js": `import x from "foo"; ({y = x} = 1)`,
      "/good1.js": `import x from "foo"; ({[x]: y} = 1)`,
      "/good2.js": `import x from "foo"; x.y = 1`,
      "/good3.js": `import x from "foo"; x[y] = 1`,
      "/good4.js": `import x from "foo"; x['y'] = 1`,
      "/good5.js": `import x from "foo"; x['y z'] = 1`,
    },
    entryPoints: [
      "/bad0.js",
      "/bad1.js",
      "/bad2.js",
      "/bad3.js",
      "/bad4.js",
      "/bad5.js",
      "/bad6.js",
      "/uncaught7.js",
      "/uncaught8.js",
      "/uncaught9.js",
      "/uncaught10.js",
      "/bad11.js",
      "/bad12.js",
      "/uncaught13.js",
      "/uncaught14.js",
      "/uncaught15.js",
      "/good0.js",
      "/good1.js",
      "/good2.js",
      "/good3.js",
      "/good4.js",
      "/good5.js",
    ],
    mode: "passthrough",
    /* TODO FIX expectedScanLog: `bad0.js: WARNING: This assignment will throw because "x" is an import
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  bad1.js: WARNING: This assignment will throw because "x" is an import
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  bad11.js: ERROR: Delete of a bare identifier cannot be used in an ECMAScript module
  bad11.js: NOTE: This file is considered to be an ECMAScript module because of the "import" keyword here:
  bad12.js: ERROR: Delete of a bare identifier cannot be used in an ECMAScript module
  bad12.js: NOTE: This file is considered to be an ECMAScript module because of the "import" keyword here:
  bad2.js: WARNING: This assignment will throw because "x" is an import
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  bad3.js: WARNING: This assignment will throw because "x" is an import
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  bad4.js: WARNING: This assignment will throw because "x" is an import
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  bad5.js: WARNING: This assignment will throw because "x" is an import
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  bad6.js: WARNING: This assignment will throw because "x" is an import
  NOTE: Imports are immutable in JavaScript. To modify the value of this import, you must export a setter function in the imported file (e.g. "setX") and then import and call that function here instead.
  `, */
  });
  itBundled("default/MinifyArguments", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        function a(x = arguments) {
          let arguments
        }
        function b(x = arguments) {
          let arguments
        }
        function c(x = arguments) {
          let arguments
        }
        a()
        b()
        c()
      `,
    },
    minifyIdentifiers: true,
  });
  itBundled("default/WarningsInsideNodeModules", {
    // GENERATED
    host: "unix",
    files: {
      "/entry.js": /* js */ `
        import "./dup-case.js";        import "./node_modules/dup-case.js";        import "@plugin/dup-case.js"
        import "./not-in.js";          import "./node_modules/not-in.js";          import "@plugin/not-in.js"
        import "./not-instanceof.js";  import "./node_modules/not-instanceof.js";  import "@plugin/not-instanceof.js"
        import "./return-asi.js";      import "./node_modules/return-asi.js";      import "@plugin/return-asi.js"
        import "./bad-typeof.js";      import "./node_modules/bad-typeof.js";      import "@plugin/bad-typeof.js"
        import "./equals-neg-zero.js"; import "./node_modules/equals-neg-zero.js"; import "@plugin/equals-neg-zero.js"
        import "./equals-nan.js";      import "./node_modules/equals-nan.js";      import "@plugin/equals-nan.js"
        import "./equals-object.js";   import "./node_modules/equals-object.js";   import "@plugin/equals-object.js"
        import "./write-getter.js";    import "./node_modules/write-getter.js";    import "@plugin/write-getter.js"
        import "./read-setter.js";     import "./node_modules/read-setter.js";     import "@plugin/read-setter.js"
        import "./delete-super.js";    import "./node_modules/delete-super.js";    import "@plugin/delete-super.js"
      `,
      "/dup-case.js": `switch (x) { case 0: case 0: }`,
      "/node_modules/dup-case.js": `switch (x) { case 0: case 0: }`,
      "/plugin-dir/node_modules/dup-case.js": `switch (x) { case 0: case 0: }`,
      "/not-in.js": `!a in b`,
      "/node_modules/not-in.js": `!a in b`,
      "/plugin-dir/node_modules/not-in.js": `!a in b`,
      "/not-instanceof.js": `!a instanceof b`,
      "/node_modules/not-instanceof.js": `!a instanceof b`,
      "/plugin-dir/node_modules/not-instanceof.js": `!a instanceof b`,
      "/return-asi.js": `return\n123`,
      "/node_modules/return-asi.js": `return\n123`,
      "/plugin-dir/node_modules/return-asi.js": `return\n123`,
      "/bad-typeof.js": `typeof x == 'null'`,
      "/node_modules/bad-typeof.js": `typeof x == 'null'`,
      "/plugin-dir/node_modules/bad-typeof.js": `typeof x == 'null'`,
      "/equals-neg-zero.js": `x === -0`,
      "/node_modules/equals-neg-zero.js": `x === -0`,
      "/plugin-dir/node_modules/equals-neg-zero.js": `x === -0`,
      "/equals-nan.js": `x === NaN`,
      "/node_modules/equals-nan.js": `x === NaN`,
      "/plugin-dir/node_modules/equals-nan.js": `x === NaN`,
      "/equals-object.js": `x === []`,
      "/node_modules/equals-object.js": `x === []`,
      "/plugin-dir/node_modules/equals-object.js": `x === []`,
      "/write-getter.js": `class Foo { get #foo() {} foo() { this.#foo = 123 } }`,
      "/node_modules/write-getter.js": `class Foo { get #foo() {} foo() { this.#foo = 123 } }`,
      "/plugin-dir/node_modules/write-getter.js": `class Foo { get #foo() {} foo() { this.#foo = 123 } }`,
      "/read-setter.js": `class Foo { set #foo(x) {} foo() { return this.#foo } }`,
      "/node_modules/read-setter.js": `class Foo { set #foo(x) {} foo() { return this.#foo } }`,
      "/plugin-dir/node_modules/read-setter.js": `class Foo { set #foo(x) {} foo() { return this.#foo } }`,
      "/delete-super.js": `class Foo extends Bar { foo() { delete super.foo } }`,
      "/node_modules/delete-super.js": `class Foo extends Bar { foo() { delete super.foo } }`,
      "/plugin-dir/node_modules/delete-super.js": `class Foo extends Bar { foo() { delete super.foo } }`,
    },
    /* TODO FIX expectedScanLog: `bad-typeof.js: WARNING: The "typeof" operator will never evaluate to "null"
  NOTE: The expression "typeof x" actually evaluates to "object" in JavaScript, not "null". You need to use "x === null" to test for null.
  delete-super.js: WARNING: Attempting to delete a property of "super" will throw a ReferenceError
  dup-case.js: WARNING: This case clause will never be evaluated because it duplicates an earlier case clause
  dup-case.js: NOTE: The earlier case clause is here:
  equals-nan.js: WARNING: Comparison with NaN using the "===" operator here is always false
  NOTE: Floating-point equality is defined such that NaN is never equal to anything, so "x === NaN" always returns false. You need to use "Number.isNaN(x)" instead to test for NaN.
  equals-neg-zero.js: WARNING: Comparison with -0 using the "===" operator will also match 0
  NOTE: Floating-point equality is defined such that 0 and -0 are equal, so "x === -0" returns true for both 0 and -0. You need to use "Object.is(x, -0)" instead to test for -0.
  equals-object.js: WARNING: Comparison using the "===" operator here is always false
  NOTE: Equality with a new object is always false in JavaScript because the equality operator tests object identity. You need to write code to compare the contents of the object instead. For example, use "Array.isArray(x) && x.length === 0" instead of "x === []" to test for an empty array.
  not-in.js: WARNING: Suspicious use of the "!" operator inside the "in" operator
  NOTE: The code "!x in y" is parsed as "(!x) in y". You need to insert parentheses to get "!(x in y)" instead.
  not-instanceof.js: WARNING: Suspicious use of the "!" operator inside the "instanceof" operator
  NOTE: The code "!x instanceof y" is parsed as "(!x) instanceof y". You need to insert parentheses to get "!(x instanceof y)" instead.
  read-setter.js: WARNING: Reading from setter-only property "#foo" will throw
  return-asi.js: WARNING: The following expression is not returned because of an automatically-inserted semicolon
  write-getter.js: WARNING: Writing to getter-only property "#foo" will throw
  `, */
  });
  itBundled("default/RequireResolve", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        console.log(require.resolve)
        console.log(require.resolve())
        console.log(require.resolve(foo))
        console.log(require.resolve('a', 'b'))
        console.log(require.resolve('./present-file'))
        console.log(require.resolve('./missing-file'))
        console.log(require.resolve('./external-file'))
        console.log(require.resolve('missing-pkg'))
        console.log(require.resolve('external-pkg'))
        console.log(require.resolve('@scope/missing-pkg'))
        console.log(require.resolve('@scope/external-pkg'))
        try {
          console.log(require.resolve('inside-try'))
        } catch (e) {
        }
        if (false) {
          console.log(require.resolve('dead-code'))
        }
        console.log(false ? require.resolve('dead-if') : 0)
        console.log(true ? 0 : require.resolve('dead-if'))
        console.log(false && require.resolve('dead-and'))
        console.log(true || require.resolve('dead-or'))
        console.log(true ?? require.resolve('dead-nullish'))
      `,
      "/present-file.js": ``,
    },
    platform: "node",
    format: "cjs",
    /* TODO FIX expectedScanLog: `entry.js: WARNING: "./present-file" should be marked as external for use with "require.resolve"
  entry.js: WARNING: "./missing-file" should be marked as external for use with "require.resolve"
  entry.js: WARNING: "missing-pkg" should be marked as external for use with "require.resolve"
  entry.js: WARNING: "@scope/missing-pkg" should be marked as external for use with "require.resolve"
  `, */
  });
  bundlerTest.skip("default/InjectMissing", () => {
    expectBundled("default/InjectMissingUnix", {
      // GENERATED
      host: "unix",
      files: {
        "/entry.js": ``,
      },
      /* TODO FIX expectedScanLog: "ERROR: Could not resolve \"/inject.js\"\n", */
    });
    expectBundled("default/InjectMissingWindows", {
      // GENERATED
      host: "windows",
      files: {
        "/entry.js": ``,
      },
      /* TODO FIX expectedScanLog: "ERROR: Could not resolve \"C:\\\\inject.js\"\n", */
    });
  });
  itBundled("default/InjectDuplicate", {
    // GENERATED
    files: {
      "/entry.js": ``,
      "/inject.js": `console.log('injected')`,
    },
  });
  itBundled("default/Inject", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        let sideEffects = console.log('this should be renamed')
        let collide = 123
        console.log(obj.prop)
        console.log(obj.defined)
        console.log(injectedAndDefined)
        console.log(injected.and.defined)
        console.log(chain.prop.test)
        console.log(chain2.prop2.test)
        console.log(collide)
        console.log(re_export)
        console.log(re.export)
      `,
      "/inject.js": /* js */ `
        export let obj = {}
        export let sideEffects = console.log('side effects')
        export let noSideEffects = /* @__PURE__ */ console.log('side effects')
        export let injectedAndDefined = 'should not be used'
        let injected_and_defined = 'should not be used'
        export { injected_and_defined as 'injected.and.defined' }
      `,
      "/node_modules/unused/index.js": `console.log('This is unused but still has side effects')`,
      "/node_modules/sideEffects-false/index.js": `console.log('This is unused and has no side effects')`,
      "/node_modules/sideEffects-false/package.json": /* json */ `
        {
        "sideEffects": false
      }
      `,
      "/replacement.js": /* js */ `
        export let replace = {
          test() {}
        }
        let replace2 = {
          test() {}
        }
        export { replace2 as 'chain2.prop2' }
      `,
      "/collision.js": `export let collide = 123`,
      "/re-export.js": /* js */ `
        export {re_export} from 'external-pkg'
        export {'re.export'} from 'external-pkg2'
      `,
    },
    format: "cjs",
    inject: [
      "/inject.js",
      "/node_modules/unused/index.js",
      "/node_modules/sideEffects-false/index.js",
      "/replacement.js",
      "/collision.js",
      "/re-export.js",
    ],
    define: {
      "chain.prop": "replace",
      "obj.defined": JSON.stringify("defined"),
      injectedAndDefined: JSON.stringify("should be used"),
      "injected.and.defined": JSON.stringify("should be used"),
    },
  });
  itBundled("default/InjectNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        let sideEffects = console.log('side effects')
        let collide = 123
        console.log(obj.prop)
        console.log(obj.defined)
        console.log(injectedAndDefined)
        console.log(injected.and.defined)
        console.log(chain.prop.test)
        console.log(chain2.prop2.test)
        console.log(collide)
        console.log(re_export)
        console.log(reexpo.rt)
      `,
      "/inject.js": /* js */ `
        export let obj = {}
        export let sideEffects = console.log('this should be renamed')
        export let noSideEffects = /* @__PURE__ */ console.log('side effects')
        export let injectedAndDefined = 'should not be used'
        let injected_and_defined = 'should not be used'
        export { injected_and_defined as 'injected.and.defined' }
      `,
      "/node_modules/unused/index.js": `console.log('This is unused but still has side effects')`,
      "/node_modules/sideEffects-false/index.js": `console.log('This is unused and has no side effects')`,
      "/node_modules/sideEffects-false/package.json": /* json */ `
        {
        "sideEffects": false
      }
      `,
      "/replacement.js": /* js */ `
        export let replace = {
          test() {}
        }
        let replaceDot = {
          test() {}
        }
        export { replaceDot as 'chain2.prop2' }
      `,
      "/collision.js": `export let collide = 123`,
      "/re-export.js": /* js */ `
        export {re_export} from 'external-pkg'
        export {'reexpo.rt'} from 'external-pkg2'
      `,
    },
    treeShaking: true,
    mode: "passthrough",
    define: {
      "chain.prop": "replace",
      "obj.defined": '"defined"',
      injectedAndDefined: '"should be used"',
      "injected.and.defined": '"should be used"',
    },
  });
  itBundled("default/InjectJSX", {
    // GENERATED
    files: {
      "/entry.jsx": `console.log(<><div/></>)`,
      "/inject.js": /* js */ `
        export function el() {}
        export function frag() {}
      `,
    },
    define: {
      "React.createElement": "el",
      "React.Fragment": "frag",
    },
  });
  itBundled("default/InjectJSXDotNames", {
    // GENERATED
    files: {
      "/entry.jsx": `console.log(<><div/></>)`,
      "/inject.js": /* js */ `
        function el() {}
        function frag() {}
        export {
          el as 'React.createElement',
          frag as 'React.Fragment',
        }
      `,
    },
  });
  itBundled("default/InjectImportTS", {
    // GENERATED
    files: {
      "/entry.ts": `console.log('here')`,
      "/inject.js": /* js */ `
        // Unused imports are automatically removed in TypeScript files (this
        // is a mis-feature of the TypeScript language). However, injected
        // imports are an esbuild feature so we get to decide what the
        // semantics are. We do not want injected imports to disappear unless
        // they have been explicitly marked as having no side effects.
        console.log('must be present')
      `,
    },
    format: "esm",
    mode: "convertformat",
  });
  itBundled("default/InjectImportOrder", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import 'third'
        console.log('third')
      `,
      "/inject-1.js": /* js */ `
        import 'first'
        console.log('first')
      `,
      "/inject-2.js": /* js */ `
        import 'second'
        console.log('second')
      `,
    },
    inject: ["/inject-1.js", "/inject-2.js"],
  });
  itBundled("default/InjectAssign", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        test = true
        foo.bar = true
        defined = true
      `,
      "/inject.js": /* js */ `
        export let test = 0
        let fooBar = 1
        let someDefine = 2
        export { fooBar as 'foo.bar' }
        export { someDefine as 'some.define' }
      `,
    },
    inject: ["/inject.js"],
    define: {
      defined: "some.define",
    },
  });
  itBundled("default/InjectWithDefine", {
    files: {
      "/entry.js": /* js */ `
        console.log(
          // define wins over inject
          both === 'define',
          bo.th === 'defi.ne',
          // define forwards to inject
          first === 'success (identifier)',
          fir.st === 'success (dot name)',
        )
      `,
      "/inject.js": /* js */ `
        export let both = 'inject'
        export let first = 'TEST FAILED!'
        export let second = 'success (identifier)'
  
        let both2 = 'inject'
        let first2 = 'TEST FAILED!'
        let second2 = 'success (dot name)'
        export {
          both2 as 'bo.th',
          first2 as 'fir.st',
          second2 as 'seco.nd',
        }
      `,
    },
    inject: ["/inject.js"],
    define: {
      "both": '"define"',
      "bo.th": '"defi.ne"',
      "first": "second",
      "fir.st": "seco.nd",
    },
  });
  itBundled("default/Outbase", {
    // GENERATED
    files: {
      "/a/b/c.js": `console.log('c')`,
      "/a/b/d.js": `console.log('d')`,
    },
    entryPoints: ["/a/b/c.js", "/a/b/d.js"],
  });
  itBundled("default/AvoidTDZ", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          static foo = new Foo
        }
        let foo = Foo.foo
        console.log(foo)
        export class Bar {}
        export let bar = 123
      `,
    },
  });
  itBundled("default/AvoidTDZNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          static foo = new Foo
        }
        let foo = Foo.foo
        console.log(foo)
        export class Bar {}
        export let bar = 123
      `,
    },
    mode: "passthrough",
  });
  itBundled("default/DefineImportMeta", {
    files: {
      "/entry.js": /* js */ `
        console.log(
          // These should be fully substituted
          import.meta,
          import.meta.foo,
          import.meta.foo.bar,
  
          // Should just substitute "import.meta.foo"
          import.meta.foo.length,
  
          // This should not be substituted
          import.meta.main,
        )
      `,
    },
    define: {
      "import.meta": 1,
      "import.meta.foo": "bun!",
      "import.meta.foo.bar": 3,
    },
    run: {
      stdout: "1 bun! 3 4 undefined",
    },
  });
  itBundled("default/DefineImportMetaES5", {
    // GENERATED
    files: {
      "/replaced.js": `console.log(import.meta.x)`,
      "/kept.js": `console.log(import.meta.y)`,
      "/dead-code.js": `var x = () => console.log(import.meta.z)`,
    },
    entryPoints: ["/replaced.js", "/kept.js", "/dead-code.js"],
    define: {
      "import.meta.x": 1,
    },
    /* TODO FIX expectedScanLog: `dead-code.js: WARNING: "import.meta" is not available in the configured target environment and will be empty
  kept.js: WARNING: "import.meta" is not available in the configured target environment and will be empty
  `, */
  });
  itBundled("default/InjectImportMeta", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        console.log(
          // These should be fully substituted
          import.meta,
          import.meta.foo,
          import.meta.foo.bar,
  
          // Should just substitute "import.meta.foo"
          import.meta.foo.baz,
  
          // This should not be substituted
          import.meta.bar,
        )
      `,
      "/inject.js": /* js */ `
        let foo = 1
        let bar = 2
        let baz = 3
        export {
          foo as 'import.meta',
          bar as 'import.meta.foo',
          baz as 'import.meta.foo.bar',
        }
      `,
    },
  });
  itBundled("default/DefineThis", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        ok(
          // These should be fully substituted
          this,
          this.foo,
          this.foo.bar,
  
          // Should just substitute "this.foo"
          this.foo.baz,
  
          // This should not be substituted
          this.bar,
        );
  
        // This code should be the same as above
        (() => {
          ok(
            this,
            this.foo,
            this.foo.bar,
            this.foo.baz,
            this.bar,
          );
        })();
  
        // Nothing should be substituted in this code
        (function() {
          doNotSubstitute(
            this,
            this.foo,
            this.foo.bar,
            this.foo.baz,
            this.bar,
          );
        })();
      `,
    },
    define: {
      this: 1,
      "this.foo": 2,
      "this.foo.bar": 3,
    },
  });
  itBundled("default/DefineOptionalChain", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        console.log([
          a.b.c,
          a?.b.c,
          a.b?.c,
        ], [
          a['b']['c'],
          a?.['b']['c'],
          a['b']?.['c'],
        ], [
          a[b][c],
          a?.[b][c],
          a[b]?.[c],
        ])
      `,
    },
    define: {
      "a.b.c": 1,
    },
  });
  itBundled("default/DefineOptionalChainLowered", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        console.log([
          a.b.c,
          a?.b.c,
          a.b?.c,
        ], [
          a['b']['c'],
          a?.['b']['c'],
          a['b']?.['c'],
        ], [
          a[b][c],
          a?.[b][c],
          a[b]?.[c],
        ])
      `,
    },
    define: {
      "a.b.c": 1,
    },
  });
  itBundled("default/DefineInfiniteLoopIssue2407", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        a.b()
        x.y()
      `,
    },
    define: {
      "a.b": "b.c",
      "b.c": "c.a",
      "c.a": "a.b",
      "x.y": "y",
    },
  });
  itBundled("default/DefineAssignWarning", {
    // GENERATED
    files: {
      "/read.js": /* js */ `
        console.log(
          [a, b.c, b['c']],
          [d, e.f, e['f']],
          [g, h.i, h['i']],
        )
      `,
      "/write.js": /* js */ `
        console.log(
          [a = 0, b.c = 0, b['c'] = 0],
          [d = 0, e.f = 0, e['f'] = 0],
          [g = 0, h.i = 0, h['i'] = 0],
        )
      `,
    },
    entryPoints: ["/read.js", "/write.js"],
    define: {
      a: "null",
      "b.c": "null",
      d: "ident",
      "e.f": "ident",
      g: "dot.chain",
      "h.i": "dot.chain",
    },
  });
  itBundled("default/KeepNamesTreeShaking", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        function fnStmtRemove() {}
        function fnStmtKeep() {}
        x = fnStmtKeep
  
        let fnExprRemove = function remove() {}
        let fnExprKeep = function keep() {}
        x = fnExprKeep
  
        class clsStmtRemove {}
        class clsStmtKeep {}
        new clsStmtKeep()
  
        let clsExprRemove = class remove {}
        let clsExprKeep = class keep {}
        new clsExprKeep()
      `,
    },
    keepNames: true,
  });
  itBundled("default/KeepNamesClassStaticName", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class A { static foo }
        class B { static name }
        class C { static name() {} }
        class D { static get name() {} }
        class E { static set name(x) {} }
        class F { static ['name'] = 0 }
  
        let a = class a { static foo }
        let b = class b { static name }
        let c = class c { static name() {} }
        let d = class d { static get name() {} }
        let e = class e { static set name(x) {} }
        let f = class f { static ['name'] = 0 }
  
        let a2 = class { static foo }
        let b2 = class { static name }
        let c2 = class { static name() {} }
        let d2 = class { static get name() {} }
        let e2 = class { static set name(x) {} }
        let f2 = class { static ['name'] = 0 }
      `,
    },
    mode: "passthrough",
  });
  itBundled("default/CharFreqIgnoreComments", {
    // GENERATED
    files: {
      "/a.js": /* js */ `
        export default function(one, two, three, four) {
          return 'the argument names must be the same'
        }
      `,
      "/b.js": /* js */ `
        export default function(one, two, three, four) {
          return 'the argument names must be the same'
        }
  
        // Some comment text to change the character frequency histogram:
        // ________________________________________________________________________________
        // FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
        // AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
        // IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII
        // LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
  });
  itBundled("default/ImportRelativeAsPackage", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `import 'some/other/file'`,
      "/Users/user/project/src/some/other/file.js": ``,
    },
    /* TODO FIX expectedScanLog: `Users/user/project/src/entry.js: ERROR: Could not resolve "some/other/file"
  NOTE: Use the relative path "./some/other/file" to reference the file "Users/user/project/src/some/other/file.js". Without the leading "./", the path "some/other/file" is being interpreted as a package path instead.
  `, */
  });
  itBundled("default/ForbidConstAssignWhenBundling", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        const x = 1
        x = 2
      `,
    },
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Cannot assign to "x" because it is a constant
  entry.js: NOTE: The symbol "x" was declared a constant here:
  `, */
  });
  itBundled("default/ConstWithLet", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        const a = 1; console.log(a)
        if (true) { const b = 2; console.log(b) }
        if (true) { const b = 3; unknownFn(b) }
        for (const c = x;;) console.log(c)
        for (const d in x) console.log(d)
        for (const e of x) console.log(e)
      `,
    },
  });
  itBundled("default/ConstWithLetNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        const a = 1; console.log(a)
        if (true) { const b = 2; console.log(b) }
        if (true) { const b = 3; unknownFn(b) }
        for (const c = x;;) console.log(c)
        for (const d in x) console.log(d)
        for (const e of x) console.log(e)
      `,
    },
    mode: "passthrough",
  });
  itBundled("default/ConstWithLetNoMangle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        const a = 1; console.log(a)
        if (true) { const b = 2; console.log(b) }
        for (const c = x;;) console.log(c)
        for (const d in x) console.log(d)
        for (const e of x) console.log(e)
      `,
    },
  });
  itBundled("default/RequireMainCacheCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        console.log('is main:', require.main === module)
        console.log(require('./is-main'))
        console.log('cache:', require.cache);
      `,
      "/is-main.js": `module.exports = require.main === module`,
    },
    platform: "node",
  });
  itBundled("default/ExternalES6ConvertedToCommonJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        require('./a')
        require('./b')
        require('./c')
        require('./d')
        require('./e')
      `,
      "/a.js": /* js */ `
        import * as ns from 'x'
        export {ns}
      `,
      "/b.js": /* js */ `
        import * as ns from 'x' // "ns" must be renamed to avoid collisions with "a.js"
        export {ns}
      `,
      "/c.js": `export * as ns from 'x'`,
      "/d.js": `export {ns} from 'x'`,
      "/e.js": `export * from 'x'`,
    },
    format: "esm",
  });
  itBundled("default/CallImportNamespaceWarning", {
    // GENERATED
    files: {
      "/js.js": /* js */ `
        import * as a from "a"
        import {b} from "b"
        import c from "c"
        a()
        b()
        c()
        new a()
        new b()
        new c()
      `,
      "/ts.ts": /* ts */ `
        import * as a from "a"
        import {b} from "b"
        import c from "c"
        a()
        b()
        c()
        new a()
        new b()
        new c()
      `,
      "/jsx-components.jsx": /* jsx */ `
        import * as A from "a"
        import {B} from "b"
        import C from "c"
        <A/>;
        <B/>;
        <C/>;
      `,
      "/jsx-a.jsx": /* jsx */ `
        // @jsx a
        import * as a from "a"
        <div/>
      `,
      "/jsx-b.jsx": /* jsx */ `
        // @jsx b
        import {b} from "b"
        <div/>
      `,
      "/jsx-c.jsx": /* jsx */ `
        // @jsx c
        import c from "c"
        <div/>
      `,
    },
    entryPoints: ["/js.js", "/ts.ts", "/jsx-components.jsx", "/jsx-a.jsx", "/jsx-b.jsx", "/jsx-c.jsx"],
    mode: "convertformat",
    /* TODO FIX expectedScanLog: `js.js: WARNING: Calling "a" will crash at run-time because it's an import namespace object, not a function
  js.js: NOTE: Consider changing "a" to a default import instead:
  js.js: WARNING: Constructing "a" will crash at run-time because it's an import namespace object, not a constructor
  js.js: NOTE: Consider changing "a" to a default import instead:
  jsx-a.jsx: WARNING: Calling "a" will crash at run-time because it's an import namespace object, not a function
  jsx-a.jsx: NOTE: Consider changing "a" to a default import instead:
  jsx-components.jsx: WARNING: Using "A" in a JSX expression will crash at run-time because it's an import namespace object, not a component
  jsx-components.jsx: NOTE: Consider changing "A" to a default import instead:
  ts.ts: WARNING: Calling "a" will crash at run-time because it's an import namespace object, not a function
  ts.ts: NOTE: Consider changing "a" to a default import instead:
  NOTE: Make sure to enable TypeScript's "esModuleInterop" setting so that TypeScript's type checker generates an error when you try to do this. You can read more about this setting here: https://www.typescriptlang.org/tsconfig#esModuleInterop
  ts.ts: WARNING: Constructing "a" will crash at run-time because it's an import namespace object, not a constructor
  ts.ts: NOTE: Consider changing "a" to a default import instead:
  NOTE: Make sure to enable TypeScript's "esModuleInterop" setting so that TypeScript's type checker generates an error when you try to do this. You can read more about this setting here: https://www.typescriptlang.org/tsconfig#esModuleInterop
  `, */
  });
  itBundled("default/JSXThisValueCommonJS", {
    // GENERATED
    files: {
      "/factory.jsx": /* jsx */ `
        console.log([
          <x />,
          /* @__PURE__ */ this('x', null),
        ])
        f = function() {
          console.log([
            <y />,
            /* @__PURE__ */ this('y', null),
          ])
        }
      `,
      "/fragment.jsx": /* jsx */ `
        console.log([
          <>x</>,
          /* @__PURE__ */ this(this, null, 'x'),
        ]),
        f = function() {
          console.log([
            <>y</>,
            /* @__PURE__ */ this(this, null, 'y'),
          ])
        }
      `,
    },
    entryPoints: ["/factory.jsx", "/fragment.jsx"],
    jsx: {
      factory: "this",
      fragment: "this",
    },
  });
  itBundled("default/JSXThisValueESM", {
    // GENERATED
    files: {
      "/factory.jsx": /* jsx */ `
        console.log([
          <x />,
          /* @__PURE__ */ this('x', null),
        ])
        f = function() {
          console.log([
            <y />,
            /* @__PURE__ */ this('y', null),
          ])
        }
        export {}
      `,
      "/fragment.jsx": /* jsx */ `
        console.log([
          <>x</>,
          /* @__PURE__ */ this(this, null, 'x'),
        ]),
        f = function() {
          console.log([
            <>y</>,
            /* @__PURE__ */ this(this, null, 'y'),
          ])
        }
        export {}
      `,
    },
    entryPoints: ["/factory.jsx", "/fragment.jsx"],
    jsx: {
      factory: "this",
      fragment: "this",
    },
    /* TODO FIX expectedScanLog: `factory.jsx: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  factory.jsx: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  fragment.jsx: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  fragment.jsx: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  `, */
  });
  itBundled("default/JSXThisPropertyCommonJS", {
    // GENERATED
    files: {
      "/factory.jsx": /* jsx */ `
        console.log([
          <x />,
          /* @__PURE__ */ this.factory('x', null),
        ])
        f = function() {
          console.log([
            <y />,
            /* @__PURE__ */ this.factory('y', null),
          ])
        }
      `,
      "/fragment.jsx": /* jsx */ `
        console.log([
          <>x</>,
          /* @__PURE__ */ this.factory(this.fragment, null, 'x'),
        ]),
        f = function() {
          console.log([
            <>y</>,
            /* @__PURE__ */ this.factory(this.fragment, null, 'y'),
          ])
        }
      `,
    },
    entryPoints: ["/factory.jsx", "/fragment.jsx"],
    jsx: {
      factory: "this.factory",
      fragment: "this.fragment",
    },
  });
  itBundled("default/JSXThisPropertyESM", {
    // GENERATED
    files: {
      "/factory.jsx": /* jsx */ `
        console.log([
          <x />,
          /* @__PURE__ */ this.factory('x', null),
        ])
        f = function() {
          console.log([
            <y />,
            /* @__PURE__ */ this.factory('y', null),
          ])
        }
        export {}
      `,
      "/fragment.jsx": /* jsx */ `
        console.log([
          <>x</>,
          /* @__PURE__ */ this.factory(this.fragment, null, 'x'),
        ]),
        f = function() {
          console.log([
            <>y</>,
            /* @__PURE__ */ this.factory(this.fragment, null, 'y'),
          ])
        }
        export {}
      `,
    },
    entryPoints: ["/factory.jsx", "/fragment.jsx"],
    jsx: {
      factory: "this.factory",
      fragment: "this.fragment",
    },
    /* TODO FIX expectedScanLog: `factory.jsx: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  factory.jsx: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  fragment.jsx: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  fragment.jsx: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  `, */
  });
  itBundled("default/JSXImportMetaValue", {
    // GENERATED
    files: {
      "/factory.jsx": /* jsx */ `
        console.log([
          <x />,
          /* @__PURE__ */ import.meta('x', null),
        ])
        f = function() {
          console.log([
            <y />,
            /* @__PURE__ */ import.meta('y', null),
          ])
        }
        export {}
      `,
      "/fragment.jsx": /* jsx */ `
        console.log([
          <>x</>,
          /* @__PURE__ */ import.meta(import.meta, null, 'x'),
        ]),
        f = function() {
          console.log([
            <>y</>,
            /* @__PURE__ */ import.meta(import.meta, null, 'y'),
          ])
        }
        export {}
      `,
    },
    entryPoints: ["/factory.jsx", "/fragment.jsx"],
    unsupportedJSFeatures: "ImportMeta",
    jsx: {
      factory: "import.meta",
      fragment: "import.meta",
    },
    /* TODO FIX expectedScanLog: `factory.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  factory.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  `, */
  });
  itBundled("default/JSXImportMetaProperty", {
    // GENERATED
    files: {
      "/factory.jsx": /* jsx */ `
        console.log([
          <x />,
          /* @__PURE__ */ import.meta.factory('x', null),
        ])
        f = function() {
          console.log([
            <y />,
            /* @__PURE__ */ import.meta.factory('y', null),
          ])
        }
        export {}
      `,
      "/fragment.jsx": /* jsx */ `
        console.log([
          <>x</>,
          /* @__PURE__ */ import.meta.factory(import.meta.fragment, null, 'x'),
        ]),
        f = function() {
          console.log([
            <>y</>,
            /* @__PURE__ */ import.meta.factory(import.meta.fragment, null, 'y'),
          ])
        }
        export {}
      `,
    },
    entryPoints: ["/factory.jsx", "/fragment.jsx"],
    unsupportedJSFeatures: "ImportMeta",
    jsx: {
      factory: "import.meta.factory",
      fragment: "import.meta.fragment",
    },
    /* TODO FIX expectedScanLog: `factory.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  factory.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  `, */
  });
  itBundled("default/BundlingFilesOutsideOfOutbase", {
    // GENERATED
    files: {
      "/src/entry.js": `console.log('test')`,
    },
    splitting: true,
    format: "esm",
    outbase: "/some/nested/directory",
  });
  const relocateFiles = {
    "/top-level.js": /* js */ `
  		var a;
  		for (var b; 0;);
  		for (var { c, x: [d] } = {}; 0;);
  		for (var e of []);
  		for (var { f, x: [g] } of []);
  		for (var h in {});
  		for (var i = 1 in {});
  		for (var { j, x: [k] } in {});
  		function l() {}
  	`,
    "/nested.js": /* js */ `
  		if (true) {
  			var a;
  			for (var b; 0;);
  			for (var { c, x: [d] } = {}; 0;);
  			for (var e of []);
  			for (var { f, x: [g] } of []);
  			for (var h in {});
  			for (var i = 1 in {});
  			for (var { j, x: [k] } in {});
  			function l() {}
  		}
  	`,
    "/let.js": /* js */ `
  		if (true) {
  			let a;
  			for (let b; 0;);
  			for (let { c, x: [d] } = {}; 0;);
  			for (let e of []);
  			for (let { f, x: [g] } of []);
  			for (let h in {});
  			// for (let i = 1 in {});
  			for (let { j, x: [k] } in {});
  		}
  	`,
    "/function.js": /* js */ `
  		function x() {
  			var a;
  			for (var b; 0;);
  			for (var { c, x: [d] } = {}; 0;);
  			for (var e of []);
  			for (var { f, x: [g] } of []);
  			for (var h in {});
  			for (var i = 1 in {});
  			for (var { j, x: [k] } in {});
  			function l() {}
  		}
  		x()
  	`,
    "/function-nested.js": /* js */ `
  		function x() {
  			if (true) {
  				var a;
  				for (var b; 0;);
  				for (var { c, x: [d] } = {}; 0;);
  				for (var e of []);
  				for (var { f, x: [g] } of []);
  				for (var h in {});
  				for (var i = 1 in {});
  				for (var { j, x: [k] } in {});
  				function l() {}
  			}
  		}
  		x()
  	`,
  };
  const relocateEntries = ["/top-level.js", "/nested.js", "/let.js", "/function.js", "/function-nested.js"];

  itBundled("default/VarRelocatingBundle", {
    // GENERATED
    files: relocateFiles,
    entryPoints: relocateEntries,
    format: "esm",
  });
  itBundled("default/VarRelocatingNoBundle", {
    // GENERATED
    files: relocateFiles,
    entryPoints: relocateEntries,
    format: "esm",
    mode: "convertformat",
  });
  itBundled("default/ImportNamespaceThisValue", {
    // GENERATED
    files: {
      "/a.js": /* js */ `
        import def, * as ns from 'external'
        console.log(ns[foo](), new ns[foo]())
      `,
      "/b.js": /* js */ `
        import def, * as ns from 'external'
        console.log(ns.foo(), new ns.foo())
      `,
      "/c.js": /* js */ `
        import def, {foo} from 'external'
        console.log(def(), foo())
        console.log(new def(), new foo())
      `,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    format: "cjs",
  });
  itBundled("default/ThisUndefinedWarningESM", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import x from './file1.js'
        import y from 'pkg/file2.js'
        console.log(x, y)
      `,
      "/file1.js": `export default [this, this]`,
      "/node_modules/pkg/file2.js": `export default [this, this]`,
    },
    /* TODO FIX expectedScanLog: `file1.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  file1.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  node_modules/pkg/file2.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  node_modules/pkg/file2.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  `, */
  });
  itBundled("default/QuotedProperty", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from 'ext'
        console.log(ns.mustBeUnquoted, ns['mustBeQuoted'])
      `,
    },
    format: "cjs",
  });
  itBundled("default/QuotedPropertyMangle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from 'ext'
        console.log(ns.mustBeUnquoted, ns['mustBeUnquoted2'])
      `,
    },
    format: "cjs",
    minifySyntax: true,
  });
  itBundled("default/DuplicatePropertyWarning", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import './outside-node-modules'
        import 'inside-node-modules'
      `,
      "/outside-node-modules/index.jsx": `console.log({ a: 1, a: 2 }, <div a2 a2={3}/>)`,
      "/outside-node-modules/package.json": `{ "b": 1, "b": 2 }`,
      "/node_modules/inside-node-modules/index.jsx": `console.log({ c: 1, c: 2 }, <div c2 c2={3}/>)`,
      "/node_modules/inside-node-modules/package.json": `{ "d": 1, "d": 2 }`,
    },
    /* TODO FIX expectedScanLog: `outside-node-modules/index.jsx: WARNING: Duplicate key "a" in object literal
  outside-node-modules/index.jsx: NOTE: The original key "a" is here:
  outside-node-modules/index.jsx: WARNING: Duplicate "a2" attribute in JSX element
  outside-node-modules/index.jsx: NOTE: The original "a2" attribute is here:
  outside-node-modules/package.json: WARNING: Duplicate key "b" in object literal
  outside-node-modules/package.json: NOTE: The original key "b" is here:
  `, */
  });
  itBundled("default/RequireShimSubstitution", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        console.log([
          require,
          typeof require,
          require('./example.json'),
          require('./example.json', { type: 'json' }),
          require(window.SOME_PATH),
          module.require('./example.json'),
          module.require('./example.json', { type: 'json' }),
          module.require(window.SOME_PATH),
          require.resolve('some-path'),
          require.resolve(window.SOME_PATH),
          import('some-path'),
          import(window.SOME_PATH),
        ])
      `,
      "/example.json": `{ "works": true }`,
    },
    external: ["some-path"],
  });
  itBundled("default/StrictModeNestedFnDeclKeepNamesVariableInliningIssue1552", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export function outer() {
          {
            function inner() {
              return Math.random();
            }
            const x = inner();
            console.log(x);
          }
        }
        outer();
      `,
    },
    keepNames: true,
    mode: "passthrough",
  });
  itBundled("default/BuiltInNodeModulePrecedence", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        console.log([
          // These are node core modules
          require('fs'),
          require('fs/promises'),
          require('node:foo'),
  
          // These are not node core modules
          require('fs/abc'),
          require('fs/'),
        ])
      `,
      "/node_modules/fs/abc.js": `console.log('include this')`,
      "/node_modules/fs/index.js": `console.log('include this too')`,
      "/node_modules/fs/promises.js": `throw 'DO NOT INCLUDE THIS'`,
    },
    platform: "node",
    format: "cjs",
  });
  itBundled("default/EntryNamesNoSlashAfterDir", {
    // GENERATED
    files: {
      "/src/app1/main.ts": `console.log(1)`,
      "/src/app2/main.ts": `console.log(2)`,
      "/src/app3/main.ts": `console.log(3)`,
    },
    entryPointsAdvanced: [
      { input: "/src/app1/main.ts" },
      { input: "/src/app2/main.ts" },
      { input: "/src/app3/main.ts", output: "customPath" },
    ],
    entryNames: "[dir]-[name]",
    mode: "passthrough",
  });
  itBundled("default/EntryNamesNonPortableCharacter", {
    // GENERATED
    // TODO: I think this is impossible with the CLI. and also very unsafe with paths.
    files: {
      "/entry1-*.ts": `console.log(1)`,
      "/entry2-*.ts": `console.log(2)`,
    },
    entryPointsAdvanced: [
      // The "*" should turn into "_" for cross-platform Windows portability
      { input: "/entry1-*.ts" },
      // The "*" should be preserved since the user _really_ wants it
      { input: "/entry2-*.ts", output: "entry2-*" },
    ],
    mode: "passthrough",
  });
  itBundled("default/EntryNamesChunkNamesExtPlaceholder", {
    // GENERATED
    files: {
      "/src/entries/entry1.js": `import "../lib/shared.js"; import "./entry1.css"; console.log('entry1')`,
      "/src/entries/entry2.js": `import "../lib/shared.js"; import "./entry2.css"; console.log('entry2')`,
      "/src/entries/entry1.css": `a:after { content: "entry1" }`,
      "/src/entries/entry2.css": `a:after { content: "entry2" }`,
      "/src/lib/shared.js": `console.log('shared')`,
    },
    entryPoints: ["/src/entries/entry1.js", "/src/entries/entry2.js"],
    outbase: "/src",
    splitting: true,
    entryNames: "main/[ext]/[name]-[hash]",
  });
  itBundled("default/MinifyIdentifiersImportPathFrequencyAnalysis", {
    // GENERATED
    files: {
      "/import.js": /* js */ `
        import foo from "./WWWWWWWWWWXXXXXXXXXXYYYYYYYYYYZZZZZZZZZZ"
        console.log(foo, 'no identifier in this file should be named W, X, Y, or Z')
      `,
      "/WWWWWWWWWWXXXXXXXXXXYYYYYYYYYYZZZZZZZZZZ.js": `export default 123`,
      "/require.js": /* js */ `
        const foo = require("./AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDD")
        console.log(foo, 'no identifier in this file should be named A, B, C, or D')
      `,
      "/AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDD.js": `module.exports = 123`,
    },
    entryPoints: ["/import.js", "/require.js"],
    minifyWhitespace: true,
  });
  itBundled("default/ToESMWrapperOmission", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import 'a_nowrap'
  
        import { b } from 'b_nowrap'
        b()
  
        export * from 'c_nowrap'
  
        import * as d from 'd_WRAP'
        x = d.x
  
        import e from 'e_WRAP'
        e()
  
        import { default as f } from 'f_WRAP'
        f()
  
        import { __esModule as g } from 'g_WRAP'
        g()
  
        import * as h from 'h_WRAP'
        x = h
  
        import * as i from 'i_WRAP'
        i.x()
  
        import * as j from 'j_WRAP'
        j.x\` + "\`\`" + \`
  
        x = import("k_WRAP")
      `,
    },
    format: "cjs",
    mode: "convertformat",
  });
  itBundled("default/NamedFunctionExpressionArgumentCollision", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        let x = function foo(foo) {
          var foo;
          return foo;
        }
      `,
    },
    mode: "passthrough",
  });
  itBundled("default/NoWarnCommonJSExportsInESMPassThrough", {
    // GENERATED
    files: {
      "/cjs-in-esm.js": /* js */ `
        export let foo = 1
        exports.foo = 2
        module.exports = 3
      `,
      "/import-in-cjs.js": /* js */ `
        import { foo } from 'bar'
        exports.foo = foo
        module.exports = foo
      `,
      "/no-warnings-here.js": `console.log(module, exports)`,
    },
    entryPoints: ["/cjs-in-esm.js", "/import-in-cjs.js", "/no-warnings-here.js"],
    mode: "passthrough",
  });
  itBundled("default/WarnCommonJSExportsInESMConvert", {
    // GENERATED
    files: {
      "/cjs-in-esm.js": /* js */ `
        export let foo = 1
        exports.foo = 2
        module.exports = 3
      `,
      "/cjs-in-esm2.js": /* js */ `
        export let foo = 1
        module.exports.bar = 3
      `,
      "/import-in-cjs.js": /* js */ `
        import { foo } from 'bar'
        exports.foo = foo
        module.exports = foo
        module.exports.bar = foo
      `,
      "/no-warnings-here.js": `console.log(module, exports)`,
    },
    entryPoints: ["/cjs-in-esm.js", "/cjs-in-esm2.js", "/import-in-cjs.js", "/no-warnings-here.js"],
    mode: "convertformat",
    /* TODO FIX expectedScanLog: `cjs-in-esm.js: WARNING: The CommonJS "exports" variable is treated as a global variable in an ECMAScript module and may not work as expected
  cjs-in-esm.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  cjs-in-esm.js: WARNING: The CommonJS "module" variable is treated as a global variable in an ECMAScript module and may not work as expected
  cjs-in-esm.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  cjs-in-esm2.js: WARNING: The CommonJS "module" variable is treated as a global variable in an ECMAScript module and may not work as expected
  cjs-in-esm2.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  `, */
  });
  itBundled("default/WarnCommonJSExportsInESMBundle", {
    // GENERATED
    files: {
      "/cjs-in-esm.js": /* js */ `
        export let foo = 1
        exports.foo = 2
        module.exports = 3
      `,
      "/import-in-cjs.js": /* js */ `
        import { foo } from 'bar'
        exports.foo = foo
        module.exports = foo
      `,
      "/no-warnings-here.js": `console.log(module, exports)`,
    },
    entryPoints: ["/cjs-in-esm.js", "/import-in-cjs.js", "/no-warnings-here.js"],
    format: "cjs",
    /* TODO FIX expectedScanLog: `cjs-in-esm.js: WARNING: The CommonJS "exports" variable is treated as a global variable in an ECMAScript module and may not work as expected
  cjs-in-esm.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  cjs-in-esm.js: WARNING: The CommonJS "module" variable is treated as a global variable in an ECMAScript module and may not work as expected
  cjs-in-esm.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  `, */
  });
  itBundled("default/MangleProps", {
    // GENERATED
    files: {
      "/entry1.js": /* js */ `
        export function shouldMangle() {
          let foo = {
            bar_: 0,
            baz_() {},
          };
          let { bar_ } = foo;
          ({ bar_ } = foo);
          class foo_ {
            bar_ = 0
            baz_() {}
            static bar_ = 0
            static baz_() {}
          }
          return { bar_, foo_ }
        }
  
        export function shouldNotMangle() {
          let foo = {
            'bar_': 0,
            'baz_'() {},
          };
          let { 'bar_': bar_ } = foo;
          ({ 'bar_': bar_ } = foo);
          class foo_ {
            'bar_' = 0
            'baz_'() {}
            static 'bar_' = 0
            static 'baz_'() {}
          }
          return { 'bar_': bar_, 'foo_': foo_ }
        }
      `,
      "/entry2.js": /* js */ `
        export default {
          bar_: 0,
          'baz_': 1,
        }
      `,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    mode: "passthrough",
  });
  itBundled("default/ManglePropsMinify", {
    // GENERATED
    files: {
      "/entry1.js": /* js */ `
        export function shouldMangle_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX() {
          let foo = {
            bar_: 0,
            baz_() {},
          };
          let { bar_ } = foo;
          ({ bar_ } = foo);
          class foo_ {
            bar_ = 0
            baz_() {}
            static bar_ = 0
            static baz_() {}
          }
          return { bar_, foo_ }
        }
  
        export function shouldNotMangle_YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY() {
          let foo = {
            'bar_': 0,
            'baz_'() {},
          };
          let { 'bar_': bar_ } = foo;
          ({ 'bar_': bar_ } = foo);
          class foo_ {
            'bar_' = 0
            'baz_'() {}
            static 'bar_' = 0
            static 'baz_'() {}
          }
          return { 'bar_': bar_, 'foo_': foo_ }
        }
      `,
      "/entry2.js": /* js */ `
        export default {
          bar_: 0,
          'baz_': 1,
        }
      `,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    mangleProps: /_$/,
    minifyIdentifiers: true,
    mode: "passthrough",
  });
  itBundled("default/ManglePropsKeywordPropertyMinify", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          static bar = { get baz() { return 123 } }
        }
      `,
    },
    mangleProps: /./,
    minifyIdentifiers: true,
    minifySyntax: true,
    mode: "passthrough",
  });
  itBundled("default/ManglePropsOptionalChain", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export default function(x) {
          x.foo_;
          x.foo_?.();
          x?.foo_;
          x?.foo_();
          x?.foo_.bar_;
          x?.foo_.bar_();
          x?.['foo_'].bar_;
          x?.foo_['bar_'];
        }
      `,
    },
    mode: "passthrough",
  });
  itBundled("default/ManglePropsLoweredOptionalChain", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export default function(x) {
          x.foo_;
          x.foo_?.();
          x?.foo_;
          x?.foo_();
          x?.foo_.bar_;
          x?.foo_.bar_();
          x?.['foo_'].bar_;
          x?.foo_['bar_'];
        }
      `,
    },
    mangleProps: /_$/,
    mode: "passthrough",
  });
  itBundled("default/ReserveProps", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export default {
          foo_: 0,
          _bar_: 1,
        }
      `,
    },
    mangleProps: /_$/,
    mode: "passthrough",
  });
  itBundled("default/ManglePropsImportExport", {
    // GENERATED
    files: {
      "/esm.js": /* js */ `
        export let foo_ = 123
        import { bar_ } from 'xyz'
      `,
      "/cjs.js": /* js */ `
        exports.foo_ = 123
        let bar_ = require('xyz').bar_
      `,
    },
    entryPoints: ["/esm.js", "/cjs.js"],
    mode: "passthrough",
  });
  itBundled("default/ManglePropsImportExportBundled", {
    // GENERATED
    files: {
      "/entry-esm.js": /* js */ `
        import { esm_foo_ } from './esm'
        import { cjs_foo_ } from './cjs'
        import * as esm from './esm'
        import * as cjs from './cjs'
        export let bar_ = [
          esm_foo_,
          cjs_foo_,
          esm.esm_foo_,
          cjs.cjs_foo_,
        ]
      `,
      "/entry-cjs.js": /* js */ `
        let { esm_foo_ } = require('./esm')
        let { cjs_foo_ } = require('./cjs')
        exports.bar_ = [
          esm_foo_,
          cjs_foo_,
        ]
      `,
      "/esm.js": `export let esm_foo_ = 'foo'`,
      "/cjs.js": `exports.cjs_foo_ = 'foo'`,
    },
    entryPoints: ["/entry-esm.js", "/entry-cjs.js"],
  });
  itBundled("default/ManglePropsJSXTransform", {
    // GENERATED
    files: {
      "/entry.jsx": /* jsx */ `
        let Foo = {
          Bar_(props) {
            return <>{props.text_}</>
          },
          hello_: 'hello, world',
          createElement_(...args) {
            console.log('createElement', ...args)
          },
          Fragment_(...args) {
            console.log('Fragment', ...args)
          },
        }
        export default <Foo.Bar_ text_={Foo.hello_}></Foo.Bar_>
      `,
    },
    mangleProps: /_$/,
    mode: "passthrough",
  });
  itBundled("default/ManglePropsJSXPreserve", {
    // GENERATED
    files: {
      "/entry.jsx": /* jsx */ `
        let Foo = {
          Bar_(props) {
            return <>{props.text_}</>
          },
          hello_: 'hello, world',
        }
        export default <Foo.Bar_ text_={Foo.hello_}></Foo.Bar_>
      `,
    },
    outfile: "/out.jsx",
    mangleProps: /_$/,
    mode: "passthrough",
  });
  itBundled("default/ManglePropsJSXTransformNamespace", {
    // GENERATED
    files: {
      "/entry.jsx": /* jsx */ `
        export default [
          <KEEP_THIS_ />,
          <KEEP:THIS_ />,
          <foo KEEP:THIS_ />,
        ]
      `,
    },
    mode: "passthrough",
  });
  itBundled("default/ManglePropsAvoidCollisions", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export default {
          foo_: 0, // Must not be named "a"
          bar_: 1, // Must not be named "b"
          a: 2,
          b: 3,
          __proto__: {}, // Always avoid mangling this
        }
      `,
    },
    mode: "passthrough",
  });
  itBundled("default/ManglePropsTypeScriptFeatures", {
    // GENERATED
    files: {
      "/parameter-properties.ts": /* ts */ `
        class Foo {
          constructor(
            public KEEP_FIELD: number,
            public MANGLE_FIELD_: number,
          ) {
          }
        }
  
        let foo = new Foo
        console.log(foo.KEEP_FIELD, foo.MANGLE_FIELD_)
      `,
      "/namespace-exports.ts": /* ts */ `
        namespace ns {
          export var MANGLE_VAR_ = 1
          export let MANGLE_LET_ = 2
          export const MANGLE_CONST_ = 3
          export let { NESTED_: { DESTRUCTURING_ } } = 4
          export function MANGLE_FUNCTION_() {}
          export class MANGLE_CLASS_ {}
          export namespace MANGLE_NAMESPACE_ { ; }
          export enum MANGLE_ENUM_ {}
  
          console.log({
            VAR: MANGLE_VAR_,
            LET: MANGLE_LET_,
            CONST: MANGLE_CONST_,
            DESTRUCTURING: DESTRUCTURING_,
            FUNCTION: MANGLE_FUNCTION_,
            CLASS: MANGLE_CLASS_,
            NAMESPACE: MANGLE_NAMESPACE_,
            ENUM: MANGLE_ENUM_,
          })
        }
  
        console.log({
          VAR: ns.MANGLE_VAR_,
          LET: ns.MANGLE_LET_,
          CONST: ns.MANGLE_CONST_,
          DESTRUCTURING: ns.DESTRUCTURING_,
          FUNCTION: ns.MANGLE_FUNCTION_,
          CLASS: ns.MANGLE_CLASS_,
          NAMESPACE: ns.MANGLE_NAMESPACE_,
          ENUM: ns.MANGLE_ENUM_,
        })
  
        namespace ns {
          console.log({
            VAR: MANGLE_VAR_,
            LET: MANGLE_LET_,
            CONST: MANGLE_CONST_,
            DESTRUCTURING: DESTRUCTURING_,
            FUNCTION: MANGLE_FUNCTION_,
            CLASS: MANGLE_CLASS_,
            NAMESPACE: MANGLE_NAMESPACE_,
            ENUM: MANGLE_ENUM_,
          })
        }
      `,
      "/enum-values.ts": /* ts */ `
        enum TopLevelNumber { foo_ = 0 }
        enum TopLevelString { bar_ = '' }
        console.log({
          foo: TopLevelNumber.foo_,
          bar: TopLevelString.bar_,
        })
  
        function fn() {
          enum NestedNumber { foo_ = 0 }
          enum NestedString { bar_ = '' }
          console.log({
            foo: TopLevelNumber.foo_,
            bar: TopLevelString.bar_,
          })
        }
      `,
    },
    entryPoints: ["/parameter-properties.ts", "/namespace-exports.ts", "/enum-values.ts"],
    mode: "passthrough",
  });
  itBundled("default/ManglePropsShorthand", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        // This should print as "({ y }) => ({ y })" not "({ y: y }) => ({ y: y })"
        export let yyyyy = ({ xxxxx }) => ({ xxxxx })
      `,
    },
    mangleProps: /x/,
    mode: "passthrough",
  });
  itBundled("default/ManglePropsNoShorthand", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        // This should print as "({ y }) => ({ y: y })" not "({ y: y }) => ({ y: y })"
        export let yyyyy = ({ xxxxx }) => ({ xxxxx })
      `,
    },
    mangleProps: /x/,
    minifyIdentifiers: true,
    mode: "passthrough",
  });
  itBundled("default/ManglePropsLoweredClassFields", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          foo_ = 123
          static bar_ = 234
        }
        Foo.bar_ = new Foo().foo_
      `,
    },
    mangleProps: /_$/,
    mode: "passthrough",
  });
  itBundled("default/ManglePropsSuperCall", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {}
        class Bar extends Foo {
          constructor() {
            super();
          }
        }
      `,
    },
    mode: "passthrough",
  });
  itBundled("default/MangleNoQuotedProps", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        x['_doNotMangleThis'];
        x?.['_doNotMangleThis'];
        x[y ? '_doNotMangleThis' : z];
        x?.[y ? '_doNotMangleThis' : z];
        x[y ? z : '_doNotMangleThis'];
        x?.[y ? z : '_doNotMangleThis'];
        ({ '_doNotMangleThis': x });
        (class { '_doNotMangleThis' = x });
        var { '_doNotMangleThis': x } = y;
        '_doNotMangleThis' in x;
        (y ? '_doNotMangleThis' : z) in x;
        (y ? z : '_doNotMangleThis') in x;
      `,
    },
    mangleProps: /_/,
    mode: "passthrough",
  });
  itBundled("default/MangleNoQuotedPropsMinifySyntax", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        x['_doNotMangleThis'];
        x?.['_doNotMangleThis'];
        x[y ? '_doNotMangleThis' : z];
        x?.[y ? '_doNotMangleThis' : z];
        x[y ? z : '_doNotMangleThis'];
        x?.[y ? z : '_doNotMangleThis'];
        ({ '_doNotMangleThis': x });
        (class { '_doNotMangleThis' = x });
        var { '_doNotMangleThis': x } = y;
        '_doNotMangleThis' in x;
        (y ? '_doNotMangleThis' : z) in x;
        (y ? z : '_doNotMangleThis') in x;
      `,
    },
    mangleProps: /_/,
    mangleQuoted: false,
    mode: "passthrough",
  });
  itBundled("default/MangleQuotedProps", {
    // GENERATED
    files: {
      "/keep.js": /* js */ `
        foo("_keepThisProperty");
        foo((x, "_keepThisProperty"));
        foo(x ? "_keepThisProperty" : "_keepThisPropertyToo");
        x[foo("_keepThisProperty")];
        x?.[foo("_keepThisProperty")];
        ({ [foo("_keepThisProperty")]: x });
        (class { [foo("_keepThisProperty")] = x });
        var { [foo("_keepThisProperty")]: x } = y;
        foo("_keepThisProperty") in x;
      `,
      "/mangle.js": /* js */ `
        x['_mangleThis'];
        x?.['_mangleThis'];
        x[y ? '_mangleThis' : z];
        x?.[y ? '_mangleThis' : z];
        x[y ? z : '_mangleThis'];
        x?.[y ? z : '_mangleThis'];
        x[y, '_mangleThis'];
        x?.[y, '_mangleThis'];
        ({ '_mangleThis': x });
        ({ ['_mangleThis']: x });
        ({ [(y, '_mangleThis')]: x });
        (class { '_mangleThis' = x });
        (class { ['_mangleThis'] = x });
        (class { [(y, '_mangleThis')] = x });
        var { '_mangleThis': x } = y;
        var { ['_mangleThis']: x } = y;
        var { [(z, '_mangleThis')]: x } = y;
        '_mangleThis' in x;
        (y ? '_mangleThis' : z) in x;
        (y ? z : '_mangleThis') in x;
        (y, '_mangleThis') in x;
      `,
    },
    entryPoints: ["/keep.js", "/mangle.js"],
    mangleProps: /_/,
    mode: "passthrough",
  });
  itBundled("default/MangleQuotedPropsMinifySyntax", {
    // GENERATED
    files: {
      "/keep.js": /* js */ `
        foo("_keepThisProperty");
        foo((x, "_keepThisProperty"));
        foo(x ? "_keepThisProperty" : "_keepThisPropertyToo");
        x[foo("_keepThisProperty")];
        x?.[foo("_keepThisProperty")];
        ({ [foo("_keepThisProperty")]: x });
        (class { [foo("_keepThisProperty")] = x });
        var { [foo("_keepThisProperty")]: x } = y;
        foo("_keepThisProperty") in x;
      `,
      "/mangle.js": /* js */ `
        x['_mangleThis'];
        x?.['_mangleThis'];
        x[y ? '_mangleThis' : z];
        x?.[y ? '_mangleThis' : z];
        x[y ? z : '_mangleThis'];
        x?.[y ? z : '_mangleThis'];
        x[y, '_mangleThis'];
        x?.[y, '_mangleThis'];
        ({ '_mangleThis': x });
        ({ ['_mangleThis']: x });
        ({ [(y, '_mangleThis')]: x });
        (class { '_mangleThis' = x });
        (class { ['_mangleThis'] = x });
        (class { [(y, '_mangleThis')] = x });
        var { '_mangleThis': x } = y;
        var { ['_mangleThis']: x } = y;
        var { [(z, '_mangleThis')]: x } = y;
        '_mangleThis' in x;
        (y ? '_mangleThis' : z) in x;
        (y ? z : '_mangleThis') in x;
        (y, '_mangleThis') in x;
      `,
    },
    entryPoints: ["/keep.js", "/mangle.js"],
    mangleProps: /_/,
    mangleQuoted: true,
    mode: "passthrough",
  });
  itBundled("default/IndirectRequireMessage", {
    // GENERATED
    files: {
      "/array.js": `let x = [require]`,
      "/assign.js": `require = x`,
      "/ident.js": `let x = require`,
      "/dot.js": `let x = require.cache`,
      "/index.js": `let x = require[cache]`,
    },
    entryPoints: ["/array.js", "/assign.js", "/dot.js", "/ident.js", "/index.js"],
    /* TODO FIX expectedScanLog: `array.js: DEBUG: Indirect calls to "require" will not be bundled
  assign.js: DEBUG: Indirect calls to "require" will not be bundled
  ident.js: DEBUG: Indirect calls to "require" will not be bundled
  `, */
  });
  itBundled("default/AmbiguousReexportMsg", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export * from './a'
        export * from './b'
        export * from './c'
      `,
      "/a.js": `export let a = 1, x = 2`,
      "/b.js": `export let b = 3; export { b as x }`,
      "/c.js": `export let c = 4, x = 5`,
    },
    /* TODO FIX expectedCompileLog: `DEBUG: Re-export of "x" in "entry.js" is ambiguous and has been removed
  a.js: NOTE: One definition of "x" comes from "a.js" here:
  b.js: NOTE: Another definition of "x" comes from "b.js" here:
  `, */
  });
  itBundled("default/NonDeterminismIssue2537", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        export function aap(noot: boolean, wim: number) {
          let mies = "teun"
          if (noot) {
            function vuur(v: number) {
              return v * 2
            }
            function schaap(s: number) {
              return s / 2
            }
            mies = vuur(wim) + schaap(wim)
          }
          return mies
        }
      `,
      "/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "alwaysStrict": true
          }
        }
      `,
    },
  });
  itBundled("default/MinifiedJSXPreserveWithObjectSpread", {
    // GENERATED
    files: {
      "/entry.jsx": /* jsx */ `
        const obj = {
          before,
          ...{ [key]: value },
          ...{ key: value },
          after,
        };
        <Foo
          before
          {...{ [key]: value }}
          {...{ key: value }}
          after
        />;
        <Bar
          {...{
            a,
            [b]: c,
            ...d,
            e,
          }}
        />;
      `,
    },
    minifySyntax: true,
  });
  itBundled("default/PackageAlias", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import "pkg1"
        import "pkg2/foo"
        import "./nested3"
        import "@scope/pkg4"
        import "@scope/pkg5/foo"
        import "@abs-path/pkg6"
        import "@abs-path/pkg7/foo"
        import "@scope-only/pkg8"
        import "slash/"
        import "prefix-foo"
        import "@scope/prefix-foo"
      `,
      "/nested3/index.js": `import "pkg3"`,
      "/nested3/node_modules/alias3/index.js": `test failure`,
      "/node_modules/alias1/index.js": `console.log(1)`,
      "/node_modules/alias2/foo.js": `console.log(2)`,
      "/node_modules/alias3/index.js": `console.log(3)`,
      "/node_modules/alias4/index.js": `console.log(4)`,
      "/node_modules/alias5/foo.js": `console.log(5)`,
      "/alias6/dir/index.js": `console.log(6)`,
      "/alias7/dir/foo/index.js": `console.log(7)`,
      "/alias8/dir/pkg8/index.js": `console.log(8)`,
      "/alias9/some/file.js": `console.log(9)`,
      "/node_modules/prefix-foo/index.js": `console.log(10)`,
      "/node_modules/@scope/prefix-foo/index.js": `console.log(11)`,
    },
  });
  itBundled("default/PackageAliasMatchLongest", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import "pkg"
        import "pkg/foo"
        import "pkg/foo/bar"
        import "pkg/foo/bar/baz"
        import "pkg/bar/baz"
        import "pkg/baz"
      `,
    },
    alias: {
      pkg: "alias/pkg",
      "pkg/foo": "alias/pkg_foo",
      "pkg/foo/bar": "alias/pkg_foo_bar",
    },
  });
  itBundled("default/ErrorsForAssertTypeJSON", {
    // GENERATED
    files: {
      "/js-entry.js": /* js */ `
        import all from './foo.json' assert { type: 'json' }
        import { default as def } from './foo.json' assert { type: 'json' }
        import { unused } from './foo.json' assert { type: 'json' }
        import { used } from './foo.json' assert { type: 'json' }
        import * as ns from './foo.json' assert { type: 'json' }
        use(used, ns.prop)
        export { exported } from './foo.json' assert { type: 'json' }
        import text from './foo.text' assert { type: 'json' }
        import file from './foo.file' assert { type: 'json' }
        import copy from './foo.copy' assert { type: 'json' }
      `,
      "/ts-entry.ts": /* ts */ `
        import all from './foo.json' assert { type: 'json' }
        import { default as def } from './foo.json' assert { type: 'json' }
        import { unused } from './foo.json' assert { type: 'json' }
        import { used } from './foo.json' assert { type: 'json' }
        import * as ns from './foo.json' assert { type: 'json' }
        use(used, ns.prop)
        export { exported } from './foo.json' assert { type: 'json' }
        import text from './foo.text' assert { type: 'json' }
        import file from './foo.file' assert { type: 'json' }
        import copy from './foo.copy' assert { type: 'json' }
      `,
      "/foo.json": `{}`,
      "/foo.text": `{}`,
      "/foo.file": `{}`,
      "/foo.copy": `{}`,
    },
    entryPoints: ["/js-entry.js", "/ts-entry.ts"],
    /* TODO FIX expectedScanLog: `js-entry.js: ERROR: Cannot use non-default import "unused" with a standard JSON module
  js-entry.js: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "unused" import (which is non-standard behavior).
  js-entry.js: ERROR: Cannot use non-default import "used" with a standard JSON module
  js-entry.js: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "used" import (which is non-standard behavior).
  js-entry.js: WARNING: Non-default import "prop" is undefined with a standard JSON module
  js-entry.js: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "prop" import (which is non-standard behavior).
  js-entry.js: ERROR: Cannot use non-default import "exported" with a standard JSON module
  js-entry.js: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "exported" import (which is non-standard behavior).
  js-entry.js: ERROR: The file "foo.text" was loaded with the "text" loader
  js-entry.js: NOTE: This import assertion requires the loader to be "json" instead:
  NOTE: You need to either reconfigure esbuild to ensure that the loader for this file is "json" or you need to remove this import assertion.
  js-entry.js: ERROR: The file "foo.file" was loaded with the "file" loader
  js-entry.js: NOTE: This import assertion requires the loader to be "json" instead:
  NOTE: You need to either reconfigure esbuild to ensure that the loader for this file is "json" or you need to remove this import assertion.
  ts-entry.ts: ERROR: Cannot use non-default import "used" with a standard JSON module
  ts-entry.ts: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "used" import (which is non-standard behavior).
  ts-entry.ts: WARNING: Non-default import "prop" is undefined with a standard JSON module
  ts-entry.ts: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "prop" import (which is non-standard behavior).
  ts-entry.ts: ERROR: Cannot use non-default import "exported" with a standard JSON module
  ts-entry.ts: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "exported" import (which is non-standard behavior).
  `, */
  });
  itBundled("default/OutputForAssertTypeJSON", {
    // GENERATED
    files: {
      "/js-entry.js": /* js */ `
        import all from './foo.json' assert { type: 'json' }
        import copy from './foo.copy' assert { type: 'json' }
        import { default as def } from './foo.json' assert { type: 'json' }
        import * as ns from './foo.json' assert { type: 'json' }
        use(all, copy, def, ns.prop)
        export { default } from './foo.json' assert { type: 'json' }
      `,
      "/ts-entry.ts": /* ts */ `
        import all from './foo.json' assert { type: 'json' }
        import copy from './foo.copy' assert { type: 'json' }
        import { default as def } from './foo.json' assert { type: 'json' }
        import { unused } from './foo.json' assert { type: 'json' }
        import * as ns from './foo.json' assert { type: 'json' }
        use(all, copy, def, ns.prop)
        export { default } from './foo.json' assert { type: 'json' }
      `,
      "/foo.json": `{}`,
      "/foo.copy": `{}`,
    },
    entryPoints: ["/js-entry.js", "/ts-entry.ts"],
    /* TODO FIX expectedScanLog: `js-entry.js: WARNING: Non-default import "prop" is undefined with a standard JSON module
  js-entry.js: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "prop" import (which is non-standard behavior).
  ts-entry.ts: WARNING: Non-default import "prop" is undefined with a standard JSON module
  ts-entry.ts: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "prop" import (which is non-standard behavior).
  `, */
  });
  itBundled("default/ExternalPackages", {
    // GENERATED
    files: {
      "/project/entry.js": /* js */ `
        import 'pkg1'
        import './file'
        import './node_modules/pkg2/index.js'
        import '#pkg3'
      `,
      "/project/package.json": /* json */ `
        {
        "imports": {
          "#pkg3": "./libs/pkg3.js"
        }
      }
      `,
      "/project/file.js": `console.log('file')`,
      "/project/node_modules/pkg2/index.js": `console.log('pkg2')`,
      "/project/libs/pkg3.js": `console.log('pkg3')`,
    },
  });
  itBundled("default/MetafileVariousCases", {
    // GENERATED
    files: {
      "/project/entry.js": /* js */ `
        import a from 'extern-esm'
        import b from './esm'
        import c from 'data:application/json,2'
        import d from './file.file'
        import e from './copy.copy'
        console.log(
          a,
          b,
          c,
          d,
          e,
          require('extern-cjs'),
          require('./cjs'),
          import('./dynamic'),
        )
        export let exported
      `,
      "/project/entry.css": /* css */ `
        @import "extern.css";
        a { background: url(inline.svg) }
        b { background: url(file.file) }
        c { background: url(copy.copy) }
        d { background: url(extern.png) }
      `,
      "/project/esm.js": `export default 1`,
      "/project/cjs.js": `module.exports = 4`,
      "/project/dynamic.js": `export default 5`,
      "/project/file.file": `file`,
      "/project/copy.copy": `copy`,
      "/project/inline.svg": `<svg/>`,
    },
    entryPoints: ["/project/entry.js", "/project/entry.css"],
    loader: {
      ".js": "js",
      ".css": "css",
      ".file": "file",
      ".copy": "copy",
      ".svg": "dataurl",
    },
    external: ["extern-esm", "extern-cjs", "extern.css", "extern.png"],
    metafile: true,
  });
  itBundled("default/MetafileNoBundle", {
    // GENERATED
    files: {
      "/project/entry.js": /* js */ `
        import a from 'pkg'
        import b from './file'
        console.log(
          a,
          b,
          require('pkg2'),
          require('./file2'),
          import('./dynamic'),
        )
        export let exported
      `,
      "/project/entry.css": /* css */ `
        @import "pkg";
        @import "./file";
        a { background: url(pkg2) }
        a { background: url(./file2) }
      `,
    },
    entryPoints: ["/project/entry.js", "/project/entry.css"],
    mode: "convertformat",
  });
  itBundled("default/MetafileVeryLongExternalPaths", {
    // GENERATED
    files: {
      "/project/bytesInOutput should be at least 99 (1).js": /* js */ `
        import a from './\` + strings.Repeat("1", 99) + \`.file'
        console.log(a)
      `,
      "/project/bytesInOutput should be at least 99 (2).js": /* js */ `
        import a from './\` + strings.Repeat("2", 99) + \`.copy'
        console.log(a)
      `,
      "/project/bytesInOutput should be at least 99 (3).js": `import('./\` + strings.Repeat("3", 99) + \`.js').then(console.log)`,
      "/project/bytesInOutput should be at least 99.css": `a { background: url(\` + strings.Repeat("4", 99) + \`.file) }`,
    },
    entryPoints: [
      "/project/bytesInOutput should be at least 99 (1).js",
      "/project/bytesInOutput should be at least 99 (2).js",
      "/project/bytesInOutput should be at least 99 (3).js",
      "/project/bytesInOutput should be at least 99.css",
    ],
    metafile: true,
    loader: {
      ".js": "js",
      ".css": "css",
      ".file": "file",
      ".copy": "copy",
    },
  });
  itBundled("default/CommentPreservation", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        console.log(
          import(/* before */ foo),
          import(/* before */ 'foo'),
          import(foo /* after */),
          import('foo' /* after */),
        )
  
        console.log(
          import('foo', /* before */ { assert: { type: 'json' } }),
          import('foo', { /* before */ assert: { type: 'json' } }),
          import('foo', { assert: /* before */ { type: 'json' } }),
          import('foo', { assert: { /* before */ type: 'json' } }),
          import('foo', { assert: { type: /* before */ 'json' } }),
          import('foo', { assert: { type: 'json' /* before */ } }),
          import('foo', { assert: { type: 'json' } /* before */ }),
          import('foo', { assert: { type: 'json' } } /* before */),
        )
  
        console.log(
          require(/* before */ foo),
          require(/* before */ 'foo'),
          require(foo /* after */),
          require('foo' /* after */),
        )
  
        console.log(
          require.resolve(/* before */ foo),
          require.resolve(/* before */ 'foo'),
          require.resolve(foo /* after */),
          require.resolve('foo' /* after */),
        )
  
        let [/* foo */] = [/* bar */];
        let [
          // foo
        ] = [
          // bar
        ];
        let [/*before*/ ...s] = [/*before*/ ...s]
        let [... /*before*/ s2] = [... /*before*/ s2]
  
        let { /* foo */ } = { /* bar */ };
        let {
          // foo
        } = {
          // bar
        };
        let { /*before*/ ...s3 } = { /*before*/ ...s3 }
        let { ... /*before*/ s4 } = { ... /*before*/ s4 }
  
        let [/* before */ x] = [/* before */ x];
        let [/* before */ x2 /* after */] = [/* before */ x2 /* after */];
        let [
          // before
          x3
          // after
        ] = [
          // before
          x3
          // after
        ];
  
        let { /* before */ y } = { /* before */ y };
        let { /* before */ y2 /* after */ } = { /* before */ y2 /* after */ };
        let {
          // before
          y3
          // after
        } = {
          // before
          y3
          // after
        };
        let { /* before */ [y4]: y4 } = { /* before */ [y4]: y4 };
        let { [/* before */ y5]: y5 } = { [/* before */ y5]: y5 };
        let { [y6 /* after */]: y6 } = { [y6 /* after */]: y6 };
  
        foo[/* before */ x] = foo[/* before */ x]
        foo[x /* after */] = foo[x /* after */]
  
        console.log(
          // before
          foo,
          /* comment before */
          bar,
          // comment after
        )
  
        console.log([
          // before
          foo,
          /* comment before */
          bar,
          // comment after
        ])
  
        console.log({
          // before
          foo,
          /* comment before */
          bar,
          // comment after
        })
  
        console.log(class {
          // before
          foo
          /* comment before */
          bar
          // comment after
        })
  
        console.log(
          () => { return /* foo */ null },
          () => { throw /* foo */ null },
          () => { return (/* foo */ null) + 1 },
          () => { throw (/* foo */ null) + 1 },
          () => {
            return (// foo
              null) + 1
          },
          () => {
            throw (// foo
              null) + 1
          },
        )
  
        console.log(
          /*a*/ a ? /*b*/ b : /*c*/ c,
          a /*a*/ ? b /*b*/ : c /*c*/,
        )
  
        for (/*foo*/a;;);
        for (;/*foo*/a;);
        for (;;/*foo*/a);
  
        for (/*foo*/a in b);
        for (a in /*foo*/b);
  
        for (/*foo*/a of b);
        for (a of /*foo*/b);
  
        if (/*foo*/a);
        with (/*foo*/a);
        while (/*foo*/a);
        do {} while (/*foo*/a);
        switch (/*foo*/a) {}
      `,
    },
    format: "cjs",
  });
  itBundled("default/CommentPreservationImportAssertions", {
    // GENERATED
    files: {
      "/entry.jsx": /* jsx */ `
        import 'foo' /* before */ assert { type: 'json' }
        import 'foo' assert /* before */ { type: 'json' }
        import 'foo' assert { /* before */ type: 'json' }
        import 'foo' assert { type: /* before */ 'json' }
        import 'foo' assert { type: 'json' /* before */ }
      `,
    },
  });
  itBundled("default/CommentPreservationTransformJSX", {
    // GENERATED
    files: {
      "/entry.jsx": /* jsx */ `
        console.log(
          <div x={/*before*/x} />,
          <div x={/*before*/'y'} />,
          <div x={/*before*/true} />,
          <div {/*before*/...x} />,
          <div>{/*before*/x}</div>,
          <>{/*before*/x}</>,
  
          // Comments on absent AST nodes
          <div>before{}after</div>,
          <div>before{/* comment 1 *//* comment 2 */}after</div>,
          <div>before{
            // comment 1
            // comment 2
          }after</div>,
          <>before{}after</>,
          <>before{/* comment 1 *//* comment 2 */}after</>,
          <>before{
            // comment 1
            // comment 2
          }after</>,
        )
      `,
    },
  });
  itBundled("default/CommentPreservationPreserveJSX", {
    // GENERATED
    files: {
      "/entry.jsx": /* jsx */ `
        console.log(
          <div x={/*before*/x} />,
          <div x={/*before*/'y'} />,
          <div x={/*before*/true} />,
          <div {/*before*/...x} />,
          <div>{/*before*/x}</div>,
          <>{/*before*/x}</>,
  
          // Comments on absent AST nodes
          <div>before{}after</div>,
          <div>before{/* comment 1 *//* comment 2 */}after</div>,
          <div>before{
            // comment 1
            // comment 2
          }after</div>,
          <>before{}after</>,
          <>before{/* comment 1 *//* comment 2 */}after</>,
          <>before{
            // comment 1
            // comment 2
          }after</>,
        )
      `,
    },
  });
  itBundled("default/ErrorMessageCrashStdinIssue2913", {
    // GENERATED
    files: {
      "/project/node_modules/fflate/package.json": `{ "main": "main.js" }`,
      "/project/node_modules/fflate/main.js": ``,
    },
    stdin: {
      contents: `import "node_modules/fflate"`,
      resolveDir: "/project",
    },
    platform: "neutral",
    /* TODO FIX expectedScanLog: `<stdin>: ERROR: Could not resolve "node_modules/fflate"
  NOTE: You can mark the path "node_modules/fflate" as external to exclude it from the bundle, which will remove this error.
  `, */
  });
});
