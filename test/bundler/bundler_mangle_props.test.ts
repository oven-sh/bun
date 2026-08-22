import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { itBundled } from "./expectBundled";

// Property name mangling (`--mangle-props`, `Bun.build({ mangleProps })`): the
// same feature as esbuild's option of that name. Where esbuild's behavior is
// well defined these tests expect the same output esbuild produces.
describe("bundler", () => {
  itBundled("mangle-props/Syntax", {
    files: {
      "/entry.js": /* js */ `
        let bar_ = 1;
        let foo = {
          bar_,
          baz_() { return this.bar_; },
          get qux_() { return 2; },
          set qux_(v) {},
          "quoted_": 3,
          ["computed_"]: 4,
          __proto__: null,
          plain: 5,
        };
        let { bar_: b, "quoted_": q, plain, ...rest_ } = foo;
        ({ bar_ } = foo);
        let { baz_ = 0 } = foo;
        class Foo_ {
          bar_ = 0;
          baz_() {}
          static bar_ = 1;
          static baz_() {}
          #priv_ = 2;
          get priv_() { return this.#priv_; }
          static { this.block_ = 3; }
        }
        capture(foo.bar_);
        capture(foo?.bar_);
        capture(foo?.bar_.baz_);
        capture(foo["bar_"]);
        capture(foo?.["bar_"]);
        capture("bar_" in foo);
        capture(foo.__proto__);
        capture(foo.constructor);
        capture(Foo_.prototype);
        capture(foo.plain);
        capture(delete foo.bar_);
        capture(foo.bar_ = foo.bar_ + 1);
        export { foo, b, q, plain, rest_, baz_, Foo_ };
      `,
    },
    mangleProps: /_$/,
    capture: [
      "foo.a",
      "foo?.a",
      "foo?.a.b",
      'foo["bar_"]',
      'foo?.["bar_"]',
      '"bar_" in foo',
      "foo.__proto__",
      "foo.constructor",
      "Foo_.prototype",
      "foo.plain",
      "delete foo.a",
      "foo.a = foo.a + 1",
    ],
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Object literal: shorthand is expanded, methods and accessors are renamed.
      expect(code).toContain("a: bar_");
      expect(code).toContain("b() {");
      expect(code).toContain("get c()");
      expect(code).toContain("set c(v)");
      // Quoted keys are left alone without `mangleQuoted`, and so is everything
      // with language-level meaning.
      expect(code).toContain("quoted_: 3");
      expect(code).toContain('["computed_"]: 4');
      expect(code).toContain("__proto__: null");
      expect(code).toContain("plain: 5");
      // Destructuring keys are renamed; the bindings keep their names.
      expect(code).toContain("a: b, quoted_: q, plain, ...rest_ }");
      expect(code).toContain("({ a: bar_ } = foo)");
      expect(code).toContain("{ b: baz_ = 0 }");
      // Class members, but not private names.
      expect(code).toMatch(/class Foo_ \{\s+a = 0;\s+b\(\) \{\}\s+static a = 1;\s+static b\(\) \{\}\s+#priv_ = 2;/);
      expect(code).toContain("return this.#priv_");
      expect(code).toMatch(/this\.\w+ = 3;/);
      expect(code).not.toContain("this.block_");
    },
  });

  itBundled("mangle-props/RunsCorrectly", {
    files: {
      "/entry.js": /* js */ `
        import { Counter_, makeCounter } from "./counter.js";
        const c = makeCounter();
        c.increment_();
        c.increment_();
        const { count_ } = c;
        console.log(count_, c.count_, c.label_, Counter_.instances_);
        console.log(JSON.stringify(Object.keys(c)));
        console.log(c["count_"], "count_" in c);
      `,
      "/counter.js": /* js */ `
        export class Counter_ {
          static instances_ = 0;
          count_ = 0;
          label_ = "counter";
          constructor() { Counter_.instances_++; }
          increment_() { this.count_ += 1; }
        }
        export function makeCounter() { return new Counter_(); }
      `,
    },
    mangleProps: /_$/,
    run: {
      // The unmangled string lookups see the renamed object and find nothing.
      stdout: '2 2 counter 1\n["a","d"]\nundefined false',
    },
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toMatch(/\.(count_|label_|increment_|instances_)\b/);
      // The destructured variable keeps its name; only the key is renamed.
      expect(code).toContain("var { a: count_ } = c;");
    },
  });

  itBundled("mangle-props/MostUsedPropertyGetsShortestName", {
    files: {
      "/entry.js": /* js */ `
        import { make } from "./lib.js";
        const x = make();
        console.log(x.rare_, x.common_, x.common_, x.common_, x.medium_, x.medium_);
      `,
      "/lib.js": /* js */ `
        export function make() {
          return { rare_: 1, medium_: 2, common_: 3 };
        }
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // common_ is used 4 times, medium_ 3 times, rare_ twice: a, b, c in that
      // order, and the same names in both files.
      expect(code).toContain("{ c: 1, b: 2, a: 3 }");
      expect(code).toContain("x.c, x.a, x.a, x.a, x.b, x.b");
    },
    run: { stdout: "1 3 3 3 2 2" },
  });

  itBundled("mangle-props/NamesAreConsistentAcrossChunks", {
    files: {
      "/a.js": /* js */ `
        import { make, read } from "./shared.js";
        const o = make();
        o.alpha_ += 10;
        o.gamma_ = 5;
        console.log(read(o), o.gamma_, JSON.stringify(o));
      `,
      "/b.js": /* js */ `
        import { make, read } from "./shared.js";
        const o = make();
        o.beta_ += 20;
        o.delta_ = 7;
        console.log(read(o), o.delta_, Object.keys(o).join(","));
      `,
      "/shared.js": /* js */ `
        export function make() { return { alpha_: 1, beta_: 2, plain: 3 }; }
        export function read(o) { return [o.alpha_, o.beta_, o.plain].join(" "); }
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    mangleProps: /_$/,
    run: [
      { file: "/out/a.js", stdout: '11 2 3 5 {"a":11,"b":2,"plain":3,"c":5}' },
      { file: "/out/b.js", stdout: "1 22 3 7 a,b,plain,d" },
    ],
  });

  itBundled("mangle-props/NeverCollidesWithUnmangledNames", {
    files: {
      "/entry.js": /* js */ `
        // "a" and "b" are used as properties without being mangled, "c" is only
        // ever quoted and "d" only appears on the left of "in", so none of them
        // may be handed out as a mangled name.
        const o = { foo_: "foo", bar_: "bar", a: "a", b: "b", "c": "c" };
        console.log(o.foo_, o.bar_, o.a, o.b, o["c"], "d" in o, Object.keys(o).join(","));
      `,
    },
    mangleProps: /_$/,
    run: { stdout: "foo bar a b c false e,f,a,b,c" },
  });

  itBundled("mangle-props/ReserveProps", {
    files: {
      "/entry.js": /* js */ `
        const o = { keep_me_: 1, mangle_: 2, keep_too_: 3 };
        capture(o.keep_me_);
        capture(o.mangle_);
        capture(o.keep_too_);
      `,
    },
    mangleProps: /_$/,
    reserveProps: /^keep_/,
    capture: ["o.keep_me_", "o.a", "o.keep_too_"],
  });

  itBundled("mangle-props/MangleQuoted", {
    files: {
      "/entry.js": /* js */ `
        const o = { "mangle_": 1, ["also_"]: 2, [cond() ? "yes_" : "no_"]: 3, [(side(), "comma_")]: 4 };
        capture(o["mangle_"]);
        capture(o?.["mangle_"]);
        capture(o[cond() ? "yes_" : "no_"]);
        capture(o[(side(), "comma_")]);
        capture("mangle_" in o);
        capture((cond() ? "yes_" : "no_") in o);
        capture(o[cond() || "not_a_property_position_"]);
        capture(fn("not_a_property_"));
        capture(o[\`template_\`]);
        const { "mangle_": m, ["also_"]: a } = o;
        class C { "field_" = 1; ["method_"]() {} }
        export { o, m, a, C };
        function cond() { return true }
        function side() {}
        function fn(x) { return x }
      `,
    },
    mangleProps: /_$/,
    mangleQuoted: true,
    capture: [
      "o.a",
      "o?.a",
      'o[cond() ? "b" : "c"]',
      'o[side(), "e"]',
      '"a" in o',
      '(cond() ? "b" : "c") in o',
      // Only the value position of a property name is a property name: the
      // operands of || are not, and neither are ordinary strings.
      'o[cond() || "not_a_property_position_"]',
      'fn("not_a_property_")',
      "o.g",
    ],
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).toContain('{ a: 1, ["d"]: 2, [cond() ? "b" : "c"]: 3, [(side(), "e")]: 4 }');
      expect(code).toContain('{ a: m, ["d"]: a } = o');
      expect(code).toMatch(/class C \{\s+f = 1;\s+\["h"\]\(\) \{\}/);
    },
  });

  itBundled("mangle-props/QuotedNamesAreNotMangledByDefault", {
    files: {
      "/entry.js": /* js */ `
        const o = { "mangle_": 1, ["also_"]: 2, unquoted_: 3 };
        capture(o["mangle_"]);
        capture(o[cond() ? "yes_" : "no_"]);
        capture("mangle_" in o);
        capture(o.unquoted_);
        const { "mangle_": m } = o;
        class C { "field_" = 1 }
        export { o, m, C };
        function cond() { return true }
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    capture: ["o.mangle_", 'o[cond() ? "yes_" : "no_"]', '"mangle_" in o', "o.a"],
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).toContain('["also_"]: 2');
      expect(code).toContain("mangle_: m");
      expect(code).toContain("field_ = 1");
    },
  });

  itBundled("mangle-props/PropertyKeyComment", {
    files: {
      "/entry.js": /* js */ `
        const key = /* @__KEY__ */ "value_";
        const o = { value_: 1, /* @__KEY__ */ "other_": 2, [/* @__KEY__ */ "third_"]: 3, [/* #__KEY__ */ "fourth_"]: 4 };
        const { /* @__KEY__ */ "other_": other } = o;
        console.log(o[key], o[/* @__KEY__ */ "other_"], other, o[/* @__KEY__ */ \`third_\`], o[/* @__KEY__ */ "fourth_"]);
        console.log(/* @__KEY__ */ "unused_name_", /* @__KEY__ */ "does not match");
      `,
    },
    mangleProps: /_$/,
    run: { stdout: "1 2 2 3 4\ne does not match" },
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // The annotation is kept so the output can be processed again.
      expect(code).toContain('var key = /* @__KEY__ */ "b";');
      expect(code).toContain('var o = { b: 1, a: 2, [/* @__KEY__ */ "c"]: 3, [/* @__KEY__ */ "d"]: 4 };');
      expect(code).toContain("var { a: other } = o;");
      expect(code).toContain("o[key], o.a, other, o.c, o.d");
      expect(code).toContain('console.log(/* @__KEY__ */ "e", "does not match")');
    },
  });

  itBundled("mangle-props/PropertyKeyCommentMinified", {
    files: {
      "/entry.js": /* js */ `
        const key = /* @__KEY__ */ "value_";
        console.log({ value_: 1 }[key]);
      `,
    },
    mangleProps: /_$/,
    minifyWhitespace: true,
    run: { stdout: "1" },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("@__KEY__");
    },
  });

  itBundled("mangle-props/TypeScript", {
    files: {
      "/entry.ts": /* ts */ `
        class Point {
          declare ignored_: number;
          constructor(public x_: number, private readonly y_: number) {}
          sum_(): number;
          sum_(): number { return this.x_ + this.y_; }
        }
        const p = new Point(1, 2);
        console.log(p.x_, p.sum_(), Object.keys(p).length, "x_" in p);

        namespace Shapes_ {
          export const unit_ = 1;
          export function double_(n: number) { return n * 2 * unit_; }
          export class Circle_ { constructor(public r_: number) {} }
          export namespace Nested_ { export const depth_ = 2; }
        }
        namespace Shapes_ {
          // A second block of the same namespace reads the first block's exports.
          export const fromSibling_ = double_(unit_) + Nested_.depth_;
        }
        console.log(Shapes_.unit_, Shapes_.double_(3), new Shapes_.Circle_(4).r_, Shapes_.Nested_.depth_, Shapes_.fromSibling_);

        enum Constant_ { A_ = 1, B_ = A_ * 10 }
        enum Computed_ { A_ = "a".length, B_ = A_ + 1 }
        console.log(Constant_.A_, Constant_.B_, Constant_[10], Computed_.A_, Computed_.B_, Computed_[2]);
      `,
    },
    mangleProps: /_$/,
    run: { stdout: "1 3 2 false\n1 6 4 2 4\n1 10 B_ 1 2 B_" },
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Parameter properties are declared and assigned under the mangled names.
      const [, x, y] = code.match(/this\.(\w+) = x_;\s+this\.(\w+) = y_;/)!;
      expect(code).toMatch(new RegExp(`class Point \\{\\s+${x};\\s+${y};\\s+constructor\\(x_, y_\\)`));
      expect(code).toContain(`return this.${x} + this.${y};`);
      // Namespace exports are defined under the mangled name, including when
      // read from a sibling block of the namespace.
      const [, unit] = code.match(/Shapes_\.(\w+) = 1;/)!;
      const [, double] = code.match(/Shapes_\.(\w+) = double_;/)!;
      const [, nested] = code.match(/Nested_ = Shapes_\.(\w+) \|\|= \{\}/)!;
      const [, depth] = code.match(/Nested_\.(\w+) = 2;/)!;
      expect(code).toContain(`Shapes_.${double}(Shapes_.${unit}) + Shapes_.${nested}.${depth};`);
      // Constant enum members are inlined; the others are defined and read under
      // the mangled name, while the reverse mapping keeps the original name.
      expect(code).toContain("1 /* A_ */, 10 /* B_ */");
      const [, , a] = code.match(/(\w+)\[\1\.(\w+) = "a"\.length\] = "A_";/)!;
      const [, , b] = code.match(/(\w+)\[\1\.(\w+) = \1\.\w+ \+ 1\] = "B_";/)!;
      expect(code).toContain(`Computed_.${a}, Computed_.${b}, Computed_[2]`);
      expect(code).not.toMatch(/\.(x_|y_|sum_|unit_|double_|depth_|fromSibling_|r_|A_|B_)\b/);
    },
  });

  itBundled("mangle-props/UseDefineForClassFieldsFalse", {
    files: {
      "/entry.ts": /* ts */ `
        class Base { set other(v: number) { console.log("setter", v); } }
        class Quoted extends Base { ["foo_"] = 1; other = 2; }
        class Annotated extends Base { [/* @__KEY__ */ "foo_"] = 3; bar_ = 4; other = 5; }
        const q = new Quoted(), a = new Annotated();
        console.log(Object.keys(q).length, Object.keys(a).length, q.foo_, a.foo_, a.bar_);
      `,
      "/tsconfig.json": `{ "compilerOptions": { "useDefineForClassFields": false } }`,
    },
    mangleProps: /_$/,
    mangleQuoted: true,
    // With useDefineForClassFields: false every field is assigned in the
    // constructor, so the inherited setter runs. A mangled computed key must
    // not stop the class from being lowered.
    run: { stdout: "setter 2\nsetter 5\n1 2 1 3 4" },
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      const lowered = /this\.(\w+) = 1;\s+this\.other = 2;/;
      expect(code).toMatch(lowered);
      const [, foo] = code.match(lowered)!;
      expect(code).toMatch(new RegExp(`this\\.${foo} = 3;\\s+this\\.(\\w+) = 4;\\s+this\\.other = 5;`));
      // No class fields are left behind.
      expect(code).not.toMatch(/foo_|bar_|^\s*other = /m);
    },
  });

  itBundled("mangle-props/DecoratedClassNamedAfterMangledKey", {
    files: {
      "/entry.ts": /* ts */ `
        const names: string[] = [];
        const dec = (cls: any, ctx: ClassDecoratorContext) => { names.push(String(ctx.name)); };
        const o = { foo_: @dec class {}, plain: @dec class {} };
        class Holder { bar_ = @dec class {} }
        console.log(JSON.stringify([o.foo_.name, o.plain.name, new Holder().bar_.name, names]));
      `,
    },
    mangleProps: /_$/,
    // The lowered classes are named after the property they are assigned to,
    // using the name the program wrote, whether or not the property is mangled.
    run: { stdout: '["foo_","plain","bar_",["foo_","plain","bar_"]]' },
    onAfterBundle(api) {
      // The keys, the field and the accesses are all mangled; only the names
      // given to the classes still say foo_ and bar_.
      expect(api.readFile("/out.js")).not.toMatch(/\.(foo_|bar_)\b|\bfoo_:|^\s*bar_ =/m);
    },
  });

  itBundled("mangle-props/JSX", {
    files: {
      "/entry.jsx": /* jsx */ `
        function h(tag, props) { return typeof tag === "function" ? tag(props) : JSON.stringify({ tag, props }); }
        const Lib_ = { Button_(props) { return props.label_ + "!"; } };
        const spread_ = { extra_: true };
        const title_ = "t";
        console.log(<div id="x" label_="l" data-mangle_="d" xml:keep_="k" {...spread_} {title_} />);
        console.log(<Lib_.Button_ label_="hi" />);
      `,
    },
    jsx: { runtime: "classic", factory: "h" },
    mangleProps: /_$/,
    run: {
      // label_ is the most used name (a), then Button_ (b); namespaced
      // attributes are left alone like esbuild does.
      stdout: ['{"tag":"div","props":{"id":"x","a":"l","d":"d","xml:keep_":"k","c":true,"e":"t"}}', "hi!"].join("\n"),
    },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain("h(Lib_.b, {");
    },
  });

  itBundled("mangle-props/WithMinifyIdentifiers", {
    files: {
      "/entry.js": /* js */ `
        import { describe } from "./lib.js";
        function makeThing(size) {
          const thing = { width_: size, height_: size * 2, tags_: ["x"] };
          thing.area_ = thing.width_ * thing.height_;
          return thing;
        }
        console.log(describe(makeThing(3)));
      `,
      "/lib.js": /* js */ `
        export function describe({ width_, height_, area_, tags_ }) {
          return [width_, height_, area_, tags_.length].join(",");
        }
      `,
    },
    mangleProps: /_$/,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    run: { stdout: "3,6,18,1" },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toMatch(/width_|height_|area_|tags_/);
    },
  });

  itBundled("mangle-props/GeneratedNamesSkipKeywords", {
    files: {
      "/entry.js": /* js */ `
        const o = {
          ${Array.from({ length: 400 }, (_, i) => `p${i}_: ${i}`).join(",\n          ")}
        };
        export { o };
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      const names = [...code.matchAll(/^\s+(\S+): \d+,?$/gm)].map(m => m[1]);
      expect(names).toHaveLength(400);
      // With the default alphabet, "if" would be the 333rd name and "in" the 765th.
      expect(names).toContain("hf");
      expect(names).not.toContain("if");
      expect(new Set(names).size).toBe(400);
    },
  });

  itBundled("mangle-props/RegExpFlagsFromTheJavaScriptAPI", {
    files: {
      "/entry.js": /* js */ `
        const o = { SECRET_one: 1, secret_two: 2, public_: 3 };
        capture(o.SECRET_one);
        capture(o.secret_two);
        capture(o.public_);
      `,
    },
    backend: "api",
    mangleProps: /^secret_/i,
    capture: ["o.a", "o.b", "o.public_"],
  });

  itBundled("mangle-props/RegExpFlagsKeepTheirJavaScriptMeaning", {
    files: {
      "/entry.js": /* js */ `
        // "[_(]" is valid in u mode but a syntax error in v mode, and only the s
        // flag lets "." match the newline in the quoted key.
        const o = { foo_: 1, "multi\\nline": 2, other: 3 };
        console.log(o.foo_, o["multi\\nline"], o.other, Object.keys(o).join("|"));
      `,
    },
    backend: "api",
    mangleProps: /[_(]$|^multi.line$/su,
    mangleQuoted: true,
    run: { stdout: "1 2 3 a|b|other" },
  });

  itBundled("mangle-props/CLIWithoutBundling", {
    files: {
      "/entry.js": /* js */ `
        export const o = { foo_: 1, "quoted_": 2, keep_: 3 };
        export const read = () => [o.foo_, o["quoted_"], o.keep_];
      `,
    },
    bundling: false,
    mangleProps: /_$/,
    reserveProps: /^keep/,
    mangleQuoted: true,
    onAfterBundle(api) {
      expect(normalizeBunSnapshot(api.readFile("/out.js"))).toMatchInlineSnapshot(`
        "export const o = { a: 1, b: 2, keep_: 3 };
        export const read = () => [o.a, o.b, o.keep_];"
      `);
    },
  });

  itBundled("mangle-props/CLIBundling", {
    files: {
      "/entry.js": /* js */ `
        import { o } from "./o.js";
        console.log(o.foo_, o["foo_"]);
      `,
      "/o.js": `export const o = { foo_: 1 };`,
    },
    backend: "cli",
    mangleProps: /_$/,
    run: { stdout: "1 undefined" },
  });

  itBundled("mangle-props/CLIBundlingMangleQuoted", {
    files: {
      "/entry.js": /* js */ `
        import { o } from "./o.js";
        console.log(o.foo_, o["foo_"], o.keep_);
      `,
      "/o.js": `export const o = { foo_: 1, keep_: 2 };`,
    },
    backend: "cli",
    mangleProps: /_$/,
    reserveProps: /^keep/,
    mangleQuoted: true,
    run: { stdout: "1 1 2" },
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).toContain("o.a, o.a, o.keep_");
    },
  });

  itBundled("mangle-props/JSONKeysAreData", {
    files: {
      "/entry.js": /* js */ `
        import data from "./data.json";
        // JSON keys are never renamed, so reading them through a mangled access
        // misses: keep data keys out of the pattern (or use quoted access).
        console.log(JSON.stringify(data), data["value_"], data.value_);
      `,
      "/data.json": `{ "value_": 1 }`,
    },
    mangleProps: /_$/,
    run: { stdout: '{"value_":1} 1 undefined' },
  });

  test.concurrent("bun build rejects an invalid --mangle-props pattern", async () => {
    using dir = tempDir("mangle-props-invalid", { "entry.js": "export const o = { foo_: 1 };" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", "--mangle-props=("],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain('--mangle-props expects a valid regular expression but received "("');
    expect(exitCode).toBe(1);
  });

  test.concurrent("bun build rejects an invalid --reserve-props pattern", async () => {
    using dir = tempDir("reserve-props-invalid", { "entry.js": "export const o = { foo_: 1 };" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", "--mangle-props=_$", "--reserve-props=["],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain('--reserve-props expects a valid regular expression but received "["');
    expect(exitCode).toBe(1);
  });

  test.concurrent("--reserve-props and --mangle-quoted do nothing without --mangle-props", async () => {
    using dir = tempDir("mangle-props-unset", {
      "entry.js": 'export const o = { foo_: 1 }; console.log(o.foo_, o["foo_"]);',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", "--mangle-props=", "--reserve-props=x", "--mangle-quoted"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain('console.log(o.foo_, o["foo_"])');
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent("Bun.build validates the mangling options", async () => {
    using dir = tempDir("mangle-props-api", {
      "entry.js": 'export const o = { foo_: 1, keep_: 2 }; export const r = [o.foo_, o["foo_"], o.keep_];',
    });
    const entrypoints = [`${dir}/entry.js`];

    expect(() => Bun.build({ entrypoints, mangleProps: "_$" as any })).toThrow("Expected mangleProps to be a RegExp");
    expect(() => Bun.build({ entrypoints, mangleProps: /_$/, reserveProps: "keep" as any })).toThrow(
      "Expected reserveProps to be a RegExp",
    );

    // reserveProps / mangleQuoted on their own are accepted and do nothing.
    const unmangled = await Bun.build({ entrypoints, reserveProps: /keep/, mangleQuoted: true });
    expect(await unmangled.outputs[0].text()).toContain('[o.foo_, o["foo_"], o.keep_]');

    const mangled = await Bun.build({ entrypoints, mangleProps: /_$/, reserveProps: /^keep/, mangleQuoted: true });
    const code = await mangled.outputs[0].text();
    expect(code).toContain("{ a: 1, keep_: 2 }");
    expect(code).toContain("[o.a, o.a, o.keep_]");
  });
});
