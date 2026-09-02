import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

const fakeReactNodeModules = {
  "/node_modules/react/index.js": /* js */ `
    module.exports = { react: "react" }
  `,
  "/node_modules/react/package.json": /* json */ `
    {
      "name": "react",
      "version": "2.0.0",
      "main": "index.js"
    }
  `,
};

describe("bundler", () => {
  itBundled("cjs2esm/ModuleExportsFunction", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo());
      `,
      "/node_modules/lib/index.js": /* js */ `
        module.exports.foo = function() {
          return 'foo';
        }
      `,
    },
    cjs2esm: true,
    run: {
      stdout: "foo",
    },
  });
  itBundled("cjs2esm/ImportNamedFromExportStarCJSModuleRef", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from './foo';
        console.log(foo);
      `,
      "/foo.js": /* js */ `
        export * from './bar.cjs';
      `,
      "/bar.cjs": /* js */ `
        module.exports.foo = 'bar';
      `,
    },
    run: {
      stdout: "bar",
    },
  });
  itBundled("cjs2esm/ImportNamedFromExportStarCJS", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from './foo';
        console.log(foo);
      `,
      "/foo.js": /* js */ `
        export * from './bar.cjs';
      `,
      "/bar.cjs": /* js */ `
        exports.foo = 'bar';
      `,
    },
    run: {
      stdout: "bar",
    },
  });
  itBundled("cjs2esm/BadNamedImportNamedReExportedFromCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import {bad} from './foo';
        console.log(bad);
      `,
      "/foo.js": /* js */ `
        export {bad} from './bar.cjs';
      `,
      "/bar.cjs": /* js */ `
        exports.foo = 'bar';
      `,
    },
    run: {
      stdout: "undefined",
    },
  });
  itBundled("cjs2esm/ExportsFunction", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo());
      `,
      "/node_modules/lib/index.js": /* js */ `
        exports.foo = function() {
          return 'foo';
        }
      `,
    },
    cjs2esm: true,
    run: {
      stdout: "foo",
    },
  });
  itBundled("cjs2esm/ModuleExportsFunctionTreeShaking", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo());
      `,
      "/node_modules/lib/index.js": /* js */ `
        module.exports.foo = function() {
          return 'foo';
        }
        module.exports.bar = function() {
          return 'remove_me';
        }
      `,
    },
    cjs2esm: true,
    dce: true,
    treeShaking: true,
    run: {
      stdout: "foo",
    },
  });
  itBundled("cjs2esm/ModuleExportsEqualsRequire", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo);
      `,
      "/node_modules/lib/index.js": /* js */ `
        // bundler should see through this
        module.exports = require('./library.js')
      `,
      "/node_modules/lib/library.js": /* js */ `
        module.exports.foo = 'bar';
      `,
    },
    cjs2esm: true,
    run: {
      stdout: "bar",
    },
  });
  // The same file as an entry point is a module in its own right, not only a redirect for its importers.
  itBundled("cjs2esm/ModuleExportsEqualsRequireEntryPoint", {
    files: {
      "/entry.cjs": /* js */ `
        /*! banner */
        "use strict";
        module.exports = require('./library.js')
      `,
      "/library.js": /* js */ `
        module.exports = { foo: 'bar' };
      `,
      "/user.mjs": /* js */ `
        import lib from './out.js';
        console.log(lib.foo, require('./out.js').default.foo);
      `,
    },
    outfile: "/out.js",
    run: { file: "/user.mjs", stdout: "bar bar" },
  });
  // An entry point that another entry point imports: still a module of its own (parsed once, as an entry point),
  // and the importer links to it rather than past it.
  itBundled("cjs2esm/ModuleExportsEqualsRequireEntryPointImportedByEntryPoint", {
    files: {
      "/a.js": /* js */ `
        import lib from './b.js';
        console.log('a', lib.foo);
      `,
      "/b.js": /* js */ `
        module.exports = require('./library.js')
      `,
      "/library.js": /* js */ `
        module.exports = { foo: 'bar' };
      `,
      "/user.mjs": /* js */ `
        await import('./out/a.js');
        const b = await import('./out/b.js');
        console.log('b', b.default.foo);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    run: { file: "/user.mjs", stdout: "a bar\nb bar" },
  });
  itBundled("cjs2esm/ModuleExportsEqualsRequireEntryPointImportedByEntryPointSplitting", {
    files: {
      "/a.js": /* js */ `
        import lib from './b.js';
        console.log('a', lib.foo);
      `,
      "/b.js": /* js */ `
        module.exports = require('./library.js')
      `,
      "/library.js": /* js */ `
        module.exports = { foo: 'bar' };
      `,
      "/user.mjs": /* js */ `
        await import('./out/a.js');
        const b = await import('./out/b.js');
        console.log('b', b.default.foo);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    splitting: true,
    run: { file: "/user.mjs", stdout: "a bar\nb bar" },
  });
  // Two re-export-only entry points over the same target: two modules, one shared target.
  itBundled("cjs2esm/ModuleExportsEqualsRequireTwoEntryPoints", {
    files: {
      "/a.js": `module.exports = require('./library.js')`,
      "/b.js": `module.exports = require('./library.js')`,
      "/library.js": `module.exports = { foo: 'bar' };`,
      "/user.mjs": /* js */ `
        const [a, b] = await Promise.all([import('./out/a.js'), import('./out/b.js')]);
        console.log(a.default.foo, b.default.foo);
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    run: { file: "/user.mjs", stdout: "bar bar" },
  });
  itBundled("cjs2esm/ModuleExportsBasedOnNodeEnvProduction", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo);
      `,
      "/node_modules/lib/index.js": /* js */ `
        // bundler should see through this
        if (process.env.NODE_ENV === 'production') {
          module.exports = require('./library.prod.js')
        } else {
          module.exports = require('./library.dev.js')
        }
      `,
      "/node_modules/lib/library.prod.js": /* js */ `
        module.exports.foo = 'production';
      `,
      "/node_modules/lib/library.dev.js": /* js */ `
        module.exports.foo = 'FAILED';
      `,
    },
    cjs2esm: true,
    minifySyntax: true,
    env: {
      NODE_ENV: "production",
    },
    run: {
      stdout: "production",
    },
  });
  itBundled("cjs2esm/ModuleExportsBasedOnNodeEnvDevelopment", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo);
      `,
      "/node_modules/lib/index.js": /* js */ `
        if (process.env.NODE_ENV === 'production') {
          module.exports = require('./library.prod.js')
        } else {
          module.exports = require('./library.dev.js')
        }
      `,
      "/node_modules/lib/library.prod.js": /* js */ `
        module.exports.foo = 'FAILED';
      `,
      "/node_modules/lib/library.dev.js": /* js */ `
        module.exports.foo = 'development';
      `,
    },
    cjs2esm: true,
    minifySyntax: true,
    env: {
      NODE_ENV: "development",
    },
    run: {
      stdout: "development",
    },
  });
  itBundled("cjs2esm/ModuleExportsEqualsRuntimeCondition", {
    files: {
      "/entry.js": /* js */ `
        import { foo } from 'lib';
        console.log(foo);
      `,
      "/node_modules/lib/index.js": /* js */ `
        // if the branch is unknown, we have to include both.
        if (globalThis.USE_PROD) {
          module.exports = require('./library.prod.js')
        } else {
          module.exports = require('./library.dev.js')
        }
      `,
      // these should have the cjs transform
      "/node_modules/lib/library.prod.js": /* js */ `
        module.exports.foo = 'production';
      `,
      "/node_modules/lib/library.dev.js": /* js */ `
        module.exports.foo = 'development';
      `,
    },
    cjs2esm: {
      unhandled: [
        "/node_modules/lib/index.js",
        "/node_modules/lib/library.prod.js",
        "/node_modules/lib/library.dev.js",
      ],
    },
    run: {
      stdout: "development",
    },
  });
  itBundled("cjs2esm/UnwrappedModuleRequireAssigned", {
    files: {
      "/entry.js": /* js */ `
        const react = require("react");
        console.log(react.react);

        const react1 = (console.log(require("react").react), require("react"));
        console.log(react1.react);

        const react2 = (require("react"), console.log(require("react").react));
        console.log(react2);

        let x = {};
        x.react = require("react");
        console.log(x.react.react);

        console.log(require("react").react);

        let y = {};
        y[require("react")] = require("react");
        console.log(y[require("react")].react);

        let r = require("react");
        console.log(r.react);
        r = require("react");
        console.log(r.react);

        let n = 1;
        n = require("react");
        console.log(n.react);

        let m = 1,
          o = require("react");
        console.log(m, o.react);

        let h = Math.random() > 0.5;
        let p = require(h ? "react" : "react");
        console.log(p.react);

        console.log(require(h ? "react" : "react").react);
      `,
      ...fakeReactNodeModules,
    },
    onAfterBundle: api => {
      const code = api.readFile("out.js");
      expect(code).toContain("__toESM(");
    },
    run: {
      stdout: "react\nreact\nreact\nreact\nundefined\nreact\nreact\nreact\nreact\nreact\nreact\n1 react\nreact\nreact",
    },
  });
  // A require() of an unwrapped package that initializes a destructuring
  // declaration is kept as a require expression that remembers it was
  // unwrapped, and prints as the namespace object. One inside try/catch is
  // never unwrapped and prints as an ordinary require.
  itBundled("cjs2esm/UnwrappedModuleRequireDestructuredAndInTry", {
    files: {
      "/entry.js": /* js */ `
        const { react: named } = require("react");
        console.log(named);

        let inTry = "missing";
        try {
          inTry = require("react").react;
        } catch {}
        console.log(inTry);
      `,
      "/node_modules/react/index.js": /* js */ `
        exports.react = "react";
      `,
      "/node_modules/react/package.json": /* json */ `
        {
          "name": "react",
          "version": "2.0.0",
          "main": "index.js"
        }
      `,
    },
    onAfterBundle: api => {
      const code = api.readFile("out.js");
      expect(code).toMatch(/\{ react: named \} = \(?exports_react\)?;/);
      expect(code).toContain("__toCommonJS(exports_react)).react");
    },
    run: {
      stdout: "react\nreact",
    },
  });
  itBundled("cjs2esm/ReactSpecificUnwrapping", {
    files: {
      "/entry.js": /* js */ `
        import { renderToReadableStream } from "react";
        console.log(renderToReadableStream());
      `,
      "/node_modules/react/index.js": /* js */ `
        console.log('side effect');
        module.exports = require('./main');
      `,
      "/node_modules/react/main.js": /* js */ `
        "use strict";
        var REACT_ELEMENT_TYPE = Symbol.for("pass");
        exports.renderToReadableStream = (e, t) => {
          return REACT_ELEMENT_TYPE;
        }
      `,
    },
    run: {
      stdout: "side effect\nSymbol(pass)",
    },
    minifySyntax: true,
  });
  itBundled("cjs2esm/ReactSpecificUnwrapping2", {
    files: {
      "/entry.js": /* js */ `
        import * as react from "react-dom";
        console.log(react);
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        export const stuff = [
          require('./a.js'),
          require('./b.js')
        ];
      `,
      "/node_modules/react-dom/a.js": /* js */ `
        (function () {
          var React = require('react');
          var stream = require('stream');

          console.log([React, stream]);

          exports.version = null;
        })();
      `,
      "/node_modules/react-dom/b.js": /* js */ `
        (function () {
          var React = require('react');
          var util = require('util');

          console.log([React, util]);

          exports.version = null;
        })();
      `,
      "/node_modules/react/index.js": /* js */ `
        module.exports = 123;
      `,
    },
    run: true,
    minifyIdentifiers: true,
    target: "bun",
  });
  itBundled("cjs2esm/ModuleExportsRenamingNoDeopt", {
    files: {
      "/entry.js": /* js */ `
        eval('exports = { xyz: 123 }; module.exports = { xyz: 456 }');
        let w = () => [module.exports, module.exports.xyz]; // rewrite to exports, exports.xyz
        let x = () => [exports, exports.xyz];               // keep as is
        console.log(JSON.stringify([w(), x()]));
      `,
    },
    run: {
      stdout: '[[{"xyz":123},123],[{"xyz":123},123]]',
    },
  });
  itBundled("cjs2esm/ModuleExportsRenamingAssignDeOpt", {
    files: {
      "/entry.js": /* js */ `
        eval('exports = { xyz: 123 }');
        let w = () => [module.exports, module.exports.xyz]; // keep as is
        let x = () => [exports, exports.xyz];               // keep as is
        module.exports = { xyz: 456 };
        let y = () => [module.exports, module.exports.xyz]; // keep as is
        let z = () => [exports, exports.xyz];               // keep as is
        console.log(JSON.stringify([w(), x(), y(), z()]));
      `,
    },
    run: {
      stdout: '[[{"xyz":456},456],[{"xyz":123},123],[{"xyz":456},456],[{"xyz":123},123]]',
    },
  });
  itBundled("cjs2esm/ModuleExportsRenamingAssignExportsDeOpt", {
    files: {
      "/entry.js": /* js */ `
        eval('module.exports = { xyz: 456 }');
        let w = () => [module.exports, module.exports.xyz];
        let x = () => [exports, exports.xyz];
        exports = { xyz: 123 };
        let y = () => [module.exports, module.exports.xyz];
        let z = () => [exports, exports.xyz];
        console.log(JSON.stringify([w(), x(), y(), z()]));
      `,
    },
    run: {
      stdout: '[[{"xyz":456},456],[{"xyz":123},123],[{"xyz":456},456],[{"xyz":123},123]]',
    },
  });
  // `delete (null ?? exports.a)` evaluates to a value, so the result is `true`
  // with no effect on the property. Under cjs2esm, `exports.a` is rewritten to
  // an `ECommonjsExportIdentifier`; the printer has to re-wrap it as `(0, ...)`
  // so `delete` still sees a value instead of the hoisted binding.
  itBundled("cjs2esm/DeleteFoldedExportsPropertyRef", {
    files: {
      "/entry.js": /* js */ `
        exports.a = 1;
        console.log(delete (null ?? exports.a), exports.a);
        console.log(delete (0, exports.a), exports.a);
      `,
    },
    onAfterBundle: api => {
      const code = api.readFile("out.js");
      expect(code).not.toMatch(/^[^"]*delete\s+\$a\b/m);
    },
    run: { stdout: "true 1\ntrue 1" },
  });
  itBundled("cjs2esm/DeleteFoldedExportsPropertyRefConsumer", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "./lib.js";
        console.log(a);
      `,
      "/lib.js": /* js */ `
        exports.a = 1;
        console.log(delete (null ?? exports.a), exports.a);
      `,
    },
    run: { stdout: "true 1\n1" },
  });
  // `module.exports` under cjs2esm rewrites to ESpecial::ModuleExports, which
  // prints as the `exports_*` namespace symbol. Output-shape check only: a bare
  // `module.exports` value-read under cjs2esm currently emits a reference that
  // has no declaration (a separate pre-existing issue), so the bundle cannot be
  // executed here.
  itBundled("cjs2esm/DeleteFoldedModuleExportsRef", {
    files: {
      "/entry.js": /* js */ `
        exports.a = 1;
        globalThis.r = delete (null ?? module.exports);
      `,
    },
    onAfterBundle: api => {
      const code = api.readFile("out.js");
      expect(code).toMatch(/delete\s+\(0,\s*exports_\w+\)/);
      expect(code).not.toMatch(/delete\s+exports_\w+\b/);
    },
  });
  // https://github.com/oven-sh/bun/issues/4565
  // `exports.x = ...` as the unbraced body of if/while/do/else must not be
  // converted to `var $x = ...; export { $x as x };` because `export` is only
  // valid at the top level of a module.
  const noNestedExport = (api: { readFile(path: string): string }) => {
    // Before the fix, the output contained `export { $x as x };` nested inside
    // a block, which is a syntax error. Any indented `export {` is wrong here.
    expect(api.readFile("out.js")).not.toMatch(/^\s+export\s*\{/m);
  };
  itBundled("cjs2esm/ExportsAssignInSingleStmtIf#4565", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.js';
        console.log(JSON.stringify([lib.always, lib.cond]));
      `,
      "/lib.js": /* js */ `
        exports.always = 1;
        if (process.env.NEVER_SET_4565) exports.cond = 2;
      `,
    },
    onAfterBundle: noNestedExport,
    run: { stdout: "[1,null]" },
  });
  itBundled("cjs2esm/ExportsAssignInSingleStmtElse", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.js';
        console.log(JSON.stringify([lib.a, lib.b]));
      `,
      "/lib.js": /* js */ `
        exports.a = 1;
        if (process.env.NEVER_SET_4565) void 0;
        else exports.b = 2;
      `,
    },
    onAfterBundle: noNestedExport,
    run: { stdout: "[1,2]" },
  });
  itBundled("cjs2esm/ExportsAssignInSingleStmtWhile", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.js';
        console.log(JSON.stringify([lib.a, lib.b]));
      `,
      "/lib.js": /* js */ `
        exports.a = 1;
        let i = 0;
        while (i++ < 1) exports.b = 2;
      `,
    },
    onAfterBundle: noNestedExport,
    run: { stdout: "[1,2]" },
  });
  itBundled("cjs2esm/ExportsAssignInSingleStmtDoWhile", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.js';
        console.log(JSON.stringify([lib.a, lib.b]));
      `,
      "/lib.js": /* js */ `
        exports.a = 1;
        do exports.b = 2; while (false);
      `,
    },
    onAfterBundle: noNestedExport,
    run: { stdout: "[1,2]" },
  });
  itBundled("cjs2esm/ModuleExportsAssignInSingleStmtIf", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.js';
        console.log(JSON.stringify([lib.a, lib.b]));
      `,
      "/lib.js": /* js */ `
        module.exports.a = 1;
        if (process.env.NEVER_SET_4565) module.exports.b = 2;
      `,
    },
    onAfterBundle: noNestedExport,
    run: { stdout: "[1,null]" },
  });
  itBundled("cjs2esm/ExportsAssignInNestedSingleStmtIf", {
    files: {
      "/entry.js": /* js */ `
        import lib from './lib.js';
        console.log(JSON.stringify([lib.a, lib.b]));
      `,
      "/lib.js": /* js */ `
        exports.a = 1;
        if (!process.env.NEVER_SET_4565) if (!process.env.NEVER_SET_4565) exports.b = 2;
      `,
    },
    onAfterBundle: noNestedExport,
    run: { stdout: "[1,2]" },
  });
  itBundled("cjs2esm/ExportsAssignTopLevelStillConverts", {
    files: {
      "/entry.js": /* js */ `
        import { a, b } from './lib.js';
        console.log(JSON.stringify([a, b]));
      `,
      "/lib.js": /* js */ `
        exports.a = 1;
        exports.b = 2;
      `,
    },
    cjs2esm: true,
    run: { stdout: "[1,2]" },
  });

  // When an ESM entry point re-exports a name from a CommonJS module that is
  // not converted to ESM, the linker declares a copy binding named
  // `export_<alias>` in the entry point tail and exports that. The copy must be
  // renamed around every other binding of that name in the chunk.
  const printNamespace = {
    "/test.js": /* js */ `
      import * as ns from './out.js';
      console.log(JSON.stringify(ns));
    `,
  };
  itBundled("cjs2esm/ReExportCJSCopyKeepsUserBinding", {
    files: {
      "/entry.js": /* js */ `
        export { foo } from './cjs.cjs';
        export { bar } from './esm.js';
        export const export_foo = "user-foo";
        export const export_bar = "user-bar";
      `,
      "/cjs.cjs": /* js */ `
        Object.defineProperty(exports, "foo", { enumerable: true, get: () => 42 });
      `,
      "/esm.js": /* js */ `
        export const bar = 1;
      `,
    },
    format: "esm",
    runtimeFiles: printNamespace,
    onAfterBundle(api) {
      // The user bindings keep their names. The copy is the numbered one.
      api.expectFile("/out.js").toContain('var export_foo = "user-foo"');
      api.expectFile("/out.js").toContain('var export_bar = "user-bar"');
      api.expectFile("/out.js").toContain("var export_foo2 = ");
    },
    run: {
      file: "/test.js",
      stdout: '{"bar":1,"export_bar":"user-bar","export_foo":"user-foo","foo":42}',
    },
  });
  itBundled("cjs2esm/ReExportCJSCopyKeepsClassBinding", {
    // `module.exports = {...}` is not converted either, so it takes the same
    // path. A `class` with the copy's name used to make the output a
    // SyntaxError at load: `var` cannot redeclare a class binding.
    files: {
      "/entry.js": /* js */ `
        export { foo } from './cjs.cjs';
        export class export_foo {}
      `,
      "/cjs.cjs": /* js */ `
        module.exports = { foo: 42 };
      `,
    },
    format: "esm",
    runtimeFiles: {
      "/test.js": /* js */ `
        import * as ns from './out.js';
        console.log(typeof ns.export_foo, ns.foo);
      `,
    },
    run: {
      file: "/test.js",
      stdout: "function 42",
    },
  });
  itBundled("cjs2esm/ReExportCJSCopiesWithSameMangledName", {
    // The copy's name is built from the alias with every run of non-identifier
    // characters folded into "_", so distinct aliases can collide with each
    // other even when the entry point declares nothing else.
    files: {
      "/entry.js": /* js */ `
        export { "x-y", "x.y" } from './cjs.cjs';
      `,
      "/cjs.cjs": /* js */ `
        Object.defineProperty(exports, "x-y", { enumerable: true, get: () => "dash" });
        Object.defineProperty(exports, "x.y", { enumerable: true, get: () => "dot" });
      `,
    },
    format: "esm",
    runtimeFiles: printNamespace,
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain('var export_x_y = import_cjs["x-y"]');
      api.expectFile("/out.js").toContain('var export_x_y2 = import_cjs["x.y"]');
    },
    run: {
      file: "/test.js",
      stdout: '{"x-y":"dash","x.y":"dot"}',
    },
  });
  // An unbound global is a reserved name for the chunk. The copy must be
  // numbered around it in both renamers: with minified identifiers the user
  // bindings are short, so this is the collision that remains.
  const unboundGlobalFiles = {
    "/entry.js": /* js */ `
      import './side.js';
      export { foo } from './cjs.cjs';
    `,
    "/side.js": /* js */ `
      globalThis.export_foo = "global";
      console.log("side sees", export_foo);
    `,
    "/cjs.cjs": /* js */ `
      Object.defineProperty(exports, "foo", { enumerable: true, get: () => 42 });
    `,
  };
  itBundled("cjs2esm/ReExportCJSCopyKeepsUnboundGlobal", {
    files: unboundGlobalFiles,
    format: "esm",
    runtimeFiles: printNamespace,
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("var export_foo2 = import_cjs.foo");
    },
    run: {
      file: "/test.js",
      stdout: 'side sees global\n{"foo":42}',
    },
  });
  itBundled("cjs2esm/ReExportCJSCopyKeepsUnboundGlobalMinified", {
    files: unboundGlobalFiles,
    format: "esm",
    minifyIdentifiers: true,
    runtimeFiles: printNamespace,
    onAfterBundle(api) {
      // The copy gets a short name like every other top-level symbol.
      api.expectFile("/out.js").not.toContain("var export_foo");
    },
    run: {
      file: "/test.js",
      stdout: 'side sees global\n{"foo":42}',
    },
  });

  // `import React from "react"` of a CommonJS module whose `exports.x = ...`
  // assignments were lifted to ES module exports. `React` is `module.exports`,
  // which is the lifted module's namespace: `React.x` binds straight to the
  // lifted `x`, and the namespace object only exists when `React` escapes.
  const liftedReact = {
    "/node_modules/react/package.json": /* json */ `
      { "name": "react", "version": "19.0.0", "main": "index.js" }
    `,
    "/node_modules/react/index.js": /* js */ `
      'use strict';
      var REACT_ELEMENT_TYPE = Symbol.for("react.element");
      function createElement(type, props, children) {
        props = Object.assign({}, props);
        if (children !== undefined) props.children = children;
        return { $$typeof: REACT_ELEMENT_TYPE, type: type, props: props };
      }
      function useState(initial) {
        return [initial, function setState() {}];
      }
      function useId() {
        return "id";
      }
      exports.createElement = createElement;
      exports.useState = useState;
      exports.useId = useId;
      exports.version = "19.0.0";
    `,
  };
  itBundled("cjs2esm/DefaultImportMemberBindsDirectly", {
    files: {
      "/entry.js": /* js */ `
        import React from "react";
        const el = React.createElement("div");
        console.log(el.type, React.useState(1)[0], React.useId());
      `,
      ...liftedReact,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("__toESM");
      expect(out).not.toContain("__export");
      expect(out).not.toContain("exports_react");
      // the unused `version` export is tree-shaken
      expect(out).not.toContain("19.0.0");
    },
    run: {
      stdout: "div 1 id",
    },
  });
  itBundled("cjs2esm/DefaultImportAndStarImportShareBindings", {
    files: {
      "/entry.js": /* js */ `
        import React from "react";
        import * as R from "react";
        import { useState } from "react";
        console.log(
          React.useState === R.useState,
          React.useState === useState,
          React.createElement === R.createElement,
          React === R.default,
          React === R,
        );
      `,
      ...liftedReact,
    },
    cjs2esm: true,
    run: {
      stdout: "true true true true true",
    },
  });
  itBundled("cjs2esm/DefaultImportComputedMemberKeepsNamespace", {
    files: {
      "/entry.js": /* js */ `
        import React from "react";
        const key = " useId ".trim();
        console.log(React[key](), Object.keys(React).join(","), React.useState(5)[0]);
      `,
      ...liftedReact,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("__export(exports_react, {");
      expect(out).not.toContain("__toESM");
    },
    run: {
      // the namespace keeps the `exports.x = ...` assignment order
      stdout: "id createElement,useState,useId,version 5",
    },
  });
  itBundled("cjs2esm/DefaultImportEscapingKeepsAssignmentOrder", {
    files: {
      "/entry.js": /* js */ `
        import lib from "./lib.js";
        console.log(JSON.stringify(lib), typeof lib, lib.zeta);
      `,
      "/lib.js": /* js */ `
        exports.zeta = 1;
        exports.alpha = 2;
      `,
    },
    cjs2esm: true,
    run: {
      stdout: '{"zeta":1,"alpha":2} object 1',
    },
  });
  itBundled("cjs2esm/DefaultImportDotDefaultIsUndefined", {
    files: {
      "/entry.js": /* js */ `
        import React from "react";
        console.log(typeof React.default, React.default, "default" in React);
      `,
      ...liftedReact,
    },
    cjs2esm: true,
    run: {
      stdout: "undefined undefined false",
    },
  });
  itBundled("cjs2esm/DefaultImportDotDefaultOfExportsDefault", {
    files: {
      "/entry.js": /* js */ `
        import lib from "./lib.js";
        import * as ns from "./lib.js";
        console.log(lib.default(), ns.default(), ns.default === lib.default, lib.foo, Object.keys(lib).join(","));
      `,
      "/lib.js": /* js */ `
        exports.default = function def() { return "def"; };
        exports.foo = 1;
      `,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      // `lib.default` and `ns.default` bind to the lifted export; only
      // `Object.keys(lib)` materializes the namespace object
      api.expectFile("/out.js").toContain("$default()");
    },
    run: {
      // without `__esModule`, the default import is the whole `module.exports`,
      // and `ns.default` is its own `default` key
      stdout: "def def true 1 default,foo",
    },
  });
  itBundled("cjs2esm/DefaultImportWithEsModuleKeepsWrapper", {
    files: {
      "/entry.js": /* js */ `
        import lib, { foo } from "./lib.js";
        console.log(lib, foo);
      `,
      "/lib.js": /* js */ `
        exports.__esModule = true;
        exports.default = "d";
        exports.foo = 1;
      `,
    },
    // `__esModule` makes `lib` depend on its run-time value for a `.js`
    // importer, so the module keeps its CommonJS wrapper and `__toESM`
    cjs2esm: { unhandled: ["/lib.js"] },
    run: {
      stdout: "d 1",
    },
  });
  itBundled("cjs2esm/DefaultImportWithEsModuleFromEsmImporter", {
    files: {
      "/entry.mjs": /* js */ `
        import lib, { foo } from "./lib.js";
        console.log(lib.default, lib.foo, lib.__esModule, foo);
      `,
      "/lib.js": /* js */ `
        exports.__esModule = true;
        exports.default = "d";
        exports.foo = 1;
      `,
    },
    // an ES module importer ignores `__esModule`, as in Node: the default
    // import is `module.exports`, so the module stays lifted
    cjs2esm: true,
    run: {
      stdout: "d 1 true 1",
    },
  });
  itBundled("cjs2esm/ReExportDefaultAsNameFromLiftedCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import { React } from "./barrel.js";
        console.log(React.createElement("span").type, React.useState(2)[0]);
      `,
      "/barrel.js": /* js */ `
        export { default as React } from "react";
      `,
      ...liftedReact,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("__toESM");
      expect(out).not.toContain("__export");
    },
    run: {
      stdout: "span 2",
    },
  });
  itBundled("cjs2esm/ExportDefaultOfLiftedCommonJSDefaultImport", {
    files: {
      "/entry.js": /* js */ `
        import R from "./barrel.js";
        console.log(R.createElement("p").type, R.useId());
      `,
      "/barrel.js": /* js */ `
        import React from "react";
        export default React;
      `,
      ...liftedReact,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("__toESM");
      expect(out).not.toContain("__export");
    },
    run: {
      stdout: "p id",
    },
  });
  itBundled("cjs2esm/DefaultImportJsxClassicRuntime", {
    files: {
      "/entry.jsx": /* jsx */ `
        import React from "react";
        const el = <div className="x">hi</div>;
        console.log(el.type, el.props.className, el.props.children);
      `,
      ...liftedReact,
    },
    jsx: {
      runtime: "classic",
    },
    cjs2esm: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("__toESM");
      expect(out).not.toContain("__export");
    },
    run: {
      stdout: "div x hi",
    },
  });
  itBundled("cjs2esm/DefaultImportSplitting", {
    files: {
      "/a.js": /* js */ `
        import React from "react";
        console.log("a", React.createElement("a").type, React.useId());
      `,
      "/b.js": /* js */ `
        import React from "react";
        import * as R from "react";
        console.log("b", React.useState(2)[0], React === R, Object.keys(R).length);
      `,
      ...liftedReact,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    splitting: true,
    run: [
      { file: "/out/a.js", stdout: "a a id" },
      { file: "/out/b.js", stdout: "b 2 true 4" },
    ],
  });
  // `import()` of a lifted CommonJS module resolves to a view of its namespace
  // whose `default` is the namespace itself (`module.exports`), as in Node.
  // https://github.com/oven-sh/bun/issues/14061
  itBundled("cjs2esm/DynamicImportOfLiftedCommonJSHasDefault#14061", {
    files: {
      "/entry.js": /* js */ `
        const m = await import("react");
        console.log(typeof m.default, m.default.useState === m.useState, m.default.createElement("i").type);
      `,
      ...liftedReact,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toESM((init_react(), exports_react))");
    },
    run: {
      stdout: "object true i",
    },
  });
  itBundled("cjs2esm/DefaultImportWithDynamicImport", {
    files: {
      "/entry.js": /* js */ `
        import React from "react";
        const m = await import("react");
        console.log(m.default === React, m.useState === React.useState, m.default.useId());
      `,
      ...liftedReact,
    },
    cjs2esm: true,
    run: {
      stdout: "true true id",
    },
  });
});
