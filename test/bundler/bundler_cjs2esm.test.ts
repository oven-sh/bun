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
  itBundled("cjs2esm/DeleteExportsPropertyDeopt", {
    files: {
      "/entry.js": /* js */ `
        import * as lib from './lib.js';
        console.log(lib.a, lib.b);
      `,
      "/lib.js": /* js */ `
        exports.a = 1;
        exports.b = 2;
        delete exports.a;
      `,
    },
    cjs2esm: { unhandled: ["/lib.js"] },
    run: { stdout: "undefined 2" },
  });
  itBundled("cjs2esm/DeleteModuleExportsPropertyDeopt", {
    files: {
      "/entry.js": /* js */ `
        import * as lib from './lib.js';
        console.log(lib.a, lib.b);
      `,
      "/lib.js": /* js */ `
        module.exports.a = 1;
        module.exports.b = 2;
        delete module.exports.a;
      `,
    },
    cjs2esm: { unhandled: ["/lib.js"] },
    run: { stdout: "undefined 2" },
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
});
