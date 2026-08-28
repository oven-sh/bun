import { describe, expect } from "bun:test";
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
    run: { stdout: "strict true" },
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
    run: { stdout: "strict true" },
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
      // Duplicates are removed
      api.expectFile("/out.js").toStartWith('"use strict";\n"use client";\nconsole.log("body");\n');
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

  // Only a module or function body has a directive prologue. A string at the
  // start of a block is an expression statement and does not switch the
  // enclosing scope to strict mode.
  itBundled("directive/StringInBlockIsNotADirective", {
    files: {
      "/entry.cjs": /* js */ `
        { 'use strict'; var eval = 1 }
        if (1) { 'use strict'; eval = 2 }
        class A { static { "use strict"; } }
        console.log(eval, typeof A);
        module.exports = A;
      `,
    },
    bundling: false,
    run: { stdout: "2 function" },
  });

  itBundled("directive/SloppyAssignmentToEvalAndArguments", {
    files: {
      "/entry.cjs": /* js */ `
        eval = 1;
        function f() { arguments = 2; return arguments }
        console.log(eval, f());
        module.exports = f;
      `,
    },
    bundling: false,
    run: { stdout: "1 2" },
  });

  itBundled("directive/StrictAssignmentToEvalIsAnError", {
    files: {
      "/entry.js": /* js */ `
        "use strict";
        eval = 1;
      `,
    },
    bundling: false,
    bundleErrors: {
      "/entry.js": ["Invalid assignment target"],
    },
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

  itBundled("directive/LegacyOctalLiteralInStrictFunction", {
    files: {
      "/entry.js": /* js */ `
        function h() { "use strict"; return 010 }
      `,
    },
    bundleErrors: {
      "/entry.js": ["Legacy octal literals cannot be used in strict mode"],
    },
  });

  itBundled("directive/LegacyOctalLiteralInSloppyFunction", {
    files: {
      "/entry.cjs": /* js */ `
        function h() { return 010 }
        console.log(h(), { 010: "key" }[8]);
        module.exports = h;
      `,
    },
    bundling: false,
    run: { stdout: "8 key" },
  });

  // A wrapped CommonJS file that ends up in the entry chunk keeps its
  // file-level directive inside the wrapper.
  itBundled("directive/WrappedCJSFileInEntryChunk", {
    files: {
      "/entry.js": /* js */ `
        console.log(require("./a.cjs"));
      `,
      "/a.cjs": /* js */ `
        "use strict";
        function f() { return typeof this }
        module.exports = f();
      `,
    },
    format: "cjs",
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toMatch(/__commonJS\(\(?function\([^)]*\) \{\n\s*"use strict";/);
    },
    run: { stdout: "undefined" },
  });

  // All ES modules are strict, so the directive is redundant there.
  itBundled("directive/WrappedCJSFileInESMOutput", {
    files: {
      "/entry.js": /* js */ `
        console.log(require("./a.cjs"));
      `,
      "/a.cjs": /* js */ `
        "use strict";
        function f() { return typeof this }
        module.exports = f();
      `,
    },
    format: "esm",
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain('"use strict"');
    },
    run: { stdout: "undefined" },
  });

  // An entry point that another entry point requires is wrapped inside the
  // other chunk. There it is a dependency and keeps its directive inside the
  // wrapper. In its own chunk the directive is at the top.
  itBundled("directive/EntryPointWrappedInsideOtherEntryPoint", {
    files: {
      "/a.cjs": /* js */ `
        console.log("a", require("./b.cjs"));
      `,
      "/b.cjs": /* js */ `
        "use strict";
        module.exports = (function () { return typeof this })();
        console.log("b", module.exports);
      `,
    },
    entryPoints: ["/a.cjs", "/b.cjs"],
    outdir: "/out",
    outputPaths: ["/out/a.js", "/out/b.js"],
    format: "cjs",
    onAfterBundle(api) {
      expect(api.readFile("/out/a.js")).toMatch(/__commonJS\(\(?function\([^)]*\) \{\n\s*"use strict";/);
      api.expectFile("/out/a.js").not.toStartWith('"use strict"');
      api.expectFile("/out/b.js").toStartWith('"use strict";\n');
    },
    run: [
      { file: "/out/a.js", stdout: "b undefined\na undefined" },
      { file: "/out/b.js", stdout: "b undefined" },
    ],
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
});
