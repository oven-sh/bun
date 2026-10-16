import { describe, expect, test } from "bun:test";
import { bunExe, isASAN, isDebug } from "harness";
import { readdirSync } from "node:fs";
import { bundlerTestTimeout, itBundled, type BundlerTestBundleAPI } from "./expectBundled";
import { checkMatrix, type Options } from "./unwrapped-require-matrix";

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
  // declaration is an import: the pattern reads its namespace object. One
  // inside try/catch is never unwrapped and prints as an ordinary require.
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
  // `x = require("react")` as a declaration: the require() becomes
  // `import * as ns`. `x` becomes `ns` itself, and the declaration goes, only
  // when nothing can rebind `x`. Otherwise `x` stays a variable that holds `ns`.
  const unwrapListPackages = {
    "/node_modules/react/package.json": /* json */ `
      { "name": "react", "version": "19.0.0", "main": "index.js" }
    `,
    // Converts to ESM: its exports are statically known.
    "/node_modules/react/index.js": /* js */ `
      exports.react = "react";
      exports.other = "other";
      exports.unused = "DROP_REACT";
    `,
    "/node_modules/react-is/package.json": /* json */ `
      { "name": "react-is", "version": "19.0.0", "main": "index.js" }
    `,
    "/node_modules/react-is/index.js": /* js */ `
      exports.is = "is";
      exports.unusedIs = "DROP_REACT_IS";
    `,
    "/node_modules/scheduler/package.json": /* json */ `
      { "name": "scheduler", "version": "0.25.0", "main": "index.js" }
    `,
    // Stays a `__commonJS` wrapper: it assigns `module.exports`.
    "/node_modules/scheduler/index.js": /* js */ `
      module.exports = { sched: "sched" };
    `,
  };
  for (const minify of [false, true]) {
    // Every shape that nothing rebinds reads the exports directly: no
    // namespace object, and the exports nothing reads are gone.
    itBundled(`cjs2esm/UnwrappedRequireAliasBindsDirectly${minify ? "Minified" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          var top = require("react");
          let topLet = require("react");
          const topConst = require("react");
          var x = 1, inList = require("react"), y = 2;
          function fn() {
            var a = require("react");
            let b = require("react");
            const c = require("react");
            var p = 1, d = require("react-is"), q = 2;
            return [a.react, b.react, c.other, d.is, p + q].join(" ");
          }
          const react_1 = require("react");
          function typescriptOutput() {
            return (0, react_1.react);
          }
          var e = require("react-is");
          // Another variable with the name of one above, and a write to it.
          function reuse(e) {
            e += 1;
            return e;
          }
          function shadows() {
            {
              let top = 1;
              top++;
            }
            if (globalThis) {
              var topLet = "shadow";
              topLet += "ed";
            }
            return topLet;
          }
          (function () {
            var e = require("react");
            console.log(e.other);
          })();
          class Holder {
            static {
              const inStaticBlock = require("react");
              Holder.value = inStaticBlock.other;
            }
          }
          // A \`let\` or \`const\` of a block that nothing rebinds.
          function blocks(on) {
            const out = [];
            {
              const inBlock = require("react");
              out.push(inBlock.react);
            }
            if (!on) {
              out.push("off");
            } else if (on) {
              let inElseIf = require("react");
              out.push(inElseIf.other);
            }
            for (const once of [1]) {
              const inLoop = require("react-is");
              out.push(inLoop.is);
            }
            switch (on) {
              case true:
                const inCase = require("react");
                out.push(inCase.react);
            }
            try {
            } finally {
              const inFinally = require("react-is");
              out.push(inFinally.is);
            }
            return out.join(" ");
          }
          {
            const topBlock = require("react");
            console.log(topBlock.other);
          }
          console.log(top.react, topLet.react, topConst.other, x, inList.react, y);
          console.log(fn(), typescriptOutput(), e.is, reuse(1), shadows(), Holder.value);
          console.log(blocks(true));
        `,
        ...unwrapListPackages,
      },
      minifySyntax: minify,
      minifyIdentifiers: minify,
      minifyWhitespace: minify,
      dce: true,
      dceKeepMarkerCount: false,
      onAfterBundle(api) {
        if (minify) return;
        const code = api.readFile("out.js");
        expect(code).not.toContain("exports_react");
        expect(code).not.toContain("__toESM");
        expect(code).toContain(`return [$react, $react, $other, $is, p + q].join(" ");`);
        expect(code).toContain("console.log($react, $react, $other, x, $react, y);");
        // The declaration of each block variable is gone.
        for (const name of ["inBlock", "inElseIf", "inLoop", "inCase", "inFinally", "topBlock"]) {
          expect(code).not.toContain(name);
        }
      },
      run: {
        stdout: [
          "other",
          "other",
          "react react other 1 react 2",
          "react react other is 3 react is 2 shadowed other",
          "react other is react is",
        ].join("\n"),
      },
    });
  }
  // A use of the variable as a value needs the namespace object. The property
  // reads next to it still read the exports directly.
  itBundled("cjs2esm/UnwrappedRequireAliasUsedAsValue", {
    files: {
      "/entry.js": /* js */ `
        const React = require("react");
        globalThis.keep = React;
        function fn() {
          var inner = require("react-is");
          globalThis.keepIs = inner;
          return inner.is;
        }
        console.log(React.react, globalThis.keep.other, fn(), globalThis.keepIs.is);
      `,
      ...unwrapListPackages,
    },
    onAfterBundle(api) {
      const code = api.readFile("out.js");
      expect(code).toContain("globalThis.keep = exports_react;");
      expect(code).toContain("globalThis.keepIs = exports_react_is;");
      expect(code).toContain("return $is;");
      expect(code).toContain("console.log($react, globalThis.keep.other, fn(), globalThis.keepIs.is);");
    },
    run: {
      stdout: "react other is is",
    },
  });
  for (const backend of ["cli", "api"] as const) {
    for (const minify of [false, true]) {
      const suffix = `${backend === "api" ? "Api" : ""}${minify ? "Minified" : ""}`;
      const minifyOptions = { minifySyntax: minify, minifyIdentifiers: minify, minifyWhitespace: minify };
      // The export stays: an import statement cannot stand in for an exported declaration.
      itBundled(`cjs2esm/UnwrappedRequireExported${suffix}`, {
        files: {
          "/entry.ts": /* ts */ `
            import { C, V, L, A, M, B, I, NS } from "./lib";
            console.log(C.react, V.react, L.react, A, M.sched, B, I.other, NS.N.react);
          `,
          "/lib.ts": /* ts */ `
            export const C = require("react");
            export var V = require("react");
            export let L = require("react");
            export const A = 1, M = require("scheduler"), B = 2;
            export import I = require("react");
            export namespace NS {
              export const N = require("react");
            }
          `,
          ...unwrapListPackages,
        },
        backend,
        ...minifyOptions,
        run: {
          stdout: "react react react 1 sched 2 other react",
        },
      });
      // A later write makes the variable hold another value. The package's
      // namespace object stays what it was for every other reader.
      itBundled(`cjs2esm/UnwrappedRequireRebound${suffix}`, {
        files: {
          "/entry.js": /* js */ `
            let a = require("react");
            console.log("a", a.react);
            a = { react: "a2" };
            console.log("a", a.react);

            var b = require("react");
            b = { react: "b2" };
            console.log("b", b.react);

            let c = require("react");
            function setC() {
              c = { react: "c2" };
            }
            setC();
            console.log("c", c.react);

            let d = require("react");
            [d] = [{ react: "d2" }];
            console.log("d", d.react);

            let e = require("react");
            ({ e } = { e: { react: "e2" } });
            console.log("e", e.react);

            let f = require("react");
            for (f of [{ react: "f2" }]) {}
            console.log("f", f.react);

            let g = require("react");
            g &&= { react: "g2" };
            console.log("g", g.react);

            let h = require("react");
            h++;
            console.log("h", typeof h, h.react);

            function early() {
              i = { react: "i2" };
            }
            var i = require("react");
            console.log("i", i.react);
            early();
            console.log("i", i.react);

            function inner() {
              let j = require("react");
              const before = j.react;
              j = { react: "j2" };
              return before + " " + j.react;
            }
            console.log("j", inner());

            let k = require("react");
            class Setter {
              static {
                k = { react: "k2" };
              }
            }
            console.log("k", k.react);

            let l = require("react");
            ({ ...l } = { react: "l2" });
            console.log("l", l.react);

            let m = require("react");
            [...m] = [{ react: "m2" }];
            console.log("m", m[0].react);

            let n = require("react");
            for (n in { n2: 1 }) {
            }
            console.log("n", n);

            let o = require("react");
            o += "";
            console.log("o", typeof o);

            p = { react: "p1" };
            console.log("p", p.react);
            var p = require("react");
            console.log("p", p.react);

            console.log("shared", require("./other.js").read());
          `,
          "/other.js": /* js */ `
            const React = require("react");
            exports.read = () => React.react + " " + Object.keys(React).join(",");
          `,
          ...unwrapListPackages,
        },
        backend,
        ...minifyOptions,
        run: {
          stdout: [
            "a react",
            "a a2",
            "b b2",
            "c c2",
            "d d2",
            "e e2",
            "f f2",
            "g g2",
            "h number undefined",
            "i react",
            "i i2",
            "j react j2",
            "k k2",
            "l l2",
            "m m2",
            "n n2",
            "o string",
            "p p1",
            "p react",
            "shared react react,other,unused",
          ].join("\n"),
        },
      });
    }
  }
  for (const minify of [false, true]) {
    // A variable that stays costs only itself: the variables beside it still
    // read the exports directly, and one that nothing reads is gone with the
    // namespace object it holds.
    itBundled(`cjs2esm/UnwrappedRequireReboundBesideBound${minify ? "Minified" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          import { used } from "./lib.js";
          console.log(used());
        `,
        // Nothing imports "setIdle", "readIdle" or "notCalled".
        "/lib.js": /* js */ `
          let idle = require("react");
          export function setIdle(value) {
            idle = value;
          }
          export function readIdle() {
            return idle.unused;
          }
          const bound = require("react");
          export function notCalled() {
            let inner = require("react-is");
            inner = { is: "inner" };
            return inner.is + inner.unusedIs;
          }
          export function used() {
            const first = require("react");
            let rebound = require("scheduler");
            rebound = { sched: "rebound" };
            const last = require("react-is");
            return [bound.react, first.other, rebound.sched, last.is].join(" ");
          }
        `,
        ...unwrapListPackages,
      },
      minifySyntax: minify,
      minifyIdentifiers: minify,
      minifyWhitespace: minify,
      dce: true,
      dceKeepMarkerCount: false,
      onAfterBundle(api) {
        if (minify) return;
        const code = api.readFile("out.js");
        expect(code).not.toContain("exports_react");
        expect(code).toContain(`return [$react, $other, rebound.sched, $is].join(" ");`);
      },
      run: {
        stdout: "react other rebound is",
      },
    });
  }
  // A property write through a variable that holds another value is an
  // ordinary write. Through one that stays the namespace it is a build error
  // (`dynamic_import_dce/UnwrapCjsAssignStillErrors`).
  itBundled("cjs2esm/UnwrappedRequireReboundPropertyWrite", {
    files: {
      "/entry.js": /* js */ `
        let a = require("react");
        a = { react: "a2" };
        a.extra = 1;
        delete a.react;
        console.log(a.react, a.extra, require("react").react);
      `,
      ...unwrapListPackages,
    },
    run: {
      stdout: "undefined 1 react",
    },
  });
  // A variable that stays holds the namespace of the package, not its
  // `module.exports`. For a package that stays a `__commonJS` wrapper the
  // namespace has a `default` and getters. Node prints `sched sched` and `patched`.
  itBundled("cjs2esm/UnwrappedRequireVariableOverWrappedPackage", {
    files: {
      "/entry.js": /* js */ `
        if (globalThis) {
          var held = require("scheduler");
        }
        console.log(Object.keys(held).join(","), held.sched);
        try {
          held.sched = "patched";
          console.log(held.sched);
        } catch (error) {
          console.log(error.constructor.name);
        }
      `,
      ...unwrapListPackages,
    },
    run: {
      stdout: "default,sched sched\nTypeError",
    },
  });
  // As on main: a write to a property of a variable that can still become the
  // namespace is a build error.
  itBundled("cjs2esm/UnwrappedRequirePropertyWriteBeforeRebind", {
    files: {
      "/entry.js": /* js */ `
        let a = require("react");
        a.extra = 1;
        a = { react: "a2" };
        console.log(a.react, a.extra);
      `,
      ...unwrapListPackages,
    },
    bundleErrors: { "/entry.js": ['Cannot assign to import "extra"'] },
  });
  for (const minify of [false, true]) {
    const suffix = minify ? "Minified" : "";
    const minifyOptions = { minifySyntax: minify, minifyIdentifiers: minify, minifyWhitespace: minify };
    // A read that the bundler visits after the write is a read of a property
    // of what the variable holds: a getter runs, a call has the `this` that is
    // written, and a read of `null` throws. For a read that it visits before
    // the write, see `knownGap` in unwrapped-require-matrix.ts.
    itBundled(`cjs2esm/UnwrappedRequireReboundReadsTheVariable${suffix}`, {
      files: {
        "/entry.js": /* js */ `
          "use strict";
          let a = require("react");
          let getterRuns = 0;
          a = {
            get react() {
              getterRuns++;
              return 1;
            },
          };
          a.react;
          console.log("a", getterRuns);

          let b = require("react");
          b = {
            react() {
              return this === undefined ? "no this" : typeof this;
            },
          };
          console.log("b", (0, b.react)(), b.react());

          let c = require("react");
          c = null;
          try {
            c.react;
            console.log("c", "no throw");
          } catch (e) {
            console.log("c", e.constructor.name);
          }
        `,
        ...unwrapListPackages,
      },
      ...minifyOptions,
      run: {
        stdout: "a 1\nb no this object\nc TypeError",
      },
    });
    // Each read here is visited before the write, and reads a property of an
    // export (`x.a.b`). The declaration of the variable stays for the read,
    // also when the write never runs.
    itBundled(`cjs2esm/UnwrappedRequireReboundAfterReads${suffix}`, {
      files: {
        "/entry.js": /* js */ `
          import { read } from "./lib.js";
          var R = { react: "ENTRY" };

          let a = require("react");
          console.log("a", a.react.length, a.react.toUpperCase(), a.other["length"]);
          function neverCalled() {
            a = { react: "a2" };
          }

          function inFunction() {
            let b = require("react");
            const length = () => b.react.length;
            const type = typeof b;
            const neverCalled = () => {
              b = null;
            };
            return type + " " + length();
          }
          console.log("b", inFunction());

          let c = require("react");
          const readC = () => c.react.length + " " + c.other;
          console.log("c", readC());
          c = { react: "c2", other: "c2-other" };
          console.log("c", readC());

          function typeOf(value) {
            return typeof value;
          }
          function devOnlyWrite() {
            let d = require("react");
            const type = typeOf(d);
            if (process.env.NODE_ENV !== "production") d = null;
            return type + " " + d.react.length;
          }
          console.log("d", devOnlyWrite());

          console.log("lib", read(), R.react);
        `,
        // Nothing imports "setR": the one write to "R" is tree-shaken.
        "/lib.js": /* js */ `
          let R = require("react");
          export function read() {
            return R.react.length + " " + R.other;
          }
          export function setR(value) {
            R = value;
          }
        `,
        ...unwrapListPackages,
      },
      define: { "process.env.NODE_ENV": '"production"' },
      ...minifyOptions,
      run: {
        stdout: "a 5 REACT 5\nb object 5\nc 5 other\nc 2 c2-other\nd object 5\nlib 5 other ENTRY",
      },
    });
  }
  // A write in a branch that the build removes never runs: the variable is
  // the namespace, and the exports that nothing reads are gone.
  itBundled("cjs2esm/UnwrappedRequireWriteInRemovedBranch", {
    files: {
      "/entry.js": /* js */ `
        let a = require("react");
        if (process.env.NODE_ENV !== "production") a = { react: "dev" };
        let b = require("react");
        process.env.NODE_ENV === "production" || (b = { other: "dev" });
        function fn() {
          let c = require("react-is");
          if (process.env.NODE_ENV !== "production") {
            [c] = [{ is: "dev" }];
            c &&= null;
            for (c of []) {
            }
            c++;
          }
          return process.env.NODE_ENV === "production" ? c.is : (c = "dev");
        }
        console.log(a.react, b.other, fn());
      `,
      ...unwrapListPackages,
    },
    define: { "process.env.NODE_ENV": '"production"' },
    dce: true,
    dceKeepMarkerCount: false,
    onAfterBundle(api) {
      const code = api.readFile("out.js");
      expect(code).not.toContain("exports_react");
      expect(code).toContain("console.log($react, $other, fn());");
    },
    run: {
      stdout: "react other is",
    },
  });
  // The CommonJS output of rolldown for `import * as react from "react"`.
  // The namespace of an external package, and of a package in another
  // chunk, is an import binding: an assignment to it throws at load.
  const rolldownOutput = /* js */ `
    var __toESM = mod => Object.assign({ default: mod }, mod);
    let react = require("react");
    react = __toESM(react, 1);
    exports.read = () => react.react + " " + react.default.other;
  `;
  itBundled("cjs2esm/UnwrappedRequireReboundExternal", {
    files: {
      "/entry.js": /* js */ `
        console.log(require("./lib.js").read());
      `,
      "/lib.js": rolldownOutput,
    },
    external: ["react"],
    runtimeFiles: unwrapListPackages,
    run: {
      stdout: "react other",
    },
  });
  itBundled("cjs2esm/UnwrappedRequireReboundSplitting", {
    files: {
      "/a.js": /* js */ `
        console.log("a", require("./lib.js").read());
      `,
      "/b.js": /* js */ `
        const React = require("react");
        console.log("b", React.react, Object.keys(React).join(","));
      `,
      "/lib.js": rolldownOutput,
      ...unwrapListPackages,
    },
    entryPoints: ["/a.js", "/b.js"],
    outdir: "/out",
    splitting: true,
    run: [
      { file: "/out/a.js", stdout: "a react other" },
      { file: "/out/b.js", stdout: "b react react,other,unused" },
    ],
  });
  // Two declarations of one variable: either can initialize it.
  itBundled("cjs2esm/UnwrappedRequireRedeclared", {
    files: {
      "/entry.js": /* js */ `
        var a = require("react");
        console.log("a", a.react);
        var a = { react: "a2" };
        console.log("a", a.react);

        var b = { react: "b1" };
        console.log("b", b.react);
        var b = require("react");
        console.log("b", b.react);

        function varThenFunction() {
          var c = require("react");
          function c() {}
          return typeof c + " " + c.react;
        }
        function functionThenVar() {
          function c() {}
          var c = require("react");
          return typeof c + " " + c.react;
        }
        console.log("c", varThenFunction(), functionThenVar());

        function withParameter(d) {
          console.log("d", d.react);
          var d = require("react");
          console.log("d", d.react);
        }
        withParameter({ react: "d1" });

        var e = require("react");
        for (var e of [{ react: "e2" }]) {}
        console.log("e", e.react);

        var f = require("react");
        if (globalThis) {
          var f = { react: "f2" };
        }
        console.log("f", f.react);

        function twin(x) {
          if (x) {
            var g = require("react");
          } else {
            var g = require("react-is");
          }
          return g.react + " " + g.is;
        }
        console.log("g", twin(true), twin(false));

        var h = require("react");
        var h;
        console.log("h", h.react);

        // A function declaration in a block also assigns the \`var\` of its name when the block runs.
        function blockFunction(run) {
          var i = require("react");
          var before = i.react;
          if (run) {
            function i() {}
          }
          return before + " " + typeof i + " " + i.react;
        }
        console.log("i", blockFunction(true), blockFunction(false));

        var j = require("react");
        {
          function j() {}
        }
        console.log("j", typeof j, j.react);
      `,
      ...unwrapListPackages,
    },
    run: {
      stdout: [
        "a react",
        "a a2",
        "b b1",
        "b react",
        "c object react object react",
        "d d1",
        "d react",
        "e e2",
        "f f2",
        "g react undefined undefined is",
        "h react",
        "i react function undefined react object react",
        "j function undefined",
      ].join("\n"),
    },
  });
  // A direct eval can read and write the variable by name.
  itBundled("cjs2esm/UnwrappedRequireDirectEval", {
    files: {
      "/entry.js": /* js */ `
        function write() {
          var a = require("react");
          eval("a = { react: 'a2' }");
          return a.react;
        }
        function read() {
          const b = require("react");
          return eval("b.react");
        }
        var c = require("react");
        console.log(write(), read(), eval("c.react"));
      `,
      ...unwrapListPackages,
    },
    run: {
      stdout: "a2 react react",
    },
  });
  // A `var` in a block is declared by the function: the block does not always
  // run, so the declaration stays where it is written. A `let` that its block
  // rebinds stays a variable.
  itBundled("cjs2esm/UnwrappedRequireInBlock", {
    files: {
      "/entry.js": /* js */ `
        {
          let a = require("react");
          a = { react: "a2" };
          console.log("a", a.react);
        }
        if (globalThis) {
          var b = require("react");
        }
        console.log("b", b.react);
        function fn(use) {
          if (use) {
            var c = require("react");
          }
          return c ? c.react : "none";
        }
        console.log("c", fn(true), fn(false));
        function rebound(on) {
          const out = [];
          for (const once of [1]) {
            let d = require("react");
            const early = () => d.react;
            if (!on) out.push("off");
            if (on) d = { react: "d2" };
            out.push(early(), d.react);
          }
          switch (on) {
            case true:
              let e = require("react");
              e = { react: "e2" };
              out.push(e.react);
              break;
            default:
              let f = require("react-is");
              out.push(f.is);
          }
          return out.join(" ");
        }
        console.log("d", rebound(true), rebound(false));
      `,
      ...unwrapListPackages,
    },
    run: {
      stdout: "a a2\nb react\nc react none\nd d2 d2 e2 off react react is",
    },
  });
  // A `const` of a block that nothing rebinds is the namespace, as at the top
  // of a function. As on main, a write to a property of it is a build error.
  itBundled("cjs2esm/UnwrappedRequireInBlockPropertyWrite", {
    files: {
      "/entry.js": /* js */ `
        {
          const a = require("react");
          a.extra = 1;
          console.log(a.react, a.extra);
        }
      `,
      ...unwrapListPackages,
    },
    bundleErrors: { "/entry.js": ['Cannot assign to import "extra"'] },
  });
  // A declaration that is the body of a statement without braces is not one
  // of the statements of its scope: it stays where it is, and a read of the
  // variable is a property read (the getter of a wrapped package runs).
  itBundled("cjs2esm/UnwrappedRequireInBodyWithoutBraces", {
    files: {
      "/entry.js": /* js */ `
        if (globalThis) var top = require("react");
        if (globalThis) var withGetter = require("react-dom");
        withGetter.touched;
        function ifElse(use) {
          if (use) var a = require("react");
          else var b = require("react-is");
          return [a ? a.react : "none", b ? b.is : "none"].join(",");
        }
        function loops() {
          var i = 0;
          while (i++ < 1) var c = require("react");
          do var d = require("react-is");
          while (false);
          label: var e = require("react");
          return [c.react, d.is, e.other].join(",");
        }
        class Holder {
          static {
            if (globalThis) var f = require("react");
            Holder.value = f.react;
          }
        }
        console.log(top.react, ifElse(true), ifElse(false), loops(), Holder.value);
      `,
      ...unwrapListPackages,
      "/node_modules/react-dom/package.json": /* json */ `
        { "name": "react-dom", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        module.exports = {
          get touched() {
            console.log("getter ran");
            return true;
          },
        };
      `,
    },
    run: {
      stdout: "getter ran\nreact react,none none,is react,is,other react",
    },
  });
  for (const minify of [false, true]) {
    // A `with` statement can read the variable by name from its object.
    itBundled(`cjs2esm/UnwrappedRequireReadThroughWith${minify ? "Minified" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          var a = require("react");
          with ({ a: { react: "with-a" } }) {
            console.log("a", a.react);
          }
          function fn(object) {
            var b = require("react");
            const c = require("react");
            with (object) {
              return b.react + " " + c.other;
            }
          }
          console.log("b", fn({ b: { react: "with-b" } }), fn({ c: { other: "with-c" } }), fn({}));
        `,
        ...unwrapListPackages,
      },
      minifySyntax: minify,
      minifyIdentifiers: minify,
      run: {
        stdout: "a with-a\nb with-b other react with-c react other",
      },
    });
  }
  // One part holds every statement of the file when a top-level `using` is
  // lowered, and when tree shaking is off. The variables still become the namespace.
  itBundled("cjs2esm/UnwrappedRequireBesideTopLevelUsing", {
    files: {
      "/entry.js": /* js */ `
        const top = require("react");
        using resource = {
          [Symbol.dispose]() {
            console.log("disposed");
          },
        };
        console.log(top.react);
      `,
      ...unwrapListPackages,
    },
    onAfterBundle(api) {
      const code = api.readFile("out.js");
      expect(code).not.toContain("exports_react");
      expect(code).not.toContain("DROP_REACT");
    },
    run: {
      stdout: "react\ndisposed",
    },
  });
  itBundled("cjs2esm/UnwrappedRequireWithoutTreeShaking", {
    files: {
      "/entry.js": /* js */ `
        var top = require("react");
        let a = require("react"), n = 5, b = require("react-is");
        const c = require("react");
        let rebound = require("react");
        rebound = { react: "rebound2" };
        console.log(top.react, a.other, n, b.is, c.react, rebound.react);
      `,
      ...unwrapListPackages,
    },
    treeShaking: false,
    backend: "api",
    onAfterBundle(api) {
      const code = api.readFile("out.js");
      expect(code).toContain("var n = 5;");
      expect(code).toContain("console.log($react, $other, n, $is, $react, rebound.react);");
    },
    run: {
      stdout: "react other 5 is react rebound2",
    },
  });
  // In that layout the module's statements are one list. A body without
  // braces is another list in the same scope: the variables of the module are
  // not settled at its end, and its own `var` stays where it is.
  for (const layout of ["BesideTopLevelUsing", "WithoutTreeShaking"] as const) {
    itBundled(`cjs2esm/UnwrappedRequireInBodyWithoutBraces${layout}`, {
      files: {
        "/entry.js": /* js */ `
          const top = require("react");
          if (globalThis.nope) var never = require("react-is");
          ${layout === "BesideTopLevelUsing" ? "using resource = { [Symbol.dispose]() {} };" : ""}
          console.log(top.react, typeof never);
        `,
        ...unwrapListPackages,
      },
      ...(layout === "WithoutTreeShaking" ? { treeShaking: false, backend: "api" as const } : {}),
      onAfterBundle(api) {
        expect(api.readFile("out.js")).toContain("console.log($react, typeof never);");
      },
      run: {
        stdout: "react undefined",
      },
    });
  }
  // The body of a TypeScript namespace is a scope of its own.
  itBundled("cjs2esm/UnwrappedRequireInTypeScriptNamespace", {
    files: {
      "/entry.ts": /* ts */ `
        namespace N {
          const r = require("react");
          export const v = r.react;
          let s = require("react");
          s = { react: "rebound" };
          export const w = s.react;
        }
        console.log(N.v, N.w);
      `,
      ...unwrapListPackages,
    },
    onAfterBundle(api) {
      expect(api.readFile("out.js")).toContain("N.v = $react");
    },
    run: {
      stdout: "react rebound",
    },
  });
  // `using` disposes its value when the block ends, so the declaration stays.
  // The value is the namespace of the package, which has no `Symbol.dispose`:
  // a TypeError, as for the `module.exports` of every package on the list.
  itBundled("cjs2esm/UnwrappedRequireUsing", {
    files: {
      "/entry.js": /* js */ `
        function inFunction() {
          using a = require("react");
          return "no throw";
        }
        function inBlock() {
          {
            using b = require("react-is");
          }
          return "no throw";
        }
        function foldedInitializer() {
          using c = true ? require("react") : null;
          return "no throw";
        }
        function inLoopHead() {
          for (using d = require("react"); ; ) {
            return "no throw";
          }
        }
        async function awaited() {
          await using e = require("scheduler");
          return "no throw";
        }
        const results = [];
        for (const fn of [inFunction, inBlock, foldedInitializer, inLoopHead, awaited]) {
          try {
            results.push(await fn());
          } catch (error) {
            results.push(error.constructor.name);
          }
        }
        console.log(results.join(" "));
      `,
      ...unwrapListPackages,
    },
    run: {
      stdout: "TypeError TypeError TypeError TypeError TypeError",
    },
  });
  // A pattern reads the namespace of a package that stays a `__commonJS` wrapper.
  itBundled("cjs2esm/UnwrappedRequireDestructuredWrapped", {
    files: {
      "/entry.js": /* js */ `
        const { sched } = require("scheduler");
        const { react, other: renamed = "default" } = require("react");
        const [first] = [require("scheduler")];
        function fn() {
          const { sched: inner } = require("scheduler");
          let { react: innerReact } = require("react");
          return inner + " " + innerReact;
        }
        console.log(sched, react, renamed, first.sched, fn());
      `,
      ...unwrapListPackages,
    },
    run: {
      stdout: "sched react other sched sched react",
    },
  });
  // The layout of the real `react` package: `index.js` picks a file by
  // `process.env.NODE_ENV` at run time, so it stays a `__commonJS` wrapper.
  itBundled("cjs2esm/UnwrappedRequireDestructuredReactLayout", {
    files: {
      "/entry.js": /* js */ `
        const { useState, version } = require("react");
        function inFunction() {
          const { useState, version: inner } = require("react");
          return typeof useState + " " + inner;
        }
        console.log(typeof useState, version, inFunction(), require("./component.js").info());
      `,
      "/component.js": /* js */ `
        const { useState, version } = require("react");
        exports.info = () => typeof useState + " " + version;
      `,
      "/node_modules/react/package.json": /* json */ `
        { "name": "react", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/react/index.js": /* js */ `
        'use strict';
        if (process.env.NODE_ENV === 'production') {
          module.exports = require('./cjs/react.production.js');
        } else {
          module.exports = require('./cjs/react.development.js');
        }
      `,
      "/node_modules/react/cjs/react.production.js": /* js */ `
        exports.useState = function useState() {};
        exports.version = "19.0.0-production";
      `,
      "/node_modules/react/cjs/react.development.js": /* js */ `
        exports.useState = function useState() {};
        exports.version = "19.0.0-development";
      `,
    },
    run: {
      stdout: "function 19.0.0-development function 19.0.0-development function 19.0.0-development",
    },
  });
  // An external package keeps its import statement: nothing prints a require().
  for (const target of ["browser", "bun", "node"] as const) {
    itBundled(`cjs2esm/UnwrappedRequireOfExternalPackage_${target}`, {
      files: {
        "/entry.js": /* js */ `
          const { react, other: renamed = "default" } = require("react");
          function fn() {
            const { is } = require("react-is");
            return is;
          }
          let a = require("react");
          a = { react: "a2" };
          const held = require("react");
          console.log(react, renamed, fn(), a.react, held.other);
        `,
      },
      external: ["react", "react-is"],
      runtimeFiles: unwrapListPackages,
      target,
      onAfterBundle(api) {
        expect(api.readFile("/out.js")).not.toContain("__require");
      },
      run: {
        stdout: "react other is a2 other",
      },
    });
  }
  for (const minify of [false, true]) {
    // The variable holds the value of its initializer, which is not always
    // the namespace of the first require() in it.
    itBundled(`cjs2esm/UnwrappedRequireNotTheWholeInitializer${minify ? "Minified" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          const a = (require("react-is"), require("react"));
          var local = { react: "local" };
          var b = (require("react"), local);
          var c = (require("react-is"), true) ? require("react") : null;
          var d = void require("react-is") === undefined ? local : null;
          function fn(param) {
            var e = (require("react"), require("react-is"));
            const f = (require("react"), param);
            return e.is + " " + e.react + " " + f.react;
          }
          console.log(a.react, a.is, b.react, c.react, c.is, d.react, fn({ react: "param" }));
        `,
        ...unwrapListPackages,
      },
      minifySyntax: minify,
      minifyIdentifiers: minify,
      minifyWhitespace: minify,
      run: {
        stdout: "react undefined local react undefined local is undefined param",
      },
    });
  }
  for (const minify of [false, true]) {
    // Only `x = require("pkg")` as written can become the namespace. An
    // initializer that folds to the `require()` is a variable, as on main: a
    // write to a property of it and a later write to it are ordinary writes.
    itBundled(`cjs2esm/UnwrappedRequireFoldedInitializer${minify ? "Minified" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          var a = true && require("react");
          a.extra = 1;
          var b = (0, require("react"));
          b = { react: "b2" };
          var c = true ? require("react") : null;
          c.more = 2;
          function fn() {
            let d = null ?? require("react-is");
            const read = () => d.is;
            d = { is: "d2" };
            return read();
          }
          console.log(a.react, a.extra, b.react, c.more, fn(), require("react").react);
        `,
        ...unwrapListPackages,
      },
      minifySyntax: minify,
      minifyIdentifiers: minify,
      minifyWhitespace: minify,
      run: {
        stdout: "react 1 b2 2 d2 react",
      },
    });
    // The statements of a \`switch\` are in the lists of its cases. A variable
    // of one case is settled after the last case: a later case can read it or
    // write it.
    itBundled(`cjs2esm/UnwrappedRequireInSwitch${minify ? "Minified" : ""}`, {
      files: {
        "/entry.js": /* js */ `
          let saved;
          function keep(value) {
            saved = value;
          }
          function readInLaterCase(n) {
            switch (n) {
              case 0:
                const R = require("react");
                keep(R);
              case 1:
                return R.react;
            }
          }
          function reboundInLaterCase(n) {
            const out = [];
            switch (n) {
              case 1:
                let g = require("react");
                out.push(g.react);
              case 2:
                g = { react: "g2" };
                out.push(g.react);
            }
            return out.join(" ");
          }
          function closureInLaterCase(n) {
            switch (n) {
              case 0:
                const R = require("react-is");
                keep(R);
              default:
                return (() => R.is)();
            }
          }
          console.log(readInLaterCase(0), typeof saved, reboundInLaterCase(1), closureInLaterCase(0));
        `,
        ...unwrapListPackages,
      },
      minifySyntax: minify,
      minifyIdentifiers: minify,
      minifyWhitespace: minify,
      run: {
        stdout: "react object react g2 is",
      },
    });
  }
  // A TypeScript import that is only a type does not declare the variable:
  // the \`const\` of the same name still becomes the namespace.
  itBundled("cjs2esm/UnwrappedRequireOverTypeImport", {
    files: {
      "/entry.ts": /* ts */ `
        import { React } from "./types";
        const React = require("react");
        const name: React = React.react;
        console.log(name);
      `,
      "/types.ts": /* ts */ `
        export type React = string;
      `,
      ...unwrapListPackages,
    },
    dce: true,
    dceKeepMarkerCount: false,
    onAfterBundle(api) {
      expect(api.readFile("out.js")).not.toContain("exports_react");
    },
    run: {
      stdout: "react",
    },
  });
  // The React Compiler declares the locals of a component again. A namespace
  // of a `require()` is a binding of the module for it, also when a variable
  // of the component became that namespace. A variable that stays after a
  // read took it for the namespace keeps its component as it is written.
  itBundled("cjs2esm/UnwrappedRequireInReactCompilerCandidate", {
    files: {
      "/entry.js": /* js */ `
        const components = require("./components.jsx");
        for (const name of Object.keys(components)) {
          console.log(name, components[name]({ on: true }), components[name]({ on: false }));
        }
      `,
      "/components.jsx": /* jsx */ `
        const { useEffect } = require("react");
        const React = require("react");
        let Later = require("react");
        let Before = require("react");
        Before = { version: "before" };
        const Outer = { version: "outer" };
        function Direct(props) {
          useEffect(() => {});
          const Local = require("react");
          return props.on ? Local.version : typeof Local.version;
        }
        function AsValue(props) {
          useEffect(() => {});
          const Local = require("react");
          const has = () => Local != null;
          return has() && props.on ? "on" : "off";
        }
        function InBlock(props) {
          useEffect(() => {});
          const read = () => {
            if (props.on) {
              const Lazy = require("react");
              return Lazy.version;
            }
            return "off";
          };
          return read();
        }
        function Rebound(props) {
          useEffect(() => {});
          const read = () => {
            let Outer = require("react");
            if (props.on) Outer = { version: "rebound" };
            return Outer.version;
          };
          return read() + "/" + Outer.version;
        }
        function ReboundAfterRead(props) {
          useEffect(() => {});
          let Local = require("react");
          const early = Local.version;
          if (props.on) Local = { version: "rebound" };
          return early + "/" + Local.version;
        }
        function ReboundAfterReadInClosure(props) {
          useEffect(() => {});
          const read = () => {
            let Local = require("react");
            const early = Local.version;
            if (props.on) Local = { version: "rebound" };
            return early + "/" + Local.version;
          };
          return read();
        }
        function InArray(props) {
          useEffect(() => {});
          const read = () => {
            const held = [require("react")];
            return held[0].version;
          };
          return props.on ? read() : "off";
        }
        function CheckInClosure(props) {
          useEffect(() => {});
          const check = () => require("react") != null;
          if (!check()) return "missing";
          return props.on ? "on" : "off";
        }
        // The compiler takes no component with a second parameter of this name.
        function DefaultParameter(props, lib = require("react")) {
          useEffect(() => {});
          return props.on ? lib.version : typeof lib.useEffect;
        }
        // A variable of the module that the components read, while it can still become the namespace.
        function ModuleAlias(props) {
          useEffect(() => {});
          return props.on ? React.version : Object.keys(React).length;
        }
        function ModuleRebound(props) {
          useEffect(() => {});
          return props.on ? Before.version : Later.version;
        }
        function NoRequire(props) {
          useEffect(() => {});
          const state = { on: props.on };
          return state.on ? "on" : "off";
        }
        Later = { version: "later" };
        module.exports = {
          Direct,
          AsValue,
          InBlock,
          Rebound,
          ReboundAfterRead,
          ReboundAfterReadInClosure,
          InArray,
          CheckInClosure,
          DefaultParameter,
          ModuleAlias,
          ModuleRebound,
          NoRequire,
        };
      `,
      "/node_modules/react/package.json": /* json */ `
        { "name": "react", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/react/index.js": /* js */ `
        exports.version = "19.0.0";
        exports.useEffect = function () {};
      `,
      "/node_modules/react/compiler-runtime.js": /* js */ `
        exports.c = function (size) {
          return new Array(size).fill(Symbol.for("react.memo_cache_sentinel"));
        };
      `,
    },
    reactCompiler: true,
    onAfterBundle(api) {
      const code = api.readFile("out.js");
      // The compiler moves the empty effect callback of a function that it compiles out of the function.
      const isCompiled = (name: string) => {
        const start = code.indexOf(`function ${name}(`);
        return code.slice(start, code.indexOf("\n  }\n", start)).includes("useEffect(_temp");
      };
      const names = [
        ...["Direct", "AsValue", "InBlock", "Rebound", "ReboundAfterRead", "ReboundAfterReadInClosure"],
        ...["InArray", "CheckInClosure", "DefaultParameter", "ModuleAlias", "ModuleRebound", "NoRequire"],
      ];
      expect(names.filter(name => !isCompiled(name))).toEqual([
        "ReboundAfterRead",
        "ReboundAfterReadInClosure",
        "DefaultParameter",
      ]);
      expect(code).toContain("return props.on ? $version : typeof $version;");
    },
    run: {
      stdout: [
        "Direct 19.0.0 string",
        "AsValue on off",
        "InBlock 19.0.0 off",
        "Rebound rebound/outer 19.0.0/outer",
        "ReboundAfterRead 19.0.0/rebound 19.0.0/19.0.0",
        "ReboundAfterReadInClosure 19.0.0/rebound 19.0.0/19.0.0",
        "InArray 19.0.0 off",
        "CheckInClosure on off",
        "DefaultParameter 19.0.0 function",
        "ModuleAlias 19.0.0 2",
        "ModuleRebound before later",
        "NoRequire on off",
      ].join("\n"),
    },
  });
  // The files of a package on the unwrap list unwrap every require(). React
  // 19's development jsx-runtime rebinds `React` this way.
  itBundled("cjs2esm/UnwrappedRequireReboundInsideListedPackage", {
    files: {
      "/entry.js": /* js */ `
        import { jsx } from "react/jsx-runtime";
        import * as React from "react";
        import ReactDOM from "react-dom";
        console.log(jsx("div"), React.react, typeof React.react_stack_bottom_frame);
        console.log(ReactDOM.patched, ReactDOM.render());
      `,
      "/node_modules/react/jsx-runtime.js": /* js */ `
        (function () {
          var React = require("react"),
            other = React.other,
            seen = {};
          React = {
            react_stack_bottom_frame: function (callStackForError) {
              return callStackForError();
            },
          };
          var bound = React.react_stack_bottom_frame.bind(React, function () {
            return "frame";
          })();
          exports.jsx = function (type) {
            return type + ":" + other + ":" + bound + ":" + Object.keys(seen).length;
          };
        })();
      `,
      "/node_modules/react-dom/package.json": /* json */ `
        { "name": "react-dom", "version": "19.0.0", "main": "index.js" }
      `,
      // The variable no longer holds what "./impl" exports, so the file
      // cannot become a re-export of it.
      "/node_modules/react-dom/index.js": /* js */ `
        var impl = require("./impl");
        impl = Object.assign({ patched: true }, impl);
        module.exports = impl;
      `,
      "/node_modules/react-dom/impl.js": /* js */ `
        exports.render = function render() {
          return "rendered";
        };
      `,
      ...unwrapListPackages,
    },
    run: {
      stdout: "div:other:frame:0 react undefined\ntrue rendered",
    },
  });
  // A TypeScript `import x = require()` that nothing reads as a value names
  // a type: the module is not loaded.
  itBundled("cjs2esm/UnwrappedRequireUnusedImportEquals", {
    files: {
      "/entry.ts": /* ts */ `
        import Types = require("react");
        const value: Types.Kind = "start";
        console.log(value);
      `,
      "/node_modules/react/package.json": /* json */ `
        { "name": "react", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/react/index.js": /* js */ `
        console.log("DROP_REACT loaded");
        exports.react = "react";
      `,
    },
    dce: true,
    dceKeepMarkerCount: false,
    run: {
      stdout: "start",
    },
  });
  // TypeScript removes an import that nothing reads. A `const x = require()`
  // is a call: the module loads. A read that is visited before the
  // declaration counts as a read.
  itBundled("cjs2esm/UnwrappedRequireTypeScript", {
    files: {
      "/entry.ts": /* ts */ `
        function early() {
          return a;
        }
        class Early {
          get value() {
            return b.react;
          }
        }
        const lazy = () => c.is;
        const a = require("react");
        const b = require("react");
        import c = require("react-is");
        const unused = require("scheduler");
        function fn() {
          const unusedInFunction = require("react-dom");
        }
        fn();
        console.log(Object.keys(early()).join(","), new Early().value, lazy(), (globalThis as any).loaded);
      `,
      ...unwrapListPackages,
      "/node_modules/scheduler/index.js": /* js */ `
        globalThis.loaded = (globalThis.loaded || "") + "scheduler ";
        exports.value = 1;
      `,
      "/node_modules/react-dom/package.json": /* json */ `
        { "name": "react-dom", "version": "19.0.0", "main": "index.js" }
      `,
      "/node_modules/react-dom/index.js": /* js */ `
        globalThis.loaded = (globalThis.loaded || "") + "react-dom";
        exports.value = 1;
      `,
    },
    run: {
      stdout: "react,other,unused react is scheduler react-dom",
    },
  });
  // Declaration kind x rebind x read x scope x visit order, each compared with
  // the unbundled run (unwrapped-require-matrix.ts). A debug or sanitizer
  // build is too slow for the 28,152 cells: it runs 216 of them.
  const matrixRuns: [string, Options, number][] =
    isDebug || isASAN
      ? [
          [
            "Sample",
            {
              packages: ["react"],
              kinds: ["var", "let"],
              rebinds: ["none", "assign", "neverFn", "evalWrite"],
              reads: ["oneLevel", "twoLevelCall", "commaCall", "stmt"],
              scopes: ["top", "fn", "fnBlock"],
            },
            216,
          ],
        ]
      : [
          ["WriteFirst", { orders: ["writeFirst"] }, 10132],
          ["ReadInEarlierFn", { orders: ["readInEarlierFn"] }, 9010],
          ["HoistedWriter", { orders: ["hoistedWriter"] }, 9010],
        ];
  test.concurrent.each(matrixRuns)(
    "cjs2esm/UnwrappedRequireMatrix%s",
    async (_, options, cells) => {
      expect(await checkMatrix(bunExe(), options)).toEqual({ cells, plain: {}, minified: {} });
    },
    bundlerTestTimeout(5_000, 6),
  );
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
