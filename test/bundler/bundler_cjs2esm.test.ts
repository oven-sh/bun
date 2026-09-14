import { describe, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { itBundled, type BundlerTestBundleAPI } from "./expectBundled";

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
  // The required packages assign module.exports, so they stay wrapped in __commonJS.
  // A destructuring declaration has to read from the import the require() became,
  // not from the wrapped module's own `exports` binding.
  itBundled("cjs2esm/UnwrappedModuleRequireDestructured", {
    files: {
      "/entry.js": /* js */ `
        const { react } = require("react");
        console.log(react);

        let { react: renamed, missing = "fallback" } = require("react");
        console.log(renamed, missing);

        var { react: { length } } = require("react");
        console.log(length);

        const before = require("react"),
          { react: between } = require("react"),
          after = require("react");
        console.log(before.react, between, after.react);

        function inFunction() {
          const { react } = require("react");
          return react;
        }
        console.log(inFunction());

        const [first, second] = require("scheduler");
        console.log(first, second);
      `,
      ...fakeReactNodeModules,
      "/node_modules/scheduler/index.js": /* js */ `
        module.exports = ["first", "second"];
      `,
      "/node_modules/scheduler/package.json": /* json */ `
        {
          "name": "scheduler",
          "version": "1.0.0",
          "main": "index.js"
        }
      `,
    },
    onAfterBundle: api => {
      const code = api.readFile("out.js");
      expect(code).toContain("var require_react = __commonJS(");
      expect(code).toContain("var require_scheduler = __commonJS(");
      expect(code).toMatch(/\{ react: between \} = \w+;/);
      expect(code).toMatch(/\[first, second\] = \w+;/);
    },
    run: {
      stdout: "react\nreact fallback\n5\nreact react react\nreact\nfirst second",
    },
  });
  // Against a package that does convert to ESM, a destructuring declaration
  // reads from the generated namespace object. A require() inside try/catch is
  // never unwrapped and prints as an ordinary require.
  itBundled("cjs2esm/UnwrappedModuleRequireDestructuredAndInTry", {
    files: {
      "/entry.js": /* js */ `
        const { react: named, version = "none" } = require("react");
        console.log(named, version);

        const whole = require("react"),
          { react: again } = require("react");
        console.log(whole.react, again);

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
      expect(code).toMatch(/\{ react: named, version = "none" \} = \(?exports_react\)?;/);
      expect(code).toMatch(/\{ react: again \} = \(?exports_react\)?;/);
      expect(code).toContain("__toCommonJS(exports_react)).react");
    },
    run: {
      stdout: "react none\nreact react\nreact",
    },
  });
  // `sideEffect(); module.exports = require("./main")` in an unwrapped package
  // becomes `sideEffect(); export * from "./main"`, so the file needs no
  // `__commonJS` wrapper and the named import binds to the export directly.
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
    cjs2esm: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__toESM(");
    },
    run: {
      stdout: "side effect\nSymbol(pass)",
    },
    minifySyntax: true,
  });
  // The real react-dom/index.js and react-dom/client.js shape: a DCE check
  // runs before `module.exports = require()`, both inside an `if` on
  // NODE_ENV that minification folds into `checkDCE(), module.exports = ns`.
  itBundled("cjs2esm/ReactSpecificUnwrappingDCECheck", {
    files: {
      "/entry.js": /* js */ `
        import { createRoot } from "react-dom/client";
        console.log(createRoot());
      `,
      "/node_modules/react-dom/package.json": /* json */ `
        { "name": "react-dom", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/react-dom/client.js": /* js */ `
        'use strict';

        function checkDCE() {
          if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined') {
            console.log('checkDCE');
            return;
          }
          if (process.env.NODE_ENV !== 'production') {
            throw new Error('^_^');
          }
        }

        if (process.env.NODE_ENV === 'production') {
          checkDCE();
          module.exports = require('./cjs/react-dom-client.production.js');
        } else {
          module.exports = require('./cjs/react-dom-client.development.js');
        }
      `,
      "/node_modules/react-dom/cjs/react-dom-client.production.js": /* js */ `
        exports.createRoot = function createRoot() { return "production root"; };
        exports.version = "19.0.0";
      `,
      "/node_modules/react-dom/cjs/react-dom-client.development.js": /* js */ `
        exports.createRoot = function createRoot() { return "FAILED"; };
        exports.version = "19.0.0";
      `,
    },
    cjs2esm: true,
    minifySyntax: true,
    env: {
      NODE_ENV: "production",
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__toESM(");
    },
    run: {
      stdout: "checkDCE\nproduction root",
    },
  });
  // A default import of the converted file binds to its namespace, which
  // holds the re-exported names (the export star resolves at link time).
  itBundled("cjs2esm/ReactSpecificUnwrappingSideEffectDefaultImport", {
    files: {
      "/entry.js": /* js */ `
        import ReactDOM, { render } from "react-dom";
        console.log(render(), ReactDOM.render(), ReactDOM.version, typeof ReactDOM.default);
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        console.log('side effect');
        module.exports = require('./impl');
      `,
      "/node_modules/react-dom/impl.js": /* js */ `
        exports.render = function render() { return "rendered"; };
        exports.version = "19.0.0";
      `,
    },
    cjs2esm: true,
    minifySyntax: true,
    run: {
      stdout: "side effect\nrendered rendered 19.0.0 object",
    },
  });
  itBundled("cjs2esm/ReactSpecificUnwrappingSideEffectNamespaceImport", {
    files: {
      "/entry.js": /* js */ `
        import * as ReactDOM from "react-dom";
        console.log(ReactDOM.render(), Object.keys(ReactDOM).sort().join(","), typeof ReactDOM.default);
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        console.log('side effect');
        module.exports = require('./impl');
      `,
      "/node_modules/react-dom/impl.js": /* js */ `
        exports.render = function render() { return "rendered"; };
        exports.version = "19.0.0";
      `,
    },
    cjs2esm: true,
    minifySyntax: true,
    run: {
      stdout: "side effect\nrendered render,version object",
    },
  });
  // `module.exports = ns` re-exports the whole namespace, so `default` of an
  // ES module target comes through too (a plain `export *` would drop it).
  itBundled("cjs2esm/ReactSpecificUnwrappingSideEffectTargetHasDefault", {
    files: {
      "/entry.js": /* js */ `
        import ReactDOM, { version } from "react-dom";
        import * as ns from "react-dom";
        const m = require("react-dom");
        console.log(version, typeof ReactDOM.default, ReactDOM.default(), typeof ns.default, ns.default(), m.default(), Object.keys(ns).sort().join(","));
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        console.log('side effect');
        module.exports = require('./impl');
      `,
      "/node_modules/react-dom/impl.js": /* js */ `
        export default function render() { return "rendered"; }
        export const version = "19.0.0";
      `,
    },
    cjs2esm: true,
    minifySyntax: true,
    run: {
      stdout: "side effect\n19.0.0 function rendered function rendered rendered default,version",
    },
  });
  itBundled("cjs2esm/ReactSpecificUnwrappingSideEffectTargetHasDefaultRequireOnly", {
    files: {
      "/entry.js": /* js */ `
        const m = require("react-dom");
        console.log(Object.keys(m).sort().join(","), typeof m.default, m.default(), m.version);
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        console.log('side effect');
        module.exports = require('./impl');
      `,
      "/node_modules/react-dom/impl.js": /* js */ `
        export default function render() { return "rendered"; }
        export const version = "19.0.0";
      `,
    },
    cjs2esm: true,
    minifySyntax: true,
    run: {
      stdout: "side effect\ndefault,version function rendered 19.0.0",
    },
  });
  // A real `export *` of the lifted file keeps ES module semantics: `default`
  // of the lifted namespace does not pass through it.
  itBundled("cjs2esm/ReactSpecificUnwrappingSideEffectTargetHasDefaultBehindExportStar", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from "./reexport";
        import ReactDOM from "react-dom";
        console.log(Object.keys(ns).sort().join(","), typeof ns.default, typeof ReactDOM.default);
      `,
      "/reexport.js": /* js */ `
        export * from "react-dom";
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        console.log('side effect');
        module.exports = require('./impl');
      `,
      "/node_modules/react-dom/impl.js": /* js */ `
        export default function render() { return "rendered"; }
        export const version = "19.0.0";
      `,
    },
    cjs2esm: true,
    minifySyntax: true,
    run: {
      stdout: "side effect\nversion undefined function",
    },
  });
  // The namespace the require() became stays imported when the file also
  // reads from it before the `module.exports =` assignment.
  itBundled("cjs2esm/ReactSpecificUnwrappingNamespaceStillUsed", {
    files: {
      "/entry.js": /* js */ `
        import { render } from "react-dom";
        console.log(render());
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        var impl = require('./impl');
        console.log('impl version', impl.version);
        module.exports = impl;
      `,
      "/node_modules/react-dom/impl.js": /* js */ `
        exports.render = function render() { return "rendered"; };
        exports.version = "19.0.0";
      `,
    },
    cjs2esm: true,
    minifySyntax: true,
    run: {
      stdout: "impl version 19.0.0\nrendered",
    },
  });
  // The re-exported file turns out to be CommonJS (its exports are not
  // statically known), so the linker keeps the converted file a CommonJS
  // wrapper around `module.exports = require()`.
  itBundled("cjs2esm/ReactSpecificUnwrappingTargetIsCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import ReactDOM, { version } from "react-dom";
        import * as ns from "react-dom";
        console.log(version, typeof ReactDOM, ReactDOM.version, typeof ReactDOM.default, ns.version, typeof ns.default);
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        console.log('side effect');
        module.exports = require('./impl');
      `,
      "/node_modules/react-dom/impl.js": /* js */ `
        module.exports = function render() { return "rendered"; };
        module.exports.version = "19.0.0";
      `,
    },
    cjs2esm: {
      unhandled: ["/node_modules/react-dom/index.js", "/node_modules/react-dom/impl.js"],
    },
    minifySyntax: true,
    run: {
      stdout: "side effect\n19.0.0 object 19.0.0 function 19.0.0 object",
    },
  });
  // Same when the re-exported file is external: the wrapper assigns the
  // `import * as ns` of the external module.
  itBundled("cjs2esm/ReactSpecificUnwrappingTargetIsExternal", {
    files: {
      "/entry.js": /* js */ `
        import ReactDOM, { unstable_now } from "react-dom";
        console.log(unstable_now(), ReactDOM.unstable_now(), typeof ReactDOM.default);
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        console.log('side effect');
        module.exports = require('scheduler');
      `,
    },
    external: ["scheduler"],
    target: "bun",
    runtimeFiles: {
      "/node_modules/scheduler/index.js": /* js */ `
        exports.unstable_now = function unstable_now() { return 42; };
      `,
    },
    minifySyntax: true,
    onAfterBundle(api) {
      // The hoisted import sits between the file comment and the wrapper,
      // which the `cjs2esm` check does not expect.
      const code = api.readFile("/out.js");
      expect(code).toContain('import * as scheduler from "scheduler"');
      expect(code).toContain("var require_react_dom = __commonJS(");
      expect(code).toContain("module.exports = scheduler");
    },
    run: {
      stdout: "side effect\n42 42 object",
    },
  });
  // Other `exports` uses next to `module.exports = require()` keep the file
  // CommonJS: the export star would hide the `exports.foo` assignment.
  itBundled("cjs2esm/ReactSpecificUnwrappingMixedExportsStaysCJS", {
    files: {
      "/entry.js": /* js */ `
        import ReactDOM from "react-dom";
        console.log(ReactDOM.render(), ReactDOM.foo);
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        exports.foo = 'foo';
        module.exports = require('./impl');
      `,
      "/node_modules/react-dom/impl.js": /* js */ `
        exports.render = function render() { return "rendered"; };
      `,
    },
    cjs2esm: {
      unhandled: ["/node_modules/react-dom/index.js"],
    },
    minifySyntax: true,
    run: {
      stdout: "rendered undefined",
    },
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
      expect(out).toContain("__exportCjs(exports_react, {");
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
  itBundled("cjs2esm/DefaultImportDotDefaultIsNamespace", {
    files: {
      "/entry.js": /* js */ `
        import React from "react";
        import * as R from "react";
        console.log(React.default === React, R.default === React, React.default.useState === React.useState);
      `,
      ...liftedReact,
    },
    cjs2esm: true,
    run: {
      // the module has no `default` export, so `.default` is `module.exports`
      // through both import forms
      stdout: "true true true",
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
  // `.default` of a lifted module that sets `__esModule` but exports no
  // `default` is the namespace for every importer, as `__toESM` and `bun run`
  // give `module.exports`. Both routes to the namespace, `import * as ns` and
  // `export * as Lib`, must agree.
  const esModuleNoDefault = {
    "/lib.js": /* js */ `
      exports.__esModule = true;
      exports.foo = 1;
    `,
    "/mid.js": /* js */ `
      export * as Lib from "./lib.js";
    `,
  };
  itBundled("cjs2esm/DotDefaultWithEsModuleNoDefaultFromCjsImporter", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from "./lib.js";
        import { Lib } from "./mid.js";
        console.log(Lib === ns, Lib.default === ns, ns.default === ns, Lib.foo);
      `,
      ...esModuleNoDefault,
    },
    cjs2esm: true,
    run: {
      stdout: "true true true 1",
    },
  });
  // The default import of that module is the namespace too, so the module
  // stays lifted for a `.js` importer
  itBundled("cjs2esm/DefaultImportWithEsModuleNoDefaultFromCjsImporter", {
    files: {
      "/entry.js": /* js */ `
        import lib, * as ns from "./lib.js";
        console.log(lib === ns, lib.default === ns, lib.__esModule, lib.foo);
      `,
      ...esModuleNoDefault,
    },
    cjs2esm: true,
    run: {
      stdout: "true true true 1",
    },
  });
  itBundled("cjs2esm/DotDefaultWithEsModuleNoDefaultFromEsmImporter", {
    files: {
      "/entry.mjs": /* js */ `
        import * as ns from "./lib.js";
        import { Lib } from "./mid.js";
        console.log(Lib === ns, Lib.default === ns, ns.default === ns, Lib.foo);
      `,
      ...esModuleNoDefault,
    },
    cjs2esm: true,
    run: {
      stdout: "true true true 1",
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
  // A method call through the default import or the namespace of a CommonJS
  // module passes `module.exports` as `this`. The `stack-trace` package reads it.
  const thisReadingLib = {
    "/lib.cjs": /* js */ `
      exports.parse = function (s) {
        return this._helper(s);
      };
      exports._helper = function (s) {
        return "helped:" + s;
      };
      exports.tag = function (strings) {
        return this._helper(strings[0]);
      };
    `,
  };
  itBundled("cjs2esm/DefaultImportMethodCallKeepsThis", {
    files: {
      "/entry.js": /* js */ `
        import st from "./lib.cjs";
        console.log(st.parse("x"), st["parse"]("y"), st.tag\`z\`);
      `,
      ...thisReadingLib,
    },
    cjs2esm: true,
    run: {
      stdout: "helped:x helped:y helped:z",
    },
  });
  itBundled("cjs2esm/StarImportMethodCallKeepsThis", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from "./lib.cjs";
        const parse = ns.parse;
        console.log(ns.parse("x"), ns["parse"]("y"), ns["tag"]\`z\`, parse === ns.parse);
      `,
      ...thisReadingLib,
    },
    cjs2esm: true,
    run: {
      stdout: "helped:x helped:y helped:z true",
    },
  });
  itBundled("cjs2esm/StarImportMethodCallThroughExportStarKeepsThis", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from "./barrel.js";
        import lib from "./lib.cjs";
        console.log(ns.parse("x"), lib.parse("y"));
      `,
      "/barrel.js": /* js */ `
        export * from "./lib.cjs";
      `,
      ...thisReadingLib,
    },
    cjs2esm: true,
    run: {
      stdout: "helped:x helped:y",
    },
  });
  itBundled("cjs2esm/MethodCallKeepsThisWhenTheValueCanReadIt", {
    files: {
      "/entry.js": /* js */ `
        import lib from "./lib.cjs";
        console.log(lib.decl(), lib.reassigned(), lib.value());
      `,
      "/lib.cjs": /* js */ `
        function decl() { return this.name; }
        exports.decl = decl;
        exports.reassigned = function () { return "first"; };
        exports.reassigned = function () { return this.name; };
        exports.value = [function () { return this.name; }][0];
        exports.name = "lib";
      `,
    },
    cjs2esm: true,
    run: {
      stdout: "lib lib lib",
    },
  });
  // A `var` with the name of a function declaration can change the value of the
  // binding, and so can a block-level function in sloppy mode. An ES module
  // cannot declare a function and a `var` with one name, so this file keeps its
  // `__commonJS` wrapper, and each call passes `module.exports` as `this`.
  itBundled("cjs2esm/MethodCallKeepsThisWhenAVarRedeclaresTheFunction", {
    files: {
      "/entry.js": /* js */ `
        import lib from "./lib.cjs";
        console.log(lib.nested(), lib.top(), lib.top2(), lib.block());
      `,
      "/lib.cjs": /* js */ `
        function nested() { return "declaration"; }
        if (Math.random() < 2) { var nested = function () { return this.name; }; }
        exports.nested = nested;
        function top() { return "declaration"; }
        var top = function () { return this.name; };
        exports.top = top;
        var top2 = function () { return this.name; };
        function top2() { return "declaration"; }
        exports.top2 = top2;
        function block() { return "declaration"; }
        { function block() { return this.name; } }
        exports.block = block;
        exports.name = "lib";
      `,
    },
    cjs2esm: { unhandled: ["/lib.cjs"] },
    run: {
      stdout: "lib lib lib lib",
    },
  });
  itBundled("cjs2esm/MethodCallWithoutThisBindsDirectly", {
    files: {
      "/entry.js": /* js */ `
        import lib from "./lib.cjs";
        import * as ns from "./lib.cjs";
        console.log(lib.expr(), lib.arrow(), lib.decl(), ns.expr(), ns.decl(), lib.nested()());
      `,
      "/lib.cjs": /* js */ `
        exports.expr = function () { return "expr"; };
        exports.arrow = () => "arrow";
        function decl() { return "decl"; }
        exports.decl = decl;
        exports.nested = function () { return () => "nested"; };
        exports.unused = function () { return this.expr(); };
      `,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("exports_lib");
      // `unused` reads `this`, but nothing calls it, so it is tree-shaken
      expect(out).not.toContain("this.expr");
    },
    run: {
      stdout: "expr arrow decl expr decl nested",
    },
  });
  // A call of `exports.name()` in the file itself passes `module.exports` as `this`.
  // The entry uses named imports, so only those calls keep the namespace object.
  itBundled("cjs2esm/SelfMethodCallKeepsThis", {
    files: {
      "/entry.js": /* js */ `
        import { internal, viaModule, viaTag } from "./lib.cjs";
        console.log(internal(), viaModule(), viaTag());
      `,
      "/lib.cjs": /* js */ `
        exports.parse = function (s) { return this._helper(s); };
        exports._helper = function (s) { return "helped:" + s; };
        exports.tag = function (strings) { return this._helper(strings[0]); };
        exports.internal = function () { return exports.parse("in"); };
        exports.viaModule = function () { return module.exports.parse("module"); };
        exports.viaTag = function () { return exports.tag\`tag\`; };
      `,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain('return exports_lib.parse("in");');
      expect(out).toContain("console.log($internal(), $viaModule(), $viaTag());");
    },
    run: {
      stdout: "helped:in helped:module helped:tag",
    },
  });
  itBundled("cjs2esm/SelfMethodCallWithoutThisBindsDirectly", {
    files: {
      "/entry.js": /* js */ `
        import { run } from "./lib.cjs";
        console.log(run());
      `,
      "/lib.cjs": /* js */ `
        exports.free = function (s) { return "free:" + s; };
        exports.run = function () { return exports.free("x"); };
        exports.unused = function () { return this.free("y"); };
      `,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain('$free("x")');
      expect(out).not.toContain("exports_lib");
    },
    run: {
      stdout: "free:x",
    },
  });
  itBundled("cjs2esm/SelfMethodCallInUnusedExportKeepsNoNamespace", {
    files: {
      "/entry.js": /* js */ `
        import { parse } from "./lib.cjs";
        console.log(typeof parse);
      `,
      "/lib.cjs": /* js */ `
        exports.parse = function (s) { return this._helper(s); };
        exports._helper = function (s) { return "helped:" + s; };
        exports.run = function () { return exports.parse("x"); };
        exports.other = "tree-shaken";
      `,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // Only the call in `run` needs the namespace object, and `run` is unused.
      expect(out).not.toContain("exports_lib");
      expect(out).not.toContain("tree-shaken");
    },
    run: {
      stdout: "function",
    },
  });
  itBundled("cjs2esm/SelfMethodCallNextToAReadKeepsNoNamespace", {
    files: {
      "/entry.js": /* js */ `
        import { mixed } from "./lib.cjs";
        console.log(mixed());
      `,
      "/lib.cjs": /* js */ `
        exports.parse = function (s) { return this._helper(s); };
        exports._helper = function (s) { return "helped:" + s; };
        exports.run = function () { return exports.parse("x"); };
        exports.pure = function (f) { return typeof f; };
        exports.mixed = function () { return exports.pure(exports.parse); };
        exports.other = "tree-shaken";
      `,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      // `mixed` reads `parse` and calls `pure`. Neither needs the namespace object.
      expect(out).toContain("return $pure($parse);");
      expect(out).not.toContain("exports_lib");
      expect(out).not.toContain("tree-shaken");
    },
    run: {
      stdout: "function",
    },
  });
  // `require()` of a lifted file keeps it in a `__commonJS` wrapper. A call of its own
  // export must not bring an export table for the lifted bindings into the wrapper.
  itBundled("cjs2esm/SelfMethodCallInRequiredFileKeepsExports", {
    files: {
      "/entry.js": /* js */ `
        import * as m from "./index.cjs";
        console.log(typeof m.publicEncrypt, typeof m.privateEncrypt, m.privateEncrypt("x"));
      `,
      "/index.cjs": /* js */ `
        var c = require("./empty.cjs");
        if (typeof c.publicEncrypt !== "function") c = require("./lib.cjs");
        exports.publicEncrypt = c.publicEncrypt;
        exports.privateEncrypt = c.privateEncrypt;
      `,
      "/lib.cjs": /* js */ `
        exports.publicEncrypt = require("./pe.cjs");
        exports.privateEncrypt = function (k) { return exports.publicEncrypt(k); };
      `,
      "/pe.cjs": /* js */ `
        module.exports = function publicEncrypt(k) { return "enc:" + k; };
      `,
      "/empty.cjs": /* js */ `
        module.exports = {};
      `,
    },
    cjs2esm: { unhandled: ["/lib.cjs", "/pe.cjs", "/empty.cjs"] },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("__export(");
      expect(out).toContain("var require_lib = __commonJS(function(exports) {");
    },
    run: {
      stdout: "function function enc:x",
    },
  });
  // The same, with export names that no other file declares.
  itBundled("cjs2esm/SelfMethodCallInRequiredFileDistinctNames", {
    files: {
      "/entry.js": /* js */ `
        import { run } from "./index.cjs";
        console.log(run());
      `,
      "/index.cjs": /* js */ `
        var lib = require("./lib.cjs");
        exports.run = function () { return lib.parse("in"); };
      `,
      "/lib.cjs": /* js */ `
        exports.parse = function (s) { return this._helper(s); };
        exports._helper = function (s) { return "helped:" + s; };
        exports.internal = function () { return exports.parse("x"); };
      `,
    },
    cjs2esm: { unhandled: ["/lib.cjs"] },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).not.toContain("__export(");
      expect(out).not.toContain("$parse");
    },
    run: {
      stdout: "helped:in",
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
  // The chunk a split `import()` of a lifted CommonJS module loads exports the
  // module's namespace object as `default`: the same object a default import
  // binds to, not a getter-only copy of the exports.
  const splitChunk = (api: BundlerTestBundleAPI, name: string) =>
    api.readFile("/out/" + readdirSync(api.outdir).find(f => f.startsWith(`${name}-`) && f.endsWith(".js"))!);
  const liftedLib = /* js */ `
    exports.createElement = function (t) { return "<" + t + ">"; };
    exports.version = "19.x";
  `;
  itBundled("cjs2esm/SplitDynamicImportDefaultIsNamespaceOfLiftedCommonJS", {
    files: {
      "/entry.mjs": /* js */ `
        import lib from "./lib.cjs";
        import * as ns from "./lib.cjs";
        const m = await import("./lib.cjs");
        lib.expando = 1;
        m.default.version = "patched";
        console.log(m.default === lib, m.default === ns, m.default.expando, lib.version, m.version, Object.keys(m.default).join(","));
      `,
      "/lib.cjs": liftedLib,
    },
    outdir: "/out",
    outputPaths: ["/out/entry.js"],
    splitting: true,
    onAfterBundle(api) {
      expect(splitChunk(api, "lib")).toContain("export default exports_lib;");
      expect(splitChunk(api, "lib")).not.toContain("get createElement()");
    },
    run: { file: "/out/entry.js", stdout: "true true 1 patched patched createElement,version,expando" },
  });
  itBundled("cjs2esm/SplitDynamicImportOnlyOfLiftedCommonJS", {
    files: {
      "/entry.js": /* js */ `
        const m = await import("./lib.cjs");
        console.log(m.default.createElement("i"), m.default.createElement === m.createElement, Object.keys(m.default).join(","));
      `,
      "/lib.cjs": liftedLib,
    },
    outdir: "/out",
    splitting: true,
    onAfterBundle(api) {
      expect(splitChunk(api, "lib")).toContain("export default exports_lib;");
      expect(splitChunk(api, "lib")).not.toContain("get createElement()");
    },
    run: { file: "/out/entry.js", stdout: "<i> true createElement,version" },
  });
  // No importer reads `default`, so the chunk needs no namespace object.
  itBundled("cjs2esm/SplitDynamicImportOfLiftedCommonJSWithoutDefaultRead", {
    files: {
      "/entry.js": /* js */ `
        const { version } = await import("./lib.cjs");
        console.log(version);
      `,
      "/lib.cjs": liftedLib,
    },
    outdir: "/out",
    splitting: true,
    onAfterBundle(api) {
      expect(splitChunk(api, "lib")).not.toContain("export default");
      expect(splitChunk(api, "lib")).not.toContain("__export");
    },
    run: { file: "/out/entry.js", stdout: "19.x" },
  });
  itBundled("cjs2esm/DefaultImportWithSplitDynamicImport", {
    files: {
      "/entry.js": /* js */ `
        import React from "react";
        const m = await import("react");
        console.log(m.default === React, m.useState === React.useState, m.default.useId());
      `,
      ...liftedReact,
    },
    outdir: "/out",
    splitting: true,
    onAfterBundle(api) {
      expect(splitChunk(api, "index")).toContain("export default exports_react;");
    },
    run: { file: "/out/entry.js", stdout: "true true id" },
  });
  // A lifted module with no exports still has a namespace object.
  itBundled("cjs2esm/SplitDynamicImportOfLiftedCommonJSWithoutExports", {
    files: {
      "/entry.js": /* js */ `
        import React from "react";
        const m = await import("react");
        console.log(m.default === React, typeof m.default);
      `,
      "/node_modules/react/package.json": /* json */ `
        { "name": "react", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/react/index.js": `'use strict';`,
    },
    outdir: "/out",
    splitting: true,
    run: { file: "/out/entry.js", stdout: "true object" },
  });
  // `exports.default` is a property of `module.exports`, as in Node, unless the
  // module also sets `__esModule`. Then it is the `default`, as with `bun run`.
  itBundled("cjs2esm/SplitDynamicImportOfLiftedCommonJSWithOwnDefault", {
    files: {
      "/entry.js": /* js */ `
        import lib from "./lib.cjs";
        const m = await import("./lib.cjs");
        console.log(m.default === lib, m.default.default, lib.default, m.x);
      `,
      "/lib.cjs": /* js */ `
        exports.default = "d";
        exports.x = 1;
      `,
    },
    outdir: "/out",
    splitting: true,
    onAfterBundle(api) {
      expect(splitChunk(api, "lib")).toContain("export default exports_lib;");
    },
    run: { file: "/out/entry.js", stdout: "true d d 1" },
  });
  itBundled("cjs2esm/SplitDynamicImportOfLiftedCommonJSWithEsModuleAndDefault", {
    files: {
      "/entry.mjs": /* js */ `
        const m = await import("./lib.cjs");
        console.log(m.default, m.x);
      `,
      "/lib.cjs": /* js */ `
        exports.__esModule = true;
        exports.default = "d";
        exports.x = 1;
      `,
    },
    outdir: "/out",
    outputPaths: ["/out/entry.js"],
    splitting: true,
    run: { file: "/out/entry.js", stdout: "d 1" },
  });
  // Static imports of a lifted module bind its exports directly, whether or
  // not a split `import()` of the module reads `default`. Only a read of
  // `default` creates the namespace object.
  const outputText = (api: BundlerTestBundleAPI) =>
    readdirSync(api.outdir)
      .filter(f => f.endsWith(".js"))
      .map(f => api.readFile("/out/" + f))
      .join("\n");
  const staticHookImporters = {
    "/a.js": /* js */ `
      import React from "./lib.cjs";
      export const viaDefault = () => React.useState;
      export const versionViaDefault = () => React.version;
    `,
    "/b.js": /* js */ `
      import { useState, version } from "./lib.cjs";
      export const viaNamed = () => useState;
      export const versionViaNamed = () => version;
    `,
    "/lib.cjs": /* js */ `
      exports.useState = function (value) { return [value]; };
      exports.version = "19.x";
    `,
  };
  itBundled("cjs2esm/SplitDynamicImportDestructuredWithStaticImportsOfLiftedCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import { viaDefault } from "./a.js";
        import { viaNamed } from "./b.js";
        const { useState } = await import("./lib.cjs");
        console.log(viaDefault() === useState, viaNamed() === useState, useState(1)[0]);
      `,
      ...staticHookImporters,
    },
    outdir: "/out",
    splitting: true,
    onAfterBundle(api) {
      expect(splitChunk(api, "lib")).not.toContain("export default");
      const out = outputText(api);
      expect(out).not.toContain("exports_lib");
      expect(out).not.toContain("__toESM");
      expect(out).toContain("viaDefault = () => $useState;");
      expect(out).toContain("viaNamed = () => $useState;");
    },
    run: { file: "/out/entry.js", stdout: "true true 1" },
  });
  itBundled("cjs2esm/SplitDynamicImportDefaultWithStaticImportsOfLiftedCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import React from "./lib.cjs";
        import { viaDefault, versionViaDefault } from "./a.js";
        import { viaNamed, versionViaNamed } from "./b.js";
        const m = await import("./lib.cjs");
        m.default.version = "patched";
        console.log(
          m.default === React,
          m.default.useState === viaDefault(),
          viaNamed() === viaDefault(),
          versionViaDefault(),
          versionViaNamed(),
        );
      `,
      ...staticHookImporters,
    },
    outdir: "/out",
    splitting: true,
    onAfterBundle(api) {
      expect(splitChunk(api, "lib")).toContain("export default exports_lib;");
      const out = outputText(api);
      expect(out).not.toContain("exports_lib.");
      expect(out).not.toContain("__toESM");
      expect(out).toContain("viaDefault = () => $useState;");
      expect(out).toContain("versionViaDefault = () => $version;");
      expect(out).toContain("viaNamed = () => $useState;");
      expect(out).toContain("versionViaNamed = () => $version;");
    },
    run: { file: "/out/entry.js", stdout: "true true true patched patched" },
  });
  // A module in the unwrap list that assigns `module.exports` is not lifted and
  // keeps its `__commonJS` wrapper, so its chunk is `export default require_x()`.
  // A cross-chunk `import()` of it needs the same `__toESM` as any other
  // CommonJS chunk, or the named exports are `undefined`.
  itBundled("cjs2esm/DynamicImportSplittingOfWrappedCommonJS", {
    files: {
      "/entry.js": /* js */ `
        import React from "react";
        const m = await import("react");
        console.log(m.useState(1)[0], m.version, m.default === React, typeof m.default.useState);
      `,
      "/node_modules/react/package.json": /* json */ `
        { "name": "react", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/react/index.js": /* js */ `
        'use strict';
        if (globalThis.USE_PROD) {
          module.exports = require('./cjs/react.production.js');
        } else {
          module.exports = require('./cjs/react.development.js');
        }
      `,
      "/node_modules/react/cjs/react.production.js": /* js */ `
        'use strict';
        function useState(initial) {
          return [initial, function setState() {}];
        }
        exports.useState = useState;
        exports.version = "production";
      `,
      "/node_modules/react/cjs/react.development.js": /* js */ `
        'use strict';
        function useState(initial) {
          return [initial, function setState() {}];
        }
        exports.useState = useState;
        exports.version = "development";
      `,
    },
    outdir: "/out",
    splitting: true,
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("__toESM(m.default");
    },
    run: {
      file: "/out/entry.js",
      stdout: "1 development true function",
    },
  });
  // The same for a lifted module that the linker wraps again, because the
  // target of its `module.exports = require()` stays CommonJS.
  itBundled("cjs2esm/DynamicImportSplittingOfRewrappedLiftedCommonJS", {
    files: {
      "/entry.js": /* js */ `
        const m = await import("react-dom");
        console.log(m.version, m.default.version);
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        console.log('side effect');
        module.exports = require('./impl');
      `,
      "/node_modules/react-dom/impl.js": /* js */ `
        module.exports = function render() { return "rendered"; };
        module.exports.version = "19.0.0";
      `,
    },
    outdir: "/out",
    splitting: true,
    minifySyntax: true,
    run: {
      file: "/out/entry.js",
      stdout: "side effect\n19.0.0 19.0.0",
    },
  });
  // Outside the unwrap list too: the `exports.foo = ...` of "./lib.js" are
  // lifted, but a `require()` of it makes it CommonJS again.
  itBundled("cjs2esm/DynamicImportSplittingOfRequiredLiftedCommonJS", {
    files: {
      "/entry.js": /* js */ `
        const lib = require("./lib.js");
        const m = await import("./lib.js");
        console.log(lib.foo, m.foo, m.default === lib);
      `,
      "/lib.js": /* js */ `
        exports.foo = "foo";
        exports.bar = "bar";
      `,
    },
    outdir: "/out",
    splitting: true,
    run: {
      file: "/out/entry.js",
      stdout: "foo foo true",
    },
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
  // The shape of `@react-email/render`: a transpiled async function yields the
  // `import()` promise and destructures `default` from what it resolves to.
  // https://github.com/oven-sh/bun/issues/14061
  const liftedReactDomServer = {
    "/node_modules/react-dom/package.json": /* json */ `
      { "name": "react-dom", "exports": { "./server": "./server.js" } }
    `,
    "/node_modules/react-dom/server.js": /* js */ `
      'use strict';
      exports.version = "18.3.1";
      exports.renderToString = function () { return "html"; };
    `,
  };
  itBundled("cjs2esm/DynamicImportYieldDefaultOfLiftedCommonJS#14061", {
    files: {
      "/entry.mjs": /* js */ `
        function* render() {
          const { default: reactDOMServer } = yield import("react-dom/server");
          console.log(Object.hasOwn(reactDOMServer, "renderToString"), reactDOMServer.renderToString());
        }
        const it = render();
        await Promise.resolve(it.next().value).then(v => it.next(v));
      `,
      ...liftedReactDomServer,
    },
    cjs2esm: true,
    run: {
      stdout: "true html",
    },
  });
  itBundled("cjs2esm/DynamicImportWithStaticNamedImportOfLiftedCommonJS#14061", {
    files: {
      "/entry.mjs": /* js */ `
        import { version } from "react-dom/server";
        const ns = await import("react-dom/server");
        console.log(version, ns.version, ns.default.version, ns.default.renderToString());
      `,
      ...liftedReactDomServer,
    },
    cjs2esm: true,
    run: {
      stdout: "18.3.1 18.3.1 18.3.1 html",
    },
  });
  // `FORCE_CJS_TO_ESM` is path based. A real ES module in the react family has
  // no lifted exports, so its `import()` keeps the plain namespace.
  itBundled("cjs2esm/DynamicImportOfRealEsmInReactFamilyUnaffected", {
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
    cjs2esm: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__toESM");
    },
    run: {
      stdout: "42 undefined",
    },
  });
  // A lone `import * as ns` of a lifted CommonJS module: `ns.default` is
  // `module.exports`, which is the namespace itself.
  itBundled("cjs2esm/ImportStarOfLiftedCommonJSHasDefault", {
    files: {
      "/entry.mjs": /* js */ `
        import * as ns from "./c.cjs";
        console.log(typeof ns.default, ns.default.n, ns.default === ns, Object.keys(ns).join(","));
      `,
      "/c.cjs": /* js */ `
        exports.n = 7;
      `,
    },
    cjs2esm: true,
    run: {
      stdout: "object 7 true n",
    },
  });

  // A write through the namespace of a lifted CommonJS module assigns the
  // lifted binding, as a write to `module.exports` does, so every reader sees
  // it: the default import, the named import and the `import *` namespace.
  const writableConfig = {
    "/config.js": /* js */ `
      exports.debug = false;
      exports.name = "cfg";
    `,
  };
  const writeThroughDefaultImport = /* js */ `
    import config from "./config.js";
    import { debug } from "./config.js";
    import * as ns from "./config.js";
    config.debug = true;
    config.extra = 1;
    console.log(config.debug, debug, ns.debug, config.extra, config.name);
  `;
  itBundled("cjs2esm/WriteThroughDefaultImportAssignsBinding", {
    files: {
      "/entry.js": writeThroughDefaultImport,
      ...writableConfig,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("__exportCjs(exports_config, {");
      expect(out).toContain("debug: (value) => $debug = value");
      expect(out).not.toContain("__toESM");
    },
    run: {
      stdout: "true true true 1 cfg",
    },
  });
  itBundled("cjs2esm/WriteThroughDefaultImportAssignsBindingMinified", {
    files: {
      "/entry.js": writeThroughDefaultImport,
      ...writableConfig,
    },
    minifySyntax: true,
    minifyIdentifiers: true,
    run: {
      stdout: "true true true 1 cfg",
    },
  });
  itBundled("cjs2esm/WriteThroughDefaultImportWithoutNamespaceSetters", {
    files: {
      "/entry.js": writeThroughDefaultImport,
      ...writableConfig,
    },
    // a lifted CommonJS module's namespace is writable either way: it stands
    // in for `module.exports`, not for an ES module namespace
    deprecatedNamespaceObjectSetters: false,
    cjs2esm: true,
    run: {
      stdout: "true true true 1 cfg",
    },
  });
  // The server-side rendering idiom that silences the useLayoutEffect warning.
  itBundled("cjs2esm/PatchReactExportThroughDefaultImport", {
    files: {
      "/entry.js": /* js */ `
        import React from "react";
        import { useLayoutEffect } from "react";
        React.useLayoutEffect = React.useEffect;
        console.log(React.useLayoutEffect === React.useEffect, useLayoutEffect === React.useEffect, React.useLayoutEffect());
      `,
      "/node_modules/react/package.json": /* json */ `
        { "name": "react", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/react/index.js": /* js */ `
        'use strict';
        function useEffect() { return "effect"; }
        function useLayoutEffect() { return "layout"; }
        exports.useEffect = useEffect;
        exports.useLayoutEffect = useLayoutEffect;
      `,
    },
    cjs2esm: true,
    run: {
      stdout: "true true effect",
    },
  });
  itBundled("cjs2esm/WriteThroughDefaultImportSplitting", {
    files: {
      "/a.js": /* js */ `
        import config from "./config.js";
        import { read } from "./shared.js";
        config.debug = true;
        console.log("a", config.debug, read());
      `,
      "/b.js": /* js */ `
        import { read } from "./shared.js";
        console.log("b", read());
      `,
      "/shared.js": /* js */ `
        import { debug } from "./config.js";
        export function read() { return debug; }
      `,
      ...writableConfig,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    splitting: true,
    run: [
      { file: "/out/a.js", stdout: "a true true" },
      { file: "/out/b.js", stdout: "b false" },
    ],
  });
  itBundled("cjs2esm/OtherModuleMemberKeepsWrapper", {
    files: {
      "/entry.js": /* js */ `
        import lib, * as ns from "lib";
        console.log(lib.addHook(), ns.hot, lib.self === lib);
      `,
      "/node_modules/lib/index.js": /* js */ `
        const Module = module.constructor.length > 1 ? module.constructor : null;
        exports.addHook = function addHook() { return typeof Module; };
        exports.hot = typeof module.hot;
        exports.self = module.exports;
      `,
    },
    cjs2esm: {
      unhandled: ["/node_modules/lib/index.js"],
    },
    run: {
      stdout: "object undefined true",
    },
  });
  itBundled("cjs2esm/ModuleExportsMemberStillLifts", {
    files: {
      "/entry.js": /* js */ `
        import lib, * as ns from "lib";
        console.log(lib.x, ns.y, lib.main);
      `,
      "/node_modules/lib/index.js": /* js */ `
        module.exports.x = 1;
        exports.y = module.exports.x + 1;
        exports.main = require.main === module;
      `,
    },
    cjs2esm: true,
    run: {
      stdout: "1 2 false",
    },
  });
  // Module code makes a top-level function declaration lexical, so a `var`
  // with the same name is a SyntaxError there. A function body allows it, so
  // these files keep their `__commonJS` wrapper. In sloppy mode the bundler
  // prints a block-level function with a `var` of its name, so
  // block-function.cjs has the same conflict.
  itBundled("cjs2esm/VarWithTheNameOfATopLevelFunctionKeepsWrapper", {
    files: {
      "/entry.js": /* js */ `
        import { top as a } from "./decl-then-var.cjs";
        import { top as b } from "./var-then-decl.cjs";
        import { top as c } from "./var-in-block.cjs";
        import { top as d } from "./block-function.cjs";
        import { top as e } from "./generator.cjs";
        import lib from "./default-import.cjs";
        console.log(a(), b(), c(), d(), e(), lib.top());
      `,
      "/decl-then-var.cjs": /* js */ `
        function top() { return "declaration"; }
        var top = function () { return "var"; };
        exports.top = top;
      `,
      "/var-then-decl.cjs": /* js */ `
        var top = function () { return "var"; };
        function top() { return "declaration"; }
        exports.top = top;
      `,
      "/var-in-block.cjs": /* js */ `
        function top() { return "declaration"; }
        if (typeof top === "function") {
          var top = function () { return "var"; };
        }
        exports.top = top;
      `,
      "/block-function.cjs": /* js */ `
        function top() { return "declaration"; }
        {
          function top() { return "block"; }
        }
        exports.top = top;
      `,
      "/generator.cjs": /* js */ `
        function* top() {}
        var top = function () { return "var"; };
        exports.top = top;
      `,
      "/default-import.cjs": /* js */ `
        function top() { return "declaration"; }
        var top = function () { return "var"; };
        exports.top = top;
      `,
    },
    cjs2esm: {
      unhandled: [
        "/decl-then-var.cjs",
        "/var-then-decl.cjs",
        "/var-in-block.cjs",
        "/block-function.cjs",
        "/generator.cjs",
        "/default-import.cjs",
      ],
    },
    run: {
      stdout: "var var var block var var",
    },
  });
  // Module code allows a `var` that repeats a `var`, and a function and a `var`
  // with one name inside a nested function. Of two top-level functions with one
  // name, the parser drops the first. So this file is still lifted.
  itBundled("cjs2esm/OtherRedeclarationsAreStillLifted", {
    files: {
      "/entry.js": /* js */ `
        import { top, count, wrap } from "./lib.cjs";
        console.log(top(), count, wrap());
      `,
      "/lib.cjs": /* js */ `
        function top() { return "first"; }
        function top() { return "second"; }
        var count = 1;
        if (count) {
          var count = 2;
        }
        function wrap() {
          var top = function () { return "shadow"; };
          function inner() { return "declaration"; }
          var inner = function () { return "inner"; };
          function other() { return "declaration"; }
          {
            var other = function () { return "other"; };
          }
          return [top(), inner(), other()].join(" ");
        }
        exports.top = top;
        exports.count = count;
        exports.wrap = wrap;
      `,
    },
    cjs2esm: true,
    run: {
      stdout: "second 2 shadow inner other",
    },
  });
  // `module.exports = require()` in an unwrapped package becomes
  // `export * from`, which is module code too.
  itBundled("cjs2esm/ReactSpecificUnwrappingVarWithTheNameOfAFunctionKeepsWrapper", {
    files: {
      "/entry.js": /* js */ `
        import { value } from "react";
        console.log(value);
      `,
      "/node_modules/react/index.js": /* js */ `
        function load() { return "declaration"; }
        var load = function () { return "var"; };
        console.log(load());
        module.exports = require('./main');
      `,
      "/node_modules/react/main.js": /* js */ `
        exports.value = "main";
      `,
    },
    cjs2esm: { unhandled: ["/node_modules/react/index.js"] },
    run: {
      stdout: "var\nmain",
    },
  });
});
