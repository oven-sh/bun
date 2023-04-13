import assert from "assert";
import { itBundled, testForFile } from "../expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_ts_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/ts

describe("bundler", () => {
  itBundled("ts/TSDeclareConst", {
    files: {
      "/entry.ts": /* ts */ `
        declare const require: any
        declare const exports: any;
        declare const module: any
  
        declare const foo: any
        let foo = bar()
      `,
    },
    onAfterBundle(api) {
      assert(api.readFile("/out.js").includes("foo = bar()"), 'includes "foo = bar()"');
      assert(!api.readFile("/out.js").includes("require"), 'does not include "require"');
      assert(!api.readFile("/out.js").includes("exports"), 'does not include "exports"');
      assert(!api.readFile("/out.js").includes("module"), 'does not include "module"');
      assert(!api.readFile("/out.js").includes("const foo"), 'does not include "const foo"');
    },
  });
  itBundled("ts/TSDeclareLet", {
    files: {
      "/entry.ts": /* ts */ `
        declare let require: any
        declare let exports: any;
        declare let module: any
  
        declare let foo: any
        let foo = bar()
      `,
    },
    onAfterBundle(api) {
      assert(api.readFile("/out.js").includes("foo = bar()"), 'includes "foo = bar()"');
      assert(!api.readFile("/out.js").includes("require"), 'does not include "require"');
      assert(!api.readFile("/out.js").includes("exports"), 'does not include "exports"');
      assert(!api.readFile("/out.js").includes("module"), 'does not include "module"');
    },
  });
  itBundled("ts/TSDeclareVar", {
    files: {
      "/entry.ts": /* ts */ `
        declare var require: any
        declare var exports: any;
        declare var module: any
  
        declare var foo: any
        let foo = bar()
      `,
    },
    onAfterBundle(api) {
      assert(api.readFile("/out.js").includes("foo = bar()"), 'includes "foo = bar()"');
      assert(!api.readFile("/out.js").includes("require"), 'does not include "require"');
      assert(!api.readFile("/out.js").includes("exports"), 'does not include "exports"');
      assert(!api.readFile("/out.js").includes("module"), 'does not include "module"');
    },
  });
  itBundled("ts/TSDeclareClass", {
    files: {
      "/entry.ts": /* ts */ `
        declare class require {}
        declare class exports {};
        declare class module {}
  
        declare class foo {}
        let foo = bar()
      `,
    },
    onAfterBundle(api) {
      assert(api.readFile("/out.js").includes("foo = bar()"), 'includes "foo = bar()"');
      assert(!api.readFile("/out.js").includes("require"), 'does not include "require"');
      assert(!api.readFile("/out.js").includes("exports"), 'does not include "exports"');
      assert(!api.readFile("/out.js").includes("module"), 'does not include "module"');
      assert(!api.readFile("/out.js").includes("class"), 'does not include "class"');
    },
  });
  itBundled("ts/TSDeclareClassFields", {
    files: {
      "/entry.ts": /* ts */ `
        import './setup'
        import './define-false'
        import './define-true'
      `,
      "./setup.js": /* js */ `
        globalThis.A = "global.A"
        globalThis.a = "global.a"
        globalThis.B = "global.B"
        globalThis.b = "global.b"
        globalThis.C = "global.C"
        globalThis.c = "global.c"
        globalThis.D = "global.D"
        globalThis.d = "global.d"
      `,
      "/define-false/index.ts": /* ts */ `
        class Foo {
          a
          declare b
          [(() => null, c)]
          declare [(() => null, d)]
  
          static A
          static declare B
          static [(() => null, C)]
          static declare [(() => null, D)]
        }
        const props = x => JSON.stringify({ ...Object.getOwnPropertyDescriptors(x), length: undefined, prototype: undefined })
        console.log('Foo    ', props(Foo))
        console.log('new Foo', props(new Foo()))
      `,
      "/define-true/index.ts": /* ts */ `
        class Bar {
          a
          declare b
          [(() => null, c)]
          declare [(() => null, d)]
  
          static A
          static declare B
          static [(() => null, C)]
          static declare [(() => null, D)]
        }
        const props = x => JSON.stringify({ ...Object.getOwnPropertyDescriptors(x), length: undefined, prototype: undefined })
        console.log('Bar    ', props(Bar))
        console.log('new Bar', props(new Bar()))
      `,
      "/define-true/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "useDefineForClassFields": true
          }
        }
      `,
    },
    run: {
      stdout: `
        Foo     {"name":{"value":"Foo","writable":false,"enumerable":false,"configurable":true}}
        new Foo {}
        Bar     {"name":{"value":"Bar","writable":false,"enumerable":false,"configurable":true},"A":{"writable":true,"enumerable":true,"configurable":true},"global.C":{"writable":true,"enumerable":true,"configurable":true}}
        new Bar {"a":{"writable":true,"enumerable":true,"configurable":true},"global.c":{"writable":true,"enumerable":true,"configurable":true}}
      `,
    },
  });
  itBundled("ts/TSDeclareFunction", {
    files: {
      "/entry.ts": /* ts */ `
        declare function require(): void
        declare function exports(): void;
        declare function module(): void
  
        declare function foo() {}
        let foo = bar()
      `,
    },
    onAfterBundle(api) {
      assert(api.readFile("/out.js").includes("foo = bar()"), 'includes "foo = bar()"');
      assert(!api.readFile("/out.js").includes("require"), 'does not include "require"');
      assert(!api.readFile("/out.js").includes("exports"), 'does not include "exports"');
      assert(!api.readFile("/out.js").includes("module"), 'does not include "module"');
      assert(!api.readFile("/out.js").includes("function"), 'does not include "function"');
    },
  });
  itBundled("ts/TSDeclareNamespace", {
    files: {
      "/entry.ts": /* ts */ `
        declare namespace require {}
        declare namespace exports {};
        declare namespace module {}
  
        declare namespace foo {}
        let foo = bar()
      `,
    },
    onAfterBundle(api) {
      assert(api.readFile("/out.js").includes("foo = bar()"), 'includes "foo = bar()"');
      assert(!api.readFile("/out.js").includes("require"), 'does not include "require"');
      assert(!api.readFile("/out.js").includes("exports"), 'does not include "exports"');
      assert(!api.readFile("/out.js").includes("module"), 'does not include "module"');
      assert(!api.readFile("/out.js").includes("namespace"), 'does not include "namespace"');
    },
  });
  itBundled("ts/TSDeclareEnum", {
    files: {
      "/entry.ts": /* ts */ `
        declare enum require {}
        declare enum exports {};
        declare enum module {}
  
        declare enum foo {}
        let foo = bar()
      `,
    },
    onAfterBundle(api) {
      assert(api.readFile("/out.js").includes("foo = bar()"), 'includes "foo = bar()"');
      assert(!api.readFile("/out.js").includes("require"), 'does not include "require"');
      assert(!api.readFile("/out.js").includes("exports"), 'does not include "exports"');
      assert(!api.readFile("/out.js").includes("module"), 'does not include "module"');
      assert(!api.readFile("/out.js").includes("enum"), 'does not include "enum"');
    },
  });
  itBundled("ts/TSDeclareConstEnum", {
    files: {
      "/entry.ts": /* ts */ `
        declare const enum require {}
        declare const enum exports {};
        declare const enum module {}
  
        declare const enum foo {}
        let foo = bar()
      `,
    },
    onAfterBundle(api) {
      assert(api.readFile("/out.js").includes("foo = bar()"), 'includes "foo = bar()"');
      assert(!api.readFile("/out.js").includes("require"), 'does not include "require"');
      assert(!api.readFile("/out.js").includes("exports"), 'does not include "exports"');
      assert(!api.readFile("/out.js").includes("module"), 'does not include "module"');
      assert(!api.readFile("/out.js").includes("enum"), 'does not include "enum"');
      assert(!api.readFile("/out.js").includes("const"), 'does not include "const"');
    },
  });
  itBundled("ts/TSConstEnumComments", {
    files: {
      "/bar.ts": /* ts */ `
        export const enum Foo {
          "%/*" = 1,
          "*/%" = 2,
        }
      `,
      "/foo.ts": /* ts */ `
        import { Foo } from "./bar";
        const enum Bar {
          "%/*" = 1,
          "*/%" = 2,
        }
        console.log(JSON.stringify({
          'should have comments': [
            Foo["%/*"],
            Bar["%/*"],
          ],
          'should not have comments': [
            Foo["*/%"],
            Bar["*/%"],
          ],
        }));
      `,
    },
    entryPoints: ["/foo.ts"],
    onAfterBundle(api) {
      assert(!api.readFile("/out.js").match(/var|let|const/), "should have inlined all enum constants");
      assert(!api.readFile("/out.js").match(/\*\/%/), "should not include '*/%' anywhere");
      assert(
        [...api.readFile("/out.js").matchAll(/1\s*\/\* %\/\* \*\//g)].length === 2,
        "should have 2 comments for '1'",
      );
      assert(
        [...api.readFile("/out.js").matchAll(/2\s*\/\*/g)].length === 0,
        "should have 0 comments for '2' since */ will break the comment syntax",
      );
    },
    run: {
      stdout: `{"should have comments":[1,1],"should not have comments":[2,2]}`,
    },
  });
  itBundled("ts/TSImportEmptyNamespace", {
    files: {
      "/entry.ts": /* ts */ `
        import {REMOVE} from './ns.ts'
        function foo(): REMOVE.type {}
        foo();
      `,
      "/ns.ts": `export namespace REMOVE { type type = number }`,
    },
    dce: true,
    run: true,
  });
  itBundled("ts/TSImportMissingES6", {
    files: {
      "/entry.ts": /* ts */ `
        import fn, {x as a, y as b} from './foo'
        console.log(fn(a, b))
      `,
      "/foo.js": `export const x = 123;`,
    },
    bundleErrors: {
      "/entry.ts": [
        `No matching export "default" in "foo.js" for import "default"`,
        `No matching export "y" in "foo.js" for import "y"`,
      ],
    },
  });
  itBundled("ts/TSImportMissingUnusedES6", {
    files: {
      "/entry.ts": `import fn, {x as a, y as b} from './foo'`,
      "/foo.js": `export const x = 123`,
    },
    // goal for this test is there is no error. we dont really care about the output
  });
  itBundled("ts/TSExportMissingES6", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(JSON.stringify(ns))
      `,
      "/foo.ts": `export {nope} from './bar'`,
      "/bar.js": `export const yep = 123`,
    },
    run: {
      stdout: `{}`,
    },
  });
  itBundled("ts/TSImportMissingFile", {
    files: {
      "/entry.ts": /* ts */ `
        import {Something} from './doesNotExist.ts'
        let foo = new Something
      `,
    },
    bundleErrors: {
      "/entry.ts": [`Could not resolve: "./doesNotExist.ts"`],
    },
  });
  itBundled("ts/TSImportTypeOnlyFile", {
    files: {
      "/entry.ts": /* ts */ `
        import {SomeType1} from './doesNotExist1.ts'
        import {SomeType2} from './doesNotExist2.ts'
        function bar() { return 2; }
        let foo: SomeType1 = bar()
        console.log(foo);
      `,
    },
    run: {
      stdout: "2",
    },
  });
  itBundled("ts/TSExportEquals", {
    files: {
      "/a.ts": /* ts */ `
        import b from './b.ts'
        console.log(JSON.stringify(b))
      `,
      "/b.ts": /* ts */ `
        export = [123, foo]
        function foo() {}
      `,
    },
    run: {
      stdout: `[123,null]`,
    },
  });
  itBundled("ts/TSExportNamespace", {
    files: {
      "/a.ts": /* ts */ `
        import {Foo} from './b.ts'
        console.log(JSON.stringify(new Foo))
        console.log(Foo.foo)
        console.log(Foo.bar)
      `,
      "/b.ts": /* ts */ `
        export class Foo {}
        export namespace Foo {
          export let foo = 1
        }
        export namespace Foo {
          export let bar = 2
        }
      `,
    },
    run: {
      stdout: `{}\n1\n2`,
    },
  });
  itBundled("ts/TSMinifyEnum", {
    files: {
      "/a.ts": `enum Foo { A, B, C = Foo }\ncapture(Foo)`,
      "/b.ts": `export enum Foo { X, Y, Z = Foo }`,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    mode: "transform",
    onAfterBundle(api) {
      const a = api.readFile("/out/a.js");
      api.writeFile("/out/a.edited.js", a.replace(/capture\((.*?)\)/, `export const Foo = $1`));
      const b = api.readFile("/out/b.js");

      // make sure the minification trick "enum[enum.K=V]=K" is used, but `enum`
      assert(a.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.A=0]=["']A["']\b/), "should be using enum minification trick (1)");
      assert(a.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.B=1]=["']B["']\b/), "should be using enum minification trick (2)");
      assert(
        a.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.C=[a-zA-Z$]]=["']C["']\b/),
        "should be using enum minification trick (3)",
      );
      assert(b.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.X=0]=["']X["']\b/), "should be using enum minification trick (4)");
      assert(b.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.Y=1]=["']Y["']\b/), "should be using enum minification trick (5)");
      assert(
        b.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.Z=[a-zA-Z$]]=["']Z["']\b/),
        "should be using enum minification trick (6)",
      );
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        import {Foo as FooA} from './out/a.edited.js'
        import {Foo as FooB} from './out/b.js'
        import assert from 'assert';
        assert.strictEqual(FooA.A, 0, 'a.ts Foo.A')
        assert.strictEqual(FooA.B, 1, 'a.ts Foo.B')
        assert.strictEqual(FooA.C, Foo, 'a.ts Foo.C')
        assert.strictEqual(FooA[0], 'A', 'a.ts Foo[0]')
        assert.strictEqual(FooA[1], 'B', 'a.ts Foo[1]')
        assert.strictEqual(FooA[FooA], 'C', 'a.ts Foo[Foo]')
        assert.strictEqual(FooB.X, 0, 'b.ts Foo.X')
        assert.strictEqual(FooB.Y, 1, 'b.ts Foo.Y')
        assert.strictEqual(FooB.Z, FooB, 'b.ts Foo.Z')
        assert.strictEqual(FooB[0], 'X', 'b.ts Foo[0]')
        assert.strictEqual(FooB[1], 'Y', 'b.ts Foo[1]')
        assert.strictEqual(FooB[FooB], 'Z', 'b.ts Foo[Foo]')
      `,
    },
  });
  const TSMinifyNestedEnum = itBundled("ts/TSMinifyNestedEnum", {
    files: {
      "/a.ts": `function foo(arg) { enum Foo { A, B, C = Foo, D = arg } return Foo }\ncapture(foo)`,
      "/b.ts": `export function foo(arg) { enum Foo { X, Y, Z = Foo, W = arg } return Foo }`,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    mode: "transform",
    onAfterBundle(api) {
      const a = api.readFile("/out/a.js");
      api.writeFile("/out/a.edited.js", a.replace(/capture\((.*?)\)/, `export const Foo = $1`));
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        import {foo as fooA} from './out/a.edited.js'
        import {foo as fooB} from './out/b.js'
        import assert from 'assert';
        const S = Symbol('S')
        const FooA = fooA(S)
        const FooB = fooB(S)
        assert.strictEqual(FooA.A, 0, 'a.ts Foo.A')
        assert.strictEqual(FooA.B, 1, 'a.ts Foo.B')
        assert.strictEqual(FooA.C, Foo, 'a.ts Foo.C')
        assert.strictEqual(FooA.D, S, 'a.ts Foo.D')
        assert.strictEqual(FooA[0], 'A', 'a.ts Foo[0]')
        assert.strictEqual(FooA[1], 'B', 'a.ts Foo[1]')
        assert.strictEqual(FooA[FooA], 'C', 'a.ts Foo[Foo]')
        assert.strictEqual(FooA[S], 'D', 'a.ts Foo[S]')
        assert.strictEqual(FooB.X, 0, 'b.ts Foo.X')
        assert.strictEqual(FooB.Y, 1, 'b.ts Foo.Y')
        assert.strictEqual(FooB.Z, FooB, 'b.ts Foo.Z')
        assert.strictEqual(FooB.W, S, 'b.ts Foo.W')
        assert.strictEqual(FooB[0], 'X', 'b.ts Foo[0]')
        assert.strictEqual(FooB[1], 'Y', 'b.ts Foo[1]')
        assert.strictEqual(FooB[FooB], 'Z', 'b.ts Foo[Foo]')
        assert.strictEqual(FooB[S], 'W', 'b.ts Foo[S]')
      `,
    },
  });
  itBundled("ts/TSMinifyNestedEnumNoLogicalAssignment", {
    files: {
      "/a.ts": `function foo(arg) { enum Foo { A, B, C = Foo, D = arg } return Foo }\ncapture(foo)`,
      "/b.ts": `export function foo(arg) { enum Foo { X, Y, Z = Foo, W = arg } return Foo }`,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    mode: "transform",
    unsupportedJSFeatures: ["logical-assignment"],
    onAfterBundle(api) {
      const a = api.readFile("/out/a.js");
      assert(a.includes("A"), "a should not be empty");
      assert(!a.includes("||="), "a should not use logical assignment");
      const b = api.readFile("/out/b.js");
      assert(b.includes("X"), "b should not be empty");
      assert(!b.includes("||="), "b should not use logical assignment");
    },
  });
  itBundled("ts/TSMinifyNestedEnumNoArrow", {
    files: {
      "/a.ts": `function foo() { enum Foo { A, B, C = Foo } return Foo }`,
      "/b.ts": `export function foo() { enum Foo { X, Y, Z = Foo } return Foo }`,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    outdir: "/",
    mode: "transform",
    unsupportedJSFeatures: ["arrow"],
    onAfterBundle(api) {
      const a = api.readFile("/a.js");
      assert(a.includes("A"), "a should not be empty");
      assert(!a.includes("=>"), "a should not use arrow");
      const b = api.readFile("/b.js");
      assert(b.includes("X"), "b should not be empty");
      assert(!b.includes("=>"), "b should not use arrow");
    },
  });
  return;
  itBundled("ts/TSMinifyNamespace", {
    // GENERATED
    files: {
      "/a.ts": /* ts */ `
        namespace Foo {
          export namespace Bar {
            foo(Foo, Bar)
          }
        }
      `,
      "/b.ts": /* ts */ `
        export namespace Foo {
          export namespace Bar {
            foo(Foo, Bar)
          }
        }
      `,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    mode: "transform",
  });
  itBundled("ts/TSMinifyNamespaceNoLogicalAssignment", {
    // GENERATED
    files: {
      "/a.ts": /* ts */ `
        namespace Foo {
          export namespace Bar {
            foo(Foo, Bar)
          }
        }
      `,
      "/b.ts": /* ts */ `
        export namespace Foo {
          export namespace Bar {
            foo(Foo, Bar)
          }
        }
      `,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    outdir: "/",
    mode: "transform",
    unsupportedJSFeatures: ["logical-assignment"],
  });
  itBundled("ts/TSMinifyNamespaceNoArrow", {
    // GENERATED
    files: {
      "/a.ts": /* ts */ `
        namespace Foo {
          export namespace Bar {
            foo(Foo, Bar)
          }
        }
      `,
      "/b.ts": /* ts */ `
        export namespace Foo {
          export namespace Bar {
            foo(Foo, Bar)
          }
        }
      `,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    outdir: "/",
    mode: "transform",
  });
  itBundled("ts/TSMinifyDerivedClass", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        class Foo extends Bar {
          foo = 1;
          bar = 2;
          constructor() {
            super();
            foo();
            bar();
          }
        }
      `,
    },
    minifySyntax: true,
    unsupportedJSFeatures: "es2015",
    mode: "transform",
  });
  itBundled("ts/TSImportVsLocalCollisionAllTypes", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import {a, b, c, d, e} from './other.ts'
        let a
        const b = 0
        var c
        function d() {}
        class e {}
        console.log(a, b, c, d, e)
      `,
      "/other.ts": ``,
    },
  });
  itBundled("ts/TSImportVsLocalCollisionMixed", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import {a, b, c, d, e, real} from './other.ts'
        let a
        const b = 0
        var c
        function d() {}
        class e {}
        console.log(a, b, c, d, e, real)
      `,
      "/other.ts": `export let real = 123`,
    },
  });
  itBundled("ts/TSImportEqualsEliminationTest", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import a = foo.a
        import b = a.b
        import c = b.c
  
        import x = foo.x
        import y = x.y
        import z = y.z
  
        export let bar = c
      `,
    },
  });
  itBundled("ts/TSImportEqualsTreeShakingFalse", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import { foo } from 'pkg'
        import used = foo.used
        import unused = foo.unused
        export { used }
      `,
    },
    mode: "passthrough",
  });
  itBundled("ts/TSImportEqualsTreeShakingTrue", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import { foo } from 'pkg'
        import used = foo.used
        import unused = foo.unused
        export { used }
      `,
    },
    mode: "passthrough",
  });
  itBundled("ts/TSImportEqualsBundle", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import { foo } from 'pkg'
        import used = foo.used
        import unused = foo.unused
        export { used }
      `,
    },
  });
  itBundled("ts/TSMinifiedBundleES6", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import {foo} from './a'
        console.log(foo())
      `,
      "/a.ts": /* ts */ `
        export function foo() {
          return 123
        }
      `,
    },
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
  });
  itBundled("ts/TSMinifiedBundleCommonJS", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        const {foo} = require('./a')
        console.log(foo(), require('./j.json'))
      `,
      "/a.ts": /* ts */ `
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
  itBundled("ts/TypeScriptDecorators", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import all from './all'
        import all_computed from './all_computed'
        import {a} from './a'
        import {b} from './b'
        import {c} from './c'
        import {d} from './d'
        import e from './e'
        import f from './f'
        import g from './g'
        import h from './h'
        import {i} from './i'
        import {j} from './j'
        import k from './k'
        import {fn} from './arguments'
        console.log(all, all_computed, a, b, c, d, e, f, g, h, i, j, k, fn)
      `,
      "/all.ts": /* ts */ `
        @x.y()
        @new y.x()
        export default class Foo {
          @x @y mUndef
          @x @y mDef = 1
          @x @y method(@x0 @y0 arg0, @x1 @y1 arg1) { return new Foo }
          @x @y declare mDecl
          constructor(@x0 @y0 arg0, @x1 @y1 arg1) {}
  
          @x @y static sUndef
          @x @y static sDef = new Foo
          @x @y static sMethod(@x0 @y0 arg0, @x1 @y1 arg1) { return new Foo }
          @x @y static declare mDecl
        }
      `,
      "/all_computed.ts": /* ts */ `
        @x?.[_ + 'y']()
        @new y?.[_ + 'x']()
        export default class Foo {
          @x @y [mUndef()]
          @x @y [mDef()] = 1
          @x @y [method()](@x0 @y0 arg0, @x1 @y1 arg1) { return new Foo }
          @x @y declare [mDecl()]
  
          // Side effect order must be preserved even for fields without decorators
          [xUndef()]
          [xDef()] = 2
          static [yUndef()]
          static [yDef()] = 3
  
          @x @y static [sUndef()]
          @x @y static [sDef()] = new Foo
          @x @y static [sMethod()](@x0 @y0 arg0, @x1 @y1 arg1) { return new Foo }
          @x @y static declare [mDecl()]
        }
      `,
      "/a.ts": /* ts */ `
        @x(() => 0) @y(() => 1)
        class a_class {
          fn() { return new a_class }
          static z = new a_class
        }
        export let a = a_class
      `,
      "/b.ts": /* ts */ `
        @x(() => 0) @y(() => 1)
        abstract class b_class {
          fn() { return new b_class }
          static z = new b_class
        }
        export let b = b_class
      `,
      "/c.ts": /* ts */ `
        @x(() => 0) @y(() => 1)
        export class c {
          fn() { return new c }
          static z = new c
        }
      `,
      "/d.ts": /* ts */ `
        @x(() => 0) @y(() => 1)
        export abstract class d {
          fn() { return new d }
          static z = new d
        }
      `,
      "/e.ts": /* ts */ `
        @x(() => 0) @y(() => 1)
        export default class {}
      `,
      "/f.ts": /* ts */ `
        @x(() => 0) @y(() => 1)
        export default class f {
          fn() { return new f }
          static z = new f
        }
      `,
      "/g.ts": /* ts */ `
        @x(() => 0) @y(() => 1)
        export default abstract class {}
      `,
      "/h.ts": /* ts */ `
        @x(() => 0) @y(() => 1)
        export default abstract class h {
          fn() { return new h }
          static z = new h
        }
      `,
      "/i.ts": /* ts */ `
        class i_class {
          @x(() => 0) @y(() => 1)
          foo
        }
        export let i = i_class
      `,
      "/j.ts": /* ts */ `
        export class j {
          @x(() => 0) @y(() => 1)
          foo() {}
        }
      `,
      "/k.ts": /* ts */ `
        export default class {
          foo(@x(() => 0) @y(() => 1) x) {}
        }
      `,
      "/arguments.ts": /* ts */ `
        function dec(x: any): any {}
        export function fn(x: string): any {
          class Foo {
            @dec(arguments[0])
            [arguments[0]]() {}
          }
          return Foo;
        }
      `,
    },
  });
  itBundled("ts/TypeScriptDecoratorsKeepNames", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        @decoratorMustComeAfterName
        class Foo {}
      `,
    },
  });
  itBundled("ts/TypeScriptDecoratorScopeIssue2147", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        let foo = 1
        class Foo {
          method1(@dec(foo) foo = 2) {}
          method2(@dec(() => foo) foo = 3) {}
        }
  
        class Bar {
          static x = class {
            static y = () => {
              let bar = 1
              @dec(bar)
              @dec(() => bar)
              class Baz {
                @dec(bar) method1() {}
                @dec(() => bar) method2() {}
                method3(@dec(() => bar) bar) {}
                method4(@dec(() => bar) bar) {}
              }
              return Baz
            }
          }
        }
      `,
    },
    mode: "passthrough",
  });
  itBundled("ts/TSExportDefaultTypeIssue316", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import dc_def, { bar as dc } from './keep/declare-class'
        import dl_def, { bar as dl } from './keep/declare-let'
        import im_def, { bar as im } from './keep/interface-merged'
        import in_def, { bar as _in } from './keep/interface-nested'
        import tn_def, { bar as tn } from './keep/type-nested'
        import vn_def, { bar as vn } from './keep/value-namespace'
        import vnm_def, { bar as vnm } from './keep/value-namespace-merged'
  
        import i_def, { bar as i } from './remove/interface'
        import ie_def, { bar as ie } from './remove/interface-exported'
        import t_def, { bar as t } from './remove/type'
        import te_def, { bar as te } from './remove/type-exported'
        import ton_def, { bar as ton } from './remove/type-only-namespace'
        import tone_def, { bar as tone } from './remove/type-only-namespace-exported'
  
        export default [
          dc_def, dc,
          dl_def, dl,
          im_def, im,
          in_def, _in,
          tn_def, tn,
          vn_def, vn,
          vnm_def, vnm,
  
          i,
          ie,
          t,
          te,
          ton,
          tone,
        ]
      `,
      "/keep/declare-class.ts": /* ts */ `
        declare class foo {}
        export default foo
        export let bar = 123
      `,
      "/keep/declare-let.ts": /* ts */ `
        declare let foo: number
        export default foo
        export let bar = 123
      `,
      "/keep/interface-merged.ts": /* ts */ `
        class foo {
          static x = new foo
        }
        interface foo {}
        export default foo
        export let bar = 123
      `,
      "/keep/interface-nested.ts": /* ts */ `
        if (true) {
          interface foo {}
        }
        export default foo
        export let bar = 123
      `,
      "/keep/type-nested.ts": /* ts */ `
        if (true) {
          type foo = number
        }
        export default foo
        export let bar = 123
      `,
      "/keep/value-namespace.ts": /* ts */ `
        namespace foo {
          export let num = 0
        }
        export default foo
        export let bar = 123
      `,
      "/keep/value-namespace-merged.ts": /* ts */ `
        namespace foo {
          export type num = number
        }
        namespace foo {
          export let num = 0
        }
        export default foo
        export let bar = 123
      `,
      "/remove/interface.ts": /* ts */ `
        interface foo { }
        export default foo
        export let bar = 123
      `,
      "/remove/interface-exported.ts": /* ts */ `
        export interface foo { }
        export default foo
        export let bar = 123
      `,
      "/remove/type.ts": /* ts */ `
        type foo = number
        export default foo
        export let bar = 123
      `,
      "/remove/type-exported.ts": /* ts */ `
        export type foo = number
        export default foo
        export let bar = 123
      `,
      "/remove/type-only-namespace.ts": /* ts */ `
        namespace foo {
          export type num = number
        }
        export default foo
        export let bar = 123
      `,
      "/remove/type-only-namespace-exported.ts": /* ts */ `
        export namespace foo {
          export type num = number
        }
        export default foo
        export let bar = 123
      `,
    },
  });
  itBundled("ts/TSImplicitExtensions", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import './pick-js.js'
        import './pick-ts.js'
        import './pick-jsx.jsx'
        import './pick-tsx.jsx'
        import './order-js.js'
        import './order-jsx.jsx'
      `,
      "/pick-js.js": `console.log("correct")`,
      "/pick-js.ts": `console.log("wrong")`,
      "/pick-ts.jsx": `console.log("wrong")`,
      "/pick-ts.ts": `console.log("correct")`,
      "/pick-jsx.jsx": `console.log("correct")`,
      "/pick-jsx.tsx": `console.log("wrong")`,
      "/pick-tsx.js": `console.log("wrong")`,
      "/pick-tsx.tsx": `console.log("correct")`,
      "/order-js.ts": `console.log("correct")`,
      "/order-js.tsx": `console.log("wrong")`,
      "/order-jsx.ts": `console.log("correct")`,
      "/order-jsx.tsx": `console.log("wrong")`,
    },
  });
  itBundled("ts/TSImplicitExtensionsMissing", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import './mjs.mjs'
        import './cjs.cjs'
        import './js.js'
        import './jsx.jsx'
      `,
      "/mjs.ts": ``,
      "/mjs.tsx": ``,
      "/cjs.ts": ``,
      "/cjs.tsx": ``,
      "/js.ts.js": ``,
      "/jsx.tsx.jsx": ``,
    },
    /* TODO FIX expectedScanLog: `entry.ts: ERROR: Could not resolve "./mjs.mjs"
  entry.ts: ERROR: Could not resolve "./cjs.cjs"
  entry.ts: ERROR: Could not resolve "./js.js"
  entry.ts: ERROR: Could not resolve "./jsx.jsx"
  `, */
  });
  itBundled("ts/ExportTypeIssue379", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import * as A from './a'
        import * as B from './b'
        import * as C from './c'
        import * as D from './d'
        console.log(A, B, C, D)
      `,
      "/a.ts": /* ts */ `
        type Test = Element
        let foo = 123
        export { Test, foo }
      `,
      "/b.ts": /* ts */ `
        export type Test = Element
        export let foo = 123
      `,
      "/c.ts": /* ts */ `
        import { Test } from './test'
        let foo = 123
        export { Test }
        export { foo }
      `,
      "/d.ts": /* ts */ `
        export { Test }
        export { foo }
        import { Test } from './test'
        let foo = 123
      `,
      "/test.ts": `export type Test = Element`,
    },
  });
  itBundled("ts/ThisInsideFunctionTS", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
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
  itBundled("ts/ThisInsideFunctionTSUseDefineForClassFields", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
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
  itBundled("ts/ThisInsideFunctionTSNoBundle", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
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
    mode: "passthrough",
  });
  itBundled("ts/ThisInsideFunctionTSNoBundleUseDefineForClassFields", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
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
    mode: "passthrough",
  });
  itBundled("ts/TSComputedClassFieldUseDefineFalse", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        class Foo {
          [q];
          [r] = s;
          @dec
          [x];
          @dec
          [y] = z;
        }
        new Foo()
      `,
    },
    mode: "passthrough",
  });
  itBundled("ts/TSComputedClassFieldUseDefineTrue", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        class Foo {
          [q];
          [r] = s;
          @dec
          [x];
          @dec
          [y] = z;
        }
        new Foo()
      `,
    },
    mode: "passthrough",
  });
  itBundled("ts/TSComputedClassFieldUseDefineTrueLower", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        class Foo {
          [q];
          [r] = s;
          @dec
          [x];
          @dec
          [y] = z;
        }
        new Foo()
      `,
    },
    useDefineForClassFields: true,
    mode: "passthrough",
  });
  itBundled("ts/TSAbstractClassFieldUseAssign", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        const keepThis = Symbol('keepThis')
        declare const AND_REMOVE_THIS: unique symbol
        abstract class Foo {
          REMOVE_THIS: any
          [keepThis]: any
          abstract REMOVE_THIS_TOO: any
          abstract [AND_REMOVE_THIS]: any
          abstract [(x => y => x + y)('nested')('scopes')]: any
        }
        (() => new Foo())()
      `,
    },
    mode: "passthrough",
  });
  itBundled("ts/TSAbstractClassFieldUseDefine", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        const keepThisToo = Symbol('keepThisToo')
        declare const REMOVE_THIS_TOO: unique symbol
        abstract class Foo {
          keepThis: any
          [keepThisToo]: any
          abstract REMOVE_THIS: any
          abstract [REMOVE_THIS_TOO]: any
          abstract [(x => y => x + y)('nested')('scopes')]: any
        }
        (() => new Foo())()
      `,
    },
    mode: "passthrough",
  });
  itBundled("ts/TSImportMTS", {
    // GENERATED
    files: {
      "/entry.ts": `import './imported.mjs'`,
      "/imported.mts": `console.log('works')`,
    },
  });
  itBundled("ts/TSImportCTS", {
    // GENERATED
    files: {
      "/entry.ts": `require('./required.cjs')`,
      "/required.cjs": `console.log('works')`,
    },
  });
  itBundled("ts/TSSideEffectsFalseWarningTypeDeclarations", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import "some-js"
        import "some-ts"
        import "empty-js"
        import "empty-ts"
        import "empty-dts"
      `,
      "/node_modules/some-js/package.json": `{ "main": "./foo.js", "sideEffects": false }`,
      "/node_modules/some-js/foo.js": `console.log('foo')`,
      "/node_modules/some-ts/package.json": `{ "main": "./foo.ts", "sideEffects": false }`,
      "/node_modules/some-ts/foo.ts": `console.log('foo' as string)`,
      "/node_modules/empty-js/package.json": `{ "main": "./foo.js", "sideEffects": false }`,
      "/node_modules/empty-js/foo.js": ``,
      "/node_modules/empty-ts/package.json": `{ "main": "./foo.ts", "sideEffects": false }`,
      "/node_modules/empty-ts/foo.ts": `export type Foo = number`,
      "/node_modules/empty-dts/package.json": `{ "main": "./foo.d.ts", "sideEffects": false }`,
      "/node_modules/empty-dts/foo.d.ts": `export type Foo = number`,
    },
    /* TODO FIX expectedScanLog: `entry.ts: WARNING: Ignoring this import because "node_modules/some-js/foo.js" was marked as having no side effects
  node_modules/some-js/package.json: NOTE: "sideEffects" is false in the enclosing "package.json" file:
  entry.ts: WARNING: Ignoring this import because "node_modules/some-ts/foo.ts" was marked as having no side effects
  node_modules/some-ts/package.json: NOTE: "sideEffects" is false in the enclosing "package.json" file:
  `, */
  });
  itBundled("ts/TSSiblingNamespace", {
    // GENERATED
    files: {
      "/let.ts": /* ts */ `
        export namespace x { export let y = 123 }
        export namespace x { export let z = y }
      `,
      "/function.ts": /* ts */ `
        export namespace x { export function y() {} }
        export namespace x { export let z = y }
      `,
      "/class.ts": /* ts */ `
        export namespace x { export class y {} }
        export namespace x { export let z = y }
      `,
      "/namespace.ts": /* ts */ `
        export namespace x { export namespace y { 0 } }
        export namespace x { export let z = y }
      `,
      "/enum.ts": /* ts */ `
        export namespace x { export enum y {} }
        export namespace x { export let z = y }
      `,
    },
    entryPoints: ["/let.ts", "/function.ts", "/class.ts", "/namespace.ts", "/enum.ts"],
    mode: "passthrough",
  });
  itBundled("ts/TSSiblingEnum", {
    // GENERATED
    files: {
      "/number.ts": /* ts */ `
        export enum x { y, yy = y }
        export enum x { z = y + 1 }
  
        declare let y: any, z: any
        export namespace x { console.log(y, z) }
        console.log(x.y, x.z)
      `,
      "/string.ts": /* ts */ `
        export enum x { y = 'a', yy = y }
        export enum x { z = y }
  
        declare let y: any, z: any
        export namespace x { console.log(y, z) }
        console.log(x.y, x.z)
      `,
      "/propagation.ts": /* ts */ `
        export enum a { b = 100 }
        export enum x {
          c = a.b,
          d = c * 2,
          e = x.d ** 2,
          f = x['e'] / 4,
        }
        export enum x { g = f >> 4 }
        console.log(a.b, a['b'], x.g, x['g'])
      `,
      "/nested-number.ts": /* ts */ `
        export namespace foo { export enum x { y, yy = y } }
        export namespace foo { export enum x { z = y + 1 } }
  
        declare let y: any, z: any
        export namespace foo.x {
          console.log(y, z)
          console.log(x.y, x.z)
        }
      `,
      "/nested-string.ts": /* ts */ `
        export namespace foo { export enum x { y = 'a', yy = y } }
        export namespace foo { export enum x { z = y } }
  
        declare let y: any, z: any
        export namespace foo.x {
          console.log(y, z)
          console.log(x.y, x.z)
        }
      `,
      "/nested-propagation.ts": /* ts */ `
        export namespace n { export enum a { b = 100 } }
        export namespace n {
          export enum x {
            c = n.a.b,
            d = c * 2,
            e = x.d ** 2,
            f = x['e'] / 4,
          }
        }
        export namespace n {
          export enum x { g = f >> 4 }
          console.log(a.b, n.a.b, n['a']['b'], x.g, n.x.g, n['x']['g'])
        }
      `,
    },
    entryPoints: [
      "/number.ts",
      "/string.ts",
      "/propagation.ts",
      "/nested-number.ts",
      "/nested-string.ts",
      "/nested-propagation.ts",
    ],
    mode: "passthrough",
  });
  itBundled("ts/TSEnumTreeShaking", {
    // GENERATED
    files: {
      "/simple-member.ts": /* ts */ `
        enum x { y = 123 }
        console.log(x.y)
      `,
      "/simple-enum.ts": /* ts */ `
        enum x { y = 123 }
        console.log(x)
      `,
      "/sibling-member.ts": /* ts */ `
        enum x { y = 123 }
        enum x { z = y * 2 }
        console.log(x.y, x.z)
      `,
      "/sibling-enum-before.ts": /* ts */ `
        console.log(x)
        enum x { y = 123 }
        enum x { z = y * 2 }
      `,
      "/sibling-enum-middle.ts": /* ts */ `
        enum x { y = 123 }
        console.log(x)
        enum x { z = y * 2 }
      `,
      "/sibling-enum-after.ts": /* ts */ `
        enum x { y = 123 }
        enum x { z = y * 2 }
        console.log(x)
      `,
      "/namespace-before.ts": /* ts */ `
        namespace x { console.log(x, y) }
        enum x { y = 123 }
      `,
      "/namespace-after.ts": /* ts */ `
        enum x { y = 123 }
        namespace x { console.log(x, y) }
      `,
    },
    entryPoints: [
      "/simple-member.ts",
      "/simple-enum.ts",
      "/sibling-member.ts",
      "/sibling-enum-before.ts",
      "/sibling-enum-middle.ts",
      "/sibling-enum-after.ts",
      "/namespace-before.ts",
      "/namespace-after.ts",
    ],
  });
  itBundled("ts/TSEnumJSX", {
    // GENERATED
    files: {
      "/element.tsx": /* tsx */ `
        export enum Foo { Div = 'div' }
        console.log(<Foo.Div />)
      `,
      "/fragment.tsx": /* tsx */ `
        export enum React { Fragment = 'div' }
        console.log(<>test</>)
      `,
      "/nested-element.tsx": /* tsx */ `
        namespace x.y { export enum Foo { Div = 'div' } }
        namespace x.y { console.log(<x.y.Foo.Div />) }
      `,
      "/nested-fragment.tsx": /* tsx */ `
        namespace x.y { export enum React { Fragment = 'div' } }
        namespace x.y { console.log(<>test</>) }
      `,
    },
    entryPoints: ["/element.tsx", "/fragment.tsx", "/nested-element.tsx", "/nested-fragment.tsx"],
    mode: "passthrough",
  });
  itBundled("ts/TSEnumDefine", {
    // GENERATED
    files: {
      "/entry.ts": `enum a { b = 123, c = d }`,
    },
    mode: "passthrough",
  });
  itBundled("ts/TSEnumSameModuleInliningAccess", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        enum a { x = 123 }
        enum b { x = 123 }
        enum c { x = 123 }
        enum d { x = 123 }
        enum e { x = 123 }
        console.log([
          a.x,
          b['x'],
          c?.x,
          d?.['x'],
          e,
        ])
      `,
    },
  });
  itBundled("ts/TSEnumCrossModuleInliningAccess", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import { a, b, c, d, e } from './enums'
        console.log([
          a.x,
          b['x'],
          c?.x,
          d?.['x'],
          e,
        ])
      `,
      "/enums.ts": /* ts */ `
        export enum a { x = 123 }
        export enum b { x = 123 }
        export enum c { x = 123 }
        export enum d { x = 123 }
        export enum e { x = 123 }
      `,
    },
  });
  itBundled("ts/TSEnumCrossModuleInliningDefinitions", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import { a } from './enums'
        console.log([
          a.implicit_number,
          a.explicit_number,
          a.explicit_string,
          a.non_constant,
        ])
      `,
      "/enums.ts": /* ts */ `
        export enum a {
          implicit_number,
          explicit_number = 123,
          explicit_string = 'xyz',
          non_constant = foo,
        }
      `,
    },
  });
  itBundled("ts/TSEnumCrossModuleInliningReExport", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import { a } from './re-export'
        import { b } from './re-export-star'
        import * as ns from './enums'
        console.log([
          a.x,
          b.x,
          ns.c.x,
        ])
      `,
      "/re-export.js": `export { a } from './enums'`,
      "/re-export-star.js": `export * from './enums'`,
      "/enums.ts": /* ts */ `
        export enum a { x = 'a' }
        export enum b { x = 'b' }
        export enum c { x = 'c' }
      `,
    },
  });
  itBundled("ts/TSEnumCrossModuleTreeShaking", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import {
          a_DROP,
          b_DROP,
          c_DROP,
        } from './enums'
  
        console.log([
          a_DROP.x,
          b_DROP['x'],
          c_DROP.x,
        ])
  
        import {
          a_keep,
          b_keep,
          c_keep,
          d_keep,
          e_keep,
        } from './enums'
  
        console.log([
          a_keep.x,
          b_keep.x,
          c_keep,
          d_keep.y,
          e_keep.x,
        ])
      `,
      "/enums.ts": /* ts */ `
        export enum a_DROP { x = 1 }  // test a dot access
        export enum b_DROP { x = 2 }  // test an index access
        export enum c_DROP { x = '' } // test a string enum
  
        export enum a_keep { x = false } // false is not inlinable
        export enum b_keep { x = foo }   // foo has side effects
        export enum c_keep { x = 3 }     // this enum object is captured
        export enum d_keep { x = 4 }     // we access "y" on this object
        export let e_keep = {}           // non-enum properties should be kept
      `,
    },
  });
  itBundled("ts/TSEnumExportClause", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        import {
          A,
          B,
          C as c,
          d as dd,
        } from './enums'
  
        console.log([
          A.A,
          B.B,
          c.C,
          dd.D,
        ])
      `,
      "/enums.ts": /* ts */ `
        export enum A { A = 1 }
          enum B { B = 2 }
          export enum C { C = 3 }
          enum D { D = 4 }
          export { B, D as d }
      `,
    },
  });
  itBundled("ts/TSThisIsUndefinedWarning", {
    // GENERATED
    files: {
      "/warning1.ts": `export var foo = this`,
      "/warning2.ts": `export var foo = this || this.foo`,
      "/warning3.ts": `export var foo = this ? this.foo : null`,
      "/silent1.ts": `export var foo = this && this.foo`,
      "/silent2.ts": `export var foo = this && (() => this.foo)`,
    },
    entryPoints: ["/warning1.ts", "/warning2.ts", "/warning3.ts", "/silent1.ts", "/silent2.ts"],
    /* TODO FIX expectedScanLog: `warning1.ts: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  warning1.ts: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  warning2.ts: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  warning2.ts: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  warning3.ts: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  warning3.ts: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  `, */
  });
  itBundled("ts/TSCommonJSVariableInESMTypeModule", {
    // GENERATED
    files: {
      "/entry.ts": `module.exports = null`,
      "/package.json": `{ "type": "module" }`,
    },
    /* TODO FIX expectedScanLog: `entry.ts: WARNING: The CommonJS "module" variable is treated as a global variable in an ECMAScript module and may not work as expected
  package.json: NOTE: This file is considered to be an ECMAScript module because the enclosing "package.json" file sets the type of this file to "module":
  NOTE: Node's package format requires that CommonJS files in a "type": "module" package use the ".cjs" file extension. If you are using TypeScript, you can use the ".cts" file extension with esbuild instead.
  `, */
  });
  itBundled("ts/EnumRulesFrom_TypeScript_5_0", {
    // GENERATED
    files: {
      "/supported.ts": /* ts */ `
        // From https://github.com/microsoft/TypeScript/pull/50528:
        // "An expression is considered a constant expression if it is
        const enum Foo {
          // a number or string literal,
          X0 = 123,
          X1 = 'x',
  
          // a unary +, -, or ~ applied to a numeric constant expression,
          X2 = +1,
          X3 = -2,
          X4 = ~3,
  
          // a binary +, -, *, /, %, **, <<, >>, >>>, |, &, ^ applied to two numeric constant expressions,
          X5 = 1 + 2,
          X6 = 1 - 2,
          X7 = 2 * 3,
          X8 = 1 / 2,
          X9 = 3 % 2,
          X10 = 2 ** 3,
          X11 = 1 << 2,
          X12 = -9 >> 1,
          X13 = -9 >>> 1,
          X14 = 5 | 12,
          X15 = 5 & 12,
          X16 = 5 ^ 12,
  
          // a binary + applied to two constant expressions whereof at least one is a string,
          X17 = 'x' + 0,
          X18 = 0 + 'x',
          X19 = 'x' + 'y',
          X20 = '' + NaN,
          X21 = '' + Infinity,
          X22 = '' + -Infinity,
          X23 = '' + -0,
  
          // a template expression where each substitution expression is a constant expression,
          X24 = \` + "\`A\$00}B\$0'x'}C\$01 + 3 - 4 / 2 * 5 ** 6}D\`" +
      `,
      "/not-supported.ts": /* ts */ `
        const enum NonIntegerNumberToString {
          SUPPORTED = '' + 1,
          UNSUPPORTED = '' + 1.5,
        }
        console.log(
          NonIntegerNumberToString.SUPPORTED,
          NonIntegerNumberToString.UNSUPPORTED,
        )
  
        const enum OutOfBoundsNumberToString {
          SUPPORTED = '' + 1_000_000_000,
          UNSUPPORTED = '' + 1_000_000_000_000,
        }
        console.log(
          OutOfBoundsNumberToString.SUPPORTED,
          OutOfBoundsNumberToString.UNSUPPORTED,
        )
  
        const enum TemplateExpressions {
          // TypeScript enums don't handle any of these
          NULL = '' + null,
          TRUE = '' + true,
          FALSE = '' + false,
          BIGINT = '' + 123n,
        }
        console.log(
          TemplateExpressions.NULL,
          TemplateExpressions.TRUE,
          TemplateExpressions.FALSE,
          TemplateExpressions.BIGINT,
        )
      `,
    },
    entryPoints: ["/supported.ts", "/not-supported.ts"],
  });
  itBundled("ts/TSEnumUseBeforeDeclare", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        export function before() {
          console.log(Foo.FOO)
        }
        enum Foo { FOO }
        export function after() {
          console.log(Foo.FOO)
        }
      `,
    },
  });
});
