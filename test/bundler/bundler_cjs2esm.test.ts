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

// An unwrapped package whose module converts to ESM (it assigns `exports.x`, not
// `module.exports`). `unused` is only there to show whether the package was tree-shaken.
const convertedReactNodeModules = {
  "/node_modules/react/index.js": /* js */ `
    exports.react = "react";
    exports.unused = "REMOVE";
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
  // A let/var initialized by require() of an unwrapped package is only an alias of the
  // package while nothing assigns to it. Every variable here is assigned later in some
  // form, so each one has to stay a real variable initialized from the import; the
  // expected output is what running entry.js unbundled prints.
  itBundled("cjs2esm/UnwrappedModuleRequireRebound", {
    files: {
      "/entry.js": /* js */ `
        let a = require("react");
        console.log(a.react);
        a = { react: "a" };
        console.log(a.react);

        var b = require("react");
        b = { react: "b" };
        console.log(b.react);

        c = { react: "c before" };
        console.log(c.react);
        var c = require("react");
        console.log(c.react);
        c = { react: "c after" };
        console.log(c.react);

        let d = require("react");
        function rebindD() {
          d = { react: "d" };
        }
        rebindD();
        console.log(d.react);

        function inner() {
          let e = require("react");
          const before = e.react;
          e = { react: "e" };
          return before + " " + e.react;
        }
        console.log(inner());

        let f = require("react");
        f += "";
        console.log(typeof f, f.react);

        let g = require("react");
        g++;
        console.log(typeof g, g.react);

        let h = require("react");
        [h] = [{ react: "h" }];
        console.log(h.react);

        let i = require("react");
        ({ i } = { i: { react: "i" } });
        console.log(i.react);

        let j = require("react");
        ({ ...j } = { react: "j" });
        console.log(j.react);

        let k = require("react");
        [...k] = [{ react: "k" }];
        console.log(k.length, k[0].react);

        let l = require("react");
        for (l of [{ react: "l" }]) {}
        console.log(l.react);

        let m = require("react");
        for (m in { key: 1 }) {}
        console.log(m, m.react);

        // The declaration only reaches module scope by being hoisted out of the block.
        if (a) {
          var o = require("react");
        }
        o = { react: "o" };
        console.log(o.react);

        // react-dom stays a CommonJS wrapper, so this one worked before as well.
        let n = require("react-dom");
        console.log(n.dom);
        n = { dom: "n" };
        console.log(n.dom);
      `,
      ...convertedReactNodeModules,
      "/node_modules/react-dom/index.js": /* js */ `
        module.exports = { dom: "dom" };
      `,
      "/node_modules/react-dom/package.json": /* json */ `
        {
          "name": "react-dom",
          "version": "2.0.0",
          "main": "index.js"
        }
      `,
    },
    run: {
      stdout: [
        "react",
        "a",
        "b",
        "c before",
        "react",
        "c after",
        "d",
        "react e",
        "string undefined",
        "number undefined",
        "h",
        "i",
        "j",
        "1 k",
        "l",
        "key undefined",
        "o",
        "dom",
        "n",
      ].join("\n"),
    },
  });
  // Declaring the variable a second time rebinds it too, whether the second
  // declaration is in the same scope or is a var hoisted out of a nested block.
  itBundled("cjs2esm/UnwrappedModuleRequireRedeclared", {
    files: {
      "/entry.js": /* js */ `
        var a = require("react");
        console.log(a.react);
        var a = { react: "a" };
        console.log(a.react);

        var b = require("react");
        console.log(b.react);
        if (a) {
          var b = { react: "b" };
        }
        console.log(b.react);
      `,
      ...convertedReactNodeModules,
    },
    run: {
      stdout: "react\na\nreact\nb",
    },
  });
  // Variables that are never rebound still become the import itself, so the package is
  // still tree-shaken: `unused` must not survive. Minified code reuses the same short
  // names in every function, so only assignments and redeclarations that resolve to the
  // variable itself may count, not ones that hit a same-named parameter, local, block
  // binding or arrow default.
  itBundled("cjs2esm/UnwrappedModuleRequireNotReboundIsTreeShaken", {
    files: {
      "/entry.js": /* js */ `
        var top = require("react");
        console.log(top.react);

        function inFunction() {
          let local = require("react");
          return local.react;
        }
        console.log(inFunction());

        const fixed = require("react");
        console.log(fixed.react);

        function parameter(top) {
          top = { react: "parameter" };
          return top.react;
        }
        console.log(parameter(0));

        function hoisted() {
          for (var top = 0; top < 2;) {
            top++;
          }
          // Assigned after the block closed; the var it hits is hoisted out of the block.
          top = top * 10;
          return top;
        }
        console.log(hoisted());

        function redeclared(top) {
          var top = "again";
          return top;
        }
        console.log(redeclared(0));

        {
          let top = "block";
          top += "!";
          console.log(top);
        }

        console.log(((top = "arrow") => top)());

        function unrelated() {
          let fixed = 1;
          fixed = 2;
          return fixed;
        }
        console.log(unrelated());
      `,
      ...convertedReactNodeModules,
    },
    dce: true,
    treeShaking: true,
    run: {
      stdout: ["react", "react", "react", "parameter", "20", "again", "block!", "arrow", "2"].join("\n"),
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
});
