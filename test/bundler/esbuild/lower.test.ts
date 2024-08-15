import { itBundled } from "../expectBundled";
import { describe } from "bun:test";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_lower_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/lower

describe.todo("bundler", () => {
  itBundled("lower/LowerOptionalCatchNameCollisionNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        try {}
        catch { var e, e2 }
        var e3
      `,
    },
    unsupportedJSFeatures: "es2018",
    bundling: false,
  });
  itBundled("lower/LowerObjectSpreadNoBundle", {
    // GENERATED
    files: {
      "/entry.jsx": /* jsx */ `
        let tests = [
          {...a, ...b},
          {a, b, ...c},
          {...a, b, c},
          {a, ...b, c},
          {a, b, ...c, ...d, e, f, ...g, ...h, i, j},
        ]
        let jsx = [
          <div {...a} {...b}/>,
          <div a b {...c}/>,
          <div {...a} b c/>,
          <div a {...b} c/>,
          <div a b {...c} {...d} e f {...g} {...h} i j/>,
        ]
      `,
    },
    unsupportedJSFeatures: "es2017",
    bundling: false,
  });
  itBundled("lower/LowerExponentiationOperatorNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        let tests = {
          // Exponentiation operator
          0: a ** b ** c,
          1: (a ** b) ** c,
  
          // Exponentiation assignment operator
          2: a **= b,
          3: a.b **= c,
          4: a[b] **= c,
          5: a().b **= c,
          6: a()[b] **= c,
          7: a[b()] **= c,
          8: a()[b()] **= c,
  
          // These all should not need capturing (no object identity)
          9: a[0] **= b,
          10: a[false] **= b,
          11: a[null] **= b,
          12: a[void 0] **= b,
          13: a[123n] **= b,
          14: a[this] **= b,
  
          // These should need capturing (have object identitiy)
          15: a[/x/] **= b,
          16: a[{}] **= b,
          17: a[[]] **= b,
          18: a[() => {}] **= b,
          19: a[function() {}] **= b,
        }
      `,
    },
    unsupportedJSFeatures: "es2015",
    bundling: false,
    /* TODO FIX expectedScanLog: `entry.js: ERROR: Big integer literals are not available in the configured target environment
  `, */
  });
  itBundled("lower/LowerPrivateFieldAssignments2015NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #x
          unary() {
            this.#x++
            this.#x--
            ++this.#x
            --this.#x
          }
          binary() {
            this.#x = 1
            this.#x += 1
            this.#x -= 1
            this.#x *= 1
            this.#x /= 1
            this.#x %= 1
            this.#x **= 1
            this.#x <<= 1
            this.#x >>= 1
            this.#x >>>= 1
            this.#x &= 1
            this.#x |= 1
            this.#x ^= 1
            this.#x &&= 1
            this.#x ||= 1
            this.#x ??= 1
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2015",
    bundling: false,
  });
  itBundled("lower/LowerPrivateFieldAssignments2019NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #x
          unary() {
            this.#x++
            this.#x--
            ++this.#x
            --this.#x
          }
          binary() {
            this.#x = 1
            this.#x += 1
            this.#x -= 1
            this.#x *= 1
            this.#x /= 1
            this.#x %= 1
            this.#x **= 1
            this.#x <<= 1
            this.#x >>= 1
            this.#x >>>= 1
            this.#x &= 1
            this.#x |= 1
            this.#x ^= 1
            this.#x &&= 1
            this.#x ||= 1
            this.#x ??= 1
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2019",
    bundling: false,
  });
  itBundled("lower/LowerPrivateFieldAssignments2020NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #x
          unary() {
            this.#x++
            this.#x--
            ++this.#x
            --this.#x
          }
          binary() {
            this.#x = 1
            this.#x += 1
            this.#x -= 1
            this.#x *= 1
            this.#x /= 1
            this.#x %= 1
            this.#x **= 1
            this.#x <<= 1
            this.#x >>= 1
            this.#x >>>= 1
            this.#x &= 1
            this.#x |= 1
            this.#x ^= 1
            this.#x &&= 1
            this.#x ||= 1
            this.#x ??= 1
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2020",
    bundling: false,
  });
  itBundled("lower/LowerPrivateFieldAssignmentsNextNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #x
          unary() {
            this.#x++
            this.#x--
            ++this.#x
            --this.#x
          }
          binary() {
            this.#x = 1
            this.#x += 1
            this.#x -= 1
            this.#x *= 1
            this.#x /= 1
            this.#x %= 1
            this.#x **= 1
            this.#x <<= 1
            this.#x >>= 1
            this.#x >>>= 1
            this.#x &= 1
            this.#x |= 1
            this.#x ^= 1
            this.#x &&= 1
            this.#x ||= 1
            this.#x ??= 1
          }
        }
      `,
    },
    bundling: false,
  });
  itBundled("lower/LowerPrivateFieldOptionalChain2019NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #x
          foo() {
            this?.#x.y
            this?.y.#x
            this.#x?.y
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2019",
    bundling: false,
  });
  itBundled("lower/LowerPrivateFieldOptionalChain2020NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #x
          foo() {
            this?.#x.y
            this?.y.#x
            this.#x?.y
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2020",
    bundling: false,
  });
  itBundled("lower/LowerPrivateFieldOptionalChainNextNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #x
          foo() {
            this?.#x.y
            this?.y.#x
            this.#x?.y
          }
        }
      `,
    },
    bundling: false,
  });
  itBundled("lower/TSLowerPrivateFieldOptionalChain2015NoBundle", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        class Foo {
          #x
          foo() {
            this?.#x.y
            this?.y.#x
            this.#x?.y
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2015",
    bundling: false,
  });
  itBundled("lower/TSLowerPrivateStaticMembers2015NoBundle", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        class Foo {
          static #x
          static get #y() {}
          static set #y(x) {}
          static #z() {}
          foo() {
            Foo.#x += 1
            Foo.#y += 1
            Foo.#z()
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2015",
    bundling: false,
  });
  itBundled("lower/TSLowerPrivateFieldAndMethodAvoidNameCollision2015", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        class WeakMap {
          #x
        }
        class WeakSet {
          #y() {}
        }
      `,
    },
    unsupportedJSFeatures: "es2015",
  });
  itBundled("lower/LowerPrivateGetterSetter2015", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          get #foo() { return this.foo }
          set #bar(val) { this.bar = val }
          get #prop() { return this.prop }
          set #prop(val) { this.prop = val }
          foo(fn) {
            fn().#foo
            fn().#bar = 1
            fn().#prop
            fn().#prop = 2
          }
          unary(fn) {
            fn().#prop++;
            fn().#prop--;
            ++fn().#prop;
            --fn().#prop;
          }
          binary(fn) {
            fn().#prop = 1;
            fn().#prop += 1;
            fn().#prop -= 1;
            fn().#prop *= 1;
            fn().#prop /= 1;
            fn().#prop %= 1;
            fn().#prop **= 1;
            fn().#prop <<= 1;
            fn().#prop >>= 1;
            fn().#prop >>>= 1;
            fn().#prop &= 1;
            fn().#prop |= 1;
            fn().#prop ^= 1;
            fn().#prop &&= 1;
            fn().#prop ||= 1;
            fn().#prop ??= 1;
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2015",
  });
  itBundled("lower/LowerPrivateGetterSetter2019", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          get #foo() { return this.foo }
          set #bar(val) { this.bar = val }
          get #prop() { return this.prop }
          set #prop(val) { this.prop = val }
          foo(fn) {
            fn().#foo
            fn().#bar = 1
            fn().#prop
            fn().#prop = 2
          }
          unary(fn) {
            fn().#prop++;
            fn().#prop--;
            ++fn().#prop;
            --fn().#prop;
          }
          binary(fn) {
            fn().#prop = 1;
            fn().#prop += 1;
            fn().#prop -= 1;
            fn().#prop *= 1;
            fn().#prop /= 1;
            fn().#prop %= 1;
            fn().#prop **= 1;
            fn().#prop <<= 1;
            fn().#prop >>= 1;
            fn().#prop >>>= 1;
            fn().#prop &= 1;
            fn().#prop |= 1;
            fn().#prop ^= 1;
            fn().#prop &&= 1;
            fn().#prop ||= 1;
            fn().#prop ??= 1;
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2019",
  });
  itBundled("lower/LowerPrivateGetterSetter2020", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          get #foo() { return this.foo }
          set #bar(val) { this.bar = val }
          get #prop() { return this.prop }
          set #prop(val) { this.prop = val }
          foo(fn) {
            fn().#foo
            fn().#bar = 1
            fn().#prop
            fn().#prop = 2
          }
          unary(fn) {
            fn().#prop++;
            fn().#prop--;
            ++fn().#prop;
            --fn().#prop;
          }
          binary(fn) {
            fn().#prop = 1;
            fn().#prop += 1;
            fn().#prop -= 1;
            fn().#prop *= 1;
            fn().#prop /= 1;
            fn().#prop %= 1;
            fn().#prop **= 1;
            fn().#prop <<= 1;
            fn().#prop >>= 1;
            fn().#prop >>>= 1;
            fn().#prop &= 1;
            fn().#prop |= 1;
            fn().#prop ^= 1;
            fn().#prop &&= 1;
            fn().#prop ||= 1;
            fn().#prop ??= 1;
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2020",
  });
  itBundled("lower/LowerPrivateGetterSetterNext", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export class Foo {
          get #foo() { return this.foo }
          set #bar(val) { this.bar = val }
          get #prop() { return this.prop }
          set #prop(val) { this.prop = val }
          foo(fn) {
            fn().#foo
            fn().#bar = 1
            fn().#prop
            fn().#prop = 2
          }
          unary(fn) {
            fn().#prop++;
            fn().#prop--;
            ++fn().#prop;
            --fn().#prop;
          }
          binary(fn) {
            fn().#prop = 1;
            fn().#prop += 1;
            fn().#prop -= 1;
            fn().#prop *= 1;
            fn().#prop /= 1;
            fn().#prop %= 1;
            fn().#prop **= 1;
            fn().#prop <<= 1;
            fn().#prop >>= 1;
            fn().#prop >>>= 1;
            fn().#prop &= 1;
            fn().#prop |= 1;
            fn().#prop ^= 1;
            fn().#prop &&= 1;
            fn().#prop ||= 1;
            fn().#prop ??= 1;
          }
        }
      `,
    },
  });
  itBundled("lower/LowerPrivateMethod2019", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #field
          #method() {}
          baseline() {
            a().foo
            b().foo(x)
            c()?.foo(x)
            d().foo?.(x)
            e()?.foo?.(x)
          }
          privateField() {
            a().#field
            b().#field(x)
            c()?.#field(x)
            d().#field?.(x)
            e()?.#field?.(x)
            f()?.foo.#field(x).bar()
          }
          privateMethod() {
            a().#method
            b().#method(x)
            c()?.#method(x)
            d().#method?.(x)
            e()?.#method?.(x)
            f()?.foo.#method(x).bar()
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2019",
  });
  itBundled("lower/LowerPrivateMethod2020", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #field
          #method() {}
          baseline() {
            a().foo
            b().foo(x)
            c()?.foo(x)
            d().foo?.(x)
            e()?.foo?.(x)
          }
          privateField() {
            a().#field
            b().#field(x)
            c()?.#field(x)
            d().#field?.(x)
            e()?.#field?.(x)
            f()?.foo.#field(x).bar()
          }
          privateMethod() {
            a().#method
            b().#method(x)
            c()?.#method(x)
            d().#method?.(x)
            e()?.#method?.(x)
            f()?.foo.#method(x).bar()
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2020",
  });
  itBundled("lower/LowerPrivateMethodNext", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export class Foo {
          #field
          #method() {}
          baseline() {
            a().foo
            b().foo(x)
            c()?.foo(x)
            d().foo?.(x)
            e()?.foo?.(x)
          }
          privateField() {
            a().#field
            b().#field(x)
            c()?.#field(x)
            d().#field?.(x)
            e()?.#field?.(x)
            f()?.foo.#field(x).bar()
          }
          privateMethod() {
            a().#method
            b().#method(x)
            c()?.#method(x)
            d().#method?.(x)
            e()?.#method?.(x)
            f()?.foo.#method(x).bar()
          }
        }
      `,
    },
  });
  itBundled("lower/LowerPrivateClassExpr2020NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export let Foo = class {
          #field
          #method() {}
          static #staticField
          static #staticMethod() {}
          foo() {
            this.#field = this.#method()
            Foo.#staticField = Foo.#staticMethod()
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2020",
    bundling: false,
  });
  itBundled("lower/LowerPrivateMethodWithModifiers2020", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          *#g() {}
          async #a() {}
          async *#ag() {}
  
          static *#sg() {}
          static async #sa() {}
          static async *#sag() {}
        }
      `,
    },
    unsupportedJSFeatures: "es2020",
  });
  itBundled("lower/LowerAsync2016NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        async function foo(bar) {
          await bar
          return [this, arguments]
        }
        class Foo {async foo() {}}
        export default [
          foo,
          Foo,
          async function() {},
          async () => {},
          {async foo() {}},
          class {async foo() {}},
          function() {
            return async (bar) => {
              await bar
              return [this, arguments]
            }
          },
        ]
      `,
    },
    unsupportedJSFeatures: "es2016",
    bundling: false,
  });
  itBundled("lower/LowerAsync2017NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        async function foo(bar) {
          await bar
          return arguments
        }
        class Foo {async foo() {}}
        export default [
          foo,
          Foo,
          async function() {},
          async () => {},
          {async foo() {}},
          class {async foo() {}},
          function() {
            return async (bar) => {
              await bar
              return [this, arguments]
            }
          },
        ]
      `,
    },
    unsupportedJSFeatures: "es2017",
    bundling: false,
  });
  itBundled("lower/LowerAsyncThis2016CommonJS", {
    // GENERATED
    files: {
      "/entry.js": `exports.foo = async () => this`,
    },
    unsupportedJSFeatures: "es2016",
  });
  itBundled("lower/LowerAsyncThis2016ES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export {bar} from "./other"
        export let foo = async () => this
      `,
      "/other.js": `export let bar = async () => {}`,
    },
    unsupportedJSFeatures: "es2016",
    /* TODO FIX expectedScanLog: `entry.js: DEBUG: Top-level "this" will be replaced with undefined since this file is an ECMAScript module
  entry.js: NOTE: This file is considered to be an ECMAScript module because of the "export" keyword here:
  `, */
  });
  itBundled("lower/LowerAsyncES5", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import './fn-stmt'
        import './fn-expr'
        import './arrow-1'
        import './arrow-2'
        import './export-def-1'
        import './export-def-2'
        import './obj-method'
      `,
      "/fn-stmt.js": `async function foo() {}`,
      "/fn-expr.js": `(async function() {})`,
      "/arrow-1.js": `(async () => {})`,
      "/arrow-2.js": `(async x => {})`,
      "/export-def-1.js": `export default async function foo() {}`,
      "/export-def-2.js": `export default async function() {}`,
      "/obj-method.js": `({async foo() {}})`,
    },
    unsupportedJSFeatures: "es5",
    /* TODO FIX expectedScanLog: `arrow-1.js: ERROR: Transforming async functions to the configured target environment is not supported yet
  arrow-2.js: ERROR: Transforming async functions to the configured target environment is not supported yet
  export-def-1.js: ERROR: Transforming async functions to the configured target environment is not supported yet
  export-def-2.js: ERROR: Transforming async functions to the configured target environment is not supported yet
  fn-expr.js: ERROR: Transforming async functions to the configured target environment is not supported yet
  fn-stmt.js: ERROR: Transforming async functions to the configured target environment is not supported yet
  obj-method.js: ERROR: Transforming async functions to the configured target environment is not supported yet
  `, */
  });
  itBundled("lower/LowerAsyncSuperES2017NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Derived extends Base {
          async test(key) {
            return [
              await super.foo,
              await super[key],
              await ([super.foo] = [0]),
              await ([super[key]] = [0]),
  
              await (super.foo = 1),
              await (super[key] = 1),
              await (super.foo += 2),
              await (super[key] += 2),
  
              await ++super.foo,
              await ++super[key],
              await super.foo++,
              await super[key]++,
  
              await super.foo.name,
              await super[key].name,
              await super.foo?.name,
              await super[key]?.name,
  
              await super.foo(1, 2),
              await super[key](1, 2),
              await super.foo?.(1, 2),
              await super[key]?.(1, 2),
  
              await (() => super.foo)(),
              await (() => super[key])(),
              await (() => super.foo())(),
              await (() => super[key]())(),
  
              await super.foo\` + "\`\`" +
      `,
    },
    unsupportedJSFeatures: "es2017",
    bundling: false,
  });
  itBundled("lower/LowerAsyncSuperES2016NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Derived extends Base {
          async test(key) {
            return [
              await super.foo,
              await super[key],
              await ([super.foo] = [0]),
              await ([super[key]] = [0]),
  
              await (super.foo = 1),
              await (super[key] = 1),
              await (super.foo += 2),
              await (super[key] += 2),
  
              await ++super.foo,
              await ++super[key],
              await super.foo++,
              await super[key]++,
  
              await super.foo.name,
              await super[key].name,
              await super.foo?.name,
              await super[key]?.name,
  
              await super.foo(1, 2),
              await super[key](1, 2),
              await super.foo?.(1, 2),
              await super[key]?.(1, 2),
  
              await (() => super.foo)(),
              await (() => super[key])(),
              await (() => super.foo())(),
              await (() => super[key]())(),
  
              await super.foo\` + "\`\`" +
      `,
    },
    unsupportedJSFeatures: "es2016",
    bundling: false,
  });
  itBundled("lower/LowerStaticAsyncSuperES2021NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Derived extends Base {
          static test = async (key) => {
            return [
              await super.foo,
              await super[key],
              await ([super.foo] = [0]),
              await ([super[key]] = [0]),
  
              await (super.foo = 1),
              await (super[key] = 1),
              await (super.foo += 2),
              await (super[key] += 2),
  
              await ++super.foo,
              await ++super[key],
              await super.foo++,
              await super[key]++,
  
              await super.foo.name,
              await super[key].name,
              await super.foo?.name,
              await super[key]?.name,
  
              await super.foo(1, 2),
              await super[key](1, 2),
              await super.foo?.(1, 2),
              await super[key]?.(1, 2),
  
              await (() => super.foo)(),
              await (() => super[key])(),
              await (() => super.foo())(),
              await (() => super[key]())(),
  
              await super.foo\` + "\`\`" +
      `,
    },
    unsupportedJSFeatures: "es2021",
    bundling: false,
  });
  itBundled("lower/LowerStaticAsyncSuperES2016NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Derived extends Base {
          static test = async (key) => {
            return [
              await super.foo,
              await super[key],
              await ([super.foo] = [0]),
              await ([super[key]] = [0]),
  
              await (super.foo = 1),
              await (super[key] = 1),
              await (super.foo += 2),
              await (super[key] += 2),
  
              await ++super.foo,
              await ++super[key],
              await super.foo++,
              await super[key]++,
  
              await super.foo.name,
              await super[key].name,
              await super.foo?.name,
              await super[key]?.name,
  
              await super.foo(1, 2),
              await super[key](1, 2),
              await super.foo?.(1, 2),
              await super[key]?.(1, 2),
  
              await (() => super.foo)(),
              await (() => super[key])(),
              await (() => super.foo())(),
              await (() => super[key]())(),
  
              await super.foo\` + "\`\`" +
      `,
    },
    unsupportedJSFeatures: "es2016",
    bundling: false,
  });
  itBundled("lower/LowerStaticSuperES2021NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Derived extends Base {
          static test = key => {
            return [
              super.foo,
              super[key],
              ([super.foo] = [0]),
              ([super[key]] = [0]),
  
              (super.foo = 1),
              (super[key] = 1),
              (super.foo += 2),
              (super[key] += 2),
  
              ++super.foo,
              ++super[key],
              super.foo++,
              super[key]++,
  
              super.foo.name,
              super[key].name,
              super.foo?.name,
              super[key]?.name,
  
              super.foo(1, 2),
              super[key](1, 2),
              super.foo?.(1, 2),
              super[key]?.(1, 2),
  
              (() => super.foo)(),
              (() => super[key])(),
              (() => super.foo())(),
              (() => super[key]())(),
  
              super.foo\` + "\`\`" +
      `,
    },
    unsupportedJSFeatures: "es2021",
    bundling: false,
  });
  itBundled("lower/LowerStaticSuperES2016NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Derived extends Base {
          static test = key => {
            return [
              super.foo,
              super[key],
              ([super.foo] = [0]),
              ([super[key]] = [0]),
  
              (super.foo = 1),
              (super[key] = 1),
              (super.foo += 2),
              (super[key] += 2),
  
              ++super.foo,
              ++super[key],
              super.foo++,
              super[key]++,
  
              super.foo.name,
              super[key].name,
              super.foo?.name,
              super[key]?.name,
  
              super.foo(1, 2),
              super[key](1, 2),
              super.foo?.(1, 2),
              super[key]?.(1, 2),
  
              (() => super.foo)(),
              (() => super[key])(),
              (() => super.foo())(),
              (() => super[key]())(),
  
              super.foo\` + "\`\`" +
      `,
    },
    unsupportedJSFeatures: "es2016",
    bundling: false,
  });
  itBundled("lower/LowerAsyncArrowSuperES2016", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export { default as foo1 } from "./foo1"
        export { default as foo2 } from "./foo2"
        export { default as foo3 } from "./foo3"
        export { default as foo4 } from "./foo4"
        export { default as bar1 } from "./bar1"
        export { default as bar2 } from "./bar2"
        export { default as bar3 } from "./bar3"
        export { default as bar4 } from "./bar4"
        export { default as baz1 } from "./baz1"
        export { default as baz2 } from "./baz2"
        import "./outer"
      `,
      "/foo1.js": `export default class extends x { foo1() { return async () => super.foo('foo1') } }`,
      "/foo2.js": `export default class extends x { foo2() { return async () => () => super.foo('foo2') } }`,
      "/foo3.js": `export default class extends x { foo3() { return () => async () => super.foo('foo3') } }`,
      "/foo4.js": `export default class extends x { foo4() { return async () => async () => super.foo('foo4') } }`,
      "/bar1.js": `export default class extends x { bar1 = async () => super.foo('bar1') }`,
      "/bar2.js": `export default class extends x { bar2 = async () => () => super.foo('bar2') }`,
      "/bar3.js": `export default class extends x { bar3 = () => async () => super.foo('bar3') }`,
      "/bar4.js": `export default class extends x { bar4 = async () => async () => super.foo('bar4') }`,
      "/baz1.js": `export default class extends x { async baz1() { return () => super.foo('baz1') } }`,
      "/baz2.js": `export default class extends x { async baz2() { return () => () => super.foo('baz2') } }`,
      "/outer.js": /* js */ `
        // Helper functions for "super" shouldn't be inserted into this outer function
        export default (async function () {
          class y extends z {
            foo = async () => super.foo()
          }
          await new y().foo()()
        })()
      `,
    },
    unsupportedJSFeatures: "es2016",
  });
  itBundled("lower/LowerAsyncArrowSuperSetterES2016", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export { default as foo1 } from "./foo1"
        export { default as foo2 } from "./foo2"
        export { default as foo3 } from "./foo3"
        export { default as foo4 } from "./foo4"
        export { default as bar1 } from "./bar1"
        export { default as bar2 } from "./bar2"
        export { default as bar3 } from "./bar3"
        export { default as bar4 } from "./bar4"
        export { default as baz1 } from "./baz1"
        export { default as baz2 } from "./baz2"
        import "./outer"
      `,
      "/foo1.js": `export default class extends x { foo1() { return async () => super.foo = 'foo1' } }`,
      "/foo2.js": `export default class extends x { foo2() { return async () => () => super.foo = 'foo2' } }`,
      "/foo3.js": `export default class extends x { foo3() { return () => async () => super.foo = 'foo3' } }`,
      "/foo4.js": `export default class extends x { foo4() { return async () => async () => super.foo = 'foo4' } }`,
      "/bar1.js": `export default class extends x { bar1 = async () => super.foo = 'bar1' }`,
      "/bar2.js": `export default class extends x { bar2 = async () => () => super.foo = 'bar2' }`,
      "/bar3.js": `export default class extends x { bar3 = () => async () => super.foo = 'bar3' }`,
      "/bar4.js": `export default class extends x { bar4 = async () => async () => super.foo = 'bar4' }`,
      "/baz1.js": `export default class extends x { async baz1() { return () => super.foo = 'baz1' } }`,
      "/baz2.js": `export default class extends x { async baz2() { return () => () => super.foo = 'baz2' } }`,
      "/outer.js": /* js */ `
        // Helper functions for "super" shouldn't be inserted into this outer function
        export default (async function () {
          class y extends z {
            foo = async () => super.foo = 'foo'
          }
          await new y().foo()()
        })()
      `,
    },
    unsupportedJSFeatures: "es2016",
  });
  itBundled("lower/LowerStaticAsyncArrowSuperES2016", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export { default as foo1 } from "./foo1"
        export { default as foo2 } from "./foo2"
        export { default as foo3 } from "./foo3"
        export { default as foo4 } from "./foo4"
        export { default as bar1 } from "./bar1"
        export { default as bar2 } from "./bar2"
        export { default as bar3 } from "./bar3"
        export { default as bar4 } from "./bar4"
        export { default as baz1 } from "./baz1"
        export { default as baz2 } from "./baz2"
        import "./outer"
      `,
      "/foo1.js": `export default class extends x { static foo1() { return async () => super.foo('foo1') } }`,
      "/foo2.js": `export default class extends x { static foo2() { return async () => () => super.foo('foo2') } }`,
      "/foo3.js": `export default class extends x { static foo3() { return () => async () => super.foo('foo3') } }`,
      "/foo4.js": `export default class extends x { static foo4() { return async () => async () => super.foo('foo4') } }`,
      "/bar1.js": `export default class extends x { static bar1 = async () => super.foo('bar1') }`,
      "/bar2.js": `export default class extends x { static bar2 = async () => () => super.foo('bar2') }`,
      "/bar3.js": `export default class extends x { static bar3 = () => async () => super.foo('bar3') }`,
      "/bar4.js": `export default class extends x { static bar4 = async () => async () => super.foo('bar4') }`,
      "/baz1.js": `export default class extends x { static async baz1() { return () => super.foo('baz1') } }`,
      "/baz2.js": `export default class extends x { static async baz2() { return () => () => super.foo('baz2') } }`,
      "/outer.js": /* js */ `
        // Helper functions for "super" shouldn't be inserted into this outer function
        export default (async function () {
          class y extends z {
            static foo = async () => super.foo()
          }
          await y.foo()()
        })()
      `,
    },
    unsupportedJSFeatures: "es2016",
  });
  itBundled("lower/LowerStaticAsyncArrowSuperSetterES2016", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export { default as foo1 } from "./foo1"
        export { default as foo2 } from "./foo2"
        export { default as foo3 } from "./foo3"
        export { default as foo4 } from "./foo4"
        export { default as bar1 } from "./bar1"
        export { default as bar2 } from "./bar2"
        export { default as bar3 } from "./bar3"
        export { default as bar4 } from "./bar4"
        export { default as baz1 } from "./baz1"
        export { default as baz2 } from "./baz2"
        import "./outer"
      `,
      "/foo1.js": `export default class extends x { static foo1() { return async () => super.foo = 'foo1' } }`,
      "/foo2.js": `export default class extends x { static foo2() { return async () => () => super.foo = 'foo2' } }`,
      "/foo3.js": `export default class extends x { static foo3() { return () => async () => super.foo = 'foo3' } }`,
      "/foo4.js": `export default class extends x { static foo4() { return async () => async () => super.foo = 'foo4' } }`,
      "/bar1.js": `export default class extends x { static bar1 = async () => super.foo = 'bar1' }`,
      "/bar2.js": `export default class extends x { static bar2 = async () => () => super.foo = 'bar2' }`,
      "/bar3.js": `export default class extends x { static bar3 = () => async () => super.foo = 'bar3' }`,
      "/bar4.js": `export default class extends x { static bar4 = async () => async () => super.foo = 'bar4' }`,
      "/baz1.js": `export default class extends x { static async baz1() { return () => super.foo = 'baz1' } }`,
      "/baz2.js": `export default class extends x { static async baz2() { return () => () => super.foo = 'baz2' } }`,
      "/outer.js": /* js */ `
        // Helper functions for "super" shouldn't be inserted into this outer function
        export default (async function () {
          class y extends z {
            static foo = async () => super.foo = 'foo'
          }
          await y.foo()()
        })()
      `,
    },
    unsupportedJSFeatures: "es2016",
  });
  itBundled("lower/LowerPrivateSuperES2022", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export { default as foo1 } from "./foo1"
        export { default as foo2 } from "./foo2"
        export { default as foo3 } from "./foo3"
        export { default as foo4 } from "./foo4"
        export { default as foo5 } from "./foo5"
        export { default as foo6 } from "./foo6"
        export { default as foo7 } from "./foo7"
        export { default as foo8 } from "./foo8"
      `,
      "/foo1.js": `export default class extends x { #foo() { super.foo() } }`,
      "/foo2.js": `export default class extends x { #foo() { super.foo++ } }`,
      "/foo3.js": `export default class extends x { static #foo() { super.foo() } }`,
      "/foo4.js": `export default class extends x { static #foo() { super.foo++ } }`,
      "/foo5.js": `export default class extends x { #foo = () => { super.foo() } }`,
      "/foo6.js": `export default class extends x { #foo = () => { super.foo++ } }`,
      "/foo7.js": `export default class extends x { static #foo = () => { super.foo() } }`,
      "/foo8.js": `export default class extends x { static #foo = () => { super.foo++ } }`,
    },
    unsupportedJSFeatures: "es2022",
  });
  itBundled("lower/LowerPrivateSuperES2021", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export { default as foo1 } from "./foo1"
        export { default as foo2 } from "./foo2"
        export { default as foo3 } from "./foo3"
        export { default as foo4 } from "./foo4"
        export { default as foo5 } from "./foo5"
        export { default as foo6 } from "./foo6"
        export { default as foo7 } from "./foo7"
        export { default as foo8 } from "./foo8"
      `,
      "/foo1.js": `export default class extends x { #foo() { super.foo() } }`,
      "/foo2.js": `export default class extends x { #foo() { super.foo++ } }`,
      "/foo3.js": `export default class extends x { static #foo() { super.foo() } }`,
      "/foo4.js": `export default class extends x { static #foo() { super.foo++ } }`,
      "/foo5.js": `export default class extends x { #foo = () => { super.foo() } }`,
      "/foo6.js": `export default class extends x { #foo = () => { super.foo++ } }`,
      "/foo7.js": `export default class extends x { static #foo = () => { super.foo() } }`,
      "/foo8.js": `export default class extends x { static #foo = () => { super.foo++ } }`,
    },
    unsupportedJSFeatures: "es2021",
  });
  itBundled("lower/LowerPrivateSuperStaticBundleESBuildIssue2158", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export class Foo extends Object {
          static FOO;
          constructor() {
            super();
          }
          #foo;
        }
      `,
    },
  });
  itBundled("lower/LowerClassField2020NoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #foo = 123
          #bar
          foo = 123
          bar
          static #s_foo = 123
          static #s_bar
          static s_foo = 123
          static s_bar
        }
      `,
    },
    unsupportedJSFeatures: "es2020",
    bundling: false,
  });
  itBundled("lower/LowerClassFieldNextNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #foo = 123
          #bar
          foo = 123
          bar
          static #s_foo = 123
          static #s_bar
          static s_foo = 123
          static s_bar
        }
      `,
    },
    bundling: false,
  });
  itBundled("lower/TSLowerClassField2020NoBundle", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        class Foo {
          #foo = 123
          #bar
          foo = 123
          bar
          static #s_foo = 123
          static #s_bar
          static s_foo = 123
          static s_bar
        }
      `,
    },
    unsupportedJSFeatures: "es2020",
    bundling: false,
  });
  itBundled("lower/TSLowerClassPrivateFieldNextNoBundle", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        class Foo {
          #foo = 123
          #bar
          foo = 123
          bar
          static #s_foo = 123
          static #s_bar
          static s_foo = 123
          static s_bar
        }
      `,
    },
    bundling: false,
  });
  itBundled("lower/LowerClassFieldStrictTsconfigJson2020", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import loose from './loose'
        import strict from './strict'
        console.log(loose, strict)
      `,
      "/loose/index.js": /* js */ `
        export default class {
          foo
        }
      `,
      "/loose/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "useDefineForClassFields": false
          }
        }
      `,
      "/strict/index.js": /* js */ `
        export default class {
          foo
        }
      `,
      "/strict/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "useDefineForClassFields": true
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2020",
  });
  itBundled("lower/TSLowerClassFieldStrictTsconfigJson2020", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import loose from './loose'
        import strict from './strict'
        console.log(loose, strict)
      `,
      "/loose/index.ts": /* ts */ `
        export default class {
          foo
        }
      `,
      "/loose/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "useDefineForClassFields": false
          }
        }
      `,
      "/strict/index.ts": /* ts */ `
        export default class {
          foo
        }
      `,
      "/strict/tsconfig.json": /* json */ `
        {
          "compilerOptions": {
            "useDefineForClassFields": true
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2020",
  });
  itBundled("lower/TSLowerObjectRest2017NoBundle", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        const { ...local_const } = {};
        let { ...local_let } = {};
        var { ...local_var } = {};
        let arrow_fn = ({ ...x }) => { };
        let fn_expr = function ({ ...x } = default_value) {};
        let class_expr = class { method(x, ...[y, { ...z }]) {} };
  
        function fn_stmt({ a = b(), ...x }, { c = d(), ...y }) {}
        class class_stmt { method({ ...x }) {} }
        namespace ns { export let { ...x } = {} }
        try { } catch ({ ...catch_clause }) {}
  
        for (const { ...for_in_const } in { abc }) {}
        for (let { ...for_in_let } in { abc }) {}
        for (var { ...for_in_var } in { abc }) ;
        for (const { ...for_of_const } of [{}]) ;
        for (let { ...for_of_let } of [{}]) x()
        for (var { ...for_of_var } of [{}]) x()
        for (const { ...for_const } = {}; x; x = null) {}
        for (let { ...for_let } = {}; x; x = null) {}
        for (var { ...for_var } = {}; x; x = null) {}
        for ({ ...x } in { abc }) {}
        for ({ ...x } of [{}]) {}
        for ({ ...x } = {}; x; x = null) {}
  
        ({ ...assign } = {});
        ({ obj_method({ ...x }) {} });
  
        // Check for used return values
        ({ ...x } = x);
        for ({ ...x } = x; 0; ) ;
        console.log({ ...x } = x);
        console.log({ x, ...xx } = { x });
        console.log({ x: { ...xx } } = { x });
      `,
    },
    unsupportedJSFeatures: "es2017",
    bundling: false,
  });
  itBundled("lower/TSLowerObjectRest2018NoBundle", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        const { ...local_const } = {};
        let { ...local_let } = {};
        var { ...local_var } = {};
        let arrow_fn = ({ ...x }) => { };
        let fn_expr = function ({ ...x } = default_value) {};
        let class_expr = class { method(x, ...[y, { ...z }]) {} };
  
        function fn_stmt({ a = b(), ...x }, { c = d(), ...y }) {}
        class class_stmt { method({ ...x }) {} }
        namespace ns { export let { ...x } = {} }
        try { } catch ({ ...catch_clause }) {}
  
        for (const { ...for_in_const } in { abc }) {}
        for (let { ...for_in_let } in { abc }) {}
        for (var { ...for_in_var } in { abc }) ;
        for (const { ...for_of_const } of [{}]) ;
        for (let { ...for_of_let } of [{}]) x()
        for (var { ...for_of_var } of [{}]) x()
        for (const { ...for_const } = {}; x; x = null) {}
        for (let { ...for_let } = {}; x; x = null) {}
        for (var { ...for_var } = {}; x; x = null) {}
        for ({ ...x } in { abc }) {}
        for ({ ...x } of [{}]) {}
        for ({ ...x } = {}; x; x = null) {}
  
        ({ ...assign } = {});
        ({ obj_method({ ...x }) {} });
  
        // Check for used return values
        ({ ...x } = x);
        for ({ ...x } = x; 0; ) ;
        console.log({ ...x } = x);
        console.log({ x, ...xx } = { x });
        console.log({ x: { ...xx } } = { x });
      `,
    },
    unsupportedJSFeatures: "es2018",
    bundling: false,
  });
  itBundled("lower/ClassSuperThisESBuildIssue242NoBundle", {
    // GENERATED
    files: {
      "/entry.ts": /* ts */ `
        export class A {}
  
        export class B extends A {
          #e: string
          constructor(c: { d: any }) {
            super()
            this.#e = c.d ?? 'test'
          }
          f() {
            return this.#e
          }
        }
      `,
    },
    unsupportedJSFeatures: "es2019",
    bundling: false,
  });
  itBundled("lower/LowerExportStarAsNameCollisionNoBundle", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export * as ns from 'path'
        let ns = 123
        export {ns as sn}
      `,
    },
    unsupportedJSFeatures: "es2019",
    bundling: false,
  });
  itBundled("lower/LowerExportStarAsNameCollision", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as test from './nested'
        console.log(test.foo, test.oof)
        export * as ns from 'path1'
        let ns = 123
        export {ns as sn}
      `,
      "/nested.js": /* js */ `
        export * as foo from 'path2'
        let foo = 123
        export {foo as oof}
      `,
    },
    unsupportedJSFeatures: "es2019",
  });
  itBundled("lower/LowerStrictModeSyntax", {
    // GENERATED
    files: {
      "/entry.js": `import './for-in'`,
      "/for-in.js": /* js */ `
        if (test)
          for (var a = b in {}) ;
        for (var x = y in {}) ;
      `,
    },
    format: "esm",
  });
  itBundled("lower/LowerForbidStrictModeSyntax", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import './with'
        import './delete-1'
        import './delete-2'
        import './delete-3'
      `,
      "/with.js": `with (x) y`,
      "/delete-1.js": `delete x`,
      "/delete-2.js": `delete (y)`,
      "/delete-3.js": `delete (1 ? z : z)`,
    },
    format: "esm",
    /* TODO FIX expectedScanLog: `delete-1.js: ERROR: Delete of a bare identifier cannot be used with the "esm" output format due to strict mode
  delete-2.js: ERROR: Delete of a bare identifier cannot be used with the "esm" output format due to strict mode
  with.js: ERROR: With statements cannot be used with the "esm" output format due to strict mode
  `, */
  });
  itBundled("lower/LowerPrivateClassFieldOrder", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #foo = 123 // This must be set before "bar" is initialized
          bar = this.#foo
        }
        console.log(new Foo().bar === 123)
      `,
    },
    mode: "passthrough",
  });
  itBundled("lower/LowerPrivateClassMethodOrder", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          bar = this.#foo()
          #foo() { return 123 } // This must be set before "bar" is initialized
        }
        console.log(new Foo().bar === 123)
      `,
    },
    mode: "passthrough",
  });
  itBundled("lower/LowerPrivateClassAccessorOrder", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          bar = this.#foo
          get #foo() { return 123 } // This must be set before "bar" is initialized
        }
        console.log(new Foo().bar === 123)
      `,
    },
    mode: "passthrough",
  });
  itBundled("lower/LowerPrivateClassStaticFieldOrder", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          static #foo = 123 // This must be set before "bar" is initialized
          static bar = Foo.#foo
        }
        console.log(Foo.bar === 123)
  
        class FooThis {
          static #foo = 123 // This must be set before "bar" is initialized
          static bar = this.#foo
        }
        console.log(FooThis.bar === 123)
      `,
    },
    mode: "passthrough",
  });
  itBundled("lower/LowerPrivateClassStaticMethodOrder", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          static bar = Foo.#foo()
          static #foo() { return 123 } // This must be set before "bar" is initialized
        }
        console.log(Foo.bar === 123)
  
        class FooThis {
          static bar = this.#foo()
          static #foo() { return 123 } // This must be set before "bar" is initialized
        }
        console.log(FooThis.bar === 123)
      `,
    },
    mode: "passthrough",
  });
  itBundled("lower/LowerPrivateClassStaticAccessorOrder", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          static bar = Foo.#foo
          static get #foo() { return 123 } // This must be set before "bar" is initialized
        }
        console.log(Foo.bar === 123)
  
        class FooThis {
          static bar = this.#foo
          static get #foo() { return 123 } // This must be set before "bar" is initialized
        }
        console.log(FooThis.bar === 123)
      `,
    },
    mode: "passthrough",
  });
  itBundled("lower/LowerPrivateClassBrandCheckUnsupported", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #foo
          #bar
          baz() {
            return [
              this.#foo,
              this.#bar,
              #foo in this,
            ]
          }
        }
      `,
    },
    mode: "passthrough",
  });
  itBundled("lower/LowerPrivateClassBrandCheckSupported", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class Foo {
          #foo
          #bar
          baz() {
            return [
              this.#foo,
              this.#bar,
              #foo in this,
            ]
          }
        }
      `,
    },
    mode: "passthrough",
  });
  itBundled("lower/LowerTemplateObject", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        x = () => [
          tag\` + "\`x\`" +
      `,
    },
    mode: "passthrough",
  });
  itBundled("lower/LowerPrivateClassFieldStaticESBuildIssue1424", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class T {
          #a() { return 'a'; }
          #b() { return 'b'; }
          static c;
          d() { console.log(this.#a()); }
        }
        new T().d();
      `,
    },
  });
  itBundled("lower/LowerNullishCoalescingAssignmentESBuildIssue1493", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export class A {
          #a;
          f() {
            this.#a ??= 1;
          }
        }
      `,
    },
  });
  itBundled("lower/StaticClassBlockESNext", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class A {
          static {}
          static {
            this.thisField++
            A.classField++
            super.superField = super.superField + 1
            super.superField++
          }
        }
        let B = class {
          static {}
          static {
            this.thisField++
            super.superField = super.superField + 1
            super.superField++
          }
        }
      `,
    },
  });
  itBundled("lower/StaticClassBlockES2021", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        class A {
          static {}
          static {
            this.thisField++
            A.classField++
            super.superField = super.superField + 1
            super.superField++
          }
        }
        let B = class {
          static {}
          static {
            this.thisField++
            super.superField = super.superField + 1
            super.superField++
          }
        }
      `,
    },
  });
  itBundled("lower/LowerRegExpNameCollision", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export function foo(RegExp) {
          return new RegExp(/./d, 'd')
        }
      `,
    },
  });
  itBundled("lower/LowerForAwait2017", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export default [
          async () => { for await (x of y) z(x) },
          async () => { for await (x.y of y) z(x) },
          async () => { for await (let x of y) z(x) },
          async () => { for await (const x of y) z(x) },
        ]
      `,
    },
    mode: "passthrough",
  });
  itBundled("lower/LowerForAwait2015", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        export default [
          async () => { for await (x of y) z(x) },
          async () => { for await (x.y of y) z(x) },
          async () => { for await (let x of y) z(x) },
          async () => { for await (const x of y) z(x) },
        ]
      `,
    },
    mode: "passthrough",
  });
  itBundled("lower/LowerNestedFunctionDirectEval", {
    // GENERATED
    files: {
      "/1.js": `if (foo) { function x() {} }`,
      "/2.js": `if (foo) { function x() {} eval('') }`,
      "/3.js": `if (foo) { function x() {} if (bar) { eval('') } }`,
      "/4.js": `if (foo) { eval(''); function x() {} }`,
      "/5.js": `'use strict'; if (foo) { function x() {} }`,
      "/6.js": `'use strict'; if (foo) { function x() {} eval('') }`,
      "/7.js": `'use strict'; if (foo) { function x() {} if (bar) { eval('') } }`,
      "/8.js": `'use strict'; if (foo) { eval(''); function x() {} }`,
    },
    entryPoints: ["/1.js", "/2.js", "/3.js", "/4.js", "/5.js", "/6.js", "/7.js", "/8.js"],
    mode: "passthrough",
  });
});
