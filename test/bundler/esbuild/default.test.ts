import assert from "assert";
import { describe, expect } from "bun:test";
import { osSlashes } from "harness";
import path from "path";
import { dedent, ESBUILD_PATH, itBundled } from "../expectBundled";

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
    todo: true,
    onAfterBundle(api) {
      api.appendFile(
        "/out.js",
        dedent /* js */ `
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
    mode: "bundle",
    bundling: false,
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
      "/test.js": String.raw /* js */ `
        import { deepEqual } from 'node:assert';
        globalThis.deepEqual = deepEqual;
        await import ('./out.js');
        if (!globalThis.aWasImported) {
          throw new Error('"import \'./a\'" was tree-shaken when it should not have been.')
        }
        if (!globalThis.bWasImported) {
          throw new Error('"import {} from \'./b\'" was tree-shaken when it should not have been.')
        }
      `,
    },
    run: {
      file: "/test.js",
    },
    bundling: false,
  } as const;
  itBundled("default/ImportFormsWithNoBundle", {
    ...importFormsConfig,
  } as any);
  itBundled("default/ImportFormsWithMinifyIdentifiersAndNoBundle", {
    ...importFormsConfig,
    minifyIdentifiers: true,
  } as any);
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
        new commonjs.C();
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
        globalThis.assert = require('assert');
        if (typeof assert.deepEqual !== 'function') {
          throw new Error('assert.deepEqual is not a function');
        }
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
    todo: true, // TODO: low priority, missing a couple errors.
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
  // itBundled("default/JSXImportsCommonJS", {
  //   notImplemented: true, // jsx in bun is too different to esbuild
  //   files: {
  //     "/entry.jsx": /* jsx */ `
  //       import {elem, frag} from './custom-react'
  //       console.log(<div/>, <>fragment</>)
  //     `,
  //     "/custom-react.js": /* js */ `
  //       module.exports = {
  //         elem: (...args) => console.log('elem', ...args),
  //         frag: 'frag',
  //       };
  //     `,
  //   },
  //   jsx: {
  //     factory: "elem",
  //     fragment: "frag",
  //     automaticRuntime: true,
  //   },
  //   run: {
  //     stdout: `
  //       elem div null
  //       elem frag null fragment
  //       undefined undefined
  //     `,
  //   },
  // });
  // itBundled("default/JSXImportsES6", {
  //   notImplemented: true, // jsx in bun is too different to esbuild
  //   files: {
  //     "/entry.jsx": /* jsx */ `
  //       import {elem, frag} from './custom-react'
  //       console.log(<div/>, <>fragment</>)
  //     `,
  //     "/custom-react.js": /* js */ `
  //       export function elem(...args) {
  //         console.log('elem', ...args)
  //       }
  //       export const frag = "frag";
  //     `,
  //   },
  //   jsx: {
  //     factory: "elem",
  //     fragment: "frag",
  //   },
  //   run: {
  //     stdout: `
  //       elem div null
  //       elem frag null fragment
  //       undefined undefined
  //     `,
  //   },
  // });
  // note: esbuild treats .js as non-jsx
  // bun treats js as jsx
  // so the extension has to be .mjs or .cjs to disable JSX.
  itBundled("default/JSXSyntaxInJS", {
    files: {
      "/entry.mjs": `console.log(<div/>)`,
      "/entry.cjs": `console.log(<div/>)`,
    },
    bundleErrors: {
      // TODO: this could be a nicer error
      "/entry.mjs": [`Unexpected <`],
      "/entry.cjs": [`Unexpected <`],
    },
    outdir: "/out",
    entryPoints: ["/entry.mjs", "/entry.cjs"],
  });
  // itBundled("default/JSXConstantFragments", {
  //   notImplemented: true, // jsx in bun is too different to esbuild
  //   files: {
  //     "/entry.js": /* js */ `
  //       import './default'
  //       import './null'
  //       import './boolean'
  //       import './number'
  //       import './string-single-empty'
  //       import './string-double-empty'
  //       import './string-single-punctuation'
  //       import './string-double-punctuation'
  //       import './string-template'
  //     `,
  //     "/default.jsx": `console.log(<></>)`,
  //     "/null.jsx": `console.log(<></>) // @jsxFrag null`,
  //     "/boolean.jsx": `console.log(<></>) // @jsxFrag true`,
  //     "/number.jsx": `console.log(<></>) // @jsxFrag 123`,
  //     "/string-single-empty.jsx": `console.log(<></>) // @jsxFrag ''`,
  //     "/string-double-empty.jsx": `console.log(<></>) // @jsxFrag ""`,
  //     "/string-single-punctuation.jsx": `console.log(<></>) // @jsxFrag '['`,
  //     "/string-double-punctuation.jsx": `console.log(<></>) // @jsxFrag "["`,
  //     "/string-template.jsx": "console.log(<></>) // @jsxFrag ``",

  //     "/test.js": /* js */ `
  //       globalThis.React = {
  //         createElement: (x) => x,
  //         Fragment: 'frag'
  //       }
  //       await import('./out.js');
  //     `,
  //   },
  //   jsx: {
  //     fragment: "']'",
  //   },
  //   bundleWarnings: {
  //     "/string-template.jsx": ["Invalid JSX fragment: ``"],
  //   },
  //   run: {
  //     file: "/test.js",
  //     stdout: "]\nnull\ntrue\n123\n\n\n[\n[\n]",
  //   },
  // });
  // itBundled("default/JSXAutomaticImportsCommonJS", {
  //   files: {
  //     "/entry.jsx": /* jsx */ `
  //       import {jsx, Fragment} from './custom-react'
  //       console.log(<div jsx={jsx}/>, <><Fragment/></>)
  //     `,
  //     "/custom-react.js": `module.exports = { jsx: 'jsx', Fragment: 'fragment2' }`,
  //   },
  //   jsx: {
  //     automaticRuntime: true,
  //   },
  //   external: ["react"],
  //   run: {
  //     stdout: `
  //       <div jsx="jsx" /> <>
  //         <fragment2 />
  //       </>
  //     `,
  //   },
  // });
  // itBundled("default/JSXAutomaticImportsES6", {
  //   files: {
  //     "/entry.jsx": /* jsx */ `
  //       import {jsx, Fragment} from './custom-react'
  //       console.log(<div jsx={jsx}/>, <><Fragment/></>)
  //     `,
  //     "/custom-react.js": /* js */ `
  //       export const jsx = 'jsx function'
  //       export const Fragment = 'fragment'
  //     `,
  //   },
  //   jsx: {
  //     automaticRuntime: true,
  //   },
  //   external: ["react"],
  //   run: {
  //     stdout: `
  //       <div jsx="jsx function" /> <>
  //         <fragment />
  //       </>
  //     `,
  //   },
  // });
  // itBundled("default/JSXAutomaticSyntaxInJS", {
  //   files: {
  //     "/entry.mjs": `console.log(<div/>)`,
  //   },
  //   jsx: {
  //     automaticRuntime: true,
  //   },
  //   external: ["react"],
  //   bundleErrors: {
  //     // TODO: this could be a nicer error
  //     "/entry.mjs": [`Unexpected <`],
  //   },
  // });
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
        `No matching export in "foo.js" for import "default"`,
        `No matching export in "foo.js" for import "y"`,
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
        `No matching export in "foo.js" for import "default"`,
        `No matching export in "foo.js" for import "y"`,
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
    todo: true,
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
      "/foo.js": [`No matching export in "bar.js" for import "nope"`],
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
        console.log(require('./b').x)
        console.log(require(\`./b\`).x)
      `,
      "/b.js": `exports.x = 123`,
    },
    run: {
      stdout: "123\n123",
    },
  });
  itBundled("default/DynamicImportWithTemplateIIFE", {
    files: {
      "/a.js": `
        import('./b').then(ns => console.log(ns.x))
        import(\`./b\`).then(ns => console.log(ns.x))
      `,
      "/b.js": `exports.x = 123`,
    },
    format: "iife",
    run: {
      stdout: "123\n123",
    },
  });
  itBundled("default/RequireAndDynamicImportInvalidTemplate", {
    files: {
      "/entry.cjs": `
        require(tag\`./b\`)
        require(\`./\${b}\`)
  
        try {
          require(tag\`./b\`)
          require(\`./\${b}\`)
        } catch {
        }
  
        (async () => {
          import(tag\`./b\`)
          import(\`./\${b}\`)
          await import(tag\`./b\`)
          await import(\`./\${b}\`)
  
          try {
            import(tag\`./b\`)
            import(\`./\${b}\`)
            await import(tag\`./b\`)
            await import(\`./\${b}\`)
          } catch {
          }
        })()
      `,

      "/test.js": `
        globalThis.tag = () => './c.js';
        globalThis.b = 'c.js';
        import('./out');
      `,
      "/c.js": `console.log("c")`,
    },
    run: {
      file: "/test.js",
      stdout: "c",
    },
  });
  itBundled("default/DynamicImportWithExpressionCJS", {
    files: {
      "/a.js": /* js */ `
        import('foo')
        import(foo())
      `,
    },
    format: "cjs",
    bundling: false,
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('import("foo")');
      api.expectFile("/out.js").toContain("import(foo())");
    },
  });
  itBundled("default/MinifiedDynamicImportWithExpressionCJS", {
    files: {
      "/a.js": /* js */ `
        import('foo')
        import(foo())
      `,
    },
    format: "cjs",
    bundling: false,
    minifyWhitespace: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('import("foo")');
      api.expectFile("/out.js").toContain("import(foo())");
    },
  });
  itBundled("default/ConditionalRequireResolve", {
    files: {
      "/a.js": /* js */ `
        require.resolve(x ? 'a' : y ? 'b' : 'c')
        require.resolve(v ? y ? 'a' : 'b' : c)
      `,
    },
    target: "node",
    format: "cjs",
    // esbuild seems to not need externals for require.resolve, but it should be specified
    external: ["a", "b", "c"],
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('x ? require.resolve("a") : y ? require.resolve("b") : require.resolve("c")');
      api.expectFile("/out.js").toContain('v ? y ? require.resolve("a") : require.resolve("b") : require.resolve(c)');
    },
  });
  itBundled("default/ConditionalRequire", {
    files: {
      "/a.js": /* js */ `
        const x = process.argv[2] === 'true';
        const y = process.argv[3] === 'true';
        const c = process.argv[4];
        
        console.log(require(x ? 'a' : y ? './b' : 'c').foo)
        console.log(require(x ? y ? 'a' : './b' : c).foo)
      `,
      "/b.js": `exports.foo = 213`,
    },
    external: ["a", "c"],
    runtimeFiles: {
      "/b.js": `throw new Error("Did not bundle b.js")`,
      "/c.js": `exports.foo = 532`,
      "/node_modules/a/index.js": `exports.foo = 852`,
      "/node_modules/a/package.json": `{"main": "index.js", "name": "a"}`,
      "/node_modules/c/index.js": `exports.foo = 123`,
      "/node_modules/c/package.json": `{"main": "index.js", "name": "c"}`,
    },
    target: "node",
    run: [
      {
        args: ["true", "true", "./c.js"],
        stdout: "852\n852",
      },
      {
        args: ["true", "false", "./c.js"],
        stdout: "852\n213",
      },
      {
        args: ["false", "true", "./c.js"],
        stdout: "213\n532",
      },
      {
        args: ["false", "false", "./c.js"],
        stdout: "123\n532",
      },
    ],
  });
  itBundled("default/ConditionalImport", {
    files: {
      "/a.js": `console.log('a', (await import(x ? 'a' : y ? './import' : 'c')).foo)`,
      "/b.js": `console.log('b', (await import(x ? y ? 'a' : './import' : c)).foo)`,
      "/import.js": `exports.foo = 213`,
    },
    runtimeFiles: {
      "/node_modules/a/index.js": "export const foo = 'a'",
      "/node_modules/b/index.js": "export const foo = 'b'",
      "/node_modules/c/index.js": "export const foo = 'c'",
      "/node_modules/d/index.js": "export const foo = 'd'",

      "/test.js": /* js */ `
        globalThis.x = process.argv[2] === 'true';
        globalThis.y = process.argv[3] === 'true';
        globalThis.c = process.argv[4];
        await import('./out/a');
        await import('./out/b');
      `,
    },
    entryNaming: "[name].[ext]",
    entryPoints: ["/a.js", "/b.js"],
    external: ["a", "b", "c"],
    run: [
      {
        file: "/test.js",
        args: ["true", "true", "d"],
        stdout: "a a\nb a",
      },
      {
        file: "/test.js",
        args: ["true", "false", "d"],
        stdout: "a a\nb 213",
      },
      {
        file: "/test.js",
        args: ["false", "true", "d"],
        stdout: "a 213\nb d",
      },
      {
        file: "/test.js",
        args: ["false", "false", "d"],
        stdout: "a c\nb d",
      },
    ],
  });
  itBundled("default/RequireBadArgumentCount", {
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
    onAfterBundle(api) {
      api.prependFile(
        "/out.js",
        /* js */ `
          const require = (...args) => console.log('require:' + args.join(','));
        `,
      );
    },
    run: {
      stdout: `
        require:
        require:a,b
        require:
        require:a,b
      `,
    },
  });
  itBundled("default/RequireJson", {
    files: {
      "/entry.js": `console.log(JSON.stringify(require('./test.json')))`,
      "/test.json": /* json */ `
        {
          "a": true,
          "b": 123,
          "c": [null]
        }
      `,
    },
    run: {
      stdout: '{"a":true,"b":123,"c":[null]}',
    },
  });
  itBundled("default/RequireTxt", {
    files: {
      "/entry.js": `console.log(require('./test.txt'))`,
      "/test.txt": `This is a\` test.`,
    },
    run: {
      stdout: "This is a` test.",
    },
  });
  itBundled("default/RequireBadExtension", {
    todo: true,
    files: {
      "/entry.js": `console.log(require('./test.bad'))`,
      "/test.bad": `This is a test.`,
    },
    run: {
      partialStdout: "/test.bad",
    },
  });
  itBundled("default/FalseRequire", {
    files: {
      "/entry.js": `(require => require('./test.txt'))(console.log)`,
      "/test.txt": `Failed.`,
    },
    run: {
      stdout: "./test.txt",
    },
  });
  itBundled("default/RequireWithCallInsideTry", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        try {
          const supportsColor = require('not-supports-color'); // bun overrides supports-color
          exports.colors = false;
          if (supportsColor && (supportsColor.stderr || supportsColor).level >= 2) {
            exports.colors = [];
          }
        } catch (error) {
          exports.colors = 'it threw'
        }
      `,
    },
    runtimeFiles: {
      "/test1.js": /* js */ `
        globalThis.requireThrows = false;
        import assert from 'assert';
        assert.deepEqual((await import('./out')).default, { colors: [] })
      `,
      "/test2.js": /* js */ `
        globalThis.requireThrows = true;
        import assert from 'assert';
        assert.deepEqual((await import('./out')).default, { colors: 'it threw' })
      `,
      "/node_modules/not-supports-color/index.js": /* js */ `
        if (requireThrows) {
          throw new Error('This should have been caught!');
        }
        module.exports = { stderr: { level: 9001 } }
      `,
    },
    run: [{ file: "/test1.js" }, { file: "/test2.js" }],
  });
  itBundled("default/RequirePropertyAccessCommonJS", {
    files: {
      "/entry.js": /* js */ `
        // These shouldn't warn since the format is CommonJS
        console.log(Object.keys(require.cache))
        console.log(Object.keys(require.extensions))
        delete require.cache['fs']
        delete require.extensions['.json']
      `,
    },
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      api.prependFile(
        "/out.js",
        /* js */ `
          const require = { cache: { fs: 'hello' }, extensions: { '.json': 'json' } };
        `,
      );
    },
    run: {
      stdout: '[ "fs" ]\n[ ".json" ]',
    },
  });
  itBundled("default/AwaitImportInsideTry", {
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
    run: true,
  });
  itBundled("default/ImportInsideTry", {
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
    bundleErrors: {
      "/entry.js": [`Could not resolve: "nope1". Maybe you need to "bun install"?`],
    },
  });
  itBundled("default/ImportThenCatch", {
    files: {
      "/entry.js": /* js */ `
        import(name).then(pass, fail)
        import(name).then(pass).catch(fail)
        import(name).catch(fail)
      `,
    },
    onAfterBundle(api) {
      // Define pass, fail, and replace `import` with a mock function. This allows for a single run
      // and no reliance on any `import` calls, since bundler should have left it alone anyways.
      const content = api.readFile("/out.js");
      api.writeFile(
        "/out.js",
        dedent`
          const pass = 'pass';
          const fail = 'fail';
          const _fn = (name) => (...args) => {
            console.log(name, ...args);
            return { then: _fn('then'), "catch": _fn('catch') };
          };
          const _import = _fn('import');
        ` + content.replace(/import\(name\)/g, "_import()"),
      );
    },
    run: {
      stdout: "import\nthen pass fail\nimport\nthen pass\ncatch fail\nimport\ncatch fail",
    },
  });
  itBundled("default/SourceMap", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {bar} from './bar'
        function foo() { bar() }
        foo()
      `,
      "/Users/user/project/src/bar.js": `export function bar() { console.log('hi') }`,
    },
    outdir: "/Users/user/project/out",
    sourceMap: "external",
    onAfterBundle(api) {
      const json = JSON.parse(api.readFile("/Users/user/project/out/entry.js.map"));
      api.expectFile("/Users/user/project/out/entry.js").not.toContain(`//# sourceMappingURL`);
      api.expectFile("/Users/user/project/out/entry.js").toContain(`//# debugId=${json.debugId}`);
      // see src/sourcemap/sourcemap.zig DebugIDFormatter for more info
      expect(json.debugId).toMatch(/^[A-F0-9]{32}$/);
      expect(json.debugId.endsWith("64756e2164756e21"));
    },
    run: {
      stdout: "hi",
    },
  });
  itBundled("default/SourceMapLinked", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {bar} from './bar'
        function foo() { bar() }
        foo()
      `,
      "/Users/user/project/src/bar.js": `export function bar() { console.log('hi') }`,
    },
    outdir: "/Users/user/project/out",
    sourceMap: "linked",
    onAfterBundle(api) {
      const json = JSON.parse(api.readFile("/Users/user/project/out/entry.js.map"));
      api.expectFile("/Users/user/project/out/entry.js").toContain(`//# sourceMappingURL=entry.js.map`);
      api.expectFile("/Users/user/project/out/entry.js").toContain(`//# debugId=${json.debugId}`);
      // see src/sourcemap/sourcemap.zig DebugIDFormatter for more info
      expect(json.debugId).toMatch(/^[A-F0-9]{32}$/);
      expect(json.debugId.endsWith("64756e2164756e21"));
    },
    run: {
      stdout: "hi",
    },
  });
  itBundled("default/SourceMapInline", {
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import {bar} from './bar'
        function foo() { bar() }
        foo()
      `,
      "/Users/user/project/src/bar.js": `export function bar() { console.log('hi') }`,
    },
    outdir: "/Users/user/project/out",
    sourceMap: "inline",
    onAfterBundle(api) {
      api
        .expectFile("/Users/user/project/out/entry.js")
        .toContain(`//# sourceMappingURL=data:application/json;base64,`);
    },
    run: {
      stdout: "hi",
    },
  });
  // This test covers a bug where a "var" in a nested scope did not correctly
  // bind with references to that symbol in sibling scopes. Instead, the
  // references were incorrectly considered to be unbound even though the symbol
  // should be hoisted. This caused the renamer to name them different things to
  // avoid a collision, which changed the meaning of the code.
  itBundled("default/NestedScopeBug", {
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
    run: true,
  });
  itBundled("default/HashbangBundle", {
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
    onAfterBundle(api) {
      assert(api.readFile("/out.js").startsWith("#!/usr/bin/env a"), "hashbang exists on bundle");
    },
  });
  itBundled("default/HashbangBannerUseStrictOrder", {
    files: {
      "/entry.js": /* js */ `
        #! in file
        'use strict'
        foo()
      `,
    },
    banner: "#! from banner",
    onAfterBundle(api) {
      assert(api.readFile("/out.js").startsWith("#! in file"), "hashbang from banner does not override file hashbang");
    },
  });
  itBundled("default/RequireFSBrowser", {
    files: {
      "/entry.js": `console.log(require('fs'))`,
    },
    target: "browser",
    run: {
      stdout: "[Function]",
    },
  });
  itBundled("default/RequireFSNode", {
    files: {
      "/entry.js": `console.log('existsSync' in require('fs'))`,
    },
    format: "cjs",
    target: "node",
    run: {
      stdout: "true",
    },
  });
  itBundled("default/RequireFSNodeMinify", {
    files: {
      "/entry.js": `console.log('existsSync' in require('fs'))`,
    },
    minifyWhitespace: true,
    format: "cjs",
    target: "node",
    run: {
      stdout: "true",
    },
  });
  itBundled("default/ImportFSBrowser", {
    files: {
      "/entry.js": /* js */ `
        import 'fs'
        import * as fs from 'fs'
        import defaultValue from 'fs'
        import {readFileSync} from 'fs'
        console.log(fs, readFileSync, defaultValue)
      `,
    },
    run: {
      stdout: "[Function: fs] undefined undefined",
    },
    target: "browser",
  });
  itBundled("default/ImportFSNodeCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import 'fs'
        import * as fs from 'fs'
        import defaultValue from 'fs'
        import {readFileSync} from 'fs'
        console.log('writeFileSync' in fs, readFileSync, 'writeFileSync' in defaultValue)
      `,
    },
    target: "bun",
    format: "cjs",
    run: {
      stdout: "true [Function: readFileSync] true",
    },
  });
  itBundled("default/ImportFSNodeES6", {
    files: {
      "/entry.js": /* js */ `
        import 'fs'
        import * as fs from 'fs'
        import defaultValue from 'fs'
        import {readFileSync} from 'fs'
        console.log('writeFileSync' in fs, readFileSync, 'writeFileSync' in defaultValue)
      `,
    },
    target: "node",
    run: {
      stdout: "true [Function: readFileSync] true",
    },
  });
  itBundled("default/ExportFSBrowser", {
    files: {
      "/entry.js": /* js */ `
        export * as fs from 'fs'
        export {readFileSync} from 'fs'
      `,
    },
    target: "browser",
    run: {
      file: "out.js",
    },
  });
  itBundled("default/ExportFSNode", {
    files: {
      "/entry.js": /* js */ `
        export * as fs from 'fs'
        export {readFileSync} from 'fs'
      `,

      "/test.js": /* js */ `
        import fs from "fs";
        import assert from "assert";
        import * as module from './out.js';
        assert(module.fs.default === fs, 'export * as fs from "fs"; works')
        assert(module.fs.default.readFileSync === fs.readFileSync, 'export {readFileSync} from "fs"; works')
      `,
    },
    target: "node",
    run: {
      file: "/test.js",
    },
  });
  itBundled("default/ReExportFSNode", {
    files: {
      "/entry.js": /* js */ `
        export {fs as f} from './foo'
        export {readFileSync as rfs} from './foo'
      `,
      "/foo.js": /* js */ `
        export * as fs from 'fs'
        export {readFileSync} from 'fs'
      `,

      "/test.js": /* js */ `
        import * as fs from "fs";
        import assert from "assert";
        import * as module from './out.js';
        assert(module.f.default === fs.default, 'export {fs as f} works')
        assert(module.rfs === fs.readFileSync, 'export {rfs} works')
      `,
    },
    target: "node",
    run: {
      file: "/test.js",
    },
  });
  itBundled("default/ExportFSNodeInCommonJSModule", {
    files: {
      "/entry.js": /* js */ `
        import * as fs from 'fs'
        import {readFileSync} from 'fs'
        exports.fs = fs
        exports.readFileSync = readFileSync
        exports.foo = 123
      `,

      "/test.js": /* js */ `
        import * as fs from "fs";
        import assert from "assert";
        import * as mod from './out.js';
        assert(mod.fs === fs, 'exports.fs')
        assert(mod.readFileSync === fs.readFileSync, 'exports.readFileSync')
        assert(mod.foo === 123, 'exports.foo')
      `,
    },
    target: "node",
    run: {
      file: "/test.js",
    },
  });
  itBundled("default/ExportWildcardFSNodeES6", {
    files: {
      "/entry.js": `export * from 'fs'`,
      "/test.js": /* js */ `
        import assert from 'assert';
        import * as fs from 'fs';
        import * as fs2 from './out.js';
        assert(fs, fs2);
      `,
    },
    format: "esm",
    target: "node",
    run: {
      file: "/test.js",
    },
  });
  itBundled("default/ExportWildcardFSNodeCommonJS", {
    files: {
      "/entry.js": `export * from 'fs'`,
      "/test.js": /* js */ `
        import assert from 'assert';
        import * as fs from 'fs';
        import * as fs2 from './out.js';
        assert(fs, fs2);
      `,
    },
    format: "cjs",
    target: "node",
    run: {
      file: "/test.js",
    },
  });
  itBundled("default/MinifiedBundleES6", {
    files: {
      "/entry.js": /* js */ `
        import {foo} from './a'
        console.log(foo())
      `,
      "/a.js": /* js */ `
        export function foo() {
          console.log('call');
          return 123
        }
        foo()
      `,
    },
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    run: {
      stdout: `
        call
        call
        123
      `,
    },
  });
  itBundled("default/MinifiedBundleCommonJS", {
    files: {
      "/entry.js": /* js */ `
        const {foo} = require('./a')
        console.log(foo(), JSON.stringify(require('./j.json')))
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
    run: {
      stdout: '123 {"test":true}',
    },
  });
  itBundled("default/MinifiedBundleEndingWithImportantSemicolon", {
    files: {
      "/entry.js": `while(foo()); // This semicolon must not be stripped`,

      "/test.js": /* js */ `
        let i = 0;
        globalThis.foo = () => {
          console.log(i++);
          return i === 1;
        };
        await import('./out.js')
      `,
    },
    minifyWhitespace: true,
    format: "iife",
    run: {
      file: "/test.js",
      stdout: "0\n1",
    },
  });
  itBundled("default/RuntimeNameCollisionNoBundle", {
    files: {
      "/entry.js": /* js */ `
        function __require() { return 123 }
        console.log(__require(), typeof (require('fs')))
      `,
    },
    bundling: false,
    target: "bun",
    run: {
      stdout: "123 object",
    },
  });
  itBundled("default/TopLevelReturnForbiddenImport", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        console.log('A');
        return
        console.log('B');
        import 'foo'
      `,
    },
    external: ["foo"],
    runtimeFiles: {
      "/node_modules/foo/index.js": "console.log('C')",
    },
    run: {
      stdout: "C\nA",
    },
  });
  itBundled("default/TopLevelReturnForbiddenImportAndModuleExports", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        module.exports.foo = 123
        return
        import 'foo'
      `,
    },
    external: ["foo"],
  });
  itBundled("default/TopLevelReturnForbiddenExport", {
    files: {
      "/entry.js": /* js */ `
        return
        export var foo
      `,
    },
    bundling: false,
    bundleErrors: {
      "/entry.js": ["Top-level return cannot be used inside an ECMAScript module"],
    },
  });
  itBundled("default/TopLevelReturnForbiddenTLA", {
    files: {
      "/entry.js": `return await foo`,
    },
    bundling: false,
    bundleErrors: {
      "/entry.js": ["Top-level return cannot be used inside an ECMAScript module"],
    },
  });
  itBundled("default/CircularTLADependency", {
    files: {
      "/entry.js": /* js */ `
        const { A } = await import('./a.js');
        console.log(A);
      `,
      "/a.js": /* js */ `
        import { B } from './b.js';
        export const A = 'hi';
      `,
      "/b.js": /* js */ `
        import { A } from './a.js';

        // TLA that should mark the wrapper closure for a.js as async
        await 1;

        export const B = 'hello';
      `,
    },
    run: {
      stdout: "hi\n",
    },
  });
  itBundled("default/ThisOutsideFunctionRenamedToExports", {
    files: {
      "/entry.js": /* js */ `
        console.log(this)
        console.log((x = this) => this)
        console.log({x: this})
        console.log(class extends this.foo {})
        console.log(class { [this.foo] })
        console.log(class { [this.foo]() {} })
        console.log(class { static [this.foo] })
        console.log(class { static [this.foo]() {} })
      `,
    },
    onAfterBundle(api) {
      if (api.readFile("/out.js").includes("this")) {
        throw new Error("All cases of `this` should have been rewritten to `exports`");
      }
    },
  });
  itBundled("default/ThisOutsideFunctionNotRenamed", {
    files: {
      "/entry.js": /* js */ `
        class C1 { foo = this };
        class C2 { foo() { return this } };
        class C3 { static foo = this };
        class C4 { static foo() { return this } };

        const c1 = new C1();
        const c2 = new C2();
        globalThis.assert(c1 === c1.foo, 'c1.foo');
        globalThis.assert(c2 === c2.foo(), 'c2.foo()');
        globalThis.assert(C3.foo === C3, 'C3.foo');
        globalThis.assert(C4.foo() === C4, 'C4.foo()');
      `,

      "/test.js": /* js */ `
        globalThis.assert = (await import('assert')).default;
        import('./out.js')
      `,
    },
    run: {
      file: "/test.js",
    },
  });
  itBundled("default/ThisInsideFunction", {
    files: {
      "/entry.js": /* js */ `
        function foo(x = this) { return [x, this]; }
        const objFoo = {
          foo(x = this) { return [x, this]; }
        }
        class Foo {
          x = this
          static z = 456;
          static y = this.z;
          foo(x = this) { return [x, this]; }
          static bar(x = this) { return [x, this]; }
        }

        assert.deepEqual(foo('bun'), ['bun', undefined]);
        assert.deepEqual(foo.call('this'), ['this', 'this']);
        assert.deepEqual(foo.call('this', 'bun'), ['bun', 'this']);
        assert.deepEqual(objFoo.foo('bun'), ['bun', objFoo]);
        assert.deepEqual(objFoo.foo(), [objFoo, objFoo]);
        const fooInstance = new Foo();
        assert(fooInstance.x === fooInstance, 'Foo#x');
        assert(Foo.y === 456, 'Foo.y');
        assert.deepEqual(Foo.bar('bun'), ['bun', Foo]);
        assert.deepEqual(Foo.bar(), [Foo, Foo]);
        assert.deepEqual(fooInstance.foo(), [fooInstance, fooInstance]);
        assert.deepEqual(fooInstance.foo('bun'), ['bun', fooInstance]);

        if (nested) {
          function bar(x = this) { return [x, this]; }
          const objBar = {
            foo(x = this) { return [x, this]; }
          }
          class Bar {
            x = this
            static z = 456;
            static y = this.z
            foo(x = this) { return [x, this]; }
            static bar(x = this) { return [x, this]; }
          }
          
          assert.deepEqual(bar('bun'), ['bun', undefined]);
          assert.deepEqual(bar.call('this'), ['this', 'this']);
          assert.deepEqual(bar.call('this', 'bun'), ['bun', 'this']);
          assert.deepEqual(objBar.foo('bun'), ['bun', objBar]);
          assert.deepEqual(objBar.foo(), [objBar, objBar]);
          const barInstance = new Bar();
          assert(barInstance.x === barInstance, 'Bar#x');
          assert(Bar.y === 456, 'Bar.y');
          assert.deepEqual(Bar.bar('bun'), ['bun', Bar]);
          assert.deepEqual(Bar.bar(), [Bar, Bar]);
          assert.deepEqual(barInstance.foo(), [barInstance, barInstance]);
          assert.deepEqual(barInstance.foo('bun'), ['bun', barInstance]);
        }
      `,

      "/test.js": /* js */ `
        globalThis.nested = true;
        globalThis.assert = (await import('assert')).default;
        import('./out')
      `,
    },
    run: {
      file: "/test.js",
    },
  });
  itBundled("default/ThisWithES6Syntax", {
    todo: true,
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
      "/cjs.js": `console.log("cjs.js:",JSON.stringify(this))`,
      "/es6-import-stmt.js": `import './dummy'; console.log("es6-import-stmt.js:",JSON.stringify(this))`,
      "/es6-import-assign.ts": `import x = require('./dummy'); console.log("es6-import-assign.ts:",JSON.stringify(this))`,
      "/es6-import-dynamic.js": `import('./dummy'); console.log("es6-import-dynamic.js:",JSON.stringify(this))`,
      "/es6-import-meta.js": `import.meta; console.log("es6-import-meta.js:",JSON.stringify(this))`,
      "/es6-expr-import-dynamic.js": `(import('./dummy')); console.log("es6-expr-import-dynamic.js:",JSON.stringify(this))`,
      "/es6-expr-import-meta.js": `(import.meta); console.log("es6-expr-import-meta.js:",JSON.stringify(this))`,
      "/es6-export-variable.js": `export const foo = 123; console.log("es6-export-variable.js:",JSON.stringify(this))`,
      "/es6-export-function.js": `export function foo() {} console.log("es6-export-function.js:",JSON.stringify(this))`,
      "/es6-export-async-function.js": `export async function foo() {} console.log("es6-export-async-function.js:",JSON.stringify(this))`,
      "/es6-export-enum.ts": `export enum Foo {} console.log("es6-export-enum.ts:",JSON.stringify(this))`,
      "/es6-export-const-enum.ts": `export const enum Foo {} console.log("es6-export-const-enum.ts:",JSON.stringify(this))`,
      "/es6-export-module.ts": `export module Foo {} console.log("es6-export-module.ts:",JSON.stringify(this))`,
      "/es6-export-namespace.ts": `export namespace Foo {} console.log("es6-export-namespace.ts:",JSON.stringify(this))`,
      "/es6-export-class.js": `export class Foo {} console.log("es6-export-class.js:",JSON.stringify(this))`,
      "/es6-export-abstract-class.ts": `export abstract class Foo {} console.log("es6-export-abstract-class.ts:",JSON.stringify(this))`,
      "/es6-export-default.js": `export default 123; console.log("es6-export-default.js:",JSON.stringify(this))`,
      "/es6-export-clause.js": `export {}; console.log("es6-export-clause.js:",JSON.stringify(this))`,
      "/es6-export-clause-from.js": `export {} from './dummy'; console.log("es6-export-clause-from.js:",JSON.stringify(this))`,
      "/es6-export-star.js": `export * from './dummy'; console.log("es6-export-star.js:",JSON.stringify(this))`,
      "/es6-export-star-as.js": `export * as ns from './dummy'; console.log("es6-export-star-as.js:",JSON.stringify(this))`,
      "/es6-export-assign.ts": `export = 123; console.log("es6-export-assign.ts:",JSON.stringify(this))`,
      "/es6-export-import-assign.ts": `export import x = require('./dummy'); console.log("es6-export-import-assign.ts:",JSON.stringify(this))`,
      "/es6-ns-export-variable.ts": `namespace ns { export const foo = 123; } console.log("es6-ns-export-variable.ts:",JSON.stringify(this))`,
      "/es6-ns-export-function.ts": `namespace ns { export function foo() {} } console.log("es6-ns-export-function.ts:",JSON.stringify(this))`,
      "/es6-ns-export-async-function.ts": `namespace ns { export async function foo() {} } console.log("es6-ns-export-async-function.ts:",JSON.stringify(this))`,
      "/es6-ns-export-enum.ts": `namespace ns { export enum Foo {} } console.log("es6-ns-export-enum.ts:",JSON.stringify(this))`,
      "/es6-ns-export-const-enum.ts": `namespace ns { export const enum Foo {} } console.log("es6-ns-export-const-enum.ts:",JSON.stringify(this))`,
      "/es6-ns-export-module.ts": `namespace ns { export module Foo {} } console.log("es6-ns-export-module.ts:",JSON.stringify(this))`,
      "/es6-ns-export-namespace.ts": `namespace ns { export namespace Foo {} } console.log("es6-ns-export-namespace.ts:",JSON.stringify(this))`,
      "/es6-ns-export-class.ts": `namespace ns { export class Foo {} } console.log("es6-ns-export-class.ts:",JSON.stringify(this))`,
      "/es6-ns-export-abstract-class.ts": `namespace ns { export abstract class Foo {} } console.log("es6-ns-export-abstract-class.ts:",JSON.stringify(this))`,
    },
    run: {
      "stdout": `
        cjs.js: {}
        es6-import-stmt.js: {}
        es6-import-assign.ts: {}
        es6-import-dynamic.js: {}
        es6-import-meta.js: undefined
        es6-expr-import-dynamic.js: {}
        es6-expr-import-meta.js: undefined
        es6-export-variable.js: undefined
        es6-export-function.js: undefined
        es6-export-async-function.js: undefined
        es6-export-enum.ts: undefined
        es6-export-const-enum.ts: undefined
        es6-export-module.ts: undefined
        es6-export-namespace.ts: undefined
        es6-export-class.js: undefined
        es6-export-abstract-class.ts: undefined
        es6-export-default.js: undefined
        es6-export-clause.js: undefined
        es6-export-clause-from.js: undefined
        es6-export-star.js: undefined
        es6-export-star-as.js: undefined
        es6-export-assign.ts: {}
        es6-export-import-assign.ts: undefined
        es6-ns-export-variable.ts: {}
        es6-ns-export-function.ts: {}
        es6-ns-export-async-function.ts: {}
        es6-ns-export-enum.ts: {}
        es6-ns-export-const-enum.ts: {}
        es6-ns-export-module.ts: {}
        es6-ns-export-namespace.ts: {}
        es6-ns-export-class.ts: {}
        es6-ns-export-abstract-class.ts: {}
      `,
    },
  });
  itBundled("default/ArrowFnScope", {
    // TODO: MANUAL CHECK: make sure the snapshot we use works.
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
    files: {
      "/entry.js": /* js */ `
        switch (foo) { default: var foo }
        switch (bar) { default: let bar }
      `,
    },
    minifyIdentifiers: true,
    bundling: false,
    onAfterBundle(api) {
      assert(!api.readFile("/out.js").includes("foo"), 'bundle shouldnt include "foo"');
      assert(!api.readFile("/out.js").includes("let bar"), 'bundle shouldnt include "let bar"');
      assert(!api.readFile("/out.js").includes("var bar"), 'bundle shouldnt include "var bar"');
    },
    run: {
      error: "ReferenceError: bar is not defined",
    },
  });
  itBundled("default/ArgumentDefaultValueScopeNoBundle", {
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
    onAfterBundle(api) {
      assert(
        [...api.readFile("/out.js").matchAll(/= *foo/g)].length === 6,
        'foo default argument value should not have been replaced (expected to see exactly 6 instances of "= foo")',
      );
    },
    minifyIdentifiers: true,
    bundling: false,
  });
  itBundled("default/ArgumentsSpecialCaseNoBundle", {
    files: {
      "/entry.cjs": /* js */ `
        (async() => {
          var arguments = 'var';
  
          const f1 = function foo(x = arguments) { return [x, arguments] }
          const f2 = (function(x = arguments) { return [x, arguments] });
          const o1 = ({foo(x = arguments) { return [x, arguments] }});
          const C1 = class Foo { foo(x = arguments) { return [x, arguments] } }
          const C2 = (class { foo(x = arguments) { return [x, arguments] } });
  
          const f3 = function foo(x = arguments) { var arguments; return [x, arguments] }
          const f4 = (function(x = arguments) { var arguments; return [x, arguments] });
          const o2 = ({foo(x = arguments) { var arguments; return [x, arguments] }});
  
          console.log('marker');

          const a1 = (x => [x, arguments]);
          const a2 = (() => [arguments]);
          const a3 = (async () => [arguments]);
          const a4 = ((x = arguments) => [x, arguments]);
          const a5 = (async (x = arguments) => [x, arguments]);
  
          const a6 = x => [x, arguments];
          const a7 = () => [arguments];
          const a8 = async () => [arguments];
          const a9 = (x = arguments) => [x, arguments];
          const a10 = async (x = arguments) => [x, arguments];
  
          const a11 = (x => { return [x, arguments] });
          const a12 = (() => { return [arguments] });
          const a13 = (async () => { return [arguments] });
          const a14 = ((x = arguments) => { return [x, arguments] });
          const a15 = (async (x = arguments) => { return [x, arguments] });
  
          const a16 = x => { return [x, arguments] };
          const a17 = () => { return [arguments] };
          const a18 = async () => { return [arguments] };
          const a19 = (x = arguments) => { return [x, arguments] };
          const a20 = async (x = arguments) => { return [x, arguments] };

          // assertions:
          // we need this helper function to get "Arguments" objects, though this only applies for tests using v8
          const argumentsFor = new Function('return arguments;');
          const assert = (0, require)('assert');
          assert.deepEqual(f1(), [argumentsFor(), argumentsFor()], 'f1()');
          assert.deepEqual(f1(1), [1, argumentsFor(1)], 'f1(1)');
          assert.deepEqual(f2(), [argumentsFor(), argumentsFor()], 'f2()');
          assert.deepEqual(f2(1), [1, argumentsFor(1)], 'f2(1)');
          assert.deepEqual(f3(), [argumentsFor(), argumentsFor()], 'f3()');
          assert.deepEqual(f3(1), [1, argumentsFor(1)], 'f3(1)');
          assert.deepEqual(o1.foo(), [argumentsFor(), argumentsFor()], 'o1.foo()');
          assert.deepEqual(o1.foo(1), [1, argumentsFor(1)], 'o1.foo(1)');
          assert.deepEqual(o2.foo(), [argumentsFor(), argumentsFor()], 'o2.foo()');
          assert.deepEqual(o2.foo(1), [1, argumentsFor(1)], 'o2.foo(1)');
          assert.deepEqual(new C1().foo(), [argumentsFor(), argumentsFor()], 'C1#foo()');
          assert.deepEqual(new C1().foo(1), [1, argumentsFor(1)], 'C1#foo(1)');
          assert.deepEqual(new C2().foo(), [argumentsFor(), argumentsFor()], 'C2#foo()');
          assert.deepEqual(new C2().foo(1), [1, argumentsFor(1)], 'C2#foo(1)');
          assert.deepEqual(a1(), [undefined, 'var'], 'a1()');
          assert.deepEqual(a1(1), [1, 'var'], 'a1(1)');
          assert.deepEqual(a2(), ['var'], 'a2()');
          assert.deepEqual(await a3(), ['var'], 'a3()');
          assert.deepEqual(a4(), ['var', 'var'], 'a4()');
          assert.deepEqual(a4(1), [1, 'var'], 'a4(1)');
          assert.deepEqual(await a5(), ['var', 'var'], 'a5()');
          assert.deepEqual(await a5(1), [1, 'var'], 'a5(1)');
          assert.deepEqual(a6(), [undefined, 'var'], 'a6()');
          assert.deepEqual(a6(1), [1, 'var'], 'a6(1)');
          assert.deepEqual(a7(), ['var'], 'a7()');
          assert.deepEqual(await a8(), ['var'], 'a8()');
          assert.deepEqual(a9(), ['var', 'var'], 'a9()');
          assert.deepEqual(a9(1), [1, 'var'], 'a9(1)');
          assert.deepEqual(await a10(), ['var', 'var'], 'a10()');
          assert.deepEqual(await a10(1), [1, 'var'], 'a10(1)');
          assert.deepEqual(a11(), [undefined, 'var'], 'a11()');
          assert.deepEqual(a11(1), [1, 'var'], 'a11(1)');
          assert.deepEqual(a12(), ['var'], 'a12()');
          assert.deepEqual(await a13(), ['var'], 'a13()');
          assert.deepEqual(a14(), ['var', 'var'], 'a14()');
          assert.deepEqual(a14(1), [1, 'var'], 'a14(1)');
          assert.deepEqual(await a15(), ['var', 'var'], 'a15()');
          assert.deepEqual(await a15(1), [1, 'var'], 'a15(1)');
          assert.deepEqual(a16(), [undefined, 'var'], 'a16()');
          assert.deepEqual(a16(1), [1, 'var'], 'a16(1)');
          assert.deepEqual(a17(), ['var'], 'a17()');
          assert.deepEqual(await a18(), ['var'], 'a18()');
          assert.deepEqual(a19(), ['var', 'var'], 'a19()');
          assert.deepEqual(a19(1), [1, 'var'], 'a19(1)');
          assert.deepEqual(await a20(), ['var', 'var'], 'a20()');
          assert.deepEqual(await a20(1), [1, 'var'], 'a20(1)');
        })(1,3,5);
      `,
    },
    format: "iife",
    outfile: "/out.js",
    minifyIdentifiers: true,
  });
  itBundled("default/WithStatementTaintingNoBundle", {
    files: {
      "/entry.js": /* js */ `
        (() => {
          let local = 1
          let outer = 2
          let outerDead = 3
          console.log(local, outer, outerDead)
          with ({ outer: 100, local: 150, hoisted: 200, extra: 500 }) {
            console.log(outer, outerDead, hoisted, extra)
            var hoisted = 4
            let local = 5
            hoisted++
            local++
            console.log(local, outer, outerDead, hoisted, extra)
            if (1) outer++
            if (0) outerDead++
            console.log(local, outer, outerDead, hoisted, extra)
          }
          console.log(local, outer, outerDead, hoisted)
          if (1) {
            hoisted++
            local++
            outer++
            outerDead++
          }
          console.log(local, outer, outerDead, hoisted)
        })()
      `,
    },
    format: "iife",
    minifyIdentifiers: true,
    bundling: false,
    run: {
      runtime: "node",
      stdout: `
        1 2 3
        100 3 200 500
        6 100 3 5 500
        6 101 3 5 500
        1 2 3 undefined
        2 3 4 NaN
      `,
    },
  });
  itBundled("default/DirectEvalTaintingNoBundle", {
    files: {
      "/entry.js": /* js */ `
        module.exports = 1; // flag as CJS input

        function test1() {
          let shouldNotBeRenamed1 = 1;
          function add(first, second) {
            let renameMe = 1;
            return first + second;
          }
          eval('add(1, 2)')
        }
  
        function test2() {
          let renameMe1 = 1;
          function add(first, second) {
            let renameMe2 = 1;
            return first + second
          }
          (0, eval)('add(1, 2)')
        }
  
        function test3() {
          let renameMe1 = 1;
          function add(first, second) {
            let renameMe2 = 1;
            return first + second
          }
        }

        function test5() {
          let shouldNotBeRenamed3 = 1;
          function containsDirectEval() { eval() }
          if (true) { var shouldNotBeRenamed4 }
        }
      `,
    },
    minifyIdentifiers: true,
    bundling: false,
    onAfterBundle(api) {
      const text = api.readFile("/out.js");
      assert(text.includes("shouldNotBeRenamed1"), "Should not have renamed `shouldNotBeRenamed1`");
      // assert(text.includes("shouldNotBeRenamed2"), "Should not have renamed `shouldNotBeRenamed2`");
      assert(text.includes("shouldNotBeRenamed3"), "Should not have renamed `shouldNotBeRenamed3`");
      assert(text.includes("shouldNotBeRenamed4"), "Should not have renamed `shouldNotBeRenamed4`");
      assert(!text.includes("renameMe"), "Should have renamed all `renameMe` variabled");
    },
  });
  itBundled("default/DirectEvalTainting2NoBundle", {
    files: {
      "/entry.js": /* js */ `
        module.exports = 1; // flag as CJS input

        function test4(eval) {
          let shouldNotBeRenamed2 = 1;
          function add(first, second) {
            let renameMe1 = 1;
            return first + second
          }
          eval('add(1, 2)')
        }
      `,
    },
    todo: true,
    minifyIdentifiers: true,
    bundling: false,
    format: "cjs",
    onAfterBundle(api) {
      const text = api.readFile("/out.js");
      assert(text.includes("shouldNotBeRenamed2"), "Should not have renamed `shouldNotBeRenamed2`");
      assert(!text.includes("renameMe"), "Should have renamed all `renameMe` variabled");
    },
  });
  itBundled("default/ImportReExportES6ESBuildIssue149", {
    todo: true,
    files: {
      "/app.jsx": /* jsx */ `
        import { p as Part, h, render } from './import';
        import { Internal } from './in2';
        const App = () => <Part> <Internal /> T </Part>;
        render(<App />, 'a dom node');
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
    runtimeFiles: {
      "/node_modules/preact/index.js": /* js */ `
        export const p = 'part';
        export const h = () => 'preact element';
        export const render = (jsx) => {
          if (jsx !== 'preact element') {
            throw new Error('Test failed, is bun is applying automatic jsx?');
          }
        };
      `,
    },
    jsx: {
      factory: "h",
      automaticRuntime: false,
    },
    external: ["preact"],
    run: true,
  });
  itBundled("default/ExternalModuleExclusionPackage", {
    files: {
      "/index.js": /* js */ `
        import { S3 } from 'aws-sdk';
        import { DocumentClient } from 'aws-sdk/clients/dynamodb';
        export const s3 = new S3();
        export const dynamodb = new DocumentClient();
      `,
    },
    external: ["aws-sdk"],
  });
  itBundled("default/ExternalModuleExclusionScopedPackage", {
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
    external: ["@a1", "@b1/b2", "@c1/c2/c3"],
    bundleErrors: {
      "/index.js": [
        `Could not resolve: "@a1-a2". Maybe you need to "bun install"?`,
        `Could not resolve: "@b1". Maybe you need to "bun install"?`,
        `Could not resolve: "@b1/b2-b3". Maybe you need to "bun install"?`,
        `Could not resolve: "@c1". Maybe you need to "bun install"?`,
        `Could not resolve: "@c1/c2". Maybe you need to "bun install"?`,
        `Could not resolve: "@c1/c2/c3-c4". Maybe you need to "bun install"?`,
      ],
    },
  });
  itBundled("default/ScopedExternalModuleExclusion", {
    files: {
      "/index.js": /* js */ `
        import { Foo } from '@scope/foo';
        import { Bar } from '@scope/foo/bar';
        export const foo = new Foo();
        export const bar = new Bar();
      `,
    },
    external: ["@scope/foo"],
  });
  itBundled("default/ExternalModuleExclusionRelativePath", {
    todo: true,
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
    outdir: "/Users/user/project/out/",
    external: [
      "{{root}}/Users/user/project/out/in-out-dir.js",
      "{{root}}/Users/user/project/src/nested/folder/foo.js",
      "{{root}}/Users/user/project/src/sha256.min.js",
      "/api/config?a=1&b=2",
    ],
    onAfterBundle(api) {
      const file = api.readFile("/Users/user/project/out/index.js");
      const imports = new Bun.Transpiler().scanImports(file);
      expect(imports).toStrictEqual([
        { kind: "import-statement", path: "../src/nested/folder/foo.js" },
        { kind: "import-statement", path: "./in-out-dir.js" },
        { kind: "import-statement", path: "../src/sha256.min.js" },
        { kind: "import-statement", path: "/api/config?a=1&b=2" },
      ]);
    },
  });
  itBundled("default/ImportWithHashInPath", {
    files: {
      "/entry.js": /* js */ `
        import foo from './file#foo.txt'
        import bar from './file#bar.txt'
        console.log(foo, bar)
      `,
      "/file#foo.txt": `foo`,
      "/file#bar.txt": `bar`,
    },
    run: {
      stdout: "foo bar",
    },
  });
  itBundled("default/ImportWithHashParameter", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        // Each of these should have a separate identity (i.e. end up in the output file twice)
        import foo from './file.txt#foo'
        import bar from './file.txt#bar'
        console.log(foo, bar)
      `,
      "/file.txt": `This is some text`,
    },
    run: {
      stdout: "This is some text This is some text",
    },
  });
  itBundled("default/ImportWithQueryParameter", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        // Each of these should have a separate identity (i.e. end up in the output file twice)
        import foo from './file.txt?foo'
        import bar from './file.txt?bar'
        console.log(foo, bar)
      `,
      "/file.txt": `This is some text`,
    },
    run: {
      stdout: "This is some text This is some text",
    },
  });
  itBundled("default/ImportAbsPathWithQueryParameter", {
    todo: true,
    files: {
      "/Users/user/project/entry.js": /* js */ `
        // Each of these should have a separate identity (i.e. end up in the output file twice)
        import foo from '{{root}}/Users/user/project/file.txt?foo'
        import bar from '{{root}}/Users/user/project/file.txt#bar'
        console.log(foo, bar)
      `,
      "/Users/user/project/file.txt": `This is some text`,
    },
    run: {
      stdout: "This is some text This is some text",
    },
  });
  itBundled("default/ImportAbsPathAsFile", {
    files: {
      "/Users/user/project/entry.js": /* js */ `
        import pkg from '{{root}}/Users/user/project/node_modules/pkg/index'
        console.log(pkg)
      `,
      "/Users/user/project/node_modules/pkg/index.js": `export default 123`,
    },
    run: {
      stdout: "123",
    },
  });
  itBundled("default/ImportAbsPathAsDirUnix", {
    files: {
      "/Users/user/project/entry.js": /* js */ `
        import pkg from '{{root}}/Users/user/project/node_modules/pkg'
        console.log(pkg)
      `,
      "/Users/user/project/node_modules/pkg/index.js": `export default 123`,
    },
    run: {
      stdout: "123",
    },
  });
  // itBundled("default/ImportBackslashNormalization", {
  //   files: {
  //     "/Users/user/project/entry.js": /* js */ `
  //       import pkg from '{{root}}\\\\Users\\\\user\\\\project\\\\node_modules\\\\pkg'
  //       console.log(pkg)
  //     `,
  //     "/Users/user/project/node_modules/pkg/index.js": `export default 123`,
  //   },
  //   run: {
  //     stdout: "123",
  //   },
  // });
  itBundled("default/AutoExternal", {
    files: {
      "/entry.js": /* js */ `
        // These URLs should be external automatically
        import "http://example.com/code.js";
        import "https://example.com/code.js";
        import "//example.com/code.js";
        import "data:application/javascript;base64,ZXhwb3J0IGRlZmF1bHQgMTIz";
      `,
    },
    onAfterBundle(api) {
      const file = api.readFile("/out.js");
      const imports = new Bun.Transpiler().scanImports(file);
      expect(imports).toStrictEqual([
        { kind: "import-statement", path: "http://example.com/code.js" },
        { kind: "import-statement", path: "https://example.com/code.js" },
        { kind: "import-statement", path: "//example.com/code.js" },
        { kind: "import-statement", path: "data:application/javascript;base64,ZXhwb3J0IGRlZmF1bHQgMTIz" },
      ]);
    },
  });
  itBundled("default/AutoExternalNode", {
    todo: true,
    // notImplemented: true,
    files: {
      "/entry.js": /* js */ `
        // These URLs should be external automatically
        import fs from "node:fs/promises";
        fs.readFile();
  
        // This should be external and should be tree-shaken because it's side-effect free
        import "node:path";
        import "querystring";
  
        // This should be external too, but shouldn't be tree-shaken because it could be a run-time error
        import "node:what-is-this";
      `,
    },
    target: "node",
    treeShaking: true,
    onAfterBundle(api) {
      const file = api.readFile("/out.js");
      const imports = new Bun.Transpiler().scanImports(file);
      expect(imports).toStrictEqual([
        { kind: "import-statement", path: "node:fs/promises" },
        { kind: "import-statement", path: "node:what-is-this" },
      ]);
    },
  });
  itBundled("default/AutoExternalBun", {
    skipOnEsbuild: true,
    todo: true,
    files: {
      "/entry.js": /* js */ `
        // These URLs should be external automatically
        import fs from "node:fs/promises";
        fs.readFile();
        import { CryptoHasher } from "bun";
        new CryptoHasher();
        
        // This should be external and should be tree-shaken because it's side-effect free
        import "node:path";
        import "bun:sqlite";
  
        // This should be external too, but shouldn't be tree-shaken because it could be a run-time error
        import "node:what-is-this";
        import "bun:what-is-this";
      `,
    },
    target: "bun",
    onAfterBundle(api) {
      const file = api.readFile("/out.js");
      const imports = new Bun.Transpiler().scanImports(file);
      expect(imports).toStrictEqual([
        // bun is transformed in destructuring the bun global
        { kind: "import-statement", path: "node:fs/promises" },
        { kind: "import-statement", path: "node:what-is-this" },
        { kind: "import-statement", path: "bun:what-is-this" },
      ]);
    },
  });
  itBundled("default/ExternalWithWildcard", {
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
    external: ["/assets/*", "*.png", "/dir/*/file.gif"],
    bundleErrors: {
      "/entry.js": [
        `Could not resolve: "/sassets/images/test.jpg"`,
        `Could not resolve: "/dir/file.gif"`,
        `Could not resolve: "./file.ping"`,
      ],
    },
  });
  itBundled("default/ExternalWildcardDoesNotMatchEntryPoint", {
    skipOnEsbuild: true,
    files: {
      "/entry.js": `import "foo"`,
    },
    bundling: false,
  });
  itBundled("default/ManyEntryPoints", {
    files: Object.fromEntries([
      ["/shared.js", "export default 123"],
      ...Array.from({ length: 40 }, (_, i) => [
        `/e${String(i).padStart(2, "0")}.js`,
        `import x from "./shared"; console.log(x)`,
      ]),
    ]),
    entryPoints: Array.from({ length: 40 }, (_, i) => `/e${String(i).padStart(2, "0")}.js`),
  });
  itBundled("default/MinifyPrivateIdentifiersNoBundle", {
    files: {
      "/entry.js": /* js */ `
        class Foo {
          doNotRenameMe
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
          doNotRenameMe
          #foo
          foo = class {
            #foo2
            #foo
            #bar
          }
          get #bar() {}
          set #bar(x) {}
        }

        cool(Foo)
        cool(Bar)
      `,
    },
    minifyIdentifiers: true,
    onAfterBundle(api) {
      const text = api.readFile("/out.js");
      assert(text.includes("doNotRenameMe"), "bundler should not have renamed `doNotRenameMe`");
      assert(!text.includes("#foo"), "bundler should have renamed `#foo`");
      assert(text.includes("#"), "bundler keeps private variables private `#`");
    },
  });
  // These labels should all share the same minified names
  itBundled("default/MinifySiblingLabelsNoBundle", {
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
    onAfterBundle(api) {
      const text = api.readFile("/out.js");
      const labels = [...text.matchAll(/([a-z0-9]+):/gi)].map(x => x[1]);
      expect(labels).toStrictEqual([labels[0], labels[1], labels[0], labels[1], labels[0], labels[1]]);
    },
  });
  // This is such a fun file. it crashes prettier and some other parsers.
  const crazyNestedLabelFile = dedent`
    L001:{L002:{L003:{L004:{L005:{L006:{L007:{L008:{L009:{L010:{L011:{L012:{L013:{L014:{L015:{L016:{console.log('a')
    L017:{L018:{L019:{L020:{L021:{L022:{L023:{L024:{L025:{L026:{L027:{L028:{L029:{L030:{L031:{L032:{console.log('a')
    L033:{L034:{L035:{L036:{L037:{L038:{L039:{L040:{L041:{L042:{L043:{L044:{L045:{L046:{L047:{L048:{console.log('a')
    L049:{L050:{L051:{L052:{L053:{L054:{L055:{L056:{L057:{L058:{L059:{L060:{L061:{L062:{L063:{L064:{console.log('a')
    L065:{L066:{L067:{L068:{L069:{L070:{L071:{L072:{L073:{L074:{L075:{L076:{L077:{L078:{L079:{L080:{console.log('a')
    L081:{L082:{L083:{L084:{L085:{L086:{L087:{L088:{L089:{L090:{L091:{L092:{L093:{L094:{L095:{L096:{console.log('a')
    L097:{L098:{L099:{L100:{L101:{L102:{L103:{L104:{L105:{L106:{L107:{L108:{L109:{L110:{L111:{L112:{console.log('a')
    L113:{L114:{L115:{L116:{L117:{L118:{L119:{L120:{L121:{L122:{L123:{L124:{L125:{L126:{L127:{L128:{console.log('a')
    L129:{L130:{L131:{L132:{L133:{L134:{L135:{L136:{L137:{L138:{L139:{L140:{L141:{L142:{L143:{L144:{console.log('a')
    L145:{L146:{L147:{L148:{L149:{L150:{L151:{L152:{L153:{L154:{L155:{L156:{L157:{L158:{L159:{L160:{console.log('a')
    L161:{L162:{L163:{L164:{L165:{L166:{L167:{L168:{L169:{L170:{L171:{L172:{L173:{L174:{L175:{L176:{console.log('a')
    L177:{L178:{L179:{L180:{L181:{L182:{L183:{L184:{L185:{L186:{L187:{L188:{L189:{L190:{L191:{L192:{console.log('a')
    L193:{L194:{L195:{L196:{L197:{L198:{L199:{L200:{L201:{L202:{L203:{L204:{L205:{L206:{L207:{L208:{console.log('a')
    L209:{L210:{L211:{L212:{L213:{L214:{L215:{L216:{L217:{L218:{L219:{L220:{L221:{L222:{L223:{L224:{console.log('a')
    L225:{L226:{L227:{L228:{L229:{L230:{L231:{L232:{L233:{L234:{L235:{L236:{L237:{L238:{L239:{L240:{console.log('a')
    L241:{L242:{L243:{L244:{L245:{L246:{L247:{L248:{L249:{L250:{L251:{L252:{L253:{L254:{L255:{L256:{console.log('a')
    L257:{L258:{L259:{L260:{L261:{L262:{L263:{L264:{L265:{L266:{L267:{L268:{L269:{L270:{L271:{L272:{console.log('a')
    L273:{L274:{L275:{L276:{L277:{L278:{L279:{L280:{L281:{L282:{L283:{L284:{L285:{L286:{L287:{L288:{console.log('a')
    L289:{L290:{L291:{L292:{L293:{L294:{L295:{L296:{L297:{L298:{L299:{L300:{L301:{L302:{L303:{L304:{console.log('a')
    L305:{L306:{L307:{L308:{L309:{L310:{L311:{L312:{L313:{L314:{L315:{L316:{L317:{L318:{L319:{L320:{console.log('a')
    L321:{L322:{L323:{L324:{L325:{L326:{L327:{L328:{L329:{L330:{L331:{L332:{L333:{}}}}}}}}}}}}}}}}}}console.log('a')
    }}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}console.log('a')
    }}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}console.log('a')
    }}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}console.log('a')
    }}}}}}}}}}}}}}}}}}}}}}}}}}}
  `;
  // these tests are flaky. at least if i run it just on its own, i get a crash. in a row its fine
  itBundled.skip("default/NestedLabelsBundle", {
    todo: true,
    files: {
      "/entry.js": crazyNestedLabelFile,
    },
  });
  itBundled.skip("default/MinifyNestedLabelsBundle", {
    todo: true,
    files: {
      "/entry.js": crazyNestedLabelFile,
    },
    minifyWhitespace: true,
    minifyIdentifiers: true,
    minifySyntax: true,
  });
  itBundled("default/ExportsAndModuleFormatCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import * as foo from './foo/test'
        import * as bar from './bar/test'
        console.log(JSON.stringify([exports, module.exports, foo, bar]), exports === module.exports)
      `,
      "/foo/test.js": `export let foo = 123`,
      "/bar/test.js": `export let bar = 123`,
    },
    format: "cjs",
    run: {
      stdout: '[{},{},{"foo":123},{"bar":123}] true',
    },
  });
  itBundled("default/MinifiedExportsAndModuleFormatCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import * as foo from './foo/test'
        import * as bar from './bar/test'
        console.log(JSON.stringify([exports, module.exports, foo, bar]), exports === module.exports)
      `,
      "/foo/test.js": `export let foo = 123`,
      "/bar/test.js": `export let bar = 123`,
    },
    minifyIdentifiers: true,
    format: "cjs",
    run: {
      stdout: '[{},{},{"foo":123},{"bar":123}] true',
    },
  });
  itBundled("default/EmptyExportClauseBundleAsCommonJSESBuildIssue910", {
    files: {
      "/entry.js": `console.log(JSON.stringify(require('./types.mjs')))`,
      "/types.mjs": `export {}`,
    },
    format: "cjs",
    run: {
      stdout: "{}",
    },
  });
  itBundled("default/UseStrictDirectiveMinifyNoBundle", {
    files: {
      "/entry.js": /* js */ `
        'use strict'
        'use loose'
        a
        b
      `,
    },
    format: "iife",
    minifySyntax: true,
    minifyWhitespace: true,
    bundling: false,
    todo: true,
    onAfterBundle(api) {
      assert(api.readFile("/out.js").includes('"use strict";'), '"use strict"; was emitted');
    },
  });
  itBundled("default/UseStrictDirectiveBundleESBuildIssue1837", {
    files: {
      "/entry.js": /* js */ `
        const p = require('./cjs').foo;
        console.log(typeof p);
      `,
      "/cjs.js": /* js */ `
        'use strict'
        exports.foo = process
      `,
      "/shims.js": /* js */ `
        import { readFileSync } from 'fs'
        export { readFileSync as process }
      `,
    },
    inject: ["/shims.js"],
    target: "node",
    run: {
      stdout: "function",
    },
  });
  itBundled("default/UseStrictDirectiveBundleIIFEESBuildIssue2264", {
    files: {
      "/entry.js": /* js */ `
        'use strict'
        export let a = 1
      `,
    },
    format: "iife",
    onAfterBundle(api) {
      assert(api.readFile("/out.js").includes('"use strict";'), '"use strict"; should be emitted');
    },
  });
  itBundled("default/UseStrictDirectiveBundleCJSESBuildIssue2264", {
    files: {
      "/entry.js": /* js */ `
        'use strict'
        export let a = 1
      `,
    },
    format: "cjs",
    onAfterBundle(api) {
      assert(api.readFile("/out.js").includes('"use strict";'), '"use strict"; should be emitted');
    },
  });
  itBundled("default/UseStrictDirectiveBundleESMESBuildIssue2264", {
    files: {
      "/entry.js": /* js */ `
        'use strict'
        export let a = 1
      `,
    },
    format: "esm",
    onAfterBundle(api) {
      assert(!api.readFile("/out.js").includes('"use strict";'), '"use strict"; should not be emitted');
    },
  });
  // itBundled("default/NoOverwriteInputFileError", {
  //   files: {
  //     "/entry.js": `console.log(123)`,
  //   },
  //   outfile: "/entry.js",
  //   bundleErrors: {
  //     "/entry.js": ['Refusing to overwrite input file "entry.js" (use "--allow-overwrite" to allow this)'],
  //   },
  // });
  itBundled("default/DuplicateEntryPoint", {
    files: {
      "/entry.js": `console.log(123)`,
    },
    entryPoints: ["/entry.js", "/entry.js"],
    run: {
      file: "/out/entry.js",
      stdout: "123",
    },
  });
  itBundled("default/RelativeFilepathEntryPoint", {
    files: {
      "/entry.js": `console.log(123)`,
    },
    entryPointsRaw: ["entry.js"],
    outfile: "/out.js",
    run: {
      file: "/out.js",
      stdout: "123",
    },
  });
  itBundled("default/MultipleEntryPointsSameNameCollision", {
    todo: true,
    files: {
      "/a/entry.js": `import {foo} from '../common.js'; console.log(1, foo)`,
      "/b/entry.js": `import {foo} from '../common.js'; console.log(2, 1foo)`,
      "/common.js": `export let foo = 123`,
    },
    entryPoints: ["./a/entry.js", "./b/entry.js"],
    outdir: "/out/",
    outputPaths: ["/out/a/entry.js", "/out/b/entry.js"],
  });
  itBundled("default/ReExportCommonJSAsES6", {
    files: {
      "/entry.js": `export {bar} from './foo'`,
      "/foo.js": `exports.bar = 123`,

      "/test.js": /* js */ `
        import { bar } from './out';
        console.log(bar);
      `,
    },
    run: {
      file: "/test.js",
      stdout: "123",
    },
  });
  itBundled("default/ReExportDefaultInternal", {
    files: {
      "/entry.js": /* js */ `
        export {default as foo} from './foo'
        export {default as bar} from './bar'
      `,
      "/foo.js": `export default 'foo'`,
      "/bar.js": `export default 'bar'`,

      "/test.js": /* js */ `
        import { foo, bar } from './out';
        console.log(foo, bar);
      `,
    },
    run: {
      file: "/test.js",
      stdout: "foo bar",
    },
  });
  itBundled("default/ReExportDefaultExternalES6", {
    files: {
      "/entry.js": /* js */ `
        export {default as foo} from 'foo'
        export {bar} from './bar'
      `,
      "/bar.js": `export {default as bar} from 'bar'`,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        import { foo, bar } from './out';
        console.log(foo, bar);
      `,
      "/node_modules/foo/index.js": /* js */ `
        export default 'foo'
      `,
      "/node_modules/bar/index.js": /* js */ `
        export default 'bar'
      `,
    },
    run: {
      file: "/test.js",
      stdout: "foo bar",
    },
    format: "esm",
    external: ["foo", "bar"],
  });
  itBundled("default/ReExportDefaultExternalCommonJS", {
    files: {
      "/entry.js": /* js */ `
        export {default as foo} from 'foo'
        export {bar} from './bar'
      `,
      "/bar.js": `export {default as bar} from 'bar'`,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        const { foo, bar } = require('./out');
        console.log(foo.default, bar.default);
      `,
      "/node_modules/foo/index.js": /* js */ `
        module.exports = { default: 'foo' };
      `,
      "/node_modules/bar/index.js": /* js */ `
        module.exports = { default: 'bar' };
      `,
    },
    run: {
      file: "/test.js",
      stdout: "foo bar",
    },
    format: "cjs",
    external: ["foo", "bar"],
  });
  itBundled("default/ReExportDefaultNoBundle", {
    files: {
      "/entry.js": /* js */ `
        export {default as foo} from './foo'
        export {default as bar} from './bar'
      `,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        import { foo, bar } from './out';
        console.log(foo, bar);
      `,
      "/foo.js": /* js */ `
        export default 'foo'
      `,
      "/bar.js": /* js */ `
        export default 'bar'
      `,
    },
    run: {
      file: "/test.js",
      stdout: "foo bar",
    },
    bundling: false,
  });
  itBundled("default/ImportMetaCommonJS", ({ root }) => ({
    // Currently Bun emits `import.meta` instead of correctly
    // polyfilling its properties.
    todo: true,
    files: {
      "/entry.js": `
        import fs from "fs";
        import { fileURLToPath } from "url";
        console.log(fileURLToPath(import.meta.url) === ${JSON.stringify(path.join(root, "out.cjs"))});
      `,
    },
    outfile: "out.cjs",
    format: "cjs",
    target: "node",
    run: {
      runtime: "node",
      stdout: "true true",
    },
  }));
  itBundled("default/ImportMetaES6", {
    files: {
      "/entry.js": `console.log(import.meta.url, import.meta.path)`,
    },
    format: "esm",
    run: {
      stdout: "url_here path_here",
      bunArgs: ["--define", 'import.meta.url="url_here"', "--define", 'import.meta.path="path_here"'],
    },
  });
  itBundled("default/ImportMetaNoBundle", {
    files: {
      "/entry.js": `console.log(import.meta.url, import.meta.path)`,
    },
    bundling: false,
    run: {
      stdout: "url_here path_here",
      bunArgs: ["--define", 'import.meta.url="url_here"', "--define", 'import.meta.path="path_here"'],
    },
  });
  itBundled("default/LegalCommentsNone", {
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
    outdir: "/out",
    entryPoints: ["/entry.js", "/entry.css"],
    legalComments: "none",
    onAfterBundle(api) {
      assert(!api.readFile("/out/entry.js").includes("Copyright notice"), "js should not contain copyright notice");
      assert(!api.readFile("/out/entry.css").includes("Copyright notice"), "css should not contain copyright notice");
    },
  });
  itBundled("default/LegalCommentsInline", {
    files: {
      "/entry.js": /* js */ `
        // Normal Comment
        import './a'
        import './b'
        import './c'
      `,
      "/a.js": `console.log('in a') //! Copyright notice 1`,
      "/b.js": `console.log('in b') //! Copyright notice 1\n// Normal Comment`,
      "/c.js": `console.log('in c') //! Copyright notice 2`,
      "/entry.css": /* css */ `
        /* Normal Comment */
        @import "./a.css";
        @import "./b.css";
        @import "./c.css";
      `,
      "/a.css": `a { zoom: 2 } /*! Copyright notice 1 */`,
      "/b.css": `b { zoom: 2 } /*! Copyright notice 1 */ /* Normal Comment */`,
      "/c.css": `c { zoom: 2 } /*! Copyright notice 2 */`,
    },
    outdir: "/out",
    entryPoints: ["/entry.js", "/entry.css"],
    legalComments: "inline",
    minifyWhitespace: true,
    onAfterBundle(api) {
      const entry = api.readFile("/out/entry.js");
      assert(entry.match(/Copyright notice 1/g)?.length === 2, "js should contain copyright notice 1 twice");
      assert(entry.match(/Copyright notice 2/g)?.length === 1, "js should contain copyright notice 2 once");
      assert(!entry.includes("Normal Comment"), "js should not contain normal comments");

      const entry2 = api.readFile("/out/entry.css");
      assert(entry2.match(/Copyright notice 1/g)?.length === 2, "css should contain copyright notice 1 twice");
      assert(entry2.match(/Copyright notice 2/g)?.length === 1, "css should contain copyright notice 2 once");
      assert(!entry2.includes("Normal Comment"), "css should not contain normal comments");
    },
  });
  itBundled("default/LegalCommentsEndOfFile", {
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
    outdir: "/out",
    entryPoints: ["/entry.js", "/entry.css"],
    legalComments: "eof",
    onAfterBundle(api) {
      assert(
        api
          .readFile("/out/entry.js")
          .trim()
          .endsWith(
            dedent`
              //! Copyright notice 1
              //! Copyright notice 2
            `,
          ),
        'js should end with "Copyright notice 1" and "Copyright notice 2", in that order. No duplicates.',
      );
      assert(
        api
          .readFile("/out/entry.css")
          .trim()
          .endsWith(
            dedent`
              /*! Copyright notice 1 */
              /*! Copyright notice 2 */
            `,
          ),
        'css should end with "Copyright notice 1" and "Copyright notice 2", in that order. No duplicates.',
      );
    },
  });
  itBundled("default/LegalCommentsLinked", {
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
    outdir: "/out",
    entryPoints: ["/entry.js", "/entry.css"],
    legalComments: "linked",
    onAfterBundle(api) {
      assert(
        api.readFile("/out/entry.js").trim().endsWith(`/*! For license information please see entry.js.LEGAL.txt */`),
        'js should end with the exact text "/*! For license information please see entry.js.LEGAL.txt */"',
      );
      assert(
        api.readFile("/out/entry.css").trim().endsWith(`/*! For license information please see entry.css.LEGAL.txt */`),
        'js should end with the exact text "/*! For license information please see entry.js.LEGAL.txt */"',
      );
      assert(
        api.readFile("/out/entry.js.LEGAL.txt").trim() ===
          dedent`
            //! Copyright notice 1
            //! Copyright notice 2
          `,
      );
      assert(
        api.readFile("/out/entry.css.LEGAL.txt").trim() ===
          dedent`
            /*! Copyright notice 1 */
            /*! Copyright notice 2 */
          `,
      );
    },
  });
  itBundled("default/LegalCommentsExternal", {
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
    legalComments: "external",
    onAfterBundle(api) {
      assert(!api.readFile("/out/entry.js").includes(`entry.js.LEGAL.txt`), "js should NOT mention legal information");
      assert(
        !api.readFile("/out/entry.css").includes(`entry.css.LEGAL.txt`),
        "css should NOT mention legal information",
      );
      assert(
        api.readFile("/out/entry.js.LEGAL.txt").trim() ===
          dedent`
            //! Copyright notice 1
            //! Copyright notice 2
          `,
      );
      assert(
        api.readFile("/out/entry.css.LEGAL.txt").trim() ===
          dedent`
            /*! Copyright notice 1 */
            /*! Copyright notice 2 */
          `,
      );
    },
  });
  itBundled("default/LegalCommentsModifyIndent", {
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
    outdir: "/out",
    minifyWhitespace: true,
    entryPoints: ["/entry.js", "/entry.css"],
    legalComments: "inline",
    onAfterBundle(api) {
      assert(api.readFile("/out/entry.js").trim().includes("@preserve"), "js should include the @preserve comment");
      assert(api.readFile("/out/entry.css").trim().includes("@preserve"), "css should include the @preserve comment");
    },
  });
  itBundled("default/LegalCommentsAvoidSlashTagInline", {
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
    outdir: "/out",
    entryPoints: ["/entry.js", "/entry.css"],
    legalComments: "inline",
    onAfterBundle(api) {
      assert(api.readFile("/out/entry.js").trim().includes("<script>foo<\\/script>"), "js should have escaped comment");
      assert(api.readFile("/out/entry.css").trim().includes("<style>foo<\\/style>"), "css should have escaped comment");
    },
  });
  itBundled("default/LegalCommentsAvoidSlashTagEndOfFile", {
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
    outdir: "/out",
    entryPoints: ["/entry.js", "/entry.css"],
    legalComments: "eof",
    onAfterBundle(api) {
      assert(api.readFile("/out/entry.js").trim().includes("<script>foo<\\/script>"), "js should have escaped comment");
      assert(api.readFile("/out/entry.css").trim().includes("<style>foo<\\/style>"), "css should have escaped comment");
    },
  });
  itBundled("default/LegalCommentsAvoidSlashTagExternal", {
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
    outdir: "/out",
    entryPoints: ["/entry.js", "/entry.css"],
    legalComments: "external",
    onAfterBundle(api) {
      assert(
        api.readFile("/out/entry.js.LEGAL.txt").trim().includes("<script>foo</script>"),
        "js should NOT have escaped comment",
      );
      assert(
        api.readFile("/out/entry.css.LEGAL.txt").trim().includes("<style>foo</style>"),
        "css should NOT have escaped comment",
      );
    },
  });
  itBundled("default/LegalCommentsManyEndOfFile", {
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
    outdir: "/out",
    entryPoints: ["/project/entry.js", "/project/entry.css"],
    minifyWhitespace: true,
    legalComments: "eof",
    onAfterBundle(api) {
      assert(
        api
          .readFile("/out/entry.js")
          .trim()
          .endsWith(
            dedent`
              /*
               * @license
               * Copyright notice 2
               */
              /*
               * @preserve
               * (c) Evil Software Corp
               */
              // @preserve This is another comment
              //! (c) Good Software Corp
              //! Copyright notice 1
              //! Duplicate comment
              //! Duplicate third-party comment
            `,
          ),
        "js should have all copyright notices in order",
      );
      assert(
        api
          .readFile("/out/entry.css")
          .trim()
          .endsWith(
            dedent`
              /*
               * @license
               * Copyright notice 2
               */
              /* @preserve This is another comment */
              /*! (c) Good Software Corp */
              /*! Copyright notice 1 */
              /*! Duplicate comment */
              /*! Duplicate third-party comment */
              /** @preserve
               * (c) Evil Software Corp
               */
            `,
          ),
        "css should have all copyright notices in order",
      );
    },
  });
  itBundled("default/LegalCommentsEscapeSlashScriptAndStyleEndOfFile", {
    files: {
      "/project/entry.js": `import "js-pkg"; a /*! </script> */`,
      "/project/node_modules/js-pkg/index.js": `x /*! </script> */`,
      "/project/entry.css": `@import "css-pkg"; a { b: c } /*! </style> */`,
      "/project/node_modules/css-pkg/index.css": `x { y: z } /*! </style> */`,
    },
    outdir: "/out",
    entryPoints: ["/project/entry.js", "/project/entry.css"],
    minifyWhitespace: true,
    legalComments: "eof",
    onAfterBundle(api) {
      assert(!api.readFile("/out/entry.js").includes("</script>"), "js should not contain unescaped script tags");
      assert(!api.readFile("/out/entry.css").includes("</style>"), "css should not contain unescaped style tags");
    },
  });
  itBundled("default/LegalCommentsEscapeSlashScriptAndStyleExternal", {
    files: {
      "/project/entry.js": `import "js-pkg"; a /*! </script> */`,
      "/project/node_modules/js-pkg/index.js": `x /*! </script> */`,
      "/project/entry.css": `@import "css-pkg"; a { b: c } /*! </style> */`,
      "/project/node_modules/css-pkg/index.css": `x { y: z } /*! </style> */`,
    },
    outdir: "/out",
    entryPoints: ["/project/entry.js", "/project/entry.css"],
    minifyWhitespace: true,
    legalComments: "external",
    onAfterBundle(api) {
      assert(
        api.readFile("/out/entry.js.LEGAL.txt").includes("</script>"),
        "js.LEGAL.txt should not escaped the script tags",
      );
      assert(
        api.readFile("/out/entry.css.LEGAL.txt").includes("</style>"),
        "css.LEGAL.txt should not escaped the style tags",
      );
    },
  });
  itBundled("default/LegalCommentsManyLinked", {
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
    outdir: "/out",
    entryPoints: ["/project/entry.js", "/project/entry.css"],
    minifyWhitespace: true,
    legalComments: "linked",
    onAfterBundle(api) {
      assert(
        api.readFile("/out/entry.js").endsWith("/*! For license information please see entry.js.LEGAL.txt */\n"),
        "js should have a legal comment at the end",
      );
      assert(
        api.readFile("/out/entry.css").endsWith("/*! For license information please see entry.css.LEGAL.txt */\n"),
        "css should have a legal comment at the end",
      );
      assert(
        api.readFile("/out/entry.js.LEGAL.txt").trim(),
        dedent`
          /*
           * @license
           * Copyright notice 2
          */
          /*
           * @preserve
           * (c) Evil Software Corp
          */
          // @preserve This is another comment
          //! (c) Good Software Corp
          //! Copyright notice 1
        `,
      );
      assert.strictEqual(
        api.readFile("/out/entry.css.LEGAL.txt").trim(),
        dedent`
          /*
           * @license
           * Copyright notice 2
           */
          /* @preserve This is another comment */
          /*! (c) Good Software Corp */
          /*! Copyright notice 1 */
          /** @preserve
           * (c) Evil Software Corp
           */
        `,
      );
    },
  });
  itBundled("default/IIFE_ES5", {
    files: {
      "/entry.js": `console.log('test');`,
    },
    unsupportedJSFeatures: ["arrow"],
    format: "iife",
    onAfterBundle(api) {
      assert(api.readFile("/out.js").includes("(function"), "iife should be an es5 function");
    },
  });
  itBundled("default/OutputExtensionRemappingFile", {
    files: {
      "/entry.js": `console.log('test');`,
    },
    outfile: "/outfile.notjs",
    onAfterBundle(api) {
      api.assertFileExists("/outfile.notjs");
    },
  });
  itBundled("default/TopLevelAwaitIIFE", {
    files: {
      "/entry.js": /* js */ `
        await foo;
        for await (foo of bar) ;
      `,
    },
    format: "iife",
    todo: true,
    bundleErrors: {
      "/entry.js": ['Top-level await is currently not supported with the "iife" output format'],
    },
  });
  // TODO: doesn't work on esbuild, consider if we want on bun.
  // itBundled("default/TopLevelAwaitIIFEDeadBranch", {
  //   files: {
  //     "/entry.js": /* js */ `
  //       if (false) await foo;
  //       if (false) for await (foo of bar) ;
  //     `,
  //   },
  //   format: "iife",
  // });
  itBundled("default/TopLevelAwaitCJS", {
    files: {
      "/entry.js": /* js */ `
        await foo;
        for await (foo of bar) ;
      `,
    },
    format: "cjs",
    todo: true,
    bundleErrors: {
      "/entry.js": ['Top-level await is currently not supported with the "cjs" output format'],
    },
  });
  // TODO: doesn't work on esbuild, consider if we want on bun.
  // itBundled("default/TopLevelAwaitCJSDeadBranch", {
  //   files: {
  //     "/entry.js": /* js */ `
  //       if (false) await foo;
  //       if (false) for await (foo of bar) ;
  //     `,
  //   },
  //   format: "cjs",
  // });
  itBundled("default/TopLevelAwaitESM", {
    files: {
      "/entry.js": /* js */ `
        async function* foo() {
          yield 1;
          yield 2;
          yield 3;
          return 4;
        } 
        console.log(await (Promise.resolve(0)));
        for await (const bar of foo()) console.log(bar);
      `,
    },
    format: "esm",
    run: {
      stdout: "0\n1\n2\n3\n",
    },
  });
  itBundled("default/TopLevelAwaitNoBundle", {
    files: {
      "/entry.js": /* js */ `
        await foo;
        for await (foo of bar) ;
      `,
    },
    bundling: false,
  });
  itBundled("default/TopLevelAwaitForbiddenRequire", {
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
    bundleErrors: {
      "/entry.js": [
        'This require call is not allowed because the transitive dependency "c.js" contains a top-level await',
        'This require call is not allowed because the transitive dependency "c.js" contains a top-level await',
        'This require call is not allowed because the transitive dependency "c.js" contains a top-level await',
        'This require call is not allowed because the imported file "entry.js" contains a top-level await',
      ],
    },
  });
  itBundled("default/TopLevelAwaitAllowedImportWithoutSplitting", {
    files: {
      "/entry.js": /* js */ `
        import('./a')
        import('./b')
        import('./c')
        import('./entry')
        console.log(await 1)
      `,
      "/a.js": `import './b'`,
      "/b.js": `import './c'`,
      "/c.js": `console.log(await 0)`,
    },
    format: "esm",
    run: {
      stdout: "0\n1",
    },
  });
  itBundled("default/TopLevelAwaitImport", {
    files: {
      "/entry.js": /* js */ `
        const { a } = await import('./a.js');
        console.log(a);
      `,
      "/a.js": /* js */ `
        async function five() {
          return 5;
        }

        export const a = await five();
      `,
    },
    format: "esm",
    run: {
      stdout: "5",
    },
  });
  itBundled("default/TopLevelAwaitWithStaticImport", {
    // Test static import of a module that uses top-level await
    files: {
      "/entry.js": `
        import { a } from './a.js';
        console.log('Entry', a);
      `,
      "/a.js": `
        async function getValue() {
          return await Promise.resolve('value from a');
        }
        export const a = await getValue();
        console.log('a.js loaded');
      `,
    },
    format: "esm",
    run: {
      stdout: "a.js loaded\nEntry value from a",
    },
  });
  itBundled("default/TopLevelAwaitWithNestedDynamicImport", {
    // Test nested dynamic imports with top-level await
    files: {
      "/entry.js": `
        console.log('Start Entry');
        const res = await import('./a.js');
        console.log('Entry', res.a);
      `,
      "/a.js": `
        console.log('Start a.js');
        const { b } = await import('./b.js');
        export const a = 'a.js plus ' + b;
      `,
      "/b.js": `
        console.log('Start b.js');
        export const b = 'value from b.js';
      `,
    },
    format: "esm",
    run: {
      stdout: `Start Entry
  Start a.js
  Start b.js
  Entry a.js plus value from b.js`,
    },
  });
  itBundled("default/TopLevelAwaitWithNestedRequire", {
    // Test nested dynamic imports with top-level await
    files: {
      "/entry.js": `
        console.log('Start Entry');
        const res = await import('./a.js');
        console.log('Entry', res.a);
      `,
      "/a.js": `
        console.log('Start a.js');
        const { b } = require('./b.js');
        export const a = 'a.js plus ' + b;
      `,
      "/b.js": `
        console.log('Start b.js');
        export const b = 'value from b.js';
      `,
    },
    format: "esm",
    run: {
      stdout: `Start Entry
  Start a.js
  Start b.js
  Entry a.js plus value from b.js`,
    },
  });
  itBundled("default/TopLevelAwaitWithNestedImportAndRequire", {
    // Test nested dynamic imports with top-level await
    files: {
      "/entry.js": `
        console.log('Start Entry');
        const res = await import('./a.js');
        console.log('Entry', res.a);
      `,
      "/a.js": `
        console.log('Start a.js');
        const { b } = require('./b.js');
        async function getValue() {
          return 'value from a.js plus ' + b;
        }
        export const a = await getValue();
      `,
      "/b.js": `
        console.log('Start b.js');
        import { c } from './c.js';
        export const b = 'value from b.js plus ' + c;
      `,
      "/c.js": `
        console.log('Start c.js');
        async function getValue() {
          return 'value from c.js';
        }
        export const c = await getValue();
      `,
    },
    format: "esm",
    bundleErrors: {
      "/a.js": ['This require call is not allowed because the transitive dependency "c.js" contains a top-level await'],
    },
  });
  itBundled("default/TopLevelAwaitAllowedImportWithSplitting", {
    files: {
      "/entry.js": /* js */ `
        import('./a')
        import('./b')
        import('./c')
        // Commented out because esbuild doesn't handle this https://github.com/evanw/esbuild/issues/3043
        // import('./entry')
        console.log(await 1)
      `,
      "/a.js": `import './b'`,
      "/b.js": `import './c'`,
      "/c.js": `console.log(await 0)`,
    },
    format: "esm",
    splitting: true,
    outdir: "/out",
    run: {
      file: "/out/entry.js",
      stdout: "1\n0",
    },
  });
  itBundled("default/AssignToImport", {
    todo: true,
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
    bundleErrors: {
      // TODO: get exact errors here. when you do this make sure all bad* files are covered
      "/bad0.js": ["imports are immutable"],
      "/bad1.js": ["imports are immutable"],
      "/bad2.js": ["imports are immutable"],
      "/bad3.js": ["imports are immutable"],
      "/bad4.js": ["imports are immutable"],
      "/bad5.js": ["imports are immutable"],
      "/bad6.js": ["imports are immutable"],
      "/bad7.js": ["imports are immutable"],
      "/bad8.js": ["imports are immutable"],
      "/bad9.js": ["imports are immutable"],
      "/bad10.js": ["imports are immutable"],
      "/bad11.js": ["imports are immutable"],
      "/bad12.js": ["imports are immutable"],
      "/bad13.js": ["imports are immutable"],
      "/bad14.js": ["imports are immutable"],
      "/bad15.js": ["imports are immutable"],
    },
  });
  itBundled("default/AssignToImportNoBundle", {
    todo: true,
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
    bundleErrors: {
      // TODO: get exact errors here. when you do this make sure all bad* files are covered
      "/bad0.js": ["imports are immutable"],
      "/bad1.js": ["imports are immutable"],
      "/bad2.js": ["imports are immutable"],
      "/bad3.js": ["imports are immutable"],
      "/bad4.js": ["imports are immutable"],
      "/bad5.js": ["imports are immutable"],
      "/bad6.js": ["imports are immutable"],
      "/bad11.js": ["imports are immutable"],
      "/bad12.js": ["imports are immutable"],
    },
    external: ["foo"],
  });
  itBundled("default/MinifyArguments", {
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
    format: "iife",
    onAfterBundle(api) {
      assert(!api.readFile("/out.js").includes("let arguments"), "let arguments should've been minified");
      assert(!api.readFile("/out.js").includes("var arguments"), "let arguments should've been minified");
      assert(api.readFile("/out.js").includes("arguments"), "x = arguments should not have been minified");
    },
  });
  // TODO: this test is very subjective considering bun's warnings may not match esbuild.
  // This test checks for various cases where code throws warnings, and makes sure that the warnings
  // are not present when they appear in `node_modules`
  const WarningsInsideNodeModules = {
    "/dup-case.js": `switch (x) { case 0: case 0: }`,
    "/not-in.js": `!a in b`,
    "/not-instanceof.js": `!a instanceof b`,
    "/return-asi.js": `return\n123`,
    "/bad-typeof.js": `typeof x == 'null'`,
    "/equals-neg-zero.js": `x === -0`,
    "/equals-nan.js": `x === NaN`,
    "/equals-object.js": `x === []`,
    "/write-getter.js": `class Foo { get #foo() {} foo() { this.#foo = 123 } }`,
    "/read-setter.js": `class Foo { set #foo(x) {} foo() { return this.#foo } }`,
    "/delete-super.js": `class Foo extends Bar { foo() { delete super.foo } }`,
  };
  itBundled("default/WarningsInsideNodeModules", {
    todo: true,
    files: {
      "/entry.js": Object.keys(WarningsInsideNodeModules)
        .map(file => `import "./${file}"; import "./node_modules/${file}"; import "@plugin/${file}"`)
        .join("\n"),
      ...Object.fromEntries(
        Object.entries(WarningsInsideNodeModules).flatMap(([file, code]) => [
          [file, code],
          [`/node_modules${file}`, code],
          [`/node_modules/@plugin${file}`, code],
        ]),
      ),
    },
    bundleWarnings: {
      "/write-getter.js": [`Writing to getter-only property "#foo" will throw`],
      "/read-setter.js": [`Reading from setter-only property "#foo" will throw`],
    },
  });
  itBundled("default/RequireResolve", {
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
    target: "node",
    format: "cjs",
    bundleErrors: {
      "/entry.js": [
        'Could not resolve: "./missing-file"',
        'Could not resolve: "missing-pkg"',
        'Could not resolve: "@scope/missing-pkg"',
      ],
    },
    external: ["external-pkg", "@scope/external-pkg", "{{root}}/external-file"],
  });
  itBundled("default/InjectMissing", {
    files: {
      "/entry.js": ``,
    },
    inject: ["/inject.js"],
    bundleErrors: {
      "/entry.js": ['Could not resolve "/inject.js"'],
    },
  });
  itBundled("default/InjectDuplicate", {
    files: {
      "/entry.js": ``,
      "/inject.js": `console.log('injected')`,
    },
    inject: ["/inject.js", "/inject.js"],
    bundleErrors: {
      "/entry.js": ['Duplicate injected file "/inject.js"'],
    },
  });
  // TODO: runtime checks for these next two. i think esbuild is doing this one wrong.
  itBundled("default/Inject", {
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
        export let injectedAndDefined = 'should not be used FAILED'
        let injected_and_defined = 'should not be used FAILED'
        export { injected_and_defined as 'injected.and.defined' }
      `,
      "/node_modules/unused/index.js": `console.log('This is unused but still has side effects')`,
      "/node_modules/sideEffects-false/index.js": `console.log('This is unused and has no side effects. FAILED')`,
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
      "/collision.js": `export let collide = "FAILED"`,
      "/re-export.js": /* js */ `
        export {re_export} from 'external-pkg'
        export {'re.export'} from 'external-pkg2'
      `,
    },
    format: "esm",
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
    external: ["external-pkg", "external-pkg2"],
    runtimeFiles: {
      "/node_modules/external-pkg/index.js": `export let re_export = '1'`,
      "/node_modules/external-pkg2/index.js": `export let x = '2'; export { x as 're.export' }`,
    },
    dce: true,
    run: {
      stdout: `
        side effects
        This is unused but still has side effects
        this should be renamed
        undefined
        defined
        should be used
        should be used
        [Function: test]
        [Function: test]
        123
        1
        2
      `,
    },
  });
  itBundled("default/InjectNoBundle", {
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
        export let injectedAndDefined = 'should not be used FAILED'
        let injected_and_defined = 'should not be used FAILED'
        export { injected_and_defined as 'injected.and.defined' }
      `,
      "/node_modules/unused/index.js": `console.log('This is unused but still has side effects')`,
      "/node_modules/sideEffects-false/index.js": `console.log('This is unused and has no side effects. FAILED')`,
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
      "/collision.js": `export let collide = "FAILED"`,
      "/re-export.js": /* js */ `
        export {re_export} from 'external-pkg'
        export {'re.export'} from 'external-pkg2'
      `,
    },
    format: "esm",
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
    runtimeFiles: {
      "/node_modules/external-pkg/index.js": `export let re_export = '1'`,
      "/node_modules/external-pkg2/index.js": `export let x = '2'; export { x as 're.export' }`,
    },
    dce: true,
    treeShaking: true,
    bundling: false,
    run: {
      stdout: `
        side effects
        This is unused but still has side effects
        this should be renamed
        undefined
        defined
        should be used
        should be used
        [Function: test]
        [Function: test]
        123
        1
        2
      `,
    },
  });
  // itBundled("default/InjectJSX", {
  //   files: {
  //     "/entry.jsx": `console.log(<><div/></>)`,
  //     "/inject.js": /* js */ `
  //       export function el() {}
  //       export function frag() {}
  //     `,
  //   },
  //   define: {
  //     "React.createElement": "el",
  //     "React.Fragment": "frag",
  //   },
  //   inject: ["/inject.js"],
  // });
  // itBundled("default/InjectJSXDotNames", {
  //   // GENERATED
  //   files: {
  //     "/entry.jsx": `console.log(<><div/></>)`,
  //     "/inject.js": /* js */ `
  //       function el() {}
  //       function frag() {}
  //       export {
  //         el as 'React.createElement',
  //         frag as 'React.Fragment',
  //       }
  //     `,
  //   },
  // });
  // itBundled("default/InjectImportTS", {
  //   // GENERATED
  //   files: {
  //     "/entry.ts": `console.log('here')`,
  //     "/inject.js": /* js */ `
  //       // Unused imports are automatically removed in TypeScript files (this
  //       // is a mis-feature of the TypeScript language). However, injected
  //       // imports are an esbuild feature so we get to decide what the
  //       // semantics are. We do not want injected imports to disappear unless
  //       // they have been explicitly marked as having no side effects.
  //       console.log('must be present')
  //     `,
  //   },
  //   format: "esm",
  // });
  // itBundled("default/InjectImportOrder", {
  //   // GENERATED
  //   files: {
  //     "/entry.ts": /* ts */ `
  //       import 'third'
  //       console.log('third')
  //     `,
  //     "/inject-1.js": /* js */ `
  //       import 'first'
  //       console.log('first')
  //     `,
  //     "/inject-2.js": /* js */ `
  //       import 'second'
  //       console.log('second')
  //     `,
  //   },
  //   inject: ["/inject-1.js", "/inject-2.js"],
  // });
  // itBundled("default/InjectAssign", {
  //   // GENERATED
  //   files: {
  //     "/entry.js": /* js */ `
  //       test = true
  //       foo.bar = true
  //       defined = true
  //     `,
  //     "/inject.js": /* js */ `
  //       export let test = 0
  //       let fooBar = 1
  //       let someDefine = 2
  //       export { fooBar as 'foo.bar' }
  //       export { someDefine as 'some.define' }
  //     `,
  //   },
  //   inject: ["/inject.js"],
  //   define: {
  //     defined: "some.define",
  //   },
  // });
  // itBundled("default/InjectWithDefine", {
  //   files: {
  //     "/entry.js": /* js */ `
  //       console.log(
  //         // define wins over inject
  //         both === 'define',
  //         bo.th === 'defi.ne',
  //         // define forwards to inject
  //         first === 'success (identifier)',
  //         fir.st === 'success (dot name)',
  //       )
  //     `,
  //     "/inject.js": /* js */ `
  //       export let both = 'inject'
  //       export let first = 'TEST FAILED!'
  //       export let second = 'success (identifier)'

  //       let both2 = 'inject'
  //       let first2 = 'TEST FAILED!'
  //       let second2 = 'success (dot name)'
  //       export {
  //         both2 as 'bo.th',
  //         first2 as 'fir.st',
  //         second2 as 'seco.nd',
  //       }
  //     `,
  //   },
  //   inject: ["/inject.js"],
  //   define: {
  //     "both": '"define"',
  //     "bo.th": '"defi.ne"',
  //     "first": "second",
  //     "fir.st": "seco.nd",
  //   },
  // });
  itBundled("default/Outbase", {
    files: {
      "/a/b/c.js": `console.log('c')`,
      "/a/b/d.js": `console.log('d')`,
    },
    entryPointsRaw: ["a/b/c.js", "a/b/d.js"],
    root: "/",
    onAfterBundle(api) {
      api.assertFileExists("/out/a/b/c.js");
      api.assertFileExists("/out/a/b/d.js");
    },
  });
  itBundled("default/AvoidTDZ", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          static foo = new Foo
        }
        let foo = Foo.foo
        console.log(JSON.stringify(foo))
        export class Bar {}
        export let bar = 123
      `,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        import * as mod from './out';
        console.log(JSON.stringify(mod));
      `,
    },
    run: {
      file: "/test.js",
      stdout: '{}\n{"bar":123}',
    },
  });
  itBundled("default/AvoidTDZNoBundle", {
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
    bundling: false,
    runtimeFiles: {
      "/test.js": /* js */ `
        import * as mod from './out';
        console.log(JSON.stringify(mod));
      `,
    },
    run: {
      file: "/test.js",
      stdout: 'Foo {}\n{"bar":123}',
    },
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
    files: {
      "/replaced.js": `console.log(import.meta.x)`,
      "/kept.js": `console.log(import.meta.y)`,
      "/dead-code.js": `var x = () => console.log(import.meta.z)`,
    },
    entryPoints: ["/replaced.js", "/kept.js", "/dead-code.js"],
    define: {
      "import.meta.x": 1,
    },
    unsupportedJSFeatures: ["import-meta"],
    run: [
      { file: "/out/replaced.js", stdout: "1" },
      { file: "/out/kept.js", stdout: "undefined" },
    ],
    onAfterBundle(api) {
      api.expectFile("/out/dead-code.js").toBe("");
    },
  });
  // itBundled("default/InjectImportMeta", {
  //   // GENERATED
  //   files: {
  //     "/entry.js": /* js */ `
  //       console.log(
  //         // These should be fully substituted
  //         import.meta,
  //         import.meta.foo,
  //         import.meta.foo.bar,

  //         // Should just substitute "import.meta.foo"
  //         import.meta.foo.baz,

  //         // This should not be substituted
  //         import.meta.bar,
  //       )
  //     `,
  //     "/inject.js": /* js */ `
  //       let foo = 1
  //       let bar = 2
  //       let baz = 3
  //       export {
  //         foo as 'import.meta',
  //         bar as 'import.meta.foo',
  //         baz as 'import.meta.foo.bar',
  //       }
  //     `,
  //   },
  // });
  itBundled("default/DefineThis", {
    todo: true,
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
        export default function() {
          doNotSubstitute(
            this,
            this.foo,
            this.foo.bar,
            this.foo.baz,
            this.bar,
          );
        };
      `,
    },
    define: {
      this: "_replaced",
      "this.foo.bar": "_replaced_foo_bar",
      "this.foo": "_replaced_foo",
    },
    onAfterBundle(api) {
      const split = api.readFile("/out.js").split("doNotSubstitute");
      expect(split.length).toBe(2);
      assert(!split[0].includes("this"), "this should not be substituted in the first two cases");
      assert([...split[1].matchAll(/this/g)].length === 5, "there should be 5 mentions of this in the third case");
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.ok = (...args) => console.log(JSON.stringify(args));
        globalThis.doNotSubstitute = (...args) => console.log(JSON.stringify(args));
        globalThis._replaced = { foo: 1 };
        globalThis._replaced_foo = { baz: 2 };
        globalThis._replaced_foo_bar = 3;
        const { default: fn } = await import('./out.js');

        fn.call({
          foo: {
            bar: 4,
            baz: 5,
          },
          bar: 6,
        });
      `,
    },
    run: {
      file: "/test.js",
      stdout: `
        [{"foo":1},{"baz":2},3,2,null]
        [{"foo":1},{"baz":2},3,2,null]
        [{"foo":{"bar":4,"baz":5},"bar":6},{"bar":4,"baz":5},4,5,6]
      `,
    },
  });
  itBundled("default/DefineOptionalChain", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        log([
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
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.log = (...args) => console.log(JSON.stringify(args));
        globalThis.a = { B: { C: 2 } };
        globalThis.b = "B";
        globalThis.c = "C";
        await import('./out.js');
      `,
    },
    run: {
      file: "/test.js",
      stdout: `[[1,1,1],[1,1,1],[2,2,2]]`,
    },
  });
  itBundled("default/DefineOptionalChainLowered", {
    files: {
      "/entry.js": /* js */ `
        log([
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
          a?.[d][c],
          a[d]?.[e],
        ])
      `,
    },
    unsupportedJSFeatures: ["optional-chain"],
    define: {
      "a.b.c": 1,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.log = (...args) => console.log(JSON.stringify(args));
        globalThis.a = { B: { C: 2 }, D: { } };
        globalThis.b = "B";
        globalThis.c = "C";
        globalThis.d = "D";
        globalThis.e = "E";
        await import('./out.js');
      `,
    },
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      assert(!code.includes("?."), "code should not contain optional chaining");
    },
    run: {
      file: "/test.js",
      stdout: `[[1,1,1],[1,1,1],[2,2,2,null,null]]`,
    },
  });
  itBundled("default/DefineInfiniteLoopESBuildIssue2407", {
    todo: true,
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
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.b = { c: () => console.log('1') };
        globalThis.y = () => console.log('2');
        await import('./out.js');
      `,
    },
    run: {
      file: "/test.js",
      stdout: "1\n2",
    },
  });
  // TODO: this doesnt warn in esbuild ???
  // itBundled("default/DefineAssignWarning", {
  //   // GENERATED
  //   files: {
  //     "/read.js": /* js */ `
  //       console.log(
  //         [a, b.c, b['c']],
  //         [d, e.f, e['f']],
  //         [g, h.i, h['i']],
  //       )
  //     `,
  //     "/write.js": /* js */ `
  //       console.log(
  //         [a = 0, b.c = 0, b['c'] = 0],
  //         [d = 0, e.f = 0, e['f'] = 0],
  //         [g = 0, h.i = 0, h['i'] = 0],
  //       )
  //     `,
  //   },
  //   entryPoints: ["/read.js", "/write.js"],
  //   define: {
  //     a: "null",
  //     "b.c": "null",
  //     d: "ident",
  //     "e.f": "ident",
  //     g: "dot.chain",
  //     "h.i": "dot.chain",
  //   },
  // });
  itBundled("default/KeepNamesTreeShaking", {
    files: {
      "/entry.js": /* js */ `
        (function() {
          function fnStmtRemove() {}
          function fnStmtKeep() {}
          x = fnStmtKeep
    
          let fnExprRemove = function remove() {}
          let fnExprKeep = function keepFn() {}
          x = fnExprKeep
    
          class clsStmtRemove {}
          class clsStmtKeep {}
          new clsStmtKeep()
    
          let clsExprRemove = class remove {}
          let clsExprKeep = class keepClass {}
          new clsExprKeep()
        })();
      `,
    },
    keepNames: true,
    dce: true,
    onAfterBundle(api) {
      // to properly check that keep names actually worked, we need to minify the
      // file and THEN check for the names. we do this separatly just so that we know that
      // the bundler's minifier doesn't mess anything up.
      Bun.spawnSync([ESBUILD_PATH, "--minify-identifiers", "--outfile=out.min.js", "out.js"], { cwd: api.root });
      const code = api.readFile("/out.min.js");
      const checks = ["fnStmtKeep", "keepFn", "clsStmtKeep", "keepClass"];
      for (const check of checks) {
        assert(code.includes(check), `code should contain ${check} past minifying`);
      }
    },
  });
  itBundled("default/KeepNamesClassStaticName", {
    files: {
      "/entry.js": /* js */ `
        class ClassName1A { static foo = 1 }
        class ClassName1B { static name = 2 }
        class ClassName1C { static name() {} }
        class ClassName1D { static get name() {} }
        class ClassName1E { static set name(x) {} }
        class ClassName1F { static ['name'] = 0 }
  
        let a = class ClassName2a { static foo }
        let b = class ClassName2b { static name }
        let c = class ClassName2c { static name() {} }
        let d = class ClassName2d { static get name() {} }
        let e = class ClassName2e { static set name(x) {} }
        let f = class ClassName2f { static ['name'] = 0 }
  
        let ClassName_a2 = class { static foo }
        let ClassName_b2 = class { static name }
        let ClassName_c2 = class { static name() {} }
        let ClassName_d2 = class { static get name() {} }
        let ClassName_e2 = class { static set name(x) {} }
        let ClassName_f2 = class { static ['name'] = 0 }

        export { ClassName1A, ClassName1B, ClassName1C, ClassName1D, ClassName1E, ClassName1F, a, b, c, d, e, f, ClassName_a2 as a2, ClassName_b2 as b2,ClassName_c2 as c2,ClassName_d2 as d2,ClassName_e2 as e2,ClassName_f2 as f2 }
      `,
    },
    keepNames: true,
    onAfterBundle(api) {
      // to properly check that keep names actually worked, we need to minify the
      // file and THEN check for the names. we do this separatly just so that we know that
      // the bundler's minifier doesn't mess anything up.
      Bun.spawnSync([ESBUILD_PATH, "--minify-identifiers", "--outfile=out.min.js", "out.js"], { cwd: api.root });
      const code = api.readFile("/out.min.js");
      const checks = [
        "ClassName1A",
        "ClassName1B",
        "ClassName1C",
        "ClassName1D",
        "ClassName1E",
        "ClassName1F",
        "ClassName2a",
        "ClassName2b",
        "ClassName2c",
        "ClassName2d",
        "ClassName2e",
        "ClassName2f",
        "ClassName_a2",
        "ClassName_b2",
        "ClassName_c2",
        "ClassName_d2",
        "ClassName_e2",
        "ClassName_f2",
      ];
      for (const check of checks) {
        assert(code.includes(check), `code should contain ${check} past minifying`);
      }
    },
  });
  itBundled("default/CharFreqIgnoreComments", {
    todo: true,
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
    minifyIdentifiers: true,
    entryPoints: ["/a.js", "/b.js"],
    onAfterBundle(api) {
      function capture(str: string) {
        return str.match(/function.*?\(\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+)\)/)!.slice(1);
      }
      const a = capture(api.readFile("/out/a.js"));
      const b = capture(api.readFile("/out/b.js"));
      expect(a).not.toEqual(["one", "two", "three", "four"]);
      expect(b).not.toEqual(["one", "two", "three", "four"]);
      try {
        expect(a).toEqual(b);
      } catch (error) {
        console.error("Comments should not affect minified names!");
        throw error;
      }
    },
  });
  itBundled("default/ImportRelativeAsPackage", {
    files: {
      "/Users/user/project/src/entry.js": `import 'some/other/file'`,
      "/Users/user/project/src/some/other/file.js": ``,
    },
    bundleErrors: {
      "/Users/user/project/src/entry.js": [`Could not resolve: "some/other/file". Maybe you need to "bun install"?`],
    },
  });
  itBundled("default/ForbidConstAssignWhenBundling", {
    files: {
      "/entry.js": /* js */ `
        const x = 1
        x = 2
      `,
    },
    bundleErrors: {
      "/entry.js": [`Cannot assign to "x" because it is a constant`],
    },
  });
  itBundled("default/ConstWithLet", {
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
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("const");
      assert([...code.matchAll(/let/g)].length === 3, "should have 3 let statements");
    },
  });
  // TODO: this fails on esbuild ???
  itBundled("default/ConstWithLetNoBundle", {
    todo: true,
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
    minifySyntax: true,
    bundling: false,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("const");
      assert([...code.matchAll(/let/g)].length === 3, "should have 3 let statements");
    },
  });
  itBundled("default/RequireMainCacheCommonJS", {
    files: {
      "/entry.js": /* js */ `
        console.log('is main:', require.main === module)
        console.log(require('./is-main'))
        console.log('cache:', require.cache);
      `,
      "/is-main.js": `module.exports = require.main === module`,
    },
    format: "cjs",
    platform: "node",
  });
  itBundled("default/ExternalES6ConvertedToCommonJS", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        console.log(JSON.stringify(require('./a')));
        console.log(JSON.stringify(require('./b')));
        console.log(JSON.stringify(require('./c')));
        console.log(JSON.stringify(require('./d')));
        console.log(JSON.stringify(require('./e')));
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
    external: ["x"],
    format: "esm",
    runtimeFiles: {
      "/node_modules/x/index.js": /* js */ `
        export const ns = 123
        export const ns2 = 456
      `,
    },
    run: {
      stdout: `
        {"ns":{"ns":123,"ns2":456}}
        {"ns":{"ns":123,"ns2":456}}
        {"ns":{"ns":123,"ns2":456}}
        {"ns":123}
        {"ns":123,"ns2":456}
      `,
    },
  });
  // TODO:
  // itBundled("default/CallImportNamespaceWarning", {
  //   files: {
  //     "/js.js": /* js */ `
  //       import * as a from "a"
  //       import {b} from "b"
  //       import c from "c"
  //       a()
  //       b()
  //       c()
  //       new a()
  //       new b()
  //       new c()
  //     `,
  //     "/ts.ts": /* ts */ `
  //       import * as a from "a"
  //       import {b} from "b"
  //       import c from "c"
  //       a()
  //       b()
  //       c()
  //       new a()
  //       new b()
  //       new c()
  //     `,
  //     "/jsx-components.jsx": /* jsx */ `
  //       import * as A from "a"
  //       import {B} from "b"
  //       import C from "c"
  //       <A/>;
  //       <B/>;
  //       <C/>;
  //     `,
  //     "/jsx-a.jsx": /* jsx */ `
  //       // @jsx a
  //       import * as a from "a"
  //       <div/>
  //     `,
  //     "/jsx-b.jsx": /* jsx */ `
  //       // @jsx b
  //       import {b} from "b"
  //       <div/>
  //     `,
  //     "/jsx-c.jsx": /* jsx */ `
  //       // @jsx c
  //       import c from "c"
  //       <div/>
  //     `,
  //   },
  //   entryPoints: ["/js.js", "/ts.ts", "/jsx-components.jsx", "/jsx-a.jsx", "/jsx-b.jsx", "/jsx-c.jsx"],
  //   external: ["a", "b", "c", "react/jsx-dev-runtime"],
  // });
  // I cant get bun to use `this` as the JSX runtime. It's a pretty silly idea anyways.
  // itBundled("default/JSXThisValueCommonJS", {
  //   files: {
  //     "/factory.jsx": /* jsx */ `
  //       CHECK1(<x />);
  //       CHECK1(/* @__PURE__ */ this('x', null));
  //       f = function() {
  //         CHECK2(<y />);
  //         CHECK2(/* @__PURE__ */ this('y', null));
  //       }
  //     `,
  //     "/fragment.jsx": /* jsx */ `
  //       console.log([
  //         <>x</>,
  //         /* @__PURE__ */ this(this, null, 'x'),
  //       ]),
  //       f = function() {
  //         console.log([
  //           <>y</>,
  //           /* @__PURE__ */ this(this, null, 'y'),
  //         ])
  //       }
  //     `,
  //   },
  //   entryPoints: ["/factory.jsx", "/fragment.jsx"],
  //   external: ["react/jsx-dev-runtime", "react"],
  //   jsx: {
  //     development: false,
  //     automaticRuntime: false,
  //     factory: "this",
  //     fragment: "this",
  //   },
  // });
  // itBundled("default/JSXThisValueESM", {
  //   // GENERATED
  //   files: {
  //     "/factory.jsx": /* jsx */ `
  //       console.log([
  //         <x />,
  //         /* @__PURE__ */ this('x', null),
  //       ])
  //       f = function() {
  //         console.log([
  //           <y />,
  //           /* @__PURE__ */ this('y', null),
  //         ])
  //       }
  //       export {}
  //     `,
  //     "/fragment.jsx": /* jsx */ `
  //       console.log([
  //         <>x</>,
  //         /* @__PURE__ */ this(this, null, 'x'),
  //       ]),
  //       f = function() {
  //         console.log([
  //           <>y</>,
  //           /* @__PURE__ */ this(this, null, 'y'),
  //         ])
  //       }
  //       export {}
  //     `,
  //   },
  //   entryPoints: ["/factory.jsx", "/fragment.jsx"],
  //   jsx: {
  //     factory: "this",
  //     fragment: "this",
  //   },
  //   /* TODO FIX expectedScanLog: `factory.jsx: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  // factory.jsx: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  // fragment.jsx: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  // fragment.jsx: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  // `, */
  // });
  // itBundled("default/JSXThisPropertyCommonJS", {
  //   // GENERATED
  //   files: {
  //     "/factory.jsx": /* jsx */ `
  //       console.log([
  //         <x />,
  //         /* @__PURE__ */ this.factory('x', null),
  //       ])
  //       f = function() {
  //         console.log([
  //           <y />,
  //           /* @__PURE__ */ this.factory('y', null),
  //         ])
  //       }
  //     `,
  //     "/fragment.jsx": /* jsx */ `
  //       console.log([
  //         <>x</>,
  //         /* @__PURE__ */ this.factory(this.fragment, null, 'x'),
  //       ]),
  //       f = function() {
  //         console.log([
  //           <>y</>,
  //           /* @__PURE__ */ this.factory(this.fragment, null, 'y'),
  //         ])
  //       }
  //     `,
  //   },
  //   entryPoints: ["/factory.jsx", "/fragment.jsx"],
  //   jsx: {
  //     factory: "this.factory",
  //     fragment: "this.fragment",
  //   },
  // });
  // itBundled("default/JSXThisPropertyESM", {
  //   // GENERATED
  //   files: {
  //     "/factory.jsx": /* jsx */ `
  //       console.log([
  //         <x />,
  //         /* @__PURE__ */ this.factory('x', null),
  //       ])
  //       f = function() {
  //         console.log([
  //           <y />,
  //           /* @__PURE__ */ this.factory('y', null),
  //         ])
  //       }
  //       export {}
  //     `,
  //     "/fragment.jsx": /* jsx */ `
  //       console.log([
  //         <>x</>,
  //         /* @__PURE__ */ this.factory(this.fragment, null, 'x'),
  //       ]),
  //       f = function() {
  //         console.log([
  //           <>y</>,
  //           /* @__PURE__ */ this.factory(this.fragment, null, 'y'),
  //         ])
  //       }
  //       export {}
  //     `,
  //   },
  //   entryPoints: ["/factory.jsx", "/fragment.jsx"],
  //   jsx: {
  //     factory: "this.factory",
  //     fragment: "this.fragment",
  //   },
  //   /* TODO FIX expectedScanLog: `factory.jsx: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  // factory.jsx: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  // fragment.jsx: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  // fragment.jsx: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  // `, */
  // });
  // itBundled("default/JSXImportMetaValue", {
  //   // GENERATED
  //   files: {
  //     "/factory.jsx": /* jsx */ `
  //       console.log([
  //         <x />,
  //         /* @__PURE__ */ import.meta('x', null),
  //       ])
  //       f = function() {
  //         console.log([
  //           <y />,
  //           /* @__PURE__ */ import.meta('y', null),
  //         ])
  //       }
  //       export {}
  //     `,
  //     "/fragment.jsx": /* jsx */ `
  //       console.log([
  //         <>x</>,
  //         /* @__PURE__ */ import.meta(import.meta, null, 'x'),
  //       ]),
  //       f = function() {
  //         console.log([
  //           <>y</>,
  //           /* @__PURE__ */ import.meta(import.meta, null, 'y'),
  //         ])
  //       }
  //       export {}
  //     `,
  //   },
  //   entryPoints: ["/factory.jsx", "/fragment.jsx"],
  //   unsupportedJSFeatures: "ImportMeta",
  //   jsx: {
  //     factory: "import.meta",
  //     fragment: "import.meta",
  //   },
  //   /* TODO FIX expectedScanLog: `factory.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  // factory.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  // fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  // fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  // fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  // fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  // `, */
  // });
  // itBundled("default/JSXImportMetaProperty", {
  //   // GENERATED
  //   files: {
  //     "/factory.jsx": /* jsx */ `
  //       console.log([
  //         <x />,
  //         /* @__PURE__ */ import.meta.factory('x', null),
  //       ])
  //       f = function() {
  //         console.log([
  //           <y />,
  //           /* @__PURE__ */ import.meta.factory('y', null),
  //         ])
  //       }
  //       export {}
  //     `,
  //     "/fragment.jsx": /* jsx */ `
  //       console.log([
  //         <>x</>,
  //         /* @__PURE__ */ import.meta.factory(import.meta.fragment, null, 'x'),
  //       ]),
  //       f = function() {
  //         console.log([
  //           <>y</>,
  //           /* @__PURE__ */ import.meta.factory(import.meta.fragment, null, 'y'),
  //         ])
  //       }
  //       export {}
  //     `,
  //   },
  //   entryPoints: ["/factory.jsx", "/fragment.jsx"],
  //   unsupportedJSFeatures: "ImportMeta",
  //   jsx: {
  //     factory: "import.meta.factory",
  //     fragment: "import.meta.fragment",
  //   },
  //   /* TODO FIX expectedScanLog: `factory.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  // factory.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  // fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  // fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  // fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  // fragment.jsx: WARNING: "import.meta" is not available in the configured target environment and will be empty
  // `, */
  // });
  0;
  itBundled("default/BundlingFilesOutsideOfOutbase", {
    todo: true,
    files: {
      "/src/entry.js": `console.log('test')`,
    },
    splitting: true,
    outdir: "/out",
    format: "esm",
    root: "/some/nested/directory",
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
    files: relocateFiles,
    entryPoints: relocateEntries,
    format: "esm",
  });
  itBundled("default/VarRelocatingNoBundle", {
    files: relocateFiles,
    entryPoints: relocateEntries,
    format: "esm",
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
    external: ["external"],
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    format: "cjs",
  });
  // esbuild and bun do not give the warning. this is still set to undefined
  itBundled("default/ThisUndefinedWarningESM", {
    files: {
      "/entry.js": /* js */ `
        import x from './file1.js'
        import y from 'pkg/file2.js'
        console.log(x, y)
      `,
      "/file1.js": `export default [this, this]`,
      "/node_modules/pkg/file2.js": `export default [this, this]`,
    },
    run: {
      stdout: "[ null, null ] [ null, null ]",
    },
  });
  itBundled("default/QuotedProperty", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        import * as ns from 'ext'
        console.log(ns.mustBeUnquoted, ns['mustBeQuoted'])
      `,
    },
    external: ["ext"],
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain(`"mustBeUnquoted"`);
      expect(code).toContain(`"mustBeQuoted"`);
    },
  });
  itBundled("default/QuotedPropertyMangle", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from 'ext'
        console.log(ns.mustBeUnquoted, ns['mustBeUnquoted2'])
      `,
    },
    minifySyntax: true,
    external: ["ext"],
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).toContain(`.mustBeUnquoted`);
      expect(code).toContain(`.mustBeUnquoted2`);
    },
  });
  itBundled("default/DuplicatePropertyWarning", {
    todo: true,
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
    external: ["react"],
    bundleWarnings: {
      "/outside-node-modules/index.jsx": ['Duplicate key "a" in object literal', 'Duplicate key "a2" in JSX element'],
      "/outside-node-modules/package.json": ['Duplicate key "b" in object literal'],
    },
  });
  const RequireShimSubstitutionBrowser = itBundled("default/RequireShimSubstitutionBrowser", {
    files: {
      "/entry.js": /* js */ `
        Promise.all([
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
        ]).then(results => {
          for (let result of results) {
            if (typeof result === 'string' && result.startsWith(dirname)) {
              result = result.slice(dirname.length)
            }
            console.log(typeof result, JSON.stringify(result))
          }
        })
      `,
      "/example.json": `{ "works": true }`,
    },
    runtimeFiles: {
      "/test.mjs": `
        import { createRequire } from "module";
        const require = createRequire(import.meta.url);
        import { fileURLToPath } from "url";
        import { dirname } from "path";
        globalThis.dirname = dirname(fileURLToPath(import.meta.url));
        globalThis.window = globalThis
        window.SOME_PATH = 'second-path'
        window.require = require
        window.module = { require: (x) => 'dynamic req: ' + x }
        await import('./out.mjs')
      `,
      "/node_modules/some-path/index.js": `module.exports = 123`,
      "/node_modules/second-path/index.js": `module.exports = 567`,
    },
    target: "browser",
    format: "esm",
    outfile: "/out.mjs",
    external: ["*"],
    run: {
      runtime: "node",
      file: "/test.mjs",
      // using os slashes here is correct because we run the bundle in bun.
      stdout: `
          function undefined
          string "function"
          object {"works":true}
          object {"works":true}
          number 567
          object {"works":true}
          object {"works":true}
          number 567
          string ${JSON.stringify(osSlashes("/node_modules/some-path/index.js"))}
          string ${JSON.stringify(osSlashes("/node_modules/second-path/index.js"))}
          object {"default":123}
          object {"default":567}
        `,
    },
  });
  itBundled("default/RequireShimSubstitutionNode", {
    files: RequireShimSubstitutionBrowser.options.files,
    runtimeFiles: RequireShimSubstitutionBrowser.options.runtimeFiles,
    target: "node",
    format: "esm",
    outfile: "/out.mjs",
    external: ["*"],
    run: {
      runtime: "node",
      file: "/test.mjs",
      stdout: `
        function undefined
        string "function"
        object {"works":true}
        object {"works":true}
        number 567
        object {"works":true}
        object {"works":true}
        number 567
        string ${JSON.stringify(osSlashes("/node_modules/some-path/index.js"))}
        string ${JSON.stringify(osSlashes("/node_modules/second-path/index.js"))}
        object {"default":123}
        object {"default":567}
      `,
    },
  });
  itBundled("default/StrictModeNestedFnDeclKeepNamesVariableInliningESBuildIssue1552", {
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
    minifySyntax: true,
  });
  itBundled("default/BuiltInNodeModulePrecedence", {
    todo: true,
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
        ].map(x => typeof x).join(','))
      `,
      "/node_modules/fs/abc.js": `console.log('include this')`,
      "/node_modules/fs/index.js": `console.log('include this too')`,
      "/node_modules/fs/promises.js": `throw 'DO NOT INCLUDE THIS'`,
    },
    target: "node",
    runtimeFiles: {
      "/node_modules/node_foo/index.js": `console.log('include this too')`,
    },
    onAfterBundle(api) {
      api.writeFile("/out.js", api.readFile("/out.js").replace(/node:foo/g, "node_foo"));
    },
    run: {
      runtime: "node",
      stdout: `
        include this too
        include this
        include this too
        object,object,object,object,object
      `,
    },
  });
  itBundled("default/EntryNamesNoSlashAfterDir", {
    // GENERATED
    files: {
      "/src/app1/main.ts": `console.log(1)`,
      "/src/app2/main.ts": `console.log(2)`,
      "/src/app3/main.ts": `console.log(3)`,
    },
    entryPoints: ["/src/app1/main.ts", "/src/app2/main.ts", "/src/app3/main.ts"],
    outputPaths: ["/out/app1-main.js", "/out/app2-main.js", "/out/app3-main.js"],
    entryNaming: "[dir]-[name].[ext]",
  });
  // itBundled("default/EntryNamesNonPortableCharacter", {
  //   // GENERATED
  //   // TODO: I think this is impossible with the CLI. and also very unsafe with paths.
  //   files: {
  //     "/entry1-*.ts": `console.log(1)`,
  //     "/entry2-*.ts": `console.log(2)`,
  //   },
  //   entryPointsAdvanced: [
  //     // The "*" should turn into "_" for cross-platform Windows portability
  //     { input: "/entry1-*.ts" },
  //     // The "*" should be preserved since the user _really_ wants it
  //     { input: "/entry2-*.ts", output: "entry2-*" },
  //   ],
  //   mode: "passthrough",
  // });
  // itBundled("default/EntryNamesChunkNamesExtPlaceholder", {
  //   files: {
  //     "/src/entries/entry1.js": `import "../lib/shared.js"; import "./entry1.css"; console.log('entry1')`,
  //     "/src/entries/entry2.js": `import "../lib/shared.js"; import "./entry2.css"; console.log('entry2')`,
  //     "/src/entries/entry1.css": `a:after { content: "entry1" }`,
  //     "/src/entries/entry2.css": `a:after { content: "entry2" }`,
  //     "/src/lib/shared.js": `console.log('shared')`,
  //   },
  //   entryPoints: ["/src/entries/entry1.js", "/src/entries/entry2.js"],
  //   root: "/src",
  //   splitting: true,
  //   entryNaming: "main/[ext]/[name]-[hash].[ext]",
  // });
  itBundled("default/MinifyIdentifiersImportPathFrequencyAnalysis", {
    files: {
      "/import.js": /* js */ `
        import foo from "./WWWWWWWWWWXXXXXXXXXXYYYYYYYYYYZZZZZZZZZZ"
        console.log(foo, remove('no identifier in this file should be named W, X, Y, or Z'))
      `,
      "/WWWWWWWWWWXXXXXXXXXXYYYYYYYYYYZZZZZZZZZZ.js": `export default 123`,
      "/require.js": /* js */ `
        const foo = require("./AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDD")
        console.log(foo, remove('no identifier in this file should be named A, B, C, or D'))
      `,
      "/AAAAAAAAAABBBBBBBBBBCCCCCCCCCCDDDDDDDDDD.js": `module.exports = 123`,
    },
    entryPoints: ["/import.js", "/require.js"],
    minifyWhitespace: true,
    minifyIdentifiers: true,
    onAfterBundle(api) {
      let importFile = api
        .readFile("/out/import.js")
        .replace(/remove\(.*?\)/g, "remove()")
        .replace(/Object\.[a-z]+\b/gi, "null");
      let requireFile = api
        .readFile("/out/require.js")
        .replace(/remove\(.*?\)/g, "remove()")
        .replace(/Object\.[a-z]+\b/gi, "null");
      assert(
        !["W", "X", "Y", "Z"].some(x => importFile.includes(x)),
        'import.js should not contain "W", "X", "Y", or "Z"',
      );
      assert(
        !["A", "B", "C", "D"].some(x => requireFile.includes(x)),
        'require.js should not contain "A", "B", "C", or "D"',
      );
    },
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
    bundling: false,
  });
  itBundled("default/NamedFunctionExpressionArgumentCollision", {
    files: {
      "/entry.js": /* js */ `
        let x = function foo(foo) {
          var foo;
          return foo;
        }
        console.log(x(123))
      `,
    },
    minifySyntax: true,
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
    external: ["bar"],
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
    bundling: false,
    mangleProps: /_$/,
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
    bundling: false,
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
    bundling: false,
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
    mangleProps: /_$/,
    bundling: false,
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
    bundling: false,
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
    bundling: false,
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
    mangleProps: /_$/,
    bundling: false,
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
    mangleProps: /_$/,
  });
  itBundled("default/ManglePropsJSXTransform", {
    // GENERATED
    todo: true,
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
  });
  itBundled("default/ManglePropsJSXPreserve", {
    // GENERATED
    todo: true,
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
  });
  itBundled("default/ManglePropsJSXTransformNamespace", {
    // GENERATED
    todo: true,
    files: {
      "/entry.jsx": /* jsx */ `
        export default [
          <KEEP_THIS_ />,
          <KEEP:THIS_ />,
          <foo KEEP:THIS_ />,
        ]
      `,
    },
  });
  itBundled("default/ManglePropsAvoidCollisions", {
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
    mangleProps: /_$/,
  });
  itBundled("default/ManglePropsTypeScriptFeatures", {
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
    mangleProps: /_$/,
  });
  itBundled("default/ManglePropsShorthand", {
    files: {
      "/entry.js": /* js */ `
        // This should print as "({ y }) => ({ y })" not "({ y: y }) => ({ y: y })"
        export let yyyyy = ({ xxxxx }) => ({ xxxxx })
      `,
    },
    mangleProps: /x/,
  });
  itBundled("default/ManglePropsNoShorthand", {
    files: {
      "/entry.js": /* js */ `
        // This should print as "({ y }) => ({ y: y })" not "({ y: y }) => ({ y: y })"
        export let yyyyy = ({ xxxxx }) => ({ xxxxx })
      `,
    },
    mangleProps: /x/,
    minifyIdentifiers: true,
  });
  itBundled("default/ManglePropsLoweredClassFields", {
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
    unsupportedJSFeatures: ["class-field", "class-static-field"],
  });
  itBundled("default/ManglePropsSuperCall", {
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
    mangleProps: /./,
  });
  itBundled("default/MangleNoQuotedProps", {
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
    minifySyntax: true,
  });
  itBundled("default/MangleQuotedProps", {
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
  });
  itBundled("default/MangleQuotedPropsMinifySyntax", {
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
    minifySyntax: true,
  });
  // we dont check debug messages
  // itBundled("default/IndirectRequireMessage", {
  //   // GENERATED
  //   files: {
  //     "/array.js": `let x = [require]`,
  //     "/assign.js": `require = x`,
  //     "/ident.js": `let x = require`,
  //     "/dot.js": `let x = require.cache`,
  //     "/index.js": `let x = require[cache]`,
  //   },
  //   entryPoints: ["/array.js", "/assign.js", "/dot.js", "/ident.js", "/index.js"],
  //   /* TODO FIX expectedScanLog: `array.js: DEBUG: Indirect calls to "require" will not be bundled
  // assign.js: DEBUG: Indirect calls to "require" will not be bundled
  // ident.js: DEBUG: Indirect calls to "require" will not be bundled
  // `, */
  // });
  // itBundled("default/AmbiguousReexportMsg", {
  //   // GENERATED
  //   files: {
  //     "/entry.js": /* js */ `
  //       export * from './a'
  //       export * from './b'
  //       export * from './c'
  //     `,
  //     "/a.js": `export let a = 1, x = 2`,
  //     "/b.js": `export let b = 3; export { b as x }`,
  //     "/c.js": `export let c = 4, x = 5`,
  //   },
  //   /* TODO FIX expectedCompileLog: `DEBUG: Re-export of "x" in "entry.js" is ambiguous and has been removed
  // a.js: NOTE: One definition of "x" comes from "a.js" here:
  // b.js: NOTE: Another definition of "x" comes from "b.js" here:
  // `, */
  // });
  itBundled("default/NonDeterminismESBuildIssue2537", {
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
    minifyIdentifiers: true,
  });
  // itBundled("default/MinifiedJSXPreserveWithObjectSpread", {
  //   // GENERATED
  //   files: {
  //     "/entry.jsx": /* jsx */ `
  //       const obj = {
  //         before,
  //         ...{ [key]: value },
  //         ...{ key: value },
  //         after,
  //       };
  //       <Foo
  //         before
  //         {...{ [key]: value }}
  //         {...{ key: value }}
  //         after
  //       />;
  //       <Bar
  //         {...{
  //           a,
  //           [b]: c,
  //           ...d,
  //           e,
  //         }}
  //       />;
  //     `,
  //   },
  //   jsx: {
  //     // preserve: true,
  //   },
  //   // minifySyntax: true,
  //   bundling: false,
  // });
  itBundled("default/PackageAlias", {
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
    alias: {
      "pkg1": "alias1",
      "pkg2": "alias2",
      "pkg3": "alias3",
      "@scope/pkg4": "alias4",
      "@scope/pkg5": "alias5",
      "@abs-path/pkg6": `/alias6/dir`,
      "@abs-path/pkg7": `/alias7/dir`,
      "@scope-only": "/alias8/dir",
      "slash": "/alias9/some/file.js",
      "prefix": "alias10",
      "@scope/prefix": "alias11",
    },
  });
  itBundled("default/PackageAliasMatchLongest", {
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
  // itBundled("default/ErrorsForAssertTypeJSON", {
  //   notImplemented: true,
  //   files: {
  //     "/js-entry.js": /* js */ `
  //       import all from './foo.json' assert { type: 'json' }
  //       import { default as def } from './foo.json' assert { type: 'json' }
  //       import { unused } from './foo.json' assert { type: 'json' }
  //       import { used } from './foo.json' assert { type: 'json' }
  //       import * as ns from './foo.json' assert { type: 'json' }
  //       use(used, ns.prop)
  //       export { exported } from './foo.json' assert { type: 'json' }
  //       import text from './foo.text' assert { type: 'json' }
  //       import file from './foo.file' assert { type: 'json' }
  //       import copy from './foo.copy' assert { type: 'json' }
  //     `,
  //     "/ts-entry.ts": /* ts */ `
  //       import all from './foo.json' assert { type: 'json' }
  //       import { default as def } from './foo.json' assert { type: 'json' }
  //       import { unused } from './foo.json' assert { type: 'json' }
  //       import { used } from './foo.json' assert { type: 'json' }
  //       import * as ns from './foo.json' assert { type: 'json' }
  //       use(used, ns.prop)
  //       export { exported } from './foo.json' assert { type: 'json' }
  //       import text from './foo.text' assert { type: 'json' }
  //       import file from './foo.file' assert { type: 'json' }
  //       import copy from './foo.copy' assert { type: 'json' }
  //     `,
  //     "/foo.json": `{ "used": 0, "unused": 0, "prop": 0, "exported": 0 }`,
  //     "/foo.text": `{ "used": 0, "unused": 0, "prop": 0, "exported": 0 }`,
  //     "/foo.file": `{ "used": 0, "unused": 0, "prop": 0, "exported": 0 }`,
  //     "/foo.copy": `{ "used": 0, "unused": 0, "prop": 0, "exported": 0 }`,
  //   },
  //   entryPoints: ["/js-entry.js", "/ts-entry.ts"],
  //   /* TODO FIX expectedScanLog: `js-entry.js: ERROR: Cannot use non-default import "unused" with a standard JSON module
  // js-entry.js: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  // NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "unused" import (which is non-standard behavior).
  // js-entry.js: ERROR: Cannot use non-default import "used" with a standard JSON module
  // js-entry.js: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  // NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "used" import (which is non-standard behavior).
  // js-entry.js: WARNING: Non-default import "prop" is undefined with a standard JSON module
  // js-entry.js: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  // NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "prop" import (which is non-standard behavior).
  // js-entry.js: ERROR: Cannot use non-default import "exported" with a standard JSON module
  // js-entry.js: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  // NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "exported" import (which is non-standard behavior).
  // js-entry.js: ERROR: The file "foo.text" was loaded with the "text" loader
  // js-entry.js: NOTE: This import assertion requires the loader to be "json" instead:
  // NOTE: You need to either reconfigure esbuild to ensure that the loader for this file is "json" or you need to remove this import assertion.
  // js-entry.js: ERROR: The file "foo.file" was loaded with the "file" loader
  // js-entry.js: NOTE: This import assertion requires the loader to be "json" instead:
  // NOTE: You need to either reconfigure esbuild to ensure that the loader for this file is "json" or you need to remove this import assertion.
  // ts-entry.ts: ERROR: Cannot use non-default import "used" with a standard JSON module
  // ts-entry.ts: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  // NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "used" import (which is non-standard behavior).
  // ts-entry.ts: WARNING: Non-default import "prop" is undefined with a standard JSON module
  // ts-entry.ts: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  // NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "prop" import (which is non-standard behavior).
  // ts-entry.ts: ERROR: Cannot use non-default import "exported" with a standard JSON module
  // ts-entry.ts: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  // NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "exported" import (which is non-standard behavior).
  // `, */
  // });
  // itBundled("default/OutputForAssertTypeJSON", {
  //   // GENERATED
  //   files: {
  //     "/js-entry.js": /* js */ `
  //       import all from './foo.json' assert { type: 'json' }
  //       import copy from './foo.copy' assert { type: 'json' }
  //       import { default as def } from './foo.json' assert { type: 'json' }
  //       import * as ns from './foo.json' assert { type: 'json' }
  //       use(all, copy, def, ns.prop)
  //       export { default } from './foo.json' assert { type: 'json' }
  //     `,
  //     "/ts-entry.ts": /* ts */ `
  //       import all from './foo.json' assert { type: 'json' }
  //       import copy from './foo.copy' assert { type: 'json' }
  //       import { default as def } from './foo.json' assert { type: 'json' }
  //       import { unused } from './foo.json' assert { type: 'json' }
  //       import * as ns from './foo.json' assert { type: 'json' }
  //       use(all, copy, def, ns.prop)
  //       export { default } from './foo.json' assert { type: 'json' }
  //     `,
  //     "/foo.json": `{}`,
  //     "/foo.copy": `{}`,
  //   },
  //   entryPoints: ["/js-entry.js", "/ts-entry.ts"],
  //   /* TODO FIX expectedScanLog: `js-entry.js: WARNING: Non-default import "prop" is undefined with a standard JSON module
  // js-entry.js: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  // NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "prop" import (which is non-standard behavior).
  // ts-entry.ts: WARNING: Non-default import "prop" is undefined with a standard JSON module
  // ts-entry.ts: NOTE: This is considered an import of a standard JSON module because of the import assertion here:
  // NOTE: You can either keep the import assertion and only use the "default" import, or you can remove the import assertion and use the "prop" import (which is non-standard behavior).
  // `, */
  // });
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
    bundling: false,
    metafile: true,
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
    todo: true,
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
        while (/*foo*/a);
        do {} while (/*foo*/a);
        switch (/*foo*/a) {}
      `,
    },
    external: ["foo"],
    onAfterBundle(api) {
      const commentCounts: Record<string, number> = {
        before: 44,
        after: 18,
        "comment before": 4,
        "comment after": 4,
        foo: 21,
        bar: 4,
        a: 1,
        b: 1,
        c: 1,
      };
      const file = api.readFile("/out.js");
      const comments = [...file.matchAll(/\/\*([^*]+)\*\//g), ...file.matchAll(/\/\/([^\n]+)/g)]
        .map(m => m[1].trim())
        .filter(m => m && !m.includes("__PURE__"));

      for (const key in commentCounts) {
        const count = comments.filter(c => c === key).length;
        if (count !== commentCounts[key]) {
          throw new Error(`Expected ${commentCounts[key]} comments with "${key}", got ${count}`);
        }
      }
    },
  });
  itBundled.skip("default/CommentPreservationImportAssertions", {
    // GENERATED
    todo: true,
    files: {
      "/entry.jsx": /* jsx */ `
        import 'foo' /* a */ assert { type: 'json' }
        import 'foo' assert /* b */ { type: 'json' }
        import 'foo' assert { /* c */ type: 'json' }
        import 'foo' assert { type: /* d */ 'json' }
        import 'foo' assert { type: 'json' /* e */ }
      `,
    },
    external: ["foo"],
  });
  itBundled.skip("default/CommentPreservationTransformJSX", {
    // GENERATED
    todo: true,
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
  itBundled.skip("default/CommentPreservationPreserveJSX", {
    // GENERATED
    todo: true,
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
  itBundled("default/ConstDeclNotRemovedIfReferencedBeforeDecl", {
    files: {
      "/entry.js": `
        {
          const foo = () => {
            return data;
          }
          const data = 123;

          console.log(foo());
        }
      `,
    },
    minifySyntax: true,
    run: {
      stdout: "123",
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("data = 123");
    },
  });
  itBundled("default/ConstDeclRemovedIfReferencedBeforeAllUses", {
    files: {
      "/entry.js": `
        {
          const data = 123;
          const foo = () => {
            return data;
          }

          console.log(foo());
        }
      `,
    },
    minifySyntax: true,
    run: {
      stdout: "123",
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("data = 123");
    },
  });
  itBundled("default/BundlerUsesModuleFieldForEsm", {
    files: {
      "/entry.js": `
        import { foo } from 'foo';
        console.log(foo);
      `,
      "/node_modules/foo/package.json": `
        {
          "name": "foo",
          "version": "2.0.0",
          "module": "index.esm.js",
          "main": "index.cjs.js"
        }
      `,
      "/node_modules/foo/index.cjs.js": `
        module.exports.foo = "hello index.cjs.js";
      `,
      "/node_modules/foo/index.esm.js": `
        export const foo = "hello index.esm.js";
      `,
    },
    run: {
      stdout: "hello index.esm.js",
    },
  });
  itBundled("default/BundlerUsesMainFieldForCjs", {
    files: {
      "/entry.js": `
        const { foo } = require('foo');
        console.log(foo);
      `,
      "/node_modules/foo/package.json": `
        {
          "name": "foo",
          "version": "2.0.0",
          "module": "index.esm.js",
          "main": "index.cjs.js"
        }
      `,
      "/node_modules/foo/index.cjs.js": `
        module.exports.foo = "hello index.cjs.js";
      `,
      "/node_modules/foo/index.esm.js": `
        export const foo = "hello index.esm.js";
      `,
    },
    run: {
      stdout: "hello index.cjs.js",
    },
  });
  itBundled("default/RuntimeUsesMainFieldForCjs", {
    files: {
      "/entry.js": `
        const { foo } = require('foo');
        console.log(foo);
      `,
      "/node_modules/foo/package.json": `
        {
          "name": "foo",
          "version": "2.0.0",
          "module": "index.esm.js",
          "main": "index.cjs.js"
        }
      `,
      "/node_modules/foo/index.cjs.js": `
        module.exports.foo = "hello index.cjs.js";
      `,
      "/node_modules/foo/index.esm.js": `
        export const foo = "hello index.esm.js";
      `,
    },
    bundling: false,
    run: {
      stdout: "hello index.cjs.js",
    },
  });
  itBundled("default/RuntimeUsesMainFieldForEsm", {
    files: {
      "/entry.js": `
        import { foo } from 'foo';
        console.log(foo);
      `,
      "/node_modules/foo/package.json": `
        {
          "name": "foo",
          "version": "2.0.0",
          "module": "index.esm.js",
          "main": "index.cjs.js"
        }
      `,
      "/node_modules/foo/index.cjs.js": `
        module.exports.foo = "hello index.cjs.js";
      `,
      "/node_modules/foo/index.esm.js": `
        export const foo = "hello index.esm.js";
      `,
    },
    bundling: false,
    run: {
      stdout: "hello index.cjs.js",
    },
  });
  itBundled("default/BundlerUsesModuleFieldIfMainDoesNotExistCjs", {
    files: {
      "/entry.js": `
        const { foo } = require('foo');
        console.log(foo);
      `,
      "/node_modules/foo/package.json": `
        {
          "name": "foo",
          "version": "2.0.0",
          "module": "index.esm.js"
        }
      `,
      "/node_modules/foo/index.cjs.js": `
        module.exports.foo = "hello index.cjs.js";
      `,
      "/node_modules/foo/index.esm.js": `
        export const foo = "hello index.esm.js";
      `,
    },
    run: {
      stdout: "hello index.esm.js",
    },
  });
  itBundled("default/BundlerUsesModuleFieldIfMainDoesNotExistEsm", {
    files: {
      "/entry.js": `
        import { foo } from 'foo';
        console.log(foo);
      `,
      "/node_modules/foo/package.json": `
        {
          "name": "foo",
          "version": "2.0.0",
          "module": "index.esm.js"
        }
      `,
      "/node_modules/foo/index.cjs.js": `
        module.exports.foo = "hello index.cjs.js";
      `,
      "/node_modules/foo/index.esm.js": `
        export const foo = "hello index.esm.js";
      `,
    },
    run: {
      stdout: "hello index.esm.js",
    },
  });
  itBundled("default/RuntimeUsesModuleFieldIfMainDoesNotExistCjs", {
    files: {
      "/entry.js": `
        const { foo } = require('foo');
        console.log(foo);
      `,
      "/node_modules/foo/package.json": `
        {
          "name": "foo",
          "version": "2.0.0",
          "module": "index.esm.js"
        }
      `,
      "/node_modules/foo/index.cjs.js": `
        module.exports.foo = "hello index.cjs.js";
      `,
      "/node_modules/foo/index.esm.js": `
        export const foo = "hello index.esm.js";
      `,
    },
    bundling: false,
    run: {
      stdout: "hello index.esm.js",
    },
  });
  itBundled("default/RuntimeUsesModuleFieldIfMainDoesNotExistEsm", {
    files: {
      "/entry.js": `
        import { foo } from 'foo';
        console.log(foo);
      `,
      "/node_modules/foo/package.json": `
        {
          "name": "foo",
          "version": "2.0.0",
          "module": "index.esm.js"
        }
      `,
      "/node_modules/foo/index.cjs.js": `
        module.exports.foo = "hello index.cjs.js";
      `,
      "/node_modules/foo/index.esm.js": `
        export const foo = "hello index.esm.js";
      `,
    },
    bundling: false,
    run: {
      stdout: "hello index.esm.js",
    },
  });
  itBundled("default/RequireProperlyHandlesNamedExportDeclsInCjsModule", {
    files: {
      "/entry.js": `
        const { a, b, c, d } = require('foo');
        console.log(a, b, c, d);
      `,
      "/node_modules/foo/package.json": `
        {
          "name": "foo",
          "version": "2.0.0"
        }
      `,
      "/node_modules/foo/index.js": `
        if (!exports.d) {
          exports.d = 7;
        }
        if (exports.hasOwnProperty("d")) {
          exports.a = 5;
        }
        
        exports.b;
        exports.b = 8;
        exports.b = 9;
        
        var c;
        c = 2;
        exports.c = c;
      `,
    },
    run: {
      stdout: "5 9 2 7",
    },
    onAfterBundle(api) {
      const contents = api.readFile("out.js");
      expect(contents).not.toContain("undefined");
      expect(contents).not.toContain("$");
    },
  });
  itBundled("default/EsmImportProperlyHandlesNamedExportDeclsInUnwrappedCjsModule", {
    files: {
      "/entry.js": `
        import { a, b, c, d } from 'foo';
        console.log(a, b, c, d);
      `,
      "/node_modules/foo/package.json": `
        {
          "name": "foo",
          "version": "2.0.0"
        }
      `,
      "/node_modules/foo/index.js": `
        if (!exports.d) {
          exports.d = 7;
        }
        if (exports.hasOwnProperty("d")) {
          exports.a = 5;
        }
        
        exports.b;
        exports.b = 8;
        exports.b = 9;
        
        var c;
        c = 2;
        exports.c = c;
      `,
    },
    run: {
      stdout: "5 9 2 7",
    },
  });
});
