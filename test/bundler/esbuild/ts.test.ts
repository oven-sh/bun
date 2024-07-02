import assert from "assert";
import { itBundled } from "../expectBundled";
import { describe, expect } from "bun:test";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_ts_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/

describe("bundler", () => {
  itBundled("ts/DeclareConst", {
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
  itBundled("ts/DeclareLet", {
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
  itBundled("ts/DeclareVar", {
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
  itBundled("ts/DeclareClass", {
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
  itBundled("ts/DeclareClassFields", {
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
          a = 1
          declare b: number
          [(() => null, c)] = 3
          declare [(() => null, d)]: number

          static A = 5
          static declare B: number
          static [(() => null, C)] = 7
          static declare [(() => null, D)]: number
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
        Foo     {"name":{"value":"Foo","writable":false,"enumerable":false,"configurable":true},"A":{"value":5,"writable":true,"enumerable":true,"configurable":true},"global.C":{"value":7,"writable":true,"enumerable":true,"configurable":true}}
        new Foo {"a":{"value":1,"writable":true,"enumerable":true,"configurable":true},"global.c":{"value":3,"writable":true,"enumerable":true,"configurable":true}}
        Bar     {"name":{"value":"Bar","writable":false,"enumerable":false,"configurable":true},"A":{"writable":true,"enumerable":true,"configurable":true},"global.C":{"writable":true,"enumerable":true,"configurable":true}}
        new Bar {"a":{"writable":true,"enumerable":true,"configurable":true},"global.c":{"writable":true,"enumerable":true,"configurable":true}}
      `,
    },
  });
  itBundled("ts/DeclareFunction", {
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
  itBundled("ts/DeclareNamespace", {
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
  itBundled("ts/DeclareEnum", {
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
  itBundled("ts/DeclareConstEnum", {
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
  itBundled("ts/ConstEnumComments", {
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
  itBundled("ts/ImportEmptyNamespace", {
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
  itBundled("ts/ImportMissingES6", {
    files: {
      "/entry.ts": /* ts */ `
        import fn, {x as a, y as b} from './foo'
        console.log(fn(a, b))
      `,
      "/foo.js": `export const x = 123;`,
    },
    bundleErrors: {
      "/entry.ts": [
        `No matching export in "foo.js" for import "default"`,
        `No matching export in "foo.js" for import "y"`,
      ],
    },
  });
  itBundled("ts/ImportMissingUnusedES6", {
    files: {
      "/entry.ts": `import fn, {x as a, y as b} from './foo'`,
      "/foo.js": `export const x = 123`,
    },
    // goal for this test is there is no error. we dont really care about the output
  });
  itBundled("ts/ExportMissingES6", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        import * as ns from './foo'
        console.log(JSON.stringify(ns))
      `,
      // the reason this doesnt error in TS is because `nope` can be a type
      "/foo.ts": `export {nope} from './bar'`,
      "/bar.js": `export const yep = 123`,
    },
    run: {
      stdout: `{}`,
    },
  });
  itBundled("ts/ImportMissingFile", {
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
  itBundled("ts/ImportTypeOnlyFile", {
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
  itBundled("ts/ExportEquals", {
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
  itBundled("ts/ExportNamespace", {
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
  itBundled("ts/MinifyEnum", {
    files: {
      "/a.ts": `enum Foo { A, B, C = Foo }\ncapture(Foo)`,
      "/b.ts": `export enum Foo { X, Y, Z = Foo }`,
    },
    entryPoints: ["/a.ts", "./b.ts"],
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    bundling: false,
    onAfterBundle(api) {
      const a = api.readFile("/out.js");
      api.writeFile("/out.edited.js", a.replace(/capture\((.*?)\)/, `export const Foo = $1`));
      const b = api.readFile("/out/b.js");

      // make sure the minification trick "enum[enum.K=V]=K" is used, but `enum`
      assert(a.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.A=0]=["']A["']/), "should be using enum minification trick (1)");
      assert(a.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.B=1]=["']B["']/), "should be using enum minification trick (2)");
      assert(a.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.C=[a-zA-Z$]]=["']C["']/), "should be using enum minification trick (3)");
      assert(b.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.X=0]=["']X["']/), "should be using enum minification trick (4)");
      assert(b.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.Y=1]=["']Y["']/), "should be using enum minification trick (5)");
      assert(b.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.Z=[a-zA-Z$]]=["']Z["']/), "should be using enum minification trick (6)");
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
  itBundled("ts/MinifyEnumExported", {
    files: {
      "/b.ts": `export enum Foo { X, Y, Z = Foo }`,
    },
    entryPoints: ["/b.ts"],
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    bundling: false,
    onAfterBundle(api) {
      const b = api.readFile("/out.js");

      // make sure the minification trick "enum[enum.K=V]=K" is used, but `enum`
      assert(b.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.X=0]=["']X["']/), "should be using enum minification trick (4)");
      assert(b.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.Y=1]=["']Y["']/), "should be using enum minification trick (5)");
      assert(b.match(/\b[a-zA-Z$]\[[a-zA-Z$]\.Z=[a-zA-Z$]]=["']Z["']/), "should be using enum minification trick (6)");
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        import {Foo as FooB} from './out.js'
        import assert from 'assert';
        assert.strictEqual(FooB.X, 0, 'b.ts Foo.X')
        assert.strictEqual(FooB.Y, 1, 'b.ts Foo.Y')
        assert.strictEqual(FooB.Z, FooB, 'b.ts Foo.Z')
        assert.strictEqual(FooB[0], 'X', 'b.ts Foo[0]')
        assert.strictEqual(FooB[1], 'Y', 'b.ts Foo[1]')
        assert.strictEqual(FooB[FooB], 'Z', 'b.ts Foo[Foo]')
      `,
    },
  });
  itBundled("ts/MinifyNestedEnum", {
    files: {
      "/a.ts": `function foo(arg) { enum Foo { A, B, C = Foo, D = arg } return Foo }\ncapture(foo)`,
      "/b.ts": `export function foo(arg) { enum Foo { X, Y, Z = Foo, W = arg } return Foo }`,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
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
  itBundled("ts/MinifyNestedEnumNoLogicalAssignment", {
    files: {
      "/a.ts": `function foo(arg) { enum Foo { A, B, C = Foo, D = arg } return Foo }\ncapture(foo)`,
      "/b.ts": `export function foo(arg) { enum Foo { X, Y, Z = Foo, W = arg } return Foo }`,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    bundling: false,
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
  itBundled("ts/MinifyNestedEnumNoArrow", {
    files: {
      "/a.ts": `function foo() { enum Foo { A, B, C = Foo } return Foo }`,
      "/b.ts": `export function foo() { enum Foo { X, Y, Z = Foo } return Foo }`,
    },
    entryPoints: ["/a.ts", "/b.ts"],
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    outdir: "/",
    bundling: false,
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
  itBundled("ts/MinifyNamespace", {
    files: {
      "/a.ts": /* ts */ `
        namespace Foo {
          export namespace Bar {
            foo(Foo, Bar)
          }
        }
        capture(Foo)
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
    onAfterBundle(api) {
      api.writeFile("/out/a.edited.js", api.readFile("/out/a.js").replace(/capture\((.*?)\)/, `export const Foo = $1`));
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        let called = false;
        globalThis.foo = (a, b) => called = true;
        await import('./out/a.edited.js');
        assert(called, 'foo should be called from a.ts');
        called = false;
        await import('./out/b.js');
        assert(called, 'foo should be called from b.ts');
      `,
    },
  });
  itBundled("ts/MinifyNamespaceNoLogicalAssignment", {
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
    bundling: false,
    unsupportedJSFeatures: ["logical-assignment"],
    onAfterBundle(api) {
      const a = api.readFile("/a.js");
      assert(a.includes("Bar"), "a should not be empty");
      assert(!a.includes("||="), "a should not use logical assignment");
      const b = api.readFile("/b.js");
      assert(b.includes("Bar"), "b should not be empty");
      assert(!b.includes("||="), "b should not use logical assignment");
    },
  });
  itBundled("ts/MinifyNamespaceNoArrow", {
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
    bundling: false,
    unsupportedJSFeatures: ["arrow"],
    onAfterBundle(api) {
      const a = api.readFile("/a.js");
      assert(a.includes("foo"), "a should not be empty");
      assert(!a.includes("=>"), "a should not use arrow");
      const b = api.readFile("/b.js");
      assert(b.includes("foo"), "b should not be empty");
      assert(!b.includes("=>"), "b should not use arrow");
    },
  });
  itBundled("ts/MinifyDerivedClass", {
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

        export {Foo}
      `,
    },
    minifySyntax: true,
    runtimeFiles: {
      "/test.js": /* js */ `
        let calledFoo = false;
        let calledBar = false;
        globalThis.foo = () => calledFoo = true;
        globalThis.bar = () => calledBar = true;
        globalThis.Bar = class Bar {
          constructor() {
            console.log('super')
            this.hello = 3;
          }
        };
        const {Foo} = await import('./entry.js');
        import assert from 'assert';
        const instance = new Foo();
        console.log(instance.foo, instance.bar, instance.hello);
        assert(calledFoo, 'foo should be called');
        assert(calledBar, 'bar should be called');
      `,
    },
    run: {
      file: "/test.js",
      stdout: "super\n1 2 3",
    },
  });
  itBundled("ts/ImportVsLocalCollisionAllTypes", {
    files: {
      "/entry.ts": /* ts */ `
        import {a, b, c, d, e} from './other.ts'
        let a
        const b = 0
        var c
        function d() { return 5; }
        class e { constructor() { this.prop = 2; }}
        console.log(JSON.stringify([a, b, c, d(), new e]))
      `,
      "/other.ts": ``,
    },
    run: {
      stdout: '[null,0,null,5,{"prop":2}]',
    },
  });
  itBundled("ts/ImportVsLocalCollisionMixed", {
    files: {
      "/entry.ts": /* ts */ `
        import {a, b, c, d, e, real} from './other.ts'
        let a
        const b = 0
        var c
        function d() { return 5; }
        class e { constructor() { this.prop = 2; }}
        console.log(JSON.stringify([a, b, c, d(), new e, real]))
      `,
      "/other.ts": `export let real = 123`,
    },
    run: {
      stdout: '[null,0,null,5,{"prop":2},123]',
    },
  });
  itBundled("ts/ImportEqualsEliminationTest", {
    todo: true,
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
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.foo = {
          a: { b: { c: 123 } },
          get x() {
            throw new Error('should not be called')
          }
        };
        const {bar} = await import('./out.js');
        console.log(bar);
      `,
    },
    run: {
      file: "/test.js",
      stdout: "123",
    },
  });
  itBundled("ts/ImportEqualsTreeShakingFalse", {
    files: {
      "/entry.ts": /* ts */ `
        import { foo } from 'pkg'
        import used = foo.used
        import unused_keep = foo.unused
        export { used }
      `,
    },
    treeShaking: false,
    dce: true,
    bundling: false,
    external: ["pkg"],
  });
  itBundled("ts/ImportEqualsTreeShakingTrue", {
    todo: true,
    files: {
      "/entry.ts": /* ts */ `
        import { foo } from 'pkg'
        import used = foo.used
        import unused_drop = foo.unused
        export { used }
      `,
    },
    dce: true,
    treeShaking: true,
    external: ["pkg"],
    bundling: false,
  });
  itBundled("ts/ImportEqualsBundle", {
    todo: true,
    files: {
      "/entry.ts": /* ts */ `
        import { foo } from 'pkg'
        import used = foo.used
        import unused_drop = foo.unused
        export { used }
      `,
    },
    dce: true,
    treeShaking: true,
    external: ["pkg"],
  });
  itBundled("ts/MinifiedBundleES6", {
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
    run: {
      stdout: "123",
    },
  });
  itBundled("ts/MinifiedBundleCommonJS", {
    files: {
      "/entry.ts": /* ts */ `
        const {foo} = require('./a')
        console.log(JSON.stringify([foo(), require('./j.json')]))
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
    run: {
      stdout: '[123,{"test":true}]',
    },
  });
  itBundled("ts/TypeScriptDecoratorsSimpleCase", {
    files: {
      "/entry.ts": /* ts */ `
        function decorator(...args) {
          console.log('decorator called', JSON.stringify(args))
        }

        @decorator
        class Foo {
          @decorator
          bar() {
            console.log('bar called')
          }
        }

        new Foo().bar()
      `,
    },
    run: {
      stdout: `
        decorator called [{},"bar",{"writable":true,"enumerable":false,"configurable":true}]
        decorator called [null]
        bar called
      `,
    },
  });
  itBundled("ts/TypeScriptDecorators", {
    // We still need to handle decorators with computed properties in method names
    todo: true,

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
          @x @y declare mAbst
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
          @x @y abstract [mAbst()]

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
    files: {
      "/entry.ts": /* ts */ `
        @decoratorMustComeAfterName
        class Foo {}
      `,
    },
    keepNames: true,
  });
  itBundled("ts/TypeScriptDecoratorScopeESBuildIssue2147", {
    files: {
      "/entry.ts": /* ts */ `
        class Foo {
          method1(@dec(foo) foo = 2) {}
          method2(@dec(() => foo) foo = 3) {}
        }

        class Bar {
          static x = class {
            static y = () => {
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
        console.log(Foo, Bar)
      `,
    },
    bundling: false,
    onAfterBundle(api) {
      const capturedCalls = api.captureFile("/out.js", "dec");
      expect(capturedCalls).toEqual([
        "foo",
        "() => foo",
        "bar",
        "() => bar",
        "() => bar",
        "() => bar",
        "bar",
        "() => bar",
      ]);
    },
  });
  itBundled("ts/ExportTypeSTAR", {
    files: {
      "/entry.ts": /* ts */ `
        export type * as Foo from "foo";
        export type * from "foo";
        console.log("hi");
    `,
    },
    run: {
      stdout: "hi\n",
    },
  });
  itBundled("ts/ExportDefaultTypeESBuildIssue316", {
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
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.foo = 123456;
        const mod = (await import('./out.js')).default;
        console.log(JSON.stringify(mod))
        console.log(JSON.stringify(mod.map(x => typeof x)))
      `,
    },
    run: {
      file: "/test.js",
      stdout: `
        [123456,123,123456,123,null,123,123456,123,123456,123,{"num":0},123,{"num":0},123,123,123,123,123,123,123]
        ["number","number","number","number","function","number","number","number","number","number","object","number","object","number","number","number","number","number","number","number"]
      `,
    },
  });
  itBundled("ts/ImplicitExtensions", {
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
      "/pick-js.ts": `console.log("FAILED")`,
      "/pick-ts.jsx": `console.log("FAILED")`,
      "/pick-ts.ts": `console.log("correct")`,
      "/pick-jsx.jsx": `console.log("correct")`,
      "/pick-jsx.tsx": `console.log("FAILED")`,
      "/pick-tsx.js": `console.log("FAILED")`,
      "/pick-tsx.tsx": `console.log("correct")`,
      "/order-js.ts": `console.log("correct")`,
      "/order-js.tsx": `console.log("FAILED")`,
      "/order-jsx.ts": `console.log("correct")`,
      "/order-jsx.tsx": `console.log("FAILED")`,
    },
    run: {
      stdout: "correct\n".repeat(6),
    },
  });
  itBundled("ts/ImplicitExtensionsMissing", {
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
    bundleErrors: {
      "/entry.ts": [
        `Could not resolve: "./mjs.mjs"`,
        `Could not resolve: "./cjs.cjs"`,
        `Could not resolve: "./js.js"`,
        `Could not resolve: "./jsx.jsx"`,
      ],
    },
  });
  itBundled("ts/ExportTypeESBuildIssue379", {
    files: {
      "/entry.ts": /* ts */ `
        import * as A from './a'
        import * as B from './b'
        import * as C from './c'
        import * as D from './d'
        console.log(JSON.stringify([A, B, C, D]))
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
    run: {
      stdout: '[{"foo":123},{"foo":123},{"foo":123},{"foo":123}]',
    },
    useDefineForClassFields: false,
  });
  itBundled("ts/ThisInsideFunctionTS", {
    files: {
      "/entry.ts": /* ts */ `
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
    },
    runtimeFiles: {
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
  itBundled("ts/ThisInsideFunctionTSUseDefineForClassFields", {
    files: {
      "/entry.ts": /* ts */ `
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
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.nested = true;
        globalThis.assert = (await import('assert')).default;
        import('./out')
      `,
    },
    run: {
      file: "/test.js",
    },
    useDefineForClassFields: true,
  });
  itBundled("ts/ThisInsideFunctionTSNoBundle", {
    files: {
      "/entry.ts": /* ts */ `
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
    },
    bundling: false,
    runtimeFiles: {
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
  itBundled("ts/ThisInsideFunctionTSNoBundleUseDefineForClassFields", {
    files: {
      "/entry.ts": /* ts */ `
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
    },
    bundling: false,
    runtimeFiles: {
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
  itBundled("ts/ComputedClassFieldUseDefineFalse", {
    todo: true,
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
        export default Foo;
      `,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.q = 'q1';
        globalThis.r = 'r1';
        globalThis.s = 's1';
        globalThis.x = 'x1';
        globalThis.y = 'y1';
        globalThis.z = 'z1';
        globalThis.dec = function(...args) {
          console.log(JSON.stringify([this, ...args]));
        };
        const Foo = (await import('./out')).default;
        globalThis.q = 'q2';
        globalThis.r = 'r2';
        globalThis.s = 's2';
        globalThis.x = 'x2';
        globalThis.y = 'y2';
        globalThis.z = 'z2';
        const y = new Foo();
        console.log(JSON.stringify(y));
      `,
    },
    useDefineForClassFields: false,
    bundling: false,
    run: {
      stdout: `
        [null,{},"x1",null]
        [null,{},"y1",null]
        {"r1":"s2","y1":"z2"}
      `,
      file: "/test.js",
    },
  });
  itBundled("ts/ComputedClassFieldUseDefineTrue", {
    todo: true,
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
        export default Foo;
      `,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.q = 'q1';
        globalThis.r = 'r1';
        globalThis.s = 's1';
        globalThis.x = 'x1';
        globalThis.y = 'y1';
        globalThis.z = 'z1';
        globalThis.dec = function(...args) {
          console.log(JSON.stringify([this, ...args]));
        };
        const Foo = (await import('./out')).default;
        globalThis.q = 'q2';
        globalThis.r = 'r2';
        globalThis.s = 's2';
        globalThis.x = 'x2';
        globalThis.y = 'y2';
        globalThis.z = 'z2';
        const y = new Foo();
        console.log(JSON.stringify(y));
      `,
    },
    useDefineForClassFields: true,
    bundling: false,
    run: {
      stdout: `
        [null,{},"x1",null]
        [null,{},"y1",null]
        {"r1":"s2","y1":"z2"}
      `,
      file: "/test.js",
    },
  });
  itBundled("ts/ComputedClassFieldUseDefineTrueLower", {
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
        export default Foo;
      `,
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        globalThis.q = 'q1';
        globalThis.r = 'r1';
        globalThis.s = 's1';
        globalThis.x = 'x1';
        globalThis.y = 'y1';
        globalThis.z = 'z1';
        globalThis.dec = function(...args) {
          console.log(JSON.stringify([this, ...args]));
        };
        const Foo = (await import('./out')).default;
        globalThis.q = 'q2';
        globalThis.r = 'r2';
        globalThis.s = 's2';
        globalThis.x = 'x2';
        globalThis.y = 'y2';
        globalThis.z = 'z2';
        const y = new Foo();
        console.log(JSON.stringify(y));
      `,
    },
    useDefineForClassFields: true,
    bundling: false,
    run: {
      stdout: `
        [null,{},"x1",null]
        [null,{},"y1",null]
        {"r1":"s2","y1":"z2"}
      `,
      file: "/test.js",
    },
    unsupportedJSFeatures: ["class-field"],
  });
  itBundled("ts/AbstractClassFieldUseAssign", {
    todo: true,
    files: {
      "/entry.ts": /* ts */ `
        const keepThis = Symbol('keepThis')
        declare const AND_REMOVE_THIS: unique symbol
        abstract class Foo {
          REMOVE_THIS: any
          [keepThis]: any
          abstract REMOVE_THIS_TOO: any
          abstract [AND_REMOVE_THIS]: any
          abstract [(x => y => x + y)('nested')('scopes_REMOVE')]: any
        }
        (() => new Foo())()
      `,
    },
    dce: true,
    useDefineForClassFields: false,
  });
  itBundled("ts/AbstractClassFieldUseDefine", {
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
    bundling: false,
    useDefineForClassFields: true,
  });
  itBundled("ts/ImportMTS", {
    todo: true,
    files: {
      "/entry.ts": `import './imported.mjs'`,
      "/imported.mts": `console.log('works')`,
    },
    run: {
      stdout: "works",
    },
  });
  itBundled("ts/ImportCTS", {
    files: {
      "/entry.ts": `require('./required.cjs')`,
      "/required.cjs": `console.log('works')`,
    },
    run: {
      stdout: "works",
    },
  });
  itBundled("ts/SideEffectsFalseWarningTypeDeclarations", {
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
    onAfterBundle(api) {
      expect(api.readFile("/out.js").trim()).toBe("");
    },
  });
  itBundled("ts/SiblingNamespaceLet", {
    files: {
      "/let.ts": /* ts */ `
        export namespace x { export let y = 123 }
        export namespace x { export let z = y }
      `,
    },
    entryPoints: ["/let.ts"],
    bundling: false,
    runtimeFiles: {
      "/test.js": /* js */ `
        import assert from 'assert'
        const m = (await import('./out.js')).x
        assert(m.x === m.z, "it worked")
      `,
    },
  });
  itBundled("ts/SiblingNamespaceFunction", {
    files: {
      "/function.ts": /* ts */ `
        export namespace x { export function y() {} }
        export namespace x { export let z = y }
      `,
    },
    entryPoints: ["/function.ts"],
    bundling: false,
    runtimeFiles: {
      "/test.js": /* js */ `
        import assert from 'assert'
        const m = (await import('./out.js')).x
        assert(m.x === m.z, "it worked worked")
      `,
    },
  });
  itBundled("ts/SiblingNamespaceClass", {
    files: {
      "/let.ts": /* ts */ `
        export namespace x { export class y {} }
        export namespace x { export let z = y }
      `,
    },
    entryPoints: ["/let.ts"],
    bundling: false,
    runtimeFiles: {
      "/test.js": /* js */ `
        import assert from 'assert'
        const m = (await import('./out.js')).x
        assert(m.x === m.z, "it worked worked")
      `,
    },
  });
  itBundled("ts/SiblingNamespaceNamespace", {
    files: {
      "/namespace.ts": /* ts */ `
        export namespace x { export namespace y { 0 } }
        export namespace x { export let z = y }
      `,
    },
    entryPoints: ["/namespace.ts"],
    bundling: false,
    runtimeFiles: {
      "/test.js": /* js */ `
        import assert from 'assert'
        const m = (await import('./out.js')).x
        assert(m.x === m.z, "it worked worked")
      `,
    },
  });
  itBundled("ts/SiblingNamespaceEnum", {
    files: {
      "/enum.ts": /* ts */ `
        export namespace x { export enum y {} }
        export namespace x { export let z = y }
      `,
    },
    entryPoints: ["/enum.ts"],
    bundling: false,
    runtimeFiles: {
      "/test.js": /* js */ `
        import assert from 'assert'
        const m = (await import('./out.js')).x
        assert(m.x === m.z, "it worked.ts worked")
      `,
    },
    minifySyntax: false, // intentionally disabled. enum inlining always happens
  });
  itBundled("ts/SiblingEnum", {
    files: {
      "/number.ts": /* ts */ `
        (0, eval)('globalThis.y = 1234');
        (0, eval)('globalThis.z = 2345');

        export enum x { y, yy = y }
        export enum x { z = y + 1 }

        declare let y: any, z: any
        export namespace x { console.log(y, z) }
        console.log(x.y, x.z)
      `,
      "/string.ts": /* ts */ `
        (0, eval)('globalThis.y = 1234');
        (0, eval)('globalThis.z = 2345');

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
        (0, eval)('globalThis.y = 1234');
        (0, eval)('globalThis.z = 2345');
        export namespace foo { export enum x { y, yy = y } }
        export namespace foo { export enum x { z = y + 1 } }

        declare let y: any, z: any
        export namespace foo.x {
          console.log(y, z)
          console.log(x.y, x.z)
        }
      `,
      "/nested-string.ts": /* ts */ `
        (0, eval)('globalThis.y = 1234');
        (0, eval)('globalThis.z = 2345');

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
    run: [
      { file: "/out/number.js", stdout: "1234 2345\n0 1" },
      { file: "/out/string.js", stdout: "1234 2345\na a" },
      { file: "/out/propagation.js", stdout: "100 100 625 625" },
      { file: "/out/nested-number.js", stdout: "1234 2345\n0 1" },
      { file: "/out/nested-string.js", stdout: "1234 2345\na a" },
      { file: "/out/nested-propagation.js", stdout: "100 100 100 625 625 625" },
    ],
    minifySyntax: false, // intentionally disabled. enum inlining always happens
  });
  itBundled("ts/EnumTreeShaking", {
    files: {
      "/simple-member.ts": /* ts */ `
        enum x_DROP { y_DROP = 123 }
        console.log(x_DROP.y_DROP)
      `,
      "/simple-enum.ts": /* ts */ `
        enum x { y = 123 }
        console.log(JSON.stringify(x))
      `,
      "/sibling-member.ts": /* ts */ `
        enum drop_x { drop_y = 123 }
        enum drop_x { drop_z = drop_y * 2 }
        console.log(drop_x.drop_y, drop_x.drop_z)
      `,
      "/sibling-enum-before.ts": /* ts */ `
        console.log(x)
        enum x { y = 123 }
        enum x { z = y * 2 }
      `,
      "/sibling-enum-middle.ts": /* ts */ `
        enum x { y = 123 }
        console.log(JSON.stringify(x))
        enum x { z = y * 2 }
      `,
      "/sibling-enum-after.ts": /* ts */ `
        enum x { y = 123 }
        enum x { z = y * 2 }
        console.log(JSON.stringify(x))
      `,
      "/namespace-before.ts": /* ts */ `
        (0, eval)('globalThis.y = 1234');
        (0, eval)('globalThis.x = 2345');

        namespace x { console.log(x, y) }
        enum x { y = 123 }
      `,
      "/namespace-after.ts": /* ts */ `
        (0, eval)('globalThis.y = 1234');
        (0, eval)('globalThis.x = 2345');

        enum x { y = 123 }
        namespace x { console.log(JSON.stringify(x), y) }
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
    dce: true,
    run: [
      { file: "/out/simple-member.js", stdout: "123" },
      { file: "/out/simple-enum.js", stdout: '{"123":"y","y":123}' },
      { file: "/out/sibling-member.js", stdout: "123 246" },
      { file: "/out/sibling-enum-before.js", stdout: "undefined" },
      { file: "/out/sibling-enum-middle.js", stdout: '{"123":"y","y":123}' },
      { file: "/out/sibling-enum-after.js", stdout: '{"123":"y","246":"z","y":123,"z":246}' },
      { file: "/out/namespace-before.js", stdout: "{} 1234" },
      { file: "/out/namespace-after.js", stdout: '{"123":"y","y":123} 1234' },
    ],
    minifySyntax: false, // intentionally disabled. enum inlining always happens
  });
  itBundled("ts/EnumJSX", {
    // Blocking:
    // - jsx bugs (configuration does not seem to be respected)
    todo: true,
    files: {
      "/element.tsx": /* tsx */ `
        import { create } from 'not-react'

        export enum Foo { Div = 'div' }
        console.log(JSON.stringify(<Foo.Div />))
      `,
      "/fragment.tsx": /* tsx */ `
        import { create } from 'not-react'

        export enum React { Fragment = 'div' }
        console.log(JSON.stringify(<>test</>))
      `,
      "/nested-element.tsx": /* tsx */ `
        import { create } from 'not-react'

        namespace x.y { export enum Foo { Div = 'div' } }
        namespace x.y { console.log(JSON.stringify(<Foo.Div />)) }
      `,
      "/nested-fragment.tsx": /* tsx */ `
        import { create } from 'not-react'

        namespace x.y { export enum React { Fragment = 'div' } }
        namespace x.y { console.log(JSON.stringify(<>test</>)) }
      `,
    },
    entryPoints: ["/element.tsx", "/fragment.tsx", "/nested-element.tsx", "/nested-fragment.tsx"],
    outputPaths: ["/out/element.js", "/out/fragment.js", "/out/nested-element.js", "/out/nested-fragment.js"],
    external: ["*"],
    jsx: {
      runtime: "classic",
      factory: "create",
    },
    runtimeFiles: {
      "/node_modules/not-react/index.js": /* js */ `
        export const create = (tag, props, ...children) => [tag, props, children]
      `,
    },
    minifySyntax: false, // intentionally disabled. enum inlining always happens
    run: [
      { file: "/out/element.js", stdout: '["div",null,[]]' },
      { file: "/out/fragment.js", stdout: '["div",null,["test"]]' },
      { file: "/out/nested-element.js", stdout: '["div",null,[]]' },
      { file: "/out/nested-fragment.js", stdout: '["div",null,["test"]]' },
    ],
  });
  itBundled("ts/EnumDefine", {
    todo: true,
    files: {
      "/entry.ts": `
      enum a { b = 123, c = d }
      console.log(a.b, a.c)
      `,
    },
    define: {
      d: "b",
    },
    minifySyntax: false, // intentionally disabled. enum inlining always happens
    run: { stdout: "123 123" },
  });
  itBundled("ts/EnumSameModuleInliningAccess", {
    files: {
      "/entry.ts": /* ts */ `
        enum a_drop { x = 123 }
        enum b_drop { x = 123 }
        enum c { x = 123 }
        enum d { x = 123 }
        enum e { x = 123 }
        console.log(JSON.stringify([
          a_drop.x,
          b_drop['x'],
          c?.x,
          d?.['x'],
          e,
        ]))
      `,
    },
    dce: true,
    minifySyntax: false, // intentionally disabled. enum inlining always happens
    run: { stdout: '[123,123,123,123,{"123":"x","x":123}]' },
  });
  itBundled("ts/EnumCrossModuleInliningAccess", {
    files: {
      "/entry.ts": /* ts */ `
        import { drop_a, drop_b, c, d, e } from './enums'
        console.log(JSON.stringify([
          drop_a.x,
          drop_b['x'],
          c?.x,
          d?.['x'],
          e,
        ]))
      `,
      "/enums.ts": /* ts */ `
        export enum drop_a { x = 123 }
        export enum drop_b { x = 123 }
        export enum c { x = 123 }
        export enum d { x = 123 }
        export enum e { x = 123 }
      `,
    },
    minifySyntax: false, // intentionally disabled. enum inlining always happens
    dce: true,
  });
  itBundled("ts/EnumCrossModuleInliningDefinitions", {
    files: {
      "/entry.ts": /* ts */ `
        import { a } from './enums'
        (0, eval)('globalThis.["captu" + "re"] = x => x');
        console.log(JSON.stringify([
          capture(a.implicit_number),
          capture(a.explicit_number),
          capture(a.explicit_string),
          a.non_constant,
        ]))
      `,
      "/enums.ts": /* ts */ `
        (0, eval)('globalThis.foo = 321');

        export enum a {
          implicit_number,
          explicit_number = 123,
          explicit_string = 'xyz',
          non_constant = foo,
        }
      `,
    },
    minifySyntax: false, // intentionally disabled. enum inlining always happens
    onAfterBundle(api) {
      expect(api.captureFile("/out.js").map(x => x.replace(/\/\*.*\*\//g, "").trim())).toEqual(["0", "123", '"xyz"']);
    },
  });
  itBundled("ts/EnumCrossModuleInliningReExport", {
    files: {
      "/entry.js": /* js */ `
        import { a } from './re-export'
        import { b } from './re-export-star'
        import * as ns from './enums'
        console.log([
          capture(a.x),
          capture(b.x),
          capture(ns.c.x),
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
    minifySyntax: false, // intentionally disabled. enum inlining always happens
    onAfterBundle(api) {
      expect(api.captureFile("/out.js").map(x => x.replace(/\/\*.*\*\//g, "").trim())).toEqual(['"a"', '"b"', '"c"']);
    },
  });
  itBundled("ts/EnumCrossModuleTreeShaking", {
    files: {
      "/entry.ts": /* ts */ `
        import {
          a_DROP,
          b_DROP,
          c_DROP,
        } from './enums'

        console.log([
          capture(a_DROP.x),
          capture(b_DROP['x']),
          capture(c_DROP.x),
        ])

        import { a, b, c, d, e } from './enums'

        console.log([
          capture(a.x),
          capture(b.x),
          capture(c),
          capture(d.y),
          capture(e.x),
        ])
      `,
      "/enums.ts": /* ts */ `
        export enum a_DROP { x = 1 }  // test a dot access
        export enum b_DROP { x = 2 }  // test an index access
        export enum c_DROP { x = '' } // test a string enum

        export enum a { x = false } // false is not inlinable
        export enum b { x = foo }   // foo has side effects
        export enum c { x = 3 }     // this enum object is captured
        export enum d { x = 4 }     // we access "y" on this object
        export let e = {}           // non-enum properties should be kept
      `,
    },
    minifySyntax: false, // intentionally disabled. enum inlining always happens
    onAfterBundle(api) {
      expect(api.captureFile("/out.js").map(x => x.replace(/\/\*.*\*\//g, "").trim())).toEqual([
        "1",
        "2",
        '""',
        "a.x",
        "b.x",
        "c",
        "d.y",
        "e.x",
      ]);
    },
  });
  itBundled("ts/EnumExportClause", {
    files: {
      "/entry.ts": /* ts */ `
        import {
          A,
          B,
          C as c,
          d as dd,
        } from './enums'

        console.log([
          capture(A.A),
          capture(B.B),
          capture(c.C),
          capture(dd.D),
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
    minifySyntax: false, // intentionally disabled. enum inlining always happens
    onAfterBundle(api) {
      expect(api.captureFile("/out.js").map(x => x.replace(/\/\*.*\*\//g, "").trim())).toEqual(["1", "2", "3", "4"]);
    },
  });
  itBundled("ts/EnumRulesFrom_TypeScript_5_0", {
    files: {
      "/supported.ts":
        `
        // From https://github.com/microsoft/TypeScript/pull/50528:
				// "An expression is considered a constant expression if it is
				const enum DROP {
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
					X24 = ` +
        "`A${0}B${'x'}C${1 + 3 - 4 / 2 * 5 ** 6}D`" +
        `,

					// a parenthesized constant expression,
					X25 = (321),

					// a dotted name (e.g. x.y.z) that references a const variable with a constant expression initializer and no type annotation,
					/* (we don't implement this one) */

					// a dotted name that references an enum member with an enum literal type, or
					X26 = X0,
					X27 = X0 + 'x',
					X28 = 'x' + X0,
					X29 = ` +
        "`a${X0}b`" +
        `,
					X30 = DROP.X0,
					X31 = DROP.X0 + 'x',
					X32 = 'x' + DROP.X0,
					X33 = ` +
        "`a${DROP.X0}b`" +
        `,

					// a dotted name indexed by a string literal (e.g. x.y["z"]) that references an enum member with an enum literal type."
					X34 = X1,
					X35 = X1 + 'y',
					X36 = 'y' + X1,
					X37 = ` +
        "`a${X1}b`" +
        `,
					X38 = DROP['X1'],
					X39 = DROP['X1'] + 'y',
					X40 = 'y' + DROP['X1'],
					X41 = ` +
        "`a${DROP['X1']}b`" +
        `,
				}

				console.log(JSON.stringify([
					// a number or string literal,
					DROP.X0,
					DROP.X1,

					// a unary +, -, or ~ applied to a numeric constant expression,
					DROP.X2,
					DROP.X3,
					DROP.X4,

					// a binary +, -, *, /, %, **, <<, >>, >>>, |, &, ^ applied to two numeric constant expressions,
					DROP.X5,
					DROP.X6,
					DROP.X7,
					DROP.X8,
					DROP.X9,
					DROP.X10,
					DROP.X11,
					DROP.X12,
					DROP.X13,
					DROP.X14,
					DROP.X15,
					DROP.X16,

					// a template expression where each substitution expression is a constant expression,
					DROP.X17,
					DROP.X18,
					DROP.X19,
					DROP.X20,
					DROP.X21,
					DROP.X22,
					DROP.X23,

					// a template expression where each substitution expression is a constant expression,
					DROP.X24,

					// a parenthesized constant expression,
					DROP.X25,

					// a dotted name that references an enum member with an enum literal type, or
					DROP.X26,
					DROP.X27,
					DROP.X28,
					DROP.X29,
					DROP.X30,
					DROP.X31,
					DROP.X32,
					DROP.X33,

					// a dotted name indexed by a string literal (e.g. x.y["z"]) that references an enum member with an enum literal type."
					DROP.X34,
					DROP.X35,
					DROP.X36,
					DROP.X37,
					DROP.X38,
					DROP.X39,
					DROP.X40,
					DROP.X41,
        ]))
      `,
      "/not-supported.ts": /* ts */ `
        (0, eval)('globalThis["captu" + "re"] = x => x');

        const enum NumberToString {
          DROP_One = '' + 1,
          DROP_OnePointFive = '' + 1.5,
          DROP_Other = '' + 4132879497321892437432187943789312894378237491578123414321431,
          DROP_Billion = '' + 1_000_000_000,
          DROP_Trillion = '' + 1_000_000_000_000,
        }
        console.log(
          capture(NumberToString.DROP_One),
          capture(NumberToString.DROP_OnePointFive),
          capture(NumberToString.DROP_Other),
          capture(NumberToString.DROP_Billion),
          capture(NumberToString.DROP_Trillion),
        )

        const enum DROP_TemplateExpressions {
          // TypeScript enums don't handle any of these
          NULL = '' + null,
          TRUE = '' + true,
          FALSE = '' + false,
          BIGINT = '' + 123n,
          BIGINT_2 = '' + 4132879497321892437432187943789312894378237491578123414321431n,
        }

        console.log(
          capture(DROP_TemplateExpressions.NULL),
          capture(DROP_TemplateExpressions.TRUE),
          capture(DROP_TemplateExpressions.FALSE),
          capture(DROP_TemplateExpressions.BIGINT),
          capture(DROP_TemplateExpressions.BIGINT_2),
        )
      `,
    },
    dce: true,
    entryPoints: ["/supported.ts", "/not-supported.ts"],
    run: [
      {
        file: "/out/supported.js",
        stdout:
          '[123,"x",1,-2,-4,3,-1,6,0.5,1,8,4,-5,2147483643,13,4,9,"x0","0x","xy","NaN","Infinity","-Infinity","0","A0BxC-31246D",321,123,"123x","x123","a123b",123,"123x","x123","a123b","x","xy","yx","axb","x","xy","yx","axb"]',
      },
      {
        file: "/out/not-supported.js",
        stdout: `
          1 1.5 4.1328794973218926e+60 1000000000 1000000000000
          null true false 123 4132879497321892437432187943789312894378237491578123414321431
        `,
      },
    ],
    onAfterBundle(api) {
      expect(api.captureFile("/out/not-supported.js").map(x => x.replace(/\/\*.*\*\//g, "").trim())).toEqual([
        '"1"',
        '"1.5"',
        '"4.1328794973218926e+60"',
        '"1000000000"',
        '"1000000000000"',
        '"null"',
        '"true"',
        '"false"',
        '"123"',
        '"4132879497321892437432187943789312894378237491578123414321431"',
      ]);
    },
  });
  itBundled("ts/EnumUseBeforeDeclare", {
    files: {
      "/entry.ts": /* ts */ `
        before();
        after();

        export function before() {
          console.log(JSON.stringify(Foo), Foo.FOO)
        }
        enum Foo { FOO }
        export function after() {
          console.log(JSON.stringify(Foo), Foo.FOO)
        }

        before();
        after();
      `,
    },
    run: {
      stdout: `
        undefined 0
        undefined 0
        {"0":"FOO","FOO":0} 0
        {"0":"FOO","FOO":0} 0
      `,
    },
  });
});
