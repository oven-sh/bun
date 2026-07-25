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
  // https://github.com/oven-sh/bun/issues/14061
  // Dynamic import of a CommonJS package that was converted to ESM must still
  // expose `default` (the original module.exports). react-dom is in the
  // unwrap-to-ESM allowlist, which is what triggers the conversion.
  const fakeReactDomServer = {
    "/node_modules/react-dom/package.json": /* json */ `
      { "name": "react-dom", "exports": { "./server": "./server.js" } }
    `,
    "/node_modules/react-dom/server.js": /* js */ `
      'use strict';
      exports.version = "18.3.1";
      exports.renderToString = function () { return "html"; };
    `,
  };
  itBundled("cjs2esm/DynamicImportDefault#14061", {
    files: {
      "/entry.mjs": /* js */ `
        const ns = await import("react-dom/server");
        console.log(JSON.stringify(ns.default));
        console.log(Object.hasOwn(ns.default, "renderToString"));
        console.log("default" in ns.default);
      `,
      ...fakeReactDomServer,
    },
    run: { stdout: '{"version":"18.3.1"}\ntrue\nfalse' },
  });
  itBundled("cjs2esm/DynamicImportYieldDefault#14061", {
    files: {
      "/entry.mjs": /* js */ `
        // mimics transpiled async/await (e.g. esbuild's __async helper)
        function* g() {
          const { default: mod } = yield import("react-dom/server");
          console.log(JSON.stringify(mod));
          console.log(mod.renderToString());
        }
        const it = g();
        await Promise.resolve(it.next().value).then(v => it.next(v));
      `,
      ...fakeReactDomServer,
    },
    run: { stdout: '{"version":"18.3.1"}\nhtml' },
  });
  itBundled("cjs2esm/DynamicImportWithStaticNamed#14061", {
    files: {
      "/entry.mjs": /* js */ `
        import { version } from "react-dom/server";
        const ns = await import("react-dom/server");
        console.log(version, ns.version, JSON.stringify(ns.default));
      `,
      ...fakeReactDomServer,
    },
    run: { stdout: '18.3.1 18.3.1 {"version":"18.3.1"}' },
  });
  itBundled("cjs2esm/DynamicImportRealEsmUnaffected", {
    files: {
      "/entry.mjs": /* js */ `
        const ns = await import("react-dom/server");
        console.log(ns.foo, ns.default);
      `,
      "/node_modules/react-dom/package.json": /* json */ `
        { "name": "react-dom", "exports": { "./server": "./server.mjs" } }
      `,
      "/node_modules/react-dom/server.mjs": /* js */ `
        export const foo = 42;
        export default "real-default";
      `,
    },
    onAfterBundle(api) {
      expect(api.readFile("out.js")).not.toContain("__commonJS");
    },
    run: { stdout: "42 real-default" },
  });
  itBundled("cjs2esm/DynamicImportRealEsmNoDefaultUnaffected", {
    // FORCE_CJS_TO_ESM is path-based; a genuine ESM file under react-dom with
    // no `export default` must not be forced into a CJS wrapper.
    files: {
      "/entry.mjs": /* js */ `
        const ns = await import("react-dom/server");
        console.log(ns.foo, ns.default);
      `,
      "/node_modules/react-dom/package.json": /* json */ `
        { "name": "react-dom", "exports": { "./server": "./server.mjs" } }
      `,
      "/node_modules/react-dom/server.mjs": /* js */ `
        export const foo = 42;
      `,
    },
    onAfterBundle(api) {
      expect(api.readFile("out.js")).not.toContain("__commonJS");
    },
    run: { stdout: "42 undefined" },
  });
  itBundled("cjs2esm/DynamicImportModuleExportsRequire#14061", {
    // `module.exports = require('./impl')` is the shape of react/index.js.
    // The parser redirects the import record to ./impl.js, whose
    // commonjs_named_exports then drives the CJS-wrapper decision.
    files: {
      "/entry.mjs": /* js */ `
        const ns = await import("react");
        console.log(JSON.stringify(ns.default));
        console.log(ns.version);
      `,
      "/node_modules/react/package.json": /* json */ `
        { "name": "react", "main": "./index.js" }
      `,
      "/node_modules/react/index.js": /* js */ `
        'use strict';
        module.exports = require('./impl.js');
      `,
      "/node_modules/react/impl.js": /* js */ `
        exports.version = "18";
        exports.createElement = function () {};
      `,
    },
    run: { stdout: '{"version":"18"}\n18' },
  });
  itBundled("cjs2esm/DynamicImportCjsExportsDefault#14061", {
    // Even when the CJS file has its own `exports.default = X`, Node gives
    // `ns.default === module.exports`, so the bundled output should too.
    files: {
      "/entry.mjs": /* js */ `
        const ns = await import("react-dom/server");
        console.log(JSON.stringify(ns.default));
      `,
      "/node_modules/react-dom/package.json": /* json */ `
        { "name": "react-dom", "exports": { "./server": "./server.js" } }
      `,
      "/node_modules/react-dom/server.js": /* js */ `
        'use strict';
        exports.default = "X";
        exports.version = "1.0";
      `,
    },
    run: { stdout: '{"default":"X","version":"1.0"}' },
  });
  itBundled("cjs2esm/DynamicImportTargetIsEntryPointUnaffected", {
    // When the converted CJS file is itself an entry point, keep its named
    // ESM exports instead of collapsing to `export default require_x()`.
    files: {
      "/entry.js": /* js */ `
        import("react-dom/server");
      `,
      ...fakeReactDomServer,
    },
    entryPoints: ["/entry.js", "/node_modules/react-dom/server.js"],
    outputPaths: ["/out/entry.js", "/out/node_modules/react-dom/server.js"],
    onAfterBundle(api) {
      const server = api.readFile("out/node_modules/react-dom/server.js");
      expect(server).toContain("as version");
      expect(server).toContain("as renderToString");
    },
  });
  itBundled("cjs2esm/DynamicImportRealEsmExportStarUnaffected", {
    // A hand-written ESM `export * from` under react-dom must stay ESM-wrapped.
    files: {
      "/entry.mjs": /* js */ `
        const ns = await import("react-dom/server");
        console.log(ns.foo, ns.default);
      `,
      "/node_modules/react-dom/package.json": /* json */ `
        { "name": "react-dom", "exports": { "./server": "./server.mjs" } }
      `,
      "/node_modules/react-dom/server.mjs": /* js */ `
        export * from "./inner.mjs";
      `,
      "/node_modules/react-dom/inner.mjs": /* js */ `
        export const foo = 42;
      `,
    },
    onAfterBundle(api) {
      expect(api.readFile("out.js")).not.toContain("__commonJS");
    },
    run: { stdout: "42 undefined" },
  });
});
