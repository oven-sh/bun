import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";
import { itBundled } from "./expectBundled";

// Property mangling (`--mangle-props`, `minify.mangleProps`). Every property
// name matching the regex is renamed to a short name (`a`, `b`, ...) in
// frequency order, consistently across the whole bundle. Nothing else in the
// output is minified unless the other minify flags are on, so the expected
// output below is readable.
describe("bundler", () => {
  itBundled("mangle-props/DotAndOptionalChain", {
    files: {
      "/entry.js": /* js */ `
        let x = { foo_: { bar_() { return this.baz_ }, baz_: 1 } };
        x.foo_;
        x?.foo_;
        x.foo_.bar_();
        x?.foo_?.bar_?.();
        x.foo_?.bar_();
        console.log(x.foo_.bar_(), x?.foo_?.bar_?.(), x.foo_?.bar_(), x.nope_?.bar_());
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var x = { a: { b() {
          return this.c;
        }, c: 1 } };
        x.a;
        x?.a;
        x.a.b();
        x?.a?.b?.();
        x.a?.b();
        console.log(x.a.b(), x?.a?.b?.(), x.a?.b(), x.d?.b());
        "
      `);
    },
    run: { stdout: "1 1 1 undefined" },
  });

  itBundled("mangle-props/ObjectLiteralKeys", {
    files: {
      "/entry.js": /* js */ `
        let foo_ = 1, bar_ = 2;
        let o = {
          foo_,
          bar_: bar_,
          baz_() { return 3 },
          get qux_() { return 4 },
          set qux_(v) {},
          async *gen_() {},
          ["computed_"]: 5,
          [\`tmpl_\`]: 6,
          keep: 7,
          "quoted_": 8,
        };
        console.log(o.foo_, o.bar_, o.baz_(), o.qux_, o["computed_"], o[\`tmpl_\`], o.keep, o["quoted_"], typeof o.gen_);
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var foo_ = 1;
        var bar_ = 2;
        var o = {
          b: foo_,
          c: bar_,
          d() {
            return 3;
          },
          get a() {
            return 4;
          },
          set a(v) {},
          async* e() {},
          ["computed_"]: 5,
          [\`tmpl_\`]: 6,
          keep: 7,
          quoted_: 8
        };
        console.log(o.b, o.c, o.d(), o.a, o["computed_"], o[\`tmpl_\`], o.keep, o["quoted_"], typeof o.e);
        "
      `);
    },
    run: { stdout: "1 2 3 4 5 6 7 8 function" },
  });

  itBundled("mangle-props/ClassMembers", {
    files: {
      "/entry.js": /* js */ `
        class C {
          foo_ = 1;
          static bar_ = 2;
          baz_() { return 3 }
          static qux_() { return 4 }
          get acc_() { return 5 }
          set acc_(v) {}
          static get sacc_() { return 6 }
          #priv_ = 7;
          static #spriv_() { return 8 }
          readPriv_() { return this.#priv_ + C.#spriv_() }
          constructor() { this.ctor_ = 16 }
          ["computed_"]() { return 17 }
        }
        const c = new C();
        console.log(c.foo_, C.bar_, c.baz_(), C.qux_(), c.acc_, C.sacc_, c.readPriv_(), c.ctor_, c["computed_"](), C.prototype.constructor === C);
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        class C {
          b = 1;
          static c = 2;
          d() {
            return 3;
          }
          static e() {
            return 4;
          }
          get a() {
            return 5;
          }
          set a(v) {}
          static get f() {
            return 6;
          }
          #priv_ = 7;
          static #spriv_() {
            return 8;
          }
          g() {
            return this.#priv_ + C.#spriv_();
          }
          constructor() {
            this.h = 16;
          }
          ["computed_"]() {
            return 17;
          }
        }
        var c = new C;
        console.log(c.b, C.c, c.d(), C.e(), c.a, C.f, c.g(), c.h, c["computed_"](), C.prototype.constructor === C);
        "
      `);
    },
    run: { stdout: "1 2 3 4 5 6 15 16 17 true" },
  });

  itBundled("mangle-props/ClassAutoAccessor", {
    files: {
      "/entry.js": /* js */ `
        class C {
          accessor auto_ = 9;
        }
        const c = new C();
        c.auto_ += 1;
        console.log(c.auto_);
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("auto_");
      // The auto-accessor is lowered to a getter/setter pair with the mangled name.
      expect(code).toMatch(/get a\(\)/);
      expect(code).toMatch(/set a\(/);
      expect(code).toContain("c.a += 1");
    },
    run: { stdout: "10" },
  });

  itBundled("mangle-props/Destructuring", {
    files: {
      "/entry.js": /* js */ `
        let o = { foo_: 1, bar_: 2, baz_: { nested_: 3 }, keep: 4 };
        let { foo_, bar_: renamed, baz_: { nested_ }, missing_ = 5, ...rest } = o;
        let out;
        ({ foo_: out } = o);
        ({ foo_, bar_: renamed = 0 } = o);
        function f({ foo_, bar_ = 10 }) { return foo_ + bar_ }
        for (const { foo_: v } of [o]) console.log(v);
        console.log(foo_, renamed, nested_, missing_, out, f(o), f({ foo_: 100 }), JSON.stringify(rest));
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var o = { a: 1, b: 2, c: { d: 3 }, keep: 4 };
        var { a: foo_, b: renamed, c: { d: nested_ }, e: missing_ = 5, ...rest } = o;
        var out;
        ({ a: out } = o);
        ({ a: foo_, b: renamed = 0 } = o);
        function f({ a: foo_2, b: bar_ = 10 }) {
          return foo_2 + bar_;
        }
        for (const { a: v } of [o])
          console.log(v);
        console.log(foo_, renamed, nested_, missing_, out, f(o), f({ a: 100 }), JSON.stringify(rest));
        "
      `);
    },
    run: { stdout: '1\n1 2 3 5 1 3 110 {"keep":4}' },
  });

  itBundled("mangle-props/QuotedOff", {
    files: {
      "/entry.js": /* js */ `
        let x = { foo_: 1, "bar_": 2 }, y = true, z = "other_";
        x.foo_;
        x["bar_"];
        x?.["bar_"];
        x[y ? "bar_" : z];
        x?.[!y ? z : "bar_"];
        x[(y, "bar_")];
        "bar_" in x;
        (y ? "bar_" : z) in x;
        const o = { "bar_": 3 };
        class K { "bar_" = 4 }
        var { "bar_": w } = x;
        x[\`bar_\`];
        console.log(x.foo_, x["bar_"], "bar_" in x, w, x[\`bar_\`], o["bar_"], new K()["bar_"]);
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("foo_");
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var x = { a: 1, bar_: 2 };
        var y = true;
        var z = "other_";
        x.a;
        x["bar_"];
        x?.["bar_"];
        x[y ? "bar_" : z];
        x?.[!y ? z : "bar_"];
        x[y, "bar_"];
        "bar_" in x;
        (y ? "bar_" : z) in x;
        var o = { bar_: 3 };

        class K {
          bar_ = 4;
        }
        var { bar_: w } = x;
        x[\`bar_\`];
        console.log(x.a, x["bar_"], "bar_" in x, w, x[\`bar_\`], o["bar_"], new K()["bar_"]);
        "
      `);
    },
    run: { stdout: "1 2 true 2 2 3 4" },
  });

  itBundled("mangle-props/QuotedOn", {
    files: {
      "/entry.js": /* js */ `
        let x = { "foo_": 1, bar_: 2, ["baz_"]: 3 }, y = true, z = "other_";
        console.log(x["foo_"], x?.["foo_"], x[y ? "foo_" : z], x?.[!y ? z : "foo_"], x[(y, "foo_")]);
        console.log("foo_" in x, (y ? "foo_" : z) in x, (y, "foo_") in x);
        const { "foo_": w, ["bar_"]: v } = x;
        class K { "foo_" = 4 }
        console.log(w, v, x["baz_"], new K()["foo_"], x[\`foo_\`]);
      `,
    },
    mangleProps: /_$/,
    mangleQuoted: true,
    // Runs `bun build --mangle-props=_$ --mangle-quoted`.
    backend: "cli",
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("bar_");
      expect(code).not.toContain("baz_");
      // Only the template literal key survives.
      expect(code.match(/foo_/g)).toHaveLength(1);
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var x = { a: 1, b: 2, ["c"]: 3 };
        var y = true;
        var z = "other_";
        console.log(x.a, x?.a, x[y ? "a" : z], x?.[!y ? z : "a"], x[y, "a"]);
        console.log("a" in x, (y ? "a" : z) in x, (y, "a") in x);
        var { a: w, ["b"]: v } = x;

        class K {
          a = 4;
        }
        console.log(w, v, x.c, new K().a, x[\`foo_\`]);
        "
      `);
    },
    // The template literal key is never mangled, so it no longer finds the property.
    run: { stdout: "1 1 1 1 1\ntrue true true\n1 2 3 4 undefined" },
  });

  itBundled("mangle-props/KeyComment", {
    files: {
      "/entry.js": /* js */ `
        let o = { foo_: 1, bar_: 2 };
        function get(obj, key) { return obj[key] }
        console.log(
          get(o, /* @__KEY__ */ "foo_"),
          get(o, /* #__KEY__ */ "bar_"),
          get(o, "foo_"),
          get(o, /* @__KEY__ */ \`foo_\`),
          o[\`\${/* @__KEY__ */ "bar_"}\`],
          get(o, /* @__KEY__ */ "notMatching"),
        );
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).toContain("var o = { a: 1, b: 2 }");
      expect(code).toContain('get(o, /* @__KEY__ */ "a")');
      // `#__KEY__` is accepted too and is printed as `@__KEY__`.
      expect(code).toContain('get(o, /* @__KEY__ */ "b")');
      expect(code).toContain('o[`${/* @__KEY__ */ "b"}`]');
      // Strings without the annotation or whose name does not match are unchanged.
      expect(code).toContain('get(o, "foo_")');
      expect(code).toContain('"notMatching"');
      expect(code).not.toContain('"bar_"');
      expect(code).not.toContain("`foo_`");
    },
    run: { stdout: "1 2 undefined 1 2 undefined" },
  });

  itBundled("mangle-props/ReserveProps", {
    files: {
      "/entry.js": /* js */ `
        let o = { foo_: 1, keepMe_: 2, keep_: 3 };
        console.log(o.foo_, o.keepMe_, o.keep_);
      `,
    },
    mangleProps: /_$/,
    reserveProps: /^keep/,
    // Runs `bun build --mangle-props=_$ --reserve-props=^keep`.
    backend: "cli",
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var o = { a: 1, keepMe_: 2, keep_: 3 };
        console.log(o.a, o.keepMe_, o.keep_);
        "
      `);
    },
    run: { stdout: "1 2 3" },
  });

  itBundled("mangle-props/ReservedNames", {
    files: {
      "/entry.js": /* js */ `
        let o = { foo_: 1, bar_: 2, baz_: 3 };
        console.log(o.foo_, o.bar_, o.baz_);
      `,
    },
    mangleProps: /_$/,
    mangleReserved: ["bar_", "baz_"],
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var o = { a: 1, bar_: 2, baz_: 3 };
        console.log(o.a, o.bar_, o.baz_);
        "
      `);
    },
    run: { stdout: "1 2 3" },
  });

  // `include: /./` matches everything, so this proves which names are never
  // mangled regardless of the regex. `console.log` would be mangled too, so
  // the program is not run.
  itBundled("mangle-props/PermanentlyReservedNames", {
    files: {
      "/entry.js": /* js */ `
        class Foo { constructor() { this.x = 1 } }
        Foo.prototype.y = 2;
        let o = { __proto__: null, constructor: 3, prototype: 4, 123: 5, "456": 6 };
        o["789"];
        o["__proto__"];
        o.constructor.prototype;
        export { Foo, o };
      `,
    },
    mangleProps: /./,
    mangleQuoted: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        class Foo {
          constructor() {
            this.a = 1;
          }
        }
        Foo.prototype.b = 2;
        var o = { __proto__: null, constructor: 3, prototype: 4, 123: 5, "456": 6 };
        o["789"];
        o["__proto__"];
        o.constructor.prototype;
        export {
          Foo,
          o
        };
        "
      `);
    },
  });

  itBundled("mangle-props/AvoidCollisions", {
    files: {
      "/entry.js": /* js */ `
        let o = { foo_: 1, bar_: 2, a: 3, "b": 4, c: 5 };
        console.log(o.foo_, o.bar_, o.a, o.b, o["c"], o["d"]);
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      // `a`, `b` and `c` are existing names and `d` is a kept quoted name,
      // so the generated names start at `e`.
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var o = { e: 1, f: 2, a: 3, b: 4, c: 5 };
        console.log(o.e, o.f, o.a, o.b, o["c"], o["d"]);
        "
      `);
    },
    run: { stdout: "1 2 3 4 5 undefined" },
  });

  itBundled("mangle-props/FrequencyOrdering", {
    files: {
      "/entry.js": /* js */ `
        let o = { rare_: 1, common_: 2, medium_: 3 };
        o.common_; o.common_; o.common_;
        o.medium_;
        console.log(o.common_, o.rare_, o.medium_);
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var o = { c: 1, a: 2, b: 3 };
        o.a;
        o.a;
        o.a;
        o.b;
        console.log(o.a, o.c, o.b);
        "
      `);
    },
    run: { stdout: "2 1 3" },
  });

  // 900 properties use up the 54 one-character names and reach past `do`,
  // `if` and `in` in the two-character sequence.
  itBundled("mangle-props/GeneratedNamesAreUniqueAndSkipKeywords", {
    files: {
      "/entry.js": /* js */ `
        let o = {
          ${Array.from({ length: 900 }, (_, i) => `p${i}_: ${i},`).join("\n  ")}
        };
        console.log(Object.keys(o).length, Object.values(o).every((v, i) => v === i));
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("p0_");
      const names = [...code.matchAll(/^\s+([A-Za-z_$][\w$]*): \d+,?$/gm)].map(m => m[1]);
      expect(names).toHaveLength(900);
      expect(new Set(names).size).toBe(900);
      expect(names.slice(0, 3)).toEqual(["a", "b", "c"]);
      expect(names.some(name => name.length === 2)).toBe(true);
      for (const keyword of ["do", "if", "in"]) {
        expect(names).not.toContain(keyword);
      }
    },
    run: { stdout: "900 true" },
  });

  itBundled("mangle-props/CrossFileConsistency", {
    files: {
      "/entry.js": /* js */ `
        import { make, read } from "./lib.js";
        const o = make();
        o.extra_ = 3;
        console.log(o.foo_, o.bar_, read(o), o.extra_);
      `,
      "/lib.js": /* js */ `
        export function make() { return { foo_: 1, bar_: 2 } }
        export function read(o) { return o.extra_ }
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// lib.js
        function make() {
          return { b: 1, c: 2 };
        }
        function read(o) {
          return o.a;
        }

        // entry.js
        var o = make();
        o.a = 3;
        console.log(o.b, o.c, read(o), o.a);
        "
      `);
    },
    run: { stdout: "1 2 3 3" },
  });

  itBundled("mangle-props/CodeSplitting", {
    files: {
      "/a.js": /* js */ `
        import { shared } from "./shared.js";
        console.log(shared.foo_, shared.bar_());
      `,
      "/b.js": /* js */ `
        import { shared } from "./shared.js";
        console.log(shared.bar_(), shared.foo_);
      `,
      "/shared.js": /* js */ `
        export const shared = { foo_: 1, bar_() { return this.foo_ + 1 } };
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    splitting: true,
    mangleProps: /_$/,
    onAfterBundle(api) {
      const files = readdirSync(api.outdir);
      expect(files.sort()).toHaveLength(3);
      for (const file of files) {
        const code = api.readFile(path.join("/out", file));
        expect(code).not.toContain("foo_");
        expect(code).not.toContain("bar_");
      }
      expect(api.readFile("/out/a.js")).toContain("shared.a, shared.b()");
      expect(api.readFile("/out/b.js")).toContain("shared.b(), shared.a");
    },
    run: [
      { file: "/out/a.js", stdout: "1 2" },
      { file: "/out/b.js", stdout: "2 1" },
    ],
  });

  itBundled("mangle-props/JSXClassicRuntime", {
    files: {
      "/entry.jsx": /* jsx */ `
        const Foo = {
          Bar_: "bar",
          createElement_(tag, props, ...children) { return { tag, props, children } },
          Fragment_: "frag",
        };
        const el = <Foo.Bar_ foo_={1} ns:foo_={2} keep={3} short_ {...{ spread_: 4 }} />;
        const frag = <><Foo.Bar_ /></>;
        console.log(el.tag, JSON.stringify(el.props), frag.tag, frag.children[0].tag);
      `,
    },
    jsx: { runtime: "classic", factory: "Foo.createElement_", fragment: "Foo.Fragment_" },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.jsx
        var Foo = {
          b: "bar",
          a(tag, props, ...children) {
            return { tag, props, children };
          },
          c: "frag"
        };
        var el = /* @__PURE__ */ Foo.a(Foo.b, {
          d: 1,
          "ns:foo_": 2,
          keep: 3,
          e: true,
          ...{ f: 4 }
        });
        var frag = /* @__PURE__ */ Foo.a(Foo.c, null, /* @__PURE__ */ Foo.a(Foo.b, null));
        console.log(el.tag, JSON.stringify(el.props), frag.tag, frag.children[0].tag);
        "
      `);
    },
    run: { stdout: 'bar {"d":1,"ns:foo_":2,"keep":3,"e":true,"f":4} frag bar' },
  });

  itBundled("mangle-props/JSXAutomaticRuntime", {
    files: {
      "/entry.jsx": /* jsx */ `
        const Foo = { Bar_: "bar" };
        const el = <Foo.Bar_ foo_={1} ns:foo_={2} keep={3} key="k">{4}</Foo.Bar_>;
        console.log(el.type, JSON.stringify(el.props), el.key);
      `,
      "/node_modules/react/jsx-dev-runtime.js": /* js */ `
        export function jsxDEV(type, props, key) { return { type, props, key } }
        export const Fragment = "Fragment";
      `,
      "/node_modules/react/jsx-runtime.js": /* js */ `
        export function jsx(type, props, key) { return { type, props, key } }
        export function jsxs(type, props, key) { return { type, props, key } }
        export const Fragment = "Fragment";
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("foo_:");
      expect(code).not.toContain("Foo.Bar_");
      expect(code).toContain('"ns:foo_": 2');
      expect(code).toContain("keep: 3");
      // `children` is the JSX runtime's own prop name and does not match the regex.
      expect(code).toContain("children: 4");
    },
    run: { stdout: 'bar {"b":1,"ns:foo_":2,"keep":3,"children":4} k' },
  });

  itBundled("mangle-props/TypeScriptParameterProperties", {
    files: {
      "/entry.ts": /* ts */ `
        class Foo {
          constructor(public keep: number, public mangle_: number, private priv_ = 3) {}
          sum_() { return this.keep + this.mangle_ + this.priv_ }
        }
        const f = new Foo(1, 2);
        console.log(f.keep, f.mangle_, f.sum_(), Object.keys(f).join());
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.ts
        class Foo {
          keep;
          a;
          b;
          constructor(keep, mangle_, priv_ = 3) {
            this.keep = keep;
            this.a = mangle_;
            this.b = priv_;
          }
          c() {
            return this.keep + this.a + this.b;
          }
        }
        var f = new Foo(1, 2);
        console.log(f.keep, f.a, f.c(), Object.keys(f).join());
        "
      `);
    },
    run: { stdout: "1 2 6 keep,a,b" },
  });

  itBundled("mangle-props/TypeScriptClassFieldsWithoutDefine", {
    files: {
      "/entry.ts": /* ts */ `
        class C {
          foo_ = 1;
          bar_ = this.foo_ + 1;
          static baz_ = 3;
          declare decl_: number;
        }
        console.log(new C().foo_, new C().bar_, C.baz_);
      `,
    },
    useDefineForClassFields: false,
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.ts
        class C {
          constructor() {
            this.a = 1;
            this.b = this.a + 1;
          }
          static c = 3;
        }
        console.log(new C().a, new C().b, C.c);
        "
      `);
    },
    run: { stdout: "1 2 3" },
  });

  itBundled("mangle-props/TypeScriptNamespaceExports", {
    files: {
      "/entry.ts": /* ts */ `
        namespace ns {
          export const foo_ = 1;
          export function bar_() { return 2 }
          export class Baz_ {}
          export let { nested_ } = { nested_: 3 };
          export namespace inner_ { export const deep_ = 4 }
          export enum Enum_ { member_ = 5 }
          console.log(foo_, bar_(), new Baz_() instanceof Baz_, nested_, inner_.deep_, Enum_.member_);
        }
        console.log(ns.foo_, ns.bar_(), new ns.Baz_() instanceof ns.Baz_, ns.nested_, ns.inner_.deep_, ns.Enum_.member_);
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.ts
        var ns;
        ((ns) => {
          ns.b = 1;
          function bar_() {
            return 2;
          }
          ns.f = bar_;

          class Baz_ {
          }
          ns.c = Baz_;
          ({ a: ns.a } = { a: 3 });
          let inner_;
          ((inner_) => {
            inner_.d = 4;
          })(inner_ = ns.g ||= {});
          let Enum_;
          ((Enum_2) => {
            Enum_2[Enum_2.h = 5] = "member_";
          })(Enum_ = ns.e ||= {});
          console.log(ns.b, bar_(), new Baz_ instanceof Baz_, ns.a, inner_.d, 5 /* member_ */);
        })(ns ||= {});
        console.log(ns.b, ns.f(), new ns.c instanceof ns.c, ns.a, ns.g.d, 5 /* member_ */);
        "
      `);
    },
    run: { stdout: "1 2 true 3 4 5\n1 2 true 3 4 5" },
  });

  // A reference in a later `namespace ns {}` block to an export of an earlier
  // block is a namespace alias, not an `E::Dot`; it must still be mangled.
  itBundled("mangle-props/TypeScriptMergedNamespaceBlocks", {
    files: {
      "/entry.ts": /* ts */ `
        namespace ns { export const foo_ = 1 }
        namespace ns { console.log(foo_) }
        console.log(ns.foo_);
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("foo_");
      expect(code.match(/ns\.a\b/g)).toHaveLength(3);
    },
    run: { stdout: "1\n1" },
  });

  itBundled("mangle-props/TypeScriptEnums", {
    files: {
      "/entry.ts": /* ts */ `
        enum E { foo_ = 0, bar_ = 1, keep = 2 }
        enum S { str_ = "s", other_ = str_ + "!" }
        export function read(k: string) { return (E as any)[k] }
        console.log(E.foo_, E.bar_, E.keep, E[0], E[1], E.keep, S.str_, S.other_, Object.keys(E).join(), Object.keys(S).join());
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.ts
        var E;
        ((E2) => {
          E2[E2.a = 0] = "foo_";
          E2[E2.b = 1] = "bar_";
          E2[E2["keep"] = 2] = "keep";
        })(E ||= {});
        var S;
        ((S2) => {
          S2.c = "s";
          S2.d = "s!";
        })(S ||= {});
        function read(k) {
          return E[k];
        }
        console.log(0 /* foo_ */, 1 /* bar_ */, 2 /* keep */, E[0], E[1], 2 /* keep */, "s" /* str_ */, "s!" /* other_ */, Object.keys(E).join(), Object.keys(S).join());
        export {
          read
        };
        "
      `);
    },
    run: { stdout: "0 1 2 foo_ bar_ 2 s s! 0,1,2,a,b,keep c,d" },
  });

  // A namespace import member access is resolved to the export itself, so it
  // is never a property access and is not mangled (esbuild mangles it and
  // breaks the program).
  itBundled("mangle-props/NamespaceImportMemberIsResolved", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from "./lib.js";
        console.log(ns.foo_, ns.bar_(), ns["foo_"], Object.keys(ns).join());
      `,
      "/lib.js": /* js */ `
        export const foo_ = 1;
        export function bar_() { return 2 }
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "var __defProp = Object.defineProperty;
        var __returnValue = (v) => v;
        function __exportSetter(name, newValue) {
          this[name] = __returnValue.bind(null, newValue);
        }
        var __export = (target, all) => {
          for (var name in all)
            __defProp(target, name, {
              get: all[name],
              enumerable: true,
              configurable: true,
              set: __exportSetter.bind(all, name)
            });
        };

        // lib.js
        var exports_lib = {};
        __export(exports_lib, {
          bar_: () => bar_,
          foo_: () => foo_
        });
        var foo_ = 1;
        function bar_() {
          return 2;
        }

        // entry.js
        console.log(foo_, bar_(), foo_, Object.keys(exports_lib).join());
        "
      `);
    },
    run: { stdout: "1 2 1 bar_,foo_" },
  });

  itBundled("mangle-props/ImportExportNamesUntouched", {
    files: {
      "/entry.js": /* js */ `
        import { foo_ } from "./lib.js";
        import * as ns from "./lib.js";
        export { foo_ as renamed_, ns };
        export const baz_ = { qux_: foo_ };
        export * from "./lib.js";
      `,
      "/lib.js": /* js */ `
        export const foo_ = 1;
        export let bar_ = 2;
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "var __defProp = Object.defineProperty;
        var __returnValue = (v) => v;
        function __exportSetter(name, newValue) {
          this[name] = __returnValue.bind(null, newValue);
        }
        var __export = (target, all) => {
          for (var name in all)
            __defProp(target, name, {
              get: all[name],
              enumerable: true,
              configurable: true,
              set: __exportSetter.bind(all, name)
            });
        };

        // lib.js
        var exports_lib = {};
        __export(exports_lib, {
          bar_: () => bar_,
          foo_: () => foo_
        });
        var foo_ = 1;
        var bar_ = 2;
        // entry.js
        var baz_ = { a: foo_ };
        export {
          bar_,
          baz_,
          foo_,
          exports_lib as ns,
          foo_ as renamed_
        };
        "
      `);
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        import * as m from "./out.js";
        console.log(JSON.stringify(m), JSON.stringify(m.ns));
      `,
    },
    run: {
      file: "/test.js",
      stdout: '{"bar_":2,"baz_":{"a":1},"foo_":1,"ns":{"bar_":2,"foo_":1},"renamed_":1} {"bar_":2,"foo_":1}',
    },
  });

  itBundled("mangle-props/SuperAndDeleteAndCallTargets", {
    files: {
      "/entry.js": /* js */ `
        class A { foo_() { return "A" } }
        class B extends A {
          constructor() { super(); this.x_ = super.foo_() }
          foo_() { return "B" }
        }
        const b = new B();
        const o = { foo_: 1, bar_() { return this.foo_ }, baz_: 2 };
        console.log(b.x_, b.foo_(), o.bar_(), o?.bar_(), (0, o.bar_)?.call(o), delete o.baz_, o.baz_, "baz_" in o);
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        class A {
          a() {
            return "A";
          }
        }

        class B extends A {
          constructor() {
            super();
            this.d = super.a();
          }
          a() {
            return "B";
          }
        }
        var b = new B;
        var o = { a: 1, b() {
          return this.a;
        }, c: 2 };
        console.log(b.d, b.a(), o.b(), o?.b(), (0, o.b)?.call(o), delete o.c, o.c, "baz_" in o);
        "
      `);
    },
    run: { stdout: "A B 1 1 1 true undefined false" },
  });

  itBundled("mangle-props/WithAllMinifyFlags", {
    files: {
      "/entry.js": /* js */ `
        let object = { foo_: 1, bar_: 2, keep: 3, "quoted_": 4 };
        class Klass { method_() { return object.foo_ + object.bar_ + object.keep + object["quoted_"] } }
        console.log(new Klass().method_(), Object.keys(object).length, ({ foo_ } = object).foo_, foo_);
        var foo_;
      `,
    },
    mangleProps: /_$/,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    onAfterBundle(api) {
      // With identifier minification the letters follow the character frequency, so
      // only the kept names are asserted by name.
      const code = api.readFile("/out.js");
      expect(code).not.toContain("foo_");
      expect(code).not.toContain("bar_");
      expect(code).not.toContain("method_");
      expect(code).toContain("keep:3");
      expect(code).toContain("quoted_:4");
      expect(code).toContain(".quoted_");
      expect(code.split("\n").length).toBeLessThanOrEqual(2);
    },
    run: { stdout: "10 4 1 1" },
  });

  itBundled("mangle-props/ShorthandIsExpandedWhenNamesDiffer", {
    files: {
      "/entry.js": /* js */ `
        export let fn = ({ xxxxx }) => ({ xxxxx });
        export let obj = ({ yyyyy }) => ({ yyyyy: yyyyy });
        export let dflt = ({ xxxxx = 1 }) => ({ xxxxx });
      `,
    },
    mangleProps: /x|y/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var fn = ({ a: xxxxx }) => ({ a: xxxxx });
        var obj = ({ b: yyyyy }) => ({ b: yyyyy });
        var dflt = ({ a: xxxxx = 1 }) => ({ a: xxxxx });
        export {
          dflt,
          fn,
          obj
        };
        "
      `);
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        import { fn, obj, dflt } from "./out.js";
        console.log(JSON.stringify([fn({ a: 1 }), obj({ b: 2 }), dflt({})]));
      `,
    },
    run: { file: "/test.js", stdout: '[{"a":1},{"b":2},{"a":1}]' },
  });

  // The property name is pinned to the name of the binding it is paired with,
  // so the printer collapses `{ y: y }` back into the shorthand `{ y }`.
  itBundled("mangle-props/ShorthandIsKeptWhenNamesMatch", {
    files: {
      "/entry.js": /* js */ `
        export let fn = ({ xxxxx: y }) => ({ xxxxx: y });
        export let dflt = ({ xxxxx: y = 1 }) => ({ xxxxx: y });
        export let other = ({ zzzzz: y }) => ({ zzzzz: y });
      `,
    },
    mangleProps: /x|z/,
    mangleCache: { xxxxx: "y" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var fn = ({ y }) => ({ y });
        var dflt = ({ y = 1 }) => ({ y });
        var other = ({ a: y }) => ({ a: y });
        export {
          dflt,
          fn,
          other
        };
        "
      `);
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        import { fn, dflt, other } from "./out.js";
        console.log(JSON.stringify([fn({ y: 2 }), dflt({}), other({ a: 3 })]));
      `,
    },
    run: { file: "/test.js", stdout: '[{"y":2},{"y":1},{"a":3}]' },
  });

  // With identifier minification the parameter and the property are renamed
  // independently, so only the invariants are asserted: the original name is
  // gone, no `{ a: a }` pair is printed, and the program still works.
  itBundled("mangle-props/ShorthandWithMinifiedIdentifiers", {
    files: {
      "/entry.js": /* js */ `
        export let fn = ({ xxxxx }) => ({ xxxxx });
        export let dflt = ({ xxxxx = 1 }) => ({ xxxxx });
      `,
    },
    mangleProps: /x/,
    minifyIdentifiers: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("xxxxx");
      expect(code).not.toMatch(/\b(\w+): \1\b/);
    },
    runtimeFiles: {
      "/test.js": /* js */ `
        import { fn, dflt } from "./out.js";
        const [key] = Object.keys(fn({ xxxxx: 0 }));
        console.log(key.length, JSON.stringify(Object.values(fn({ [key]: 2 }))), JSON.stringify(Object.values(dflt({}))));
      `,
    },
    run: { file: "/test.js", stdout: "1 [2] [1]" },
  });

  itBundled("mangle-props/CommonJSExports", {
    files: {
      "/entry.js": /* js */ `
        const lib = require("./lib.cjs");
        const { foo_, bar_ } = require("./lib.cjs");
        console.log(lib.foo_, lib.bar_(), foo_, bar_());
      `,
      "/lib.cjs": /* js */ `
        exports.foo_ = "foo";
        module.exports.bar_ = () => "bar";
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      // `exports.x` and `module.exports.x` are ordinary property accesses, so
      // CommonJS export names are mangled too, and the module keeps its
      // `__commonJS` wrapper.
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

        // lib.cjs
        var require_lib = __commonJS(function(exports, module) {
          exports.a = "foo";
          module.exports.b = () => "bar";
        });

        // entry.js
        var require_entry = __commonJS(function() {
          var lib = require_lib();
          var { a: foo_, b: bar_ } = require_lib();
          console.log(lib.a, lib.b(), foo_, bar_());
        });
        export default require_entry();
        "
      `);
    },
    run: { stdout: "foo bar foo bar" },
  });

  itBundled("mangle-props/NonASCIIQuotedNamesQuotedOn", {
    files: {
      "/entry.js": /* js */ `
        const o = { "ñame_": 1, "日本_": 2 };
        console.log(o["ñame_"], o.ñame_, o["日本_"], o.日本_, "ñame_" in o);
      `,
    },
    mangleProps: /_$/,
    mangleQuoted: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var o = { a: 1, b: 2 };
        console.log(o.a, o.a, o.b, o.b, "a" in o);
        "
      `);
    },
    run: { stdout: "1 1 2 2 true" },
  });

  // Without `quoted`, a non-ASCII quoted name is kept like an ASCII one while
  // the unquoted `o.ñame_` is still mangled.
  itBundled("mangle-props/NonASCIIQuotedNamesQuotedOff", {
    files: {
      "/entry.js": /* js */ `
        const o = { "ñame_": 1, "日本_": 2 };
        console.log(o["ñame_"], o.ñame_, o["日本_"], o.日本_, "ñame_" in o);
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var o = { "ñame_": 1, "日本_": 2 };
        console.log(o["ñame_"], o.a, o["日本_"], o.b, "ñame_" in o);
        "
      `);
    },
    run: { stdout: "1 undefined 2 undefined true" },
  });

  // An inlined enum member used as a property key is a quoted name: with
  // `quoted` it is mangled everywhere it is used as a key.
  itBundled("mangle-props/InlinedEnumKeysQuotedOn", {
    files: {
      "/entry.ts": /* ts */ `
        enum K { A = "a_" }
        const o = { [K.A]: 1 };
        class C { [K.A]() { return "m" } }
        console.log(o[K.A], o.a_, new C()[K.A](), K.A in o);
      `,
    },
    mangleProps: /_$/,
    mangleQuoted: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.ts
        var o = { ["a"]: 1 };

        class C {
          ["a"]() {
            return "m";
          }
        }
        console.log(o.a, o.a, new C().a(), "a" in o);
        "
      `);
    },
    run: { stdout: "1 1 m true" },
  });

  // Without `quoted`, the inlined enum member is kept and reserved: no
  // generated name is `b`.
  itBundled("mangle-props/InlinedEnumKeysQuotedOff", {
    files: {
      "/entry.ts": /* ts */ `
        enum K { A = "b" }
        const o = { foo_: 1, bar_: 2, [K.A]: 3 };
        console.log(o.foo_, o.bar_, o[K.A], o.b, Object.keys(o).join());
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.ts
        var o = { a: 1, c: 2, ["b" /* A */]: 3 };
        console.log(o.a, o.c, o["b" /* A */], o.b, Object.keys(o).join());
        "
      `);
    },
    run: { stdout: "1 2 3 3 a,c,b" },
  });

  // `minifySyntax` inlines the constant into the key position, where the
  // quoted rule applies.
  itBundled("mangle-props/InlinedConstantKeysQuotedOn", {
    files: {
      "/entry.ts": /* ts */ `
        const KEY = "k_";
        const o = { [KEY]: 1, foo_: 2 };
        console.log(o[KEY], o.k_, o.foo_, KEY in o);
      `,
    },
    mangleProps: /_$/,
    mangleQuoted: true,
    minifySyntax: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.ts
        var o = { ["a"]: 1, b: 2 };
        console.log(o.a, o.a, o.b, "a" in o);
        "
      `);
    },
    run: { stdout: "1 1 2 true" },
  });

  itBundled("mangle-props/JSONAndTOMLKeysAreReserved", {
    files: {
      "/entry.js": /* js */ `
        import data from "./data.json";
        import config from "./config.toml";
        let o = { foo_: 1, bar_: 2, baz_: 3 };
        console.log(o.foo_, o.bar_, o.baz_, JSON.stringify(data), JSON.stringify(config));
      `,
      "/data.json": `{ "a": 1, "b": { "c": 2 } }`,
      "/config.toml": `d = 1\n[e]\nf = 2\n`,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      // The keys of the imported JSON (`a`, `b`, `c`) and TOML (`d`, `e`, `f`)
      // objects are reserved, so the generated names start at `g`.
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// data.json
        var data_default = {
          a: 1,
          b: { c: 2 }
        };
        // config.toml
        var config_default = {
          d: 1,
          e: {
            f: 2
          }
        };

        // entry.js
        var o = { g: 1, h: 2, i: 3 };
        console.log(o.g, o.h, o.i, JSON.stringify(data_default), JSON.stringify(config_default));
        "
      `);
    },
    run: { stdout: '1 2 3 {"a":1,"b":{"c":2}} {"d":1,"e":{"f":2}}' },
  });

  itBundled("mangle-props/CSSModuleClassNamesAreReserved", {
    target: "bun",
    outdir: "/out",
    files: {
      "/entry.js": /* js */ `
        import styles from "./x.module.css";
        let o = { foo_: 1, bar_: 2, baz_: 3 };
        console.log(o.foo_, o.bar_, o.baz_, Object.keys(styles).join());
      `,
      "/x.module.css": `.a { color: red }\n.b { color: blue }\n`,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      // The CSS module exports `a` and `b`, so the generated names start at `c`.
      const code = api.readFile("/out/entry.js");
      expect(code).toMatch(/a: "a_[\w-]+",\n\s+b: "b_[\w-]+"/);
      expect(code).toContain("var o = { c: 1, d: 2, e: 3 };");
      expect(code).toContain("console.log(o.c, o.d, o.e, Object.keys(x_module_default).join());");
    },
    run: { stdout: "1 2 3 a,b" },
  });

  // A `define` replaces the whole `process.env.FOO_` expression before the
  // property mangler sees it; the undefined `process.env.BAR_` is mangled.
  itBundled("mangle-props/DefineWinsOverMangling", {
    files: {
      "/entry.js": /* js */ `
        console.log(process.env.FOO_, process.env.BAR_);
      `,
    },
    define: { "process.env.FOO_": '"x"' },
    mangleProps: /_$/,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        console.log("x", process.env.a);
        "
      `);
    },
    run: { stdout: "x undefined" },
  });

  // `require.resolve` is rewritten by the parser and is not a property access.
  itBundled("mangle-props/RequireResolveIsNotMangled", {
    files: {
      "/entry.js": /* js */ `
        const o = { resolve: 1 };
        console.log(typeof require.resolve, o.resolve);
      `,
    },
    target: "bun",
    mangleProps: /^resolve$/,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).toContain("typeof __require.resolve");
      expect(code).toContain("var o = { a: 1 };");
      expect(code).toContain("o.a");
    },
    run: { stdout: "function 1" },
  });

  // `minifySyntax` turns `o["b"]` into `o.b`. The name stays unmangled (the
  // quoted rule) and is reserved, so no generated name is `b`.
  itBundled("mangle-props/MinifySyntaxQuotedIndexIsReserved", {
    files: {
      "/entry.js": /* js */ `
        let o = { foo_: 1, bar_: 2 };
        o["b"] = 3;
        console.log(o["b"], o.foo_, o.bar_, JSON.stringify(o));
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").toMatchInlineSnapshot(`
        "// entry.js
        var o = { a: 1, c: 2 };
        o.b = 3;
        console.log(o.b, o.a, o.c, JSON.stringify(o));
        "
      `);
    },
    run: { stdout: '3 1 2 {"a":1,"c":2,"b":3}' },
  });

  itBundled("mangle-props/LegacyDecorators", {
    files: {
      "/entry.ts": /* ts */ `
        const keys: string[] = [];
        function dec(_target: any, key: string | symbol) { keys.push(String(key)); }
        class C {
          @dec foo_ = 1;
          @dec bar_() { return 2 }
          @dec static baz_ = 3;
          @dec get qux_() { return 4 }
          @dec keep = 5;
        }
        const c = new C();
        console.log(keys.join(), c.foo_, c.bar_(), C.baz_, c.qux_, c.keep, keys.every(k => k in c || k in C));
      `,
      "/tsconfig.json": /* json */ `{ "compilerOptions": { "experimentalDecorators": true } }`,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      // The decorator receives the mangled member name.
      const code = api.readFile("/out.js");
      expect(code).not.toMatch(/foo_|bar_|baz_|qux_/);
      expect(code).toContain('], C.prototype, "a", undefined);');
      expect(code).toContain('], C.prototype, "b", null);');
      expect(code).toContain('], C.prototype, "d", null);');
      expect(code).toContain('], C.prototype, "keep", undefined);');
      expect(code).toContain('], C, "c", undefined);');
    },
    run: { stdout: "a,b,d,keep,c 1 2 3 4 5 true" },
  });

  itBundled("mangle-props/StandardDecorators", {
    files: {
      "/entry.ts": /* ts */ `
        const keys: string[] = [];
        function dec(_value: unknown, context: { name: string | symbol }) { keys.push(String(context.name)); }
        class C {
          @dec foo_ = 1;
          @dec bar_() { return 2 }
          @dec static baz_ = 3;
          @dec get qux_() { return 4 }
          @dec accessor acc_ = 6;
          @dec keep = 5;
        }
        const c = new C();
        console.log(keys.join(), c.foo_, c.bar_(), C.baz_, c.qux_, c.acc_, c.keep, keys.every(k => k in c || k in C));
      `,
    },
    mangleProps: /_$/,
    onAfterBundle(api) {
      // The decorator context receives the mangled member name.
      const code = api.readFile("/out.js");
      expect(code).not.toMatch(/foo_|bar_|baz_|qux_|acc_/);
      expect(code).toContain('__decorateElement(_init, 5, "a", _dec, C);');
      expect(code).toContain('__decorateElement(_init, 1, "b", _dec2, C);');
      expect(code).toContain('__decorateElement(_init, 13, "c", _dec3, C);');
      expect(code).toContain('__decorateElement(_init, 2, "d", _dec4, C);');
      expect(code).toContain('__decorateElement(_init, 4, "e", _dec5, C, _accessor_storage0);');
      expect(code).toContain('__decorateElement(_init, 5, "keep", _dec6, C);');
    },
    run: { stdout: "b,d,e,c,a,keep 1 2 3 4 6 5 true" },
  });
});

describe.concurrent("Bun.build minify.mangleProps", () => {
  const entry = /* js */ `
    let o = { foo_: 1, bar_: 2, keep: 3 };
    o.foo_; o.foo_;
    console.log(o.foo_, o.bar_, o.keep, o["bar_"]);
  `;

  async function build(minify: any, files: Record<string, string> = { "entry.js": entry }) {
    using dir = tempDir("mangle-props-api", files);
    const result = await Bun.build({
      entrypoints: Object.keys(files).map(f => path.join(String(dir), f)),
      minify,
    });
    expect(result.success).toBe(true);
    // Drop the leading `// <path>/entry.js` comment so outputs of two builds compare equal.
    const code = (await result.outputs[0].text()).replace(/^\/\/ .*\n/, "");
    return { code, mangleCache: result.mangleCache };
  }

  test("a bare RegExp is the include pattern", async () => {
    const { code, mangleCache } = await build({ mangleProps: /_$/ });
    expect(code).toContain("var o = { a: 1, b: 2, keep: 3 }");
    expect(code).toContain('console.log(o.a, o.b, o.keep, o["bar_"])');
    expect(mangleCache).toEqual({ foo_: "a", bar_: "b" });
  });

  test("{ include } produces the same output as a bare RegExp", async () => {
    const [bare, object] = await Promise.all([build({ mangleProps: /_$/ }), build({ mangleProps: { include: /_$/ } })]);
    expect(object.code).toBe(bare.code);
    expect(object.mangleCache).toEqual(bare.mangleCache);
  });

  test("mangleCache lists newly assigned names in assignment order", async () => {
    const { mangleCache } = await build(
      { mangleProps: /_$/ },
      {
        "entry.js": /* js */ `
        let o = { zzz_: 1, yyy_: 2, xxx_: 3 };
        o.yyy_; o.yyy_; o.xxx_;
        console.log(o);
      `,
      },
    );
    expect(Object.entries(mangleCache!)).toEqual([
      ["yyy_", "a"],
      ["xxx_", "b"],
      ["zzz_", "c"],
    ]);
  });

  test("cache pins names, keeps `false` entries and is echoed back first", async () => {
    const { code, mangleCache } = await build({
      mangleProps: { include: /_$/, cache: { foo_: "FOO", bar_: false, unused_: "U" } },
    });
    expect(code).toContain("var o = { FOO: 1, bar_: 2, keep: 3 }");
    expect(code).toContain('console.log(o.FOO, o.bar_, o.keep, o["bar_"])');
    // Input entries come first sorted by key, then the names assigned in this build.
    expect(Object.entries(mangleCache!)).toEqual([
      ["bar_", false],
      ["foo_", "FOO"],
      ["unused_", "U"],
    ]);
  });

  test("a cache target that is not an identifier is printed as a string key", async () => {
    const { code, mangleCache } = await build(
      { mangleProps: { include: /_$/, cache: { foo_: "not-valid" } } },
      {
        "entry.js": /* js */ `
          let o = { foo_: 1, bar_: 2 };
          let { foo_ } = o;
          console.log(o.foo_, o?.foo_, foo_, o.bar_);
        `,
      },
    );
    expect(code).toContain('var o = { "not-valid": 1, a: 2 }');
    expect(code).toContain('var { "not-valid": foo_ } = o');
    expect(code).toContain('console.log(o["not-valid"], o?.["not-valid"], foo_, o.a)');
    expect(mangleCache).toEqual({ foo_: "not-valid", bar_: "a" });
  });

  test("generated names avoid cache targets", async () => {
    const { code, mangleCache } = await build({ mangleProps: { include: /_$/, cache: { unused_: "a" } } });
    expect(code).toContain("var o = { b: 1, c: 2, keep: 3 }");
    expect(mangleCache).toEqual({ unused_: "a", foo_: "b", bar_: "c" });
  });

  test("generated names avoid cache keys", async () => {
    const { code, mangleCache } = await build(
      { mangleProps: { include: /_$/, cache: { b: false, c: "zz" } } },
      {
        "entry.js": /* js */ `
          let o = { foo_: 1, bar_: 2, baz_: 3 };
          console.log(o.foo_, o.bar_, o.baz_);
        `,
      },
    );
    // `b` and `c` are cache keys and `zz` is a cache target, so none of them is generated.
    expect(code).toContain("var o = { a: 1, d: 2, e: 3 }");
    expect(Object.entries(mangleCache!)).toEqual([
      ["b", false],
      ["c", "zz"],
      ["foo_", "a"],
      ["bar_", "d"],
      ["baz_", "e"],
    ]);
  });

  test("mangleCache accepts an index-like key and lists input entries first", async () => {
    const { code, mangleCache } = await build({ mangleProps: { include: /_$/, cache: { "0": "zero", x: false } } });
    expect(code).toContain("var o = { a: 1, b: 2, keep: 3 }");
    expect(mangleCache!["0"]).toBe("zero");
    expect(Object.entries(mangleCache!)).toEqual([
      ["0", "zero"],
      ["x", false],
      ["foo_", "a"],
      ["bar_", "b"],
    ]);
  });

  test("RegExp flags keep their JavaScript meaning", async () => {
    const files = {
      "entry.js": /* js */ `
        let o = { _abc: 1, _ABC: 2, _é: 3, foo_: 4, fxo_: 5 };
        console.log(o._abc, o._ABC, o._é, o.foo_, o.fxo_);
      `,
    };
    const [ignoreCase, unicode, ignoreCaseUnicode, sticky] = await Promise.all([
      build({ mangleProps: /^_[A-Z]+$/i }, files),
      build({ mangleProps: /^_\p{L}+$/u }, files),
      build({ mangleProps: /^FOO_$/iu }, files),
      build({ mangleProps: /_$/y }, files),
    ]);
    expect(ignoreCase.mangleCache).toEqual({ _abc: "a", _ABC: "b" });
    expect(ignoreCase.code).toContain("var o = { a: 1, b: 2, _é: 3, foo_: 4, fxo_: 5 }");
    expect(unicode.mangleCache).toEqual({ _abc: "a", _ABC: "b", _é: "c" });
    expect(unicode.code).toContain("var o = { a: 1, b: 2, c: 3, foo_: 4, fxo_: 5 }");
    expect(ignoreCaseUnicode.mangleCache).toEqual({ foo_: "a" });
    // A sticky pattern only matches at index 0, so `_$` never matches `foo_`.
    expect(sticky.mangleCache).toEqual({});

    // `.` only matches a newline with the `s` flag.
    const newline = {
      "entry.js": /* js */ `
        let o = { "f\\no_": 1, foo_: 2 };
        console.log(o["f\\no_"], o.foo_);
      `,
    };
    const [dotAll, noDotAll] = await Promise.all([
      build({ mangleProps: { include: /^f.o_$/s, quoted: true } }, newline),
      build({ mangleProps: { include: /^f.o_$/, quoted: true } }, newline),
    ]);
    expect(dotAll.mangleCache).toEqual({ "f\no_": "a", foo_: "b" });
    expect(dotAll.code).toContain("var o = { a: 1, b: 2 }");
    expect(noDotAll.mangleCache).toEqual({ foo_: "a" });
    expect(noDotAll.code).toContain('var o = { "f\\no_": 1, a: 2 }');
  });

  test("exclude, reserved and quoted options", async () => {
    const { code, mangleCache } = await build({
      mangleProps: { include: /_$/, exclude: /^foo/, quoted: true },
    });
    expect(code).toContain("var o = { foo_: 1, a: 2, keep: 3 }");
    expect(code).toContain("console.log(o.foo_, o.a, o.keep, o.a)");
    expect(mangleCache).toEqual({ bar_: "a" });

    const reserved = await build({ mangleProps: { include: /_$/, reserved: ["bar_"] } });
    expect(reserved.code).toContain("var o = { a: 1, bar_: 2, keep: 3 }");
    expect(reserved.mangleCache).toEqual({ foo_: "a" });
  });

  test("minify: true alone does not mangle and reports no mangleCache", async () => {
    const { code, mangleCache } = await build(true);
    expect(code).toContain("foo_");
    expect(code).toContain("bar_");
    expect(mangleCache).toBeUndefined();
  });

  test("mangleCache is an empty object when nothing matched", async () => {
    const { code, mangleCache } = await build({ mangleProps: /^nothing-matches$/ });
    expect(code).toContain("foo_");
    expect(mangleCache).toEqual({});
  });

  test.each([
    [{ mangleProps: "x" }, "Expected minify.mangleProps to be a RegExp or an object"],
    [{ mangleProps: 1 }, "Expected minify.mangleProps to be a RegExp or an object"],
    [{ mangleProps: {} }, "Expected minify.mangleProps.include to be a RegExp"],
    [{ mangleProps: { include: "x" } }, "Expected minify.mangleProps.include to be a RegExp"],
    [{ mangleProps: { include: /a/, exclude: "b" } }, "Expected minify.mangleProps.exclude to be a RegExp"],
    [
      { mangleProps: { include: /a/, reserved: "b" } },
      "Expected minify.mangleProps.reserved to be an array of strings",
    ],
    [
      { mangleProps: { include: /a/, reserved: [1] } },
      "Expected minify.mangleProps.reserved to be an array of strings",
    ],
    [{ mangleProps: { include: /a/, quoted: 1 } }, "Expected minify.mangleProps.quoted to be a boolean"],
    [{ mangleProps: { include: /a/, cache: 1 } }, "Expected minify.mangleProps.cache to be an object"],
    [
      { mangleProps: { include: /a/, cache: { k: 1 } } },
      'Expected minify.mangleProps.cache["k"] to be a string or false',
    ],
    [
      { mangleProps: { include: /a/, cache: { k: true } } },
      'Expected minify.mangleProps.cache["k"] to be a string or false',
    ],
    [{ mangleProps: { include: /a/, cache: { k: "" } } }, 'minify.mangleProps.cache["k"] must not be an empty string'],
    [
      { mangleProps: { include: /a/, cache: { k: "constructor" } } },
      'minify.mangleProps.cache["k"] must not be "__proto__", "constructor", or "prototype"',
    ],
    [
      { mangleProps: { include: /a/, cache: { k: "prototype" } } },
      'minify.mangleProps.cache["k"] must not be "__proto__", "constructor", or "prototype"',
    ],
  ])("throws a TypeError for %j", (minify, message) => {
    // The options are validated synchronously, before any entry point is read.
    expect(() => Bun.build({ entrypoints: ["/does/not/matter.js"], minify: minify as any })).toThrow(
      new TypeError(message),
    );
  });
});

describe.concurrent("bun build --mangle-props", () => {
  async function runBuild(args: string[], files: Record<string, string>) {
    using dir = tempDir("mangle-props-cli", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, dir: String(dir) };
  }

  const entry = /* js */ `
    let o = { foo_: 1, keepMe_: 2, "quoted_": 3 };
    console.log(o.foo_, o.keepMe_, o["quoted_"]);
  `;

  test("end to end with --reserve-props and --mangle-quoted", async () => {
    using dir = tempDir("mangle-props-cli-e2e", { "entry.js": entry });
    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "./entry.js",
        "--mangle-props=_$",
        "--reserve-props=^keep",
        "--mangle-quoted",
        "--outfile=out.js",
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildStdout, buildStderr, buildExit] = await Promise.all([
      build.stdout.text(),
      build.stderr.text(),
      build.exited,
    ]);
    expect(buildStderr).toBe("");
    expect(buildExit).toBe(0);
    const code = await Bun.file(path.join(String(dir), "out.js")).text();
    expect(code).toContain("var o = { a: 1, keepMe_: 2, b: 3 }");
    expect(code).toContain("console.log(o.a, o.keepMe_, o.b)");

    await using run = Bun.spawn({
      cmd: [bunExe(), "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(stdout).toBe("1 2 3\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("--mangle-props without --mangle-quoted keeps quoted names", async () => {
    const { stdout, stderr, exitCode } = await runBuild(["./entry.js", "--mangle-props=_$"], { "entry.js": entry });
    expect(stdout).toContain("var o = { a: 1, b: 2, quoted_: 3 }");
    expect(stdout).toContain('console.log(o.a, o.b, o["quoted_"])');
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.each([
    [["--mangle-props=["], '--mangle-props expects a valid regular expression but received "["'],
    [["--mangle-props=(foo"], '--mangle-props expects a valid regular expression but received "(foo"'],
    [["--mangle-props="], "--mangle-props expects a regular expression but received an empty string"],
    [["--mangle-props=_$", "--reserve-props=["], '--reserve-props expects a valid regular expression but received "["'],
    [
      ["--mangle-props=_$", "--reserve-props="],
      "--reserve-props expects a regular expression but received an empty string",
    ],
    [["--reserve-props=_"], "--reserve-props requires --mangle-props"],
    [["--mangle-quoted"], "--mangle-quoted requires --mangle-props"],
    [["--mangle-props=_$", "--no-bundle"], "--mangle-props requires bundling and cannot be combined with --no-bundle"],
  ])("%j fails with %s", async (args, message) => {
    const { stdout, stderr, exitCode } = await runBuild(["./entry.js", ...args], { "entry.js": entry });
    expect(stderr).toContain(message);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });
});
