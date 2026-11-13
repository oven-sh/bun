import { describe, expect } from "bun:test";
import { readdirSync } from "fs";
import { itBundled } from "./expectBundled";

// Directive prologues: `"use strict"`, `"use client"`, and friends at the top
// of a module or a function body.
describe("bundler", () => {
  // A strict function throws on an assignment to an undeclared name and gets
  // `undefined` as `this` when called without a receiver. The probes are
  // CommonJS (`module.exports`) so that the module itself is sloppy and only
  // the directives make code strict. An ES module is strict everywhere.
  const strictProbe = /* js */ `
    function f() { "use strict"; try { undeclared123 = 1; return "sloppy" } catch { return "strict" } }
    function g() { "use strict"; return this === undefined }
    console.log(f(), g());
    module.exports = f;
  `;

  itBundled("directive/FunctionLevelUseStrictNoBundle", {
    files: {
      "/entry.cjs": strictProbe,
    },
    bundling: false,
    onAfterBundle(api) {
      expect(api.readFile("/out.js").match(/"use strict";/g)).toHaveLength(2);
    },
    run: { stdout: "strict true" },
  });

  itBundled("directive/FunctionLevelUseStrictBundle", {
    files: {
      "/entry.js": strictProbe,
    },
    format: "cjs",
    onAfterBundle(api) {
      expect(api.readFile("/out.js").match(/"use strict";/g)).toHaveLength(2);
    },
    run: { runtime: "node", stdout: "strict true" },
  });

  itBundled("directive/FunctionLevelUseStrictBundleMinify", {
    files: {
      "/entry.js": strictProbe,
    },
    format: "cjs",
    minifySyntax: true,
    minifyWhitespace: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js").match(/"use strict";/g)).toHaveLength(2);
    },
    run: { runtime: "node", stdout: "strict true" },
  });

  itBundled("directive/ArrowAndMethodBodies", {
    files: {
      "/entry.cjs": /* js */ `
        const arrow = () => { "use strict"; try { undeclared123 = 1; return "sloppy" } catch { return "strict" } };
        const obj = { method() { "use strict"; return this } };
        class A { static m() { "use strict"; return this } }
        console.log(arrow(), obj.method.call(undefined), A.m.call(undefined));
        module.exports = A;
      `,
    },
    bundling: false,
    onAfterBundle(api) {
      expect(api.readFile("/out.js").match(/"use strict";/g)).toHaveLength(3);
    },
    run: { stdout: "strict undefined undefined" },
  });

  itBundled("directive/TopLevelUseStrictNoBundle", {
    files: {
      "/entry.cjs": /* js */ `
        "use strict";
        function f() { return typeof this }
        console.log(f());
        module.exports = f;
      `,
    },
    bundling: false,
    onAfterBundle(api) {
      api.expectFile("/out.js").toStartWith('"use strict";\n');
    },
    run: { stdout: "undefined" },
  });

  // The JSX runtime import is injected at the top of the file. The directive
  // prologue still has to come before it.
  // https://github.com/oven-sh/bun/issues/6854
  itBundled("directive/DirectivesBeforeInjectedImportsNoBundle", {
    files: {
      "/entry.jsx": /* jsx */ `
        "use client";
        "use strict";
        export const X = () => <div />;
      `,
    },
    bundling: false,
    onAfterBundle(api) {
      api.expectFile("/out.js").toStartWith('"use client";\n"use strict";\nimport ');
    },
  });

  // An escaped "use strict" is not a Use Strict Directive. It does not end the
  // prologue either: the directives after it are still hoisted.
  itBundled("directive/EscapedUseStrictKeepsThePrologueNoBundle", {
    files: {
      "/entry.jsx": /* jsx */ `
        "use\\x20strict";
        "use client";
        export const X = () => <div />;
      `,
    },
    bundling: false,
    onAfterBundle(api) {
      api.expectFile("/out.js").toStartWith('"use client";\nimport ');
      api.expectFile("/out.js").not.toContain("use strict");
    },
  });

  itBundled("directive/DirectivesAtEntryChunkTop", {
    files: {
      "/entry.jsx": /* jsx */ `
        "use client";
        import { foo } from "./foo";
        export const X = () => <div>{foo}</div>;
      `,
      "/foo.js": `export const foo = 1;`,
    },
    external: ["react/jsx-dev-runtime"],
    onAfterBundle(api) {
      api.expectFile("/out.js").toStartWith('"use client";\n');
    },
  });

  // Minification used to drop every directive that is not "use strict".
  itBundled("directive/UseClientMinify", {
    files: {
      "/entry.js": /* js */ `
        "use client";
        export const x = 1;
      `,
    },
    minifySyntax: true,
    minifyWhitespace: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").toStartWith('"use client";var ');
    },
  });

  itBundled("directive/MultipleDirectivesNoBundle", {
    files: {
      "/entry.js": /* js */ `
        // A comment before the prologue does not end it
        "use strict";
        /* neither does a block comment */
        'use client';
        "use strict";
        console.log("body");
      `,
    },
    bundling: false,
    onAfterBundle(api) {
      // Each directive is printed, a repeated one too.
      api.expectFile("/out.js").toStartWith('"use strict";\n"use client";\n"use strict";\nconsole.log("body");\n');
    },
    run: { stdout: "body" },
  });

  itBundled("directive/MultipleDirectivesMinifyNoBundle", {
    files: {
      "/entry.js": /* js */ `
        'use strict'
        'use loose'
        console.log("body")
      `,
    },
    bundling: false,
    minifySyntax: true,
    minifyWhitespace: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").toStartWith('"use strict";"use loose";console.log("body");');
    },
  });

  itBundled("directive/UseAsmIsRemoved", {
    files: {
      "/entry.js": /* js */ `
        "use asm";
        function f() { "use asm"; return 1 }
        console.log(f());
      `,
    },
    bundling: false,
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("use asm");
    },
    run: { stdout: "1" },
  });

  // A template literal is never a directive, and a string statement that
  // follows a non-directive statement is not one either.
  itBundled("directive/NonDirectiveStrings", {
    files: {
      "/entry.cjs": /* js */ `
        function tpl() { \`use strict\`; return typeof this }
        function late() { var x = 1; "use strict"; return typeof this }
        console.log(tpl(), late());
        module.exports = tpl;
      `,
    },
    bundling: false,
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain('"use strict"');
    },
    run: { stdout: "object object" },
  });

  // A Use Strict Directive is spelled without escape sequences, and a
  // parenthesized string is not a directive at all: it ends the prologue. Node
  // runs both functions sloppy and accepts the non-simple parameter list.
  itBundled("directive/EscapedOrParenthesizedUseStrict", {
    files: {
      "/entry.cjs": /* js */ `
        function escaped(a = 1) { "use\\x20strict"; return typeof this }
        function unicode() { '\\u0075se strict'; return typeof this }
        function paren(a = 1) { ("use strict"); return typeof this }
        function after(a = 1) { ("first"); "use strict"; return typeof this }
        console.log(escaped(), unicode(), paren(), after());
        module.exports = after;
      `,
    },
    bundling: false,
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("use strict");
    },
    run: { stdout: "object object object object" },
  });

  // Only a module or function body has a directive prologue. A string at the
  // start of a block is an expression statement and does not switch the
  // enclosing scope to strict mode.
  itBundled("directive/StringInBlockIsNotADirective", {
    files: {
      "/entry.cjs": /* js */ `
        { 'use strict'; var yield = 1 }
        if (1) { 'use strict'; var implements = 2 }
        try { 'use strict'; var interface = 3 } finally { 'use strict'; var package = 4 }
        class A { static { "use strict"; } }
        console.log(yield, implements, interface, package, typeof A);
        module.exports = A;
      `,
    },
    bundling: false,
    run: { stdout: "1 2 3 4 function" },
  });

  itBundled("directive/UseStrictWithNonSimpleParameterList", {
    files: {
      "/entry.js": /* js */ `
        function f(a = 1) { "use strict"; return a }
      `,
    },
    bundleErrors: {
      "/entry.js": ['Cannot use a "use strict" directive in a function with a non-simple parameter list'],
    },
  });

  itBundled("directive/UseStrictAppliesToParameters", {
    files: {
      "/entry.js": /* js */ `
        function f(arguments) { "use strict"; }
      `,
    },
    bundleErrors: {
      "/entry.js": ['Declarations with the name "arguments" cannot be used in strict mode'],
    },
  });

  // The directive inside the wrapper keeps its location, so it maps back to
  // the source like any other statement: the `EAAA` segment on generated
  // line 5 is `"use strict"` (column 2) mapped to a.cjs line 1, column 0.
  itBundled("directive/WrappedDirectiveSourceMap", {
    files: {
      "/entry.js": /* js */ `
        console.log(require("./a.cjs"));
      `,
      "/a.cjs": /* js */ `
        "use strict";
        module.exports = (function () { return typeof this })();
      `,
    },
    format: "cjs",
    outdir: "/out",
    sourceMap: "external",
    snapshotSourceMap: {
      "entry.js.map": {
        files: ["../a.cjs", "../entry.js"],
        mappingsExactMatch:
          ";;;;EAAA;AAAA,EACA,QAAO,UAAW,QAAS,GAAG;AAAA,IAAE,OAAO,OAAO;AAAA,IAAQ;AAAA;;;ACDtD,QAAQ,IAAI,WAAkB;",
      },
    },
  });

  // The prologue has to come before the `init_*()` calls that the linker
  // inserts for the module's dependencies.
  itBundled("directive/WrappedESMFileDirectivesBeforeDependencies", {
    files: {
      "/entry.js": /* js */ `
        const a = require("./a.mjs");
        console.log(a.x);
      `,
      "/a.mjs": /* js */ `
        "use strict";
        "use other";
        import { b } from "./b.mjs";
        export const x = b + 1;
      `,
      "/b.mjs": /* js */ `
        export const b = 1;
        console.log("b side effect");
      `,
    },
    format: "cjs",
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toMatch(/__esm\(\(\) => \{\n\s*"use strict";\n\s*"use other";\n\s*init_b\(\);/);
    },
    run: { stdout: "b side effect\n2" },
  });

  // A transform that adds a statement to a function body puts it after the
  // prologue. A directive that follows another statement is no directive.
  itBundled("directive/TypeScriptConstructorKeepsThePrologueFirst", {
    files: {
      "/entry.ts": /* ts */ `
        export class A {
          constructor(public x: number, private y = 2) {
            "use other";
            console.log(this.x);
          }
        }
        export class B extends Object {
          constructor(public x: number) {
            "use other";
            super();
          }
        }
      `,
    },
    bundling: false,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain('constructor(x, y = 2) {\n    "use other";\n    this.x = x;\n    this.y = y;');
      expect(out).toContain('constructor(x) {\n    "use other";\n    super();\n    this.x = x;');
    },
  });

  itBundled("directive/LoweredClassFieldsKeepThePrologueFirst", {
    files: {
      "/entry.ts": /* ts */ `
        function dec(...args: any[]): any {}
        export class C {
          x = 1;
          @dec y = 2;
          constructor() {
            "use other";
            console.log(this.x);
          }
        }
      `,
      "/tsconfig.json": JSON.stringify({
        compilerOptions: { useDefineForClassFields: false, experimentalDecorators: true },
      }),
    },
    bundling: false,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain('constructor() {\n    "use other";\n    this.x = 1;\n    this.y = 2;');
    },
  });

  itBundled("directive/StandardDecoratorsKeepThePrologueFirst", {
    files: {
      "/entry.js": /* js */ `
        function dec(value, context) {}
        // The temporaries of a decorated class expression are declared in the function around it.
        export function make() {
          "use other";
          return @dec class K { @dec m() {} };
        }
        // The initializers of decorated fields run at the start of a constructor without super().
        export class D {
          @dec f = 2;
          constructor() {
            "use other";
            console.log(1);
          }
        }
        // The receiver of a lowered private call is captured in a temporary of the function.
        export class Q {
          @dec #m() { return 1 }
          static call(get) {
            "use other";
            return get().#m();
          }
        }
      `,
    },
    bundling: false,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatch(/function make\(\) \{\n  "use other";\n  var /);
      expect(out).toMatch(/constructor\(\) \{\n    "use other";\n    __runInitializers/);
      expect(out).toMatch(/\(get\) \{\n    "use other";\n    var _obj/);
    },
  });

  itBundled("directive/ReactFastRefreshKeepsThePrologueFirst", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { useState } from "react";
        export function Outer() {
          "use other";
          const [a] = useState(0);
          const Inner = () => { "use inner"; const [b] = useState(1); return b };
          return a + Inner();
        }
      `,
    },
    reactFastRefresh: true,
    external: ["react", "react-refresh/runtime"],
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatch(/function Outer\(\) \{\n  "use other";\n  _s\(\);/);
      expect(out).toMatch(/\(\) => \{\n    "use inner";\n    _s2\(\);/);
    },
  });

  // The linker prints the prologue of the entry point of a chunk, and of a
  // wrapped file inside its wrapper. A file that is inlined into the chunk has
  // no place for its own: it is not printed, as in esbuild.
  // https://github.com/oven-sh/bun/issues/6854
  itBundled("directive/DependencyDirectiveIsNotPrinted", {
    files: {
      "/entry.js": /* js */ `
        export { Button } from "./button.js";
      `,
      "/button.js": /* js */ `
        "use client";
        export function Button() { return "button" }
      `,
    },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).not.toContain("use client");
    },
  });

  itBundled("directive/EntryAndDependencyDirectivePrintedOnce", {
    files: {
      "/entry.js": /* js */ `
        "use client";
        export { Button } from "./button.js";
      `,
      "/button.js": /* js */ `
        "use client";
        export function Button() { return "button" }
      `,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toStartWith('"use client";\n');
      expect(out.split('"use client"')).toHaveLength(2);
    },
  });

  // With code splitting each chunk starts with the prologue of its own entry
  // point, and the shared chunk has no entry point.
  itBundled("directive/SplittingEntryChunksKeepTheirPrologue", {
    files: {
      "/a.js": /* js */ `
        "use client";
        import { shared } from "./shared.js";
        console.log("a", shared);
      `,
      "/b.js": /* js */ `
        "use server";
        import { shared } from "./shared.js";
        console.log("b", shared);
      `,
      "/shared.js": /* js */ `
        "use shared";
        export const shared = globalThis.shared ??= {};
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    splitting: true,
    onAfterBundle(api) {
      expect(api.readFile("/out/a.js")).toStartWith('"use client";\n');
      expect(api.readFile("/out/b.js")).toStartWith('"use server";\n');
      const shared = readdirSync(api.outdir).find(file => file !== "a.js" && file !== "b.js" && file.endsWith(".js"))!;
      expect(api.readFile("/out/" + shared)).not.toContain("use shared");
    },
    run: [
      { file: "/out/a.js", stdout: "a {}" },
      { file: "/out/b.js", stdout: "b {}" },
    ],
  });

  itBundled("directive/SplittingDynamicImportChunkKeepsItsPrologue", {
    files: {
      "/entry.js": /* js */ `
        "use client";
        import("./lazy.js").then(lazy => console.log(lazy.value));
      `,
      "/lazy.js": /* js */ `
        "use lazy";
        export const value = "lazy";
      `,
    },
    outdir: "/out",
    splitting: true,
    onAfterBundle(api) {
      expect(api.readFile("/out/entry.js")).toStartWith('"use client";\n');
      const lazy = readdirSync(api.outdir).find(file => file.startsWith("lazy-"))!;
      expect(api.readFile("/out/" + lazy)).toStartWith('"use lazy";\n');
    },
    run: { file: "/out/entry.js", stdout: "lazy" },
  });

  // The lowering of "using" moves the statements of a body into a try block.
  // The prologue stays in front of it.
  itBundled("directive/LoweredUsingKeepsThePrologueFirst", {
    files: {
      "/entry.cjs": /* js */ `
        function f() {
          "use strict";
          using resource = { [Symbol.dispose]() {} };
          return this === undefined;
        }
        console.log(f());
      `,
    },
    target: "node",
    format: "cjs",
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toMatch(/function f\(\) \{\n\s*"use strict";/);
    },
    run: { runtime: "node", stdout: "true" },
  });

  itBundled("directive/TargetBunCJSEntry", {
    files: {
      "/entry.js": /* js */ `
        "use strict";
        function f() { return typeof this }
        console.log(f());
      `,
    },
    target: "bun",
    format: "cjs",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('(function(exports, require, module, __filename, __dirname) {"use strict";');
    },
    run: { stdout: "undefined" },
  });

  // The dev server output is a registry of module closures. Each closure starts
  // with its own module's prologue, and the chunk itself gets no copy: a
  // chunk-level directive would apply to every module in the registry.
  itBundled("directive/DevServerModuleClosures", {
    files: {
      "/entry.js": /* js */ `
        "use strict";
        "use potato";
        import { x } from "./dep.js";
        console.log(x);
      `,
      "/dep.js": /* js */ `
        "use tomato";
        export const x = 1;
      `,
    },
    format: "internal_bake_dev",
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toMatch(/\{\s*"use strict";\s*"use potato";/);
      expect(out).toMatch(/\{\s*"use tomato";/);
      expect(out).not.toStartWith('"use strict"');
    },
  });
});
