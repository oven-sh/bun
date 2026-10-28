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
  // A require() of an unwrapped package that initializes a destructuring
  // declaration is kept as a require expression that remembers it was
  // unwrapped, and prints as the namespace object. One inside try/catch is
  // never unwrapped and stays a call, which returns that same object.
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
      expect(code).toContain("(init_react(), exports_react).react");
      expect(code).not.toContain("__toCommonJS");
    },
    run: {
      stdout: "react\nreact",
    },
  });

  // A require() that stays a call, of a CommonJS file of an unwrapped package
  // that was lifted to an ES module, returns the file's namespace object.
  // That object stands in for `module.exports`: it has no `__esModule` unless
  // the file sets one, every require() of the file returns it, and a write
  // reaches the lifted binding. A `__toCommonJS` copy has none of these.
  //
  // `matchesBunRun` also runs the entry point of a case with `bun run`, which
  // must print the stdout that the case expects of the bundle.
  const reactWithCounter = {
    "/node_modules/react/package.json": /* json */ `
      { "name": "react", "version": "19.0.0", "main": "index.js" }
    `,
    "/node_modules/react/index.js": /* js */ `
      exports.make = x => "F" + x;
      exports.count = 0;
      exports.inc = () => ++exports.count;
    `,
  };
  for (const backend of ["cli", "api"] as const) {
    // The call stays in a `try` body and in a `catch` body. The same file
    // under a name off the unwrap list keeps its `__commonJS` wrapper.
    itBundled(`cjs2esm/KeptRequireOfLiftedCommonJS-${backend}`, {
      matchesBunRun: true,
      files: {
        "/entry.js": /* js */ `
          const unwrapped = require("react");
          let inTry, inCatch, other;
          try { inTry = require("react"); } catch {}
          try { throw 1; } catch { inCatch = require("react"); }
          try { other = require("other"); } catch {}
          console.log(inTry.__esModule, typeof inTry.default, other.__esModule, typeof other.default);
          console.log((inTry.__esModule ? inTry.default : inTry).make("A"), Object.keys(inTry).join());
          console.log(inTry === unwrapped, inCatch === unwrapped);
          inTry.count = 41;
          console.log(inTry.count, inTry.inc(), unwrapped.count);
        `,
        ...reactWithCounter,
        "/node_modules/other/package.json": /* json */ `
          { "name": "other", "version": "19.0.0", "main": "index.js" }
        `,
        "/node_modules/other/index.js": reactWithCounter["/node_modules/react/index.js"],
      },
      backend,
      onAfterBundle(api) {
        const code = api.readFile("out.js");
        expect(code).toContain("inTry = (init_react(), exports_react);");
        expect(code).toContain("inCatch = (init_react(), exports_react);");
        expect(code).toContain("other = require_other();");
        expect(code).not.toContain("__toCommonJS");
      },
      run: {
        stdout: "undefined undefined undefined undefined\nFA make,count,inc\ntrue true\n41 42 42",
      },
    });
  }
  // A specifier that is not on the unwrap list can resolve to a file of a
  // listed package. The parser keeps such a call with no `try` around it.
  itBundled("cjs2esm/KeptRequireOfLiftedCommonJSThroughAlias", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        import { viaRelativePath } from "sibling";
        const unwrapped = require("react");
        const viaTsconfigPaths = require("tsconfig-alias");
        const viaPackageImports = require("#react");
        for (const m of [viaTsconfigPaths, viaPackageImports, viaRelativePath()]) {
          console.log(m.__esModule, m === unwrapped, (m.count = m.count + 40), m.inc());
        }
      `,
      "/tsconfig.json": /* json */ `
        { "compilerOptions": { "baseUrl": ".", "paths": { "tsconfig-alias": ["./node_modules/react/index.js"] } } }
      `,
      "/package.json": /* json */ `
        { "name": "app", "imports": { "#react": "react" } }
      `,
      "/node_modules/sibling/package.json": /* json */ `
        { "name": "sibling", "version": "1.0.0", "main": "index.js" }
      `,
      "/node_modules/sibling/index.js": /* js */ `
        exports.viaRelativePath = () => require("../react");
      `,
      ...reactWithCounter,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__toCommonJS");
    },
    run: {
      stdout: "undefined true 40 41\nundefined true 81 82\nundefined true 122 123",
    },
  });
  // The parser binds names read off a require() result, but it leaves
  // `__esModule` and `default` to the object that the call returns.
  itBundled("cjs2esm/KeptRequireOfLiftedCommonJSReadsEsModuleOffNamespace", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        try {
          const m = require("react");
          console.log(m.__esModule, typeof m.default, m.make("A"));
          const { make, __esModule } = require("react");
          console.log(__esModule, make("B"));
        } catch (e) {
          console.log(e);
        }
      `,
      ...reactWithCounter,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__toCommonJS");
    },
    run: {
      stdout: "undefined undefined FA\nundefined FB",
    },
  });
  // A lifted file that sets `exports.__esModule` exports that name itself.
  // It is enumerable, as on `module.exports`, and not on a `__toCommonJS` copy.
  itBundled("cjs2esm/KeptRequireOfLiftedCommonJSThatSetsEsModule", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        let m;
        try { m = require("react"); } catch {}
        console.log(m.__esModule, Object.keys(m).join(), (m.__esModule ? m.default : m).tag, m.named);
      `,
      "/node_modules/react/package.json": reactWithCounter["/node_modules/react/package.json"],
      "/node_modules/react/index.js": /* js */ `
        exports.__esModule = true;
        exports.default = { tag: "default" };
        exports.named = 1;
      `,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__toCommonJS");
    },
    run: {
      stdout: "true __esModule,default,named default 1",
    },
  });
  // The shape of react-dom/server.node.js, read the way Babel and TypeScript
  // compile `import Server from "react-dom/server"`. With a synthetic
  // `__esModule`, `Server.default` is `undefined`.
  itBundled("cjs2esm/KeptRequireOfLiftedCommonJSThroughInteropHelper", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
        let Server;
        try { Server = _interopRequireDefault(require("react-dom/server")); } catch {}
        console.log(typeof Server.default, Server.default.renderToString("x"), Server.default.version);
      `,
      "/node_modules/react-dom/package.json": /* json */ `
        { "name": "react-dom", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/react-dom/server.js": /* js */ `
        'use strict';
        module.exports = require('./server.node');
      `,
      "/node_modules/react-dom/server.node.js": /* js */ `
        'use strict';
        var l;
        if (process.env.NODE_ENV === 'production') {
          l = require('./cjs/react-dom-server-legacy.node.production.js');
        } else {
          l = require('./cjs/react-dom-server-legacy.node.development.js');
        }
        exports.version = l.version;
        exports.renderToString = l.renderToString;
      `,
      "/node_modules/react-dom/cjs/react-dom-server-legacy.node.production.js": /* js */ `
        exports.version = "19.0.0";
        exports.renderToString = x => "<" + x + ">";
      `,
      "/node_modules/react-dom/cjs/react-dom-server-legacy.node.development.js": /* js */ `
        exports.version = "19.0.0-development";
        exports.renderToString = x => "<development " + x + ">";
      `,
    },
    env: {
      NODE_ENV: "production",
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("_interopRequireDefault((init_server_node(), exports_server_node))");
    },
    run: {
      stdout: "object <x> 19.0.0",
    },
  });
  // The shape of react-dom/index.js. With `--minify-syntax` and a production
  // NODE_ENV, `module.exports = require()` after the side effect is lifted to
  // `export * from`. The file is as much CommonJS as the file it re-exports.
  const reactDomIndex = {
    "/node_modules/react-dom/package.json": /* json */ `
      { "name": "react-dom", "version": "19.0.0", "main": "index.js" }
    `,
    "/node_modules/react-dom/index.js": /* js */ `
      'use strict';
      function checkDCE() {
        if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined') {
          console.log('checkDCE');
        }
      }
      if (process.env.NODE_ENV === 'production') {
        checkDCE();
        module.exports = require('./cjs/react-dom.production.js');
      } else {
        module.exports = require('./cjs/react-dom.development.js');
      }
    `,
    "/node_modules/react-dom/cjs/react-dom.production.js": /* js */ `
      exports.createRoot = function createRoot() { return "production root"; };
      exports.version = "19.0.0";
    `,
    "/node_modules/react-dom/cjs/react-dom.development.js": /* js */ `
      'use strict';
      (function () {
        exports.createRoot = function createRoot() { return "development root"; };
        exports.version = "19.0.0";
      })();
    `,
  };
  itBundled("cjs2esm/KeptRequireOfLiftedModuleExportsEqualsRequire", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        let m;
        try { m = require("react-dom"); } catch {}
        console.log(m.__esModule, Object.keys(m).join(), m.createRoot());
      `,
      ...reactDomIndex,
    },
    minifySyntax: true,
    env: {
      NODE_ENV: "production",
    },
    onAfterBundle(api) {
      const code = api.readFile("out.js");
      expect(code).toContain("m = (init_react_dom(), exports_react_dom)");
      expect(code).not.toContain("__toCommonJS");
    },
    run: {
      stdout: "checkDCE\nundefined createRoot,version production root",
    },
  });
  // The namespace of such a file has a getter and no setter for a name that
  // it re-exports, and it is not the object of the file it re-exports.
  itBundled("cjs2esm/KeptRequireOfLiftedModuleExportsEqualsRequireWriteAndIdentity", {
    matchesBunRun: true,
    todo: true,
    files: {
      "/entry.js": /* js */ `
        let m;
        try { m = require("react-dom"); } catch {}
        m.version = "patched";
        console.log(m.version, m === require("react-dom/cjs/react-dom.production.js"));
      `,
      ...reactDomIndex,
    },
    minifySyntax: true,
    env: {
      NODE_ENV: "production",
    },
    run: {
      stdout: "checkDCE\npatched true",
    },
  });
  // The kept call, an unwrapped require() and the `default` of an import() of
  // such a file are one object.
  itBundled("cjs2esm/KeptRequireOfLiftedModuleExportsEqualsRequireIdentity", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        let kept;
        try { kept = require("react-dom"); } catch {}
        const unwrapped = require("react-dom");
        const ns = await import("react-dom");
        console.log(kept === unwrapped, ns.default === kept);
      `,
      ...reactDomIndex,
    },
    minifySyntax: true,
    env: {
      NODE_ENV: "production",
    },
    run: {
      stdout: "checkDCE\ntrue true",
    },
  });
  // The file that such a module re-exports can be a CommonJS file of a
  // package outside the list. The parser lifts the exports of that file too.
  itBundled("cjs2esm/KeptRequireOfLiftedModuleExportsEqualsRequireOfOtherPackage", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        let m;
        try { m = require("react-is"); } catch {}
        const ns = await import("react-is");
        console.log(m.__esModule, Object.keys(m).join(), m.bump(), m.value, globalThis.sideEffect, ns.default === m);
      `,
      "/node_modules/react-is/package.json": /* json */ `
        { "name": "react-is", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/react-is/index.js": /* js */ `
        globalThis.sideEffect = true;
        module.exports = require("other");
      `,
      "/node_modules/other/package.json": /* json */ `
        { "name": "other", "version": "1.0.0", "main": "index.js" }
      `,
      "/node_modules/other/index.js": /* js */ `
        exports.value = "v";
        exports.bump = () => (exports.value += "!");
      `,
    },
    onAfterBundle(api) {
      const code = api.readFile("out.js");
      expect(code).toContain("m = (init_react_is(), exports_react_is)");
      expect(code).not.toContain("__toCommonJS");
    },
    run: {
      stdout: "undefined value,bump v! v! true true",
    },
  });
  // Control: a file with no JavaScript exports, here an empty one, is not a
  // lifted CommonJS file. `bun run` loads it as an ES module.
  itBundled("cjs2esm/KeptRequireOfLiftedModuleExportsEqualsRequireOfEmptyFile", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        let m;
        try { m = require("react-is"); } catch {}
        console.log(m.__esModule, JSON.stringify(Object.keys(m)), globalThis.sideEffect);
      `,
      "/node_modules/react-is/package.json": /* json */ `
        { "name": "react-is", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/react-is/index.js": /* js */ `
        globalThis.sideEffect = true;
        module.exports = require("./empty.js");
      `,
      "/node_modules/react-is/empty.js": "",
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("m = (init_react_is(), __toCommonJS(exports_react_is));");
    },
    run: {
      stdout: "true [] true",
    },
  });
  // Controls for the same file. Without `--minify-syntax` the `if` stays, and
  // the file keeps its `__commonJS` wrapper. In a development build the
  // wrapper also converts the development file, which is another defect.
  itBundled("cjs2esm/KeptRequireOfModuleExportsEqualsRequireInAnIfKeepsWrapper", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        let m;
        try { m = require("react-dom"); } catch {}
        console.log(m.__esModule, Object.keys(m).join(), m.createRoot());
      `,
      ...reactDomIndex,
    },
    env: {
      NODE_ENV: "production",
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("m = require_react_dom();");
    },
    run: {
      stdout: "checkDCE\nundefined createRoot,version production root",
    },
  });
  itBundled("cjs2esm/KeptRequireOfModuleExportsEqualsRequireDevelopmentKeepsWrapper", {
    files: {
      "/entry.js": /* js */ `
        let m;
        try { m = require("react-dom"); } catch {}
        console.log(m.createRoot());
      `,
      ...reactDomIndex,
    },
    env: {
      NODE_ENV: "development",
    },
    onAfterBundle(api) {
      const code = api.readFile("out.js");
      expect(code).toContain("m = require_react_dom();");
      expect(code).toContain("__toESM(require_react_dom_development())");
    },
    run: {
      stdout: "development root",
    },
  });
  // `bun run` loads a file with no exports as CommonJS when it calls
  // require(), or when it starts with "use strict".
  itBundled("cjs2esm/KeptRequireOfLiftedCommonJSWithNoExports", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        let m, n;
        try { m = require("react"); } catch {}
        try { n = require("scheduler"); } catch {}
        console.log(m.__esModule, Object.keys(m).length, globalThis.fromDependency);
        console.log(n.__esModule, Object.keys(n).length, globalThis.sideEffect);
      `,
      "/node_modules/react/package.json": reactWithCounter["/node_modules/react/package.json"],
      "/node_modules/react/index.js": /* js */ `
        const dependency = require("./dependency");
        globalThis.fromDependency = dependency.value;
      `,
      "/node_modules/react/dependency.js": /* js */ `
        exports.value = "value";
      `,
      "/node_modules/scheduler/package.json": /* json */ `
        { "name": "scheduler", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/scheduler/index.js": /* js */ `
        'use strict';
        globalThis.sideEffect = true;
      `,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__toCommonJS");
    },
    run: {
      stdout: "undefined 0 value\nundefined 0 true",
    },
  });
  // `bun run` loads a file that assigns `exports.x` as CommonJS, also in a
  // package with "type": "module".
  itBundled("cjs2esm/KeptRequireOfLiftedCommonJSInTypeModulePackage", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        let m;
        try { m = require("react"); } catch {}
        console.log(m.__esModule, m.make("A"));
      `,
      "/node_modules/react/package.json": /* json */ `
        { "name": "react", "version": "19.0.0", "main": "index.js", "type": "module" }
      `,
      "/node_modules/react/index.js": reactWithCounter["/node_modules/react/index.js"],
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__toCommonJS");
    },
    run: {
      stdout: "undefined FA",
    },
  });
  // Two files that re-export each other never reach a file that decides.
  itBundled("cjs2esm/KeptRequireOfLiftedModuleExportsEqualsRequireCycle", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        let m;
        try { m = require("react"); } catch {}
        console.log(m.__esModule, Object.keys(m).length, globalThis.loaded);
      `,
      "/node_modules/react/package.json": reactWithCounter["/node_modules/react/package.json"],
      "/node_modules/react/index.js": /* js */ `
        globalThis.loaded = (globalThis.loaded ?? 0) + 1;
        module.exports = require("./other");
      `,
      "/node_modules/react/other.js": /* js */ `
        globalThis.loaded = (globalThis.loaded ?? 0) + 1;
        module.exports = require("./index");
      `,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__toCommonJS");
    },
    run: {
      stdout: "undefined 0 2",
    },
  });
  // Controls: an ES module by syntax is an ES module to `bun run` too, so
  // require() of it has `__esModule` and keeps the `__toCommonJS` copy. The
  // same holds for a lifted `module.exports = require()` of an ES module.
  itBundled("cjs2esm/KeptRequireOfESModuleInUnwrappedPackageKeepsEsModule", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        const loaded = [];
        try { loaded.push(require("scheduler")); } catch {}
        try { loaded.push(require("react-is")); } catch {}
        for (const m of loaded) console.log(m.__esModule, JSON.stringify(Object.keys(m)));
      `,
      "/node_modules/scheduler/package.json": /* json */ `
        { "name": "scheduler", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/scheduler/index.js": /* js */ `
        const dependency = require("./dependency.js");
        export const value = dependency.value;
      `,
      "/node_modules/scheduler/dependency.js": /* js */ `
        exports.value = "value";
      `,
      "/node_modules/react-is/package.json": /* json */ `
        { "name": "react-is", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/react-is/index.js": /* js */ `
        globalThis.sideEffect = true;
        module.exports = require("./impl.mjs");
      `,
      "/node_modules/react-is/impl.mjs": /* js */ `
        export const isElement = () => true;
      `,
    },
    onAfterBundle(api) {
      const code = api.readFile("out.js");
      for (const name of ["scheduler", "react_is"]) {
        expect(code).toContain(`__toCommonJS(exports_${name})`);
      }
    },
    run: {
      stdout: 'true ["value"]\ntrue ["isElement"]',
    },
  });
  // An `import()` of the file in the same bundle resolves to a namespace
  // whose `default` is that same object.
  itBundled("cjs2esm/KeptRequireOfLiftedCommonJSIsDefaultOfImport", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        let m;
        try { m = require("react"); } catch {}
        const ns = await import("react");
        console.log(m.__esModule, ns.default === m, ns.make === m.make);
      `,
      ...reactWithCounter,
    },
    run: {
      stdout: "undefined true true",
    },
  });
  // The same with code splitting, when the lifted file stays in a chunk that
  // the caller imports: with `splitRequire: false`, and for a target that
  // cannot split a require().
  for (const [name, options] of [
    ["SplitRequireOff", { target: "bun", splitRequire: false }],
    ["TargetNode", { target: "node" }],
  ] as const) {
    itBundled(`cjs2esm/KeptRequireOfLiftedCommonJSWithSplitting-${name}`, {
      matchesBunRun: true,
      files: {
        "/main.ts": /* ts */ `
          let m;
          try { m = require("react"); } catch {}
          m.count = 41;
          const ns = await import("react");
          console.log(m.__esModule, m.inc(), ns.default === m);
        `,
        ...reactWithCounter,
      },
      entryPoints: ["/main.ts"],
      splitting: true,
      outdir: "/out",
      format: "esm",
      ...options,
      onAfterBundle(api) {
        api.expectFile("/out/main.js").toContain("m = (init_react(), exports_react);");
        api.expectFile("/out/main.js").not.toContain("__toCommonJS");
      },
      run: { file: "/out/main.js", stdout: "undefined 42 true" },
    });
  }
  // Only ESM output lifts. With CommonJS output the file keeps its wrapper.
  // With IIFE output a file with no exports is an ES module, as under any
  // other package name.
  itBundled("cjs2esm/KeptRequireOfCommonJSFormatCjs", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        const unwrapped = require("react");
        let m;
        try { m = require("react"); } catch {}
        m.count = 41;
        console.log(m.__esModule, m === unwrapped, m.inc());
      `,
      ...reactWithCounter,
    },
    format: "cjs",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("m = require_react();");
    },
    run: {
      stdout: "undefined true 42",
    },
  });
  itBundled("cjs2esm/KeptRequireOfFileWithNoExportsFormatIife", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        import "./side-effect.js";
        let m;
        try { m = require("react"); } catch {}
        console.log(m.__esModule, globalThis.sideEffect);
      `,
      "/side-effect.js": /* js */ `
        globalThis.entryLoaded = true;
      `,
      "/node_modules/react/package.json": reactWithCounter["/node_modules/react/package.json"],
      "/node_modules/react/index.js": /* js */ `
        globalThis.sideEffect = true;
      `,
    },
    format: "iife",
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__toCommonJS(exports_react)");
    },
    run: {
      stdout: "true true",
    },
  });
  // Where the namespace object is not `module.exports`. Each comment gives
  // what `bun run` prints.
  itBundled("cjs2esm/KeptRequireOfLiftedCommonJSDiffersFromBunRun", {
    files: {
      "/entry.js": /* js */ `
        let m, plain, typeModule;
        try { m = require("react"); } catch {}
        try { plain = require("scheduler"); } catch {}
        try { typeModule = require("react-is"); } catch {}
        // 65 70: the module reads the property that was defined.
        Object.defineProperty(m, "x", { value: 65, writable: true, enumerable: true, configurable: true });
        console.log(m.x, m.sum());
        // true NaN: the module reads the property that was deleted.
        console.log(delete m.y, m.sum());
        // 3: a frozen object ignores the write.
        Object.freeze(m);
        m.z = 66;
        console.log(m.z);
        // true: a file with no exports, no require() and no "use strict" is an ES module to Bun. Node prints undefined.
        console.log(plain.__esModule);
        // true value: so is a file that only calls require(), in a package with "type": "module".
        console.log(typeModule.__esModule, globalThis.fromDependency);
      `,
      "/node_modules/react/package.json": reactWithCounter["/node_modules/react/package.json"],
      "/node_modules/react/index.js": /* js */ `
        exports.x = 1;
        exports.y = 2;
        exports.z = 3;
        exports.sum = () => exports.x + exports.y + exports.z;
      `,
      "/node_modules/scheduler/package.json": /* json */ `
        { "name": "scheduler", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/scheduler/index.js": /* js */ `
        globalThis.sideEffect = true;
      `,
      "/node_modules/react-is/package.json": /* json */ `
        { "name": "react-is", "version": "19.0.0", "main": "index.js", "type": "module" }
      `,
      "/node_modules/react-is/index.js": /* js */ `
        const dependency = require("./dependency.cjs");
        globalThis.fromDependency = dependency.value;
      `,
      "/node_modules/react-is/dependency.cjs": /* js */ `
        exports.value = "value";
      `,
    },
    run: {
      stdout: "65 6\ntrue 6\n66\nundefined\nundefined value",
    },
  });
  // A write after `Object.freeze()` still reaches the lifted binding, through
  // the setter of the namespace object. `bun run` prints `3 true 6`.
  itBundled("cjs2esm/KeptRequireOfLiftedCommonJSWriteAfterFreeze", {
    files: {
      "/entry.js": /* js */ `
        let m;
        try { m = require("react"); } catch {}
        Object.freeze(m);
        try { m.z = 66; } catch (e) { console.log(e.constructor.name); }
        console.log(m.z, Object.isFrozen(m), m.sum());
      `,
      "/node_modules/react/package.json": reactWithCounter["/node_modules/react/package.json"],
      "/node_modules/react/index.js": /* js */ `
        exports.x = 1;
        exports.y = 2;
        exports.z = 3;
        exports.sum = () => exports.x + exports.y + exports.z;
      `,
    },
    run: {
      stdout: "66 true 69",
    },
  });
  // A lifted file can set a property named "module.exports". The call returns
  // the whole object, as for any CommonJS file.
  itBundled("cjs2esm/KeptRequireOfLiftedCommonJSWithModuleExportsName", {
    matchesBunRun: true,
    files: {
      "/entry.js": /* js */ `
        let m;
        try { m = require("react"); } catch {}
        console.log(m.__esModule, m["module.exports"], m.named);
      `,
      "/node_modules/react/package.json": reactWithCounter["/node_modules/react/package.json"],
      "/node_modules/react/index.js": /* js */ `
        exports["module.exports"] = 5;
        exports.named = 1;
      `,
    },
    run: {
      stdout: "undefined 5 1",
    },
  });
  // `import * as ns` of a lifted file is that same object. `bun run` prints false.
  itBundled("cjs2esm/KeptRequireOfLiftedCommonJSIsTheImportStarObject", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from "react";
        let m;
        try { m = require("react"); } catch {}
        console.log(m === ns);
      `,
      ...reactWithCounter,
    },
    run: {
      stdout: "true",
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
  // lifted `x`. The namespace object exists for a write (`React.x = 1`), a
  // computed access (`React[k]`) or a method call that reads `this`. Code that
  // holds `React` as a value makes the module keep its wrapper instead.
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
        );
      `,
      ...liftedReact,
    },
    cjs2esm: true,
    run: {
      stdout: "true true true",
    },
  });
  itBundled("cjs2esm/DefaultImportComputedMemberKeepsNamespace", {
    files: {
      "/entry.js": /* js */ `
        import React from "react";
        const key = " useId ".trim();
        console.log(React[key](), React.useState(5)[0]);
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
      stdout: "id 5",
    },
  });
  itBundled("cjs2esm/DefaultImportDotDefaultIsNamespace", {
    files: {
      "/entry.js": /* js */ `
        import React from "react";
        import * as R from "react";
        console.log(React.default.useState === React.useState, R.default.useState === React.useState);
      `,
      ...liftedReact,
    },
    cjs2esm: true,
    run: {
      // the module has no `default` export, so `.default` is `module.exports`
      // through both import forms
      stdout: "true true",
    },
  });
  itBundled("cjs2esm/DefaultImportDotDefaultOfExportsDefault", {
    files: {
      "/entry.js": /* js */ `
        import lib from "./lib.js";
        import * as ns from "./lib.js";
        console.log(lib.default(), ns.default(), ns.default === lib.default, lib.foo);
      `,
      "/lib.js": /* js */ `
        exports.default = function def() { return "def"; };
        exports.foo = 1;
      `,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      // `lib.default` and `ns.default` bind to the lifted export
      api.expectFile("/out.js").toContain("$default()");
    },
    run: {
      // without `__esModule`, the default import is the whole `module.exports`,
      // and `ns.default` is its own `default` key
      stdout: "def def true 1",
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
        console.log(lib.default === ns, lib.__esModule, lib.foo);
      `,
      ...esModuleNoDefault,
    },
    cjs2esm: true,
    run: {
      stdout: "true true 1",
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
  // A re-export hands `module.exports` to importers step 1 of the linker does
  // not follow, so the module keeps its wrapper: any of them can hold the
  // object as a value.
  for (const [name, barrel, importer] of [
    [
      "ReExportDefaultAsNameFromLiftedCommonJS",
      `export { default as R } from "react";`,
      `import { R } from "./barrel.js";`,
    ],
    [
      "ExportClauseOfLiftedCommonJSDefaultImport",
      `import React from "react"; export { React as R };`,
      `import { R } from "./barrel.js";`,
    ],
    [
      "ExportDefaultOfLiftedCommonJSDefaultImport",
      `import React from "react"; export default React;`,
      `import R from "./barrel.js";`,
    ],
  ]) {
    itBundled(`cjs2esm/${name}`, {
      files: {
        "/entry.js": /* js */ `
          ${importer}
          console.log(R.createElement("span").type, R.useState(2)[0]);
          Object.freeze(R);
          try { R.version = "patched"; } catch {}
          console.log(R.version, Object.isFrozen(R));
        `,
        "/barrel.js": barrel,
        ...liftedReact,
      },
      cjs2esm: { unhandled: ["/node_modules/react/index.js"] },
      run: {
        stdout: "span 2\n19.0.0 true",
      },
    });
  }
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
  // `--minify-syntax` rewrites `X["name"]` to `X.name`. The new node is still the
  // call target or the template tag, so the call still passes `X` as `this`.
  itBundled("cjs2esm/DefaultImportComputedMemberKeepsThisMinifySyntax", {
    files: {
      "/entry.js": /* js */ `
        import st from "./lib.cjs";
        console.log(st["parse"]("y"), st["tag"]\`z\`);
      `,
      ...thisReadingLib,
    },
    cjs2esm: true,
    minifySyntax: true,
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain('console.log(exports_lib.parse("y"), exports_lib.tag`z`);');
    },
    run: {
      stdout: "helped:y helped:z",
    },
  });
  itBundled("cjs2esm/StarImportComputedMemberKeepsThisMinifySyntax", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from "./lib.cjs";
        console.log(ns["parse"]("y"), ns["tag"]\`z\`);
      `,
      ...thisReadingLib,
    },
    cjs2esm: true,
    minifySyntax: true,
    onAfterBundle(api) {
      // Each access keeps a receiver. The printed name of `ns` is not part of this test.
      expect(api.readFile("/out.js")).toMatch(/console\.log\(\w+\.parse\("y"\), \w+\.tag`z`\);/);
    },
    run: {
      stdout: "helped:y helped:z",
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
  itBundled("cjs2esm/SelfComputedMemberKeepsThisMinifySyntax", {
    files: {
      "/entry.js": /* js */ `
        import { internal, viaTag } from "./lib.cjs";
        console.log(internal(), viaTag());
      `,
      "/lib.cjs": /* js */ `
        exports.parse = function (s) { return this._helper(s); };
        exports._helper = function (s) { return "helped:" + s; };
        exports.tag = function (strings) { return this._helper(strings[0]); };
        exports.internal = function () { return exports["parse"]("in"); };
        exports.viaTag = function () { return exports["tag"]\`tag\`; };
      `,
    },
    cjs2esm: true,
    minifySyntax: true,
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain('return exports_lib.parse("in");');
      expect(out).toContain("return exports_lib.tag`tag`;");
    },
    run: {
      stdout: "helped:in helped:tag",
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
        console.log("b", React.useState(2)[0], React.useId === R.useId, Object.keys(R).length);
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
        console.log(m.default === ns, m.default.expando, lib.version, m.version, Object.keys(m.default).join(","));
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
    // `m.default.expando` reads what `lib.expando = 1` wrote: one object
    run: { file: "/out/entry.js", stdout: "true 1 patched patched createElement,version,expando" },
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
        console.log(m.default.useState === React.useState, m.useState === React.useState, m.default.useId());
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
        console.log(m.default.default, lib.default, m.x);
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
    run: { file: "/out/entry.js", stdout: "d d 1" },
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
          m.default.useState === React.useState,
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
        console.log(m.default.useState === React.useState, m.useState === React.useState, m.default.useId());
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

  // Code that holds the default import as a value can change the object
  // itself: `Object.defineProperty`, `delete`, `Object.freeze`. The getters and
  // setters of a namespace object cannot carry that to the lifted bindings, so
  // the module keeps its wrapper and the importer gets the real
  // `module.exports`. Each `stdout` below is what Node prints.
  const objectOperationTargets = {
    "/lib.cjs": /* js */ `
      exports.x = 1;
      exports.y = 2;
      exports.sum = function () { return exports.x + exports.y; };
    `,
    "/cfg.cjs": /* js */ `
      exports.z = 3;
    `,
  };
  const objectOperations = /* js */ `
    import lib from "./lib.cjs";
    import cfg from "./cfg.cjs";
    Object.defineProperty(lib, "x", { value: 65, writable: true, enumerable: true, configurable: true });
    console.log("defineProperty", lib.x, lib.sum());
    console.log("delete", delete lib.y, lib.y, "y" in lib, lib.sum());
    Object.freeze(cfg);
    try { cfg.z = 66; } catch {}
    console.log("freeze", cfg.z, Object.isFrozen(cfg));
  `;
  const objectOperationsStdout = "defineProperty 65 67\ndelete true undefined false NaN\nfreeze 3 true";
  itBundled("cjs2esm/DefaultImportObjectOperationsReachModuleExports", {
    files: {
      "/entry.mjs": objectOperations,
      ...objectOperationTargets,
    },
    cjs2esm: { unhandled: ["/lib.cjs", "/cfg.cjs"] },
    run: { stdout: objectOperationsStdout },
  });
  itBundled("cjs2esm/DefaultImportObjectOperationsReachModuleExportsMinified", {
    files: {
      "/entry.mjs": objectOperations,
      ...objectOperationTargets,
    },
    minifySyntax: true,
    minifyIdentifiers: true,
    minifyWhitespace: true,
    run: { stdout: objectOperationsStdout },
  });
  itBundled("cjs2esm/DefaultImportObjectOperationsReachModuleExportsSplitting", {
    files: {
      "/entry.js": objectOperations,
      "/other.js": /* js */ `
        import lib from "./lib.cjs";
        console.log("other", lib.x, lib.sum());
      `,
      ...objectOperationTargets,
    },
    entryPoints: ["/entry.js", "/other.js"],
    outdir: "/out",
    splitting: true,
    run: [
      { file: "/out/entry.js", stdout: objectOperationsStdout },
      { file: "/out/other.js", stdout: "other 1 3" },
    ],
  });
  // One importer that holds the object is enough. An importer that only reads
  // properties sees the same real object.
  itBundled("cjs2esm/DefaultImportHeldAsValueInOneImporter", {
    files: {
      "/entry.mjs": /* js */ `
        import lib from "./lib.cjs";
        import { read } from "./reader.mjs";
        const alias = lib;
        delete alias.y;
        (object => Object.defineProperty(object, "x", { value: 65 }))(lib);
        console.log(lib.x, lib.y, read());
      `,
      "/reader.mjs": /* js */ `
        import lib from "./lib.cjs";
        export const read = () => [lib.x, lib.y, lib.sum()].join(",");
      `,
      ...objectOperationTargets,
    },
    cjs2esm: { unhandled: ["/lib.cjs"] },
    run: { stdout: "65 undefined 65,,NaN" },
  });
  itBundled("cjs2esm/DefaultImportDeleteMemberKeepsWrapper", {
    files: {
      "/entry.mjs": /* js */ `
        import lib from "./lib.cjs";
        console.log(delete lib.y, lib.y, lib.sum(), delete lib["x"], lib.x);
      `,
      ...objectOperationTargets,
    },
    cjs2esm: { unhandled: ["/lib.cjs"] },
    run: { stdout: "true undefined NaN true undefined" },
  });
  itBundled("cjs2esm/DefaultImportPassedAsValueKeepsAssignmentOrder", {
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
    cjs2esm: { unhandled: ["/lib.js"] },
    run: {
      stdout: '{"zeta":1,"alpha":2} object 1',
    },
  });
  // `emitDecoratorMetadata` passes the import itself to `Reflect.metadata`.
  itBundled("cjs2esm/DefaultImportHeldByDecoratorMetadata", {
    files: {
      "/entry.ts": /* ts */ `
        import Lib from "./lib.cjs";
        const seen: any[] = [];
        (Reflect as any).metadata = (key: string, value: any) => () => { seen.push(value); };
        function dec(..._args: any[]) {}
        class A {
          @dec prop: Lib;
        }
        Object.defineProperty(seen[0], "x", { value: 65 });
        console.log(Lib.x, Lib.sum());
      `,
      "/tsconfig.json": /* json */ `
        { "compilerOptions": { "experimentalDecorators": true, "emitDecoratorMetadata": true } }
      `,
      ...objectOperationTargets,
    },
    cjs2esm: { unhandled: ["/lib.cjs"] },
    run: { stdout: "65 67" },
  });
  // The shape of react-dom/index.js. The wrapped file assigns the namespace
  // object of "./main", as in 1.4.0, and every read goes through that object.
  itBundled("cjs2esm/DefaultImportHeldAsValueOfModuleExportsEqualsRequire", {
    files: {
      "/entry.js": /* js */ `
        import ReactDOM from "react-dom";
        Object.defineProperty(ReactDOM, "version", { value: "dp", writable: true, enumerable: true, configurable: true });
        console.log(ReactDOM.version, delete ReactDOM.render, "render" in ReactDOM);
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        console.log('side effect');
        module.exports = require('./main');
      `,
      "/node_modules/react-dom/main.js": /* js */ `
        "use strict";
        exports.version = "19.0.0";
        exports.render = () => "rendered";
      `,
    },
    minifySyntax: true,
    run: {
      stdout: "side effect\ndp true false",
    },
  });
  // Reads, calls and writes of a property, and a destructuring declaration,
  // do not hold the object: the module stays lifted.
  itBundled("cjs2esm/DefaultImportPropertyAccessStaysLifted", {
    files: {
      "/entry.mjs": /* js */ `
        import lib from "./lib.cjs";
        const { x, sum } = lib;
        const key = "y";
        lib.x = 10;
        lib[key] += 1;
        console.log(x, lib.x, lib[key], lib?.y, sum(), lib.sum(), typeof lib.missing);
      `,
      ...objectOperationTargets,
    },
    cjs2esm: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("__toESM");
    },
    run: { stdout: "1 10 3 3 13 13 undefined" },
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
