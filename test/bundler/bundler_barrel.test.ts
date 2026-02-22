import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // --- Explicit mode (optimizeImports list) ---

  itBundled("barrel/SkipUnusedWithOptimizeImports", {
    files: {
      "/entry.js": /* js */ `
        import { Button } from 'mylib';
        console.log(Button);
      `,
      "/node_modules/mylib/package.json": JSON.stringify({ name: "mylib", main: "./index.js" }),
      "/node_modules/mylib/index.js": /* js */ `
        export { Button } from './Button.js';
        export { Card } from './Card.js';
      `,
      "/node_modules/mylib/Button.js": /* js */ `
        export const Button = "button";
      `,
      // Card.js has a syntax error — if barrel optimization works,
      // it should NOT be parsed and the bundle should succeed.
      "/node_modules/mylib/Card.js": /* js */ `
        export const Card = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["mylib"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("button");
    },
  });

  itBundled("barrel/AllExportsNeeded", {
    files: {
      "/entry.js": /* js */ `
        import { Button, Card } from 'mylib';
        console.log(Button, Card);
      `,
      "/node_modules/mylib/package.json": JSON.stringify({ name: "mylib", main: "./index.js" }),
      "/node_modules/mylib/index.js": /* js */ `
        export { Button } from './Button.js';
        export { Card } from './Card.js';
      `,
      "/node_modules/mylib/Button.js": /* js */ `
        export const Button = "button";
      `,
      "/node_modules/mylib/Card.js": /* js */ `
        export const Card = "card";
      `,
    },
    optimizeImports: ["mylib"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("button");
      api.expectFile("/out/entry.js").toContain("card");
    },
  });

  // --- Automatic mode (sideEffects: false) ---

  itBundled("barrel/SkipUnusedWithSideEffectsFalse", {
    files: {
      "/entry.js": /* js */ `
        import { Alpha } from 'autolib';
        console.log(Alpha);
      `,
      "/node_modules/autolib/package.json": JSON.stringify({
        name: "autolib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/autolib/index.js": /* js */ `
        export { Alpha } from './Alpha.js';
        export { Beta } from './Beta.js';
      `,
      "/node_modules/autolib/Alpha.js": /* js */ `
        export const Alpha = "alpha";
      `,
      // Beta.js has a syntax error — should not be parsed
      "/node_modules/autolib/Beta.js": /* js */ `
        export const Beta = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("alpha");
    },
  });

  itBundled("barrel/NoOptimizationWithoutSideEffects", {
    files: {
      "/entry.js": /* js */ `
        import { Foo } from 'normallib';
        console.log(Foo);
      `,
      "/node_modules/normallib/package.json": JSON.stringify({
        name: "normallib",
        main: "./index.js",
        // No sideEffects field — no automatic optimization
      }),
      "/node_modules/normallib/index.js": /* js */ `
        export { Foo } from './Foo.js';
        export { Bar } from './Bar.js';
      `,
      "/node_modules/normallib/Foo.js": /* js */ `
        export const Foo = "foo";
      `,
      // Bar.js has a syntax error — without optimization this SHOULD cause a bundle error
      "/node_modules/normallib/Bar.js": /* js */ `
        export const Bar = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    bundleErrors: {
      "/node_modules/normallib/Bar.js": ["Unexpected <<"],
    },
  });

  // --- Shared behavior ---

  itBundled("barrel/ExportStarLoadsAll", {
    files: {
      "/entry.js": /* js */ `
        import { X } from 'starlib';
        console.log(X);
      `,
      "/node_modules/starlib/package.json": JSON.stringify({
        name: "starlib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/starlib/index.js": /* js */ `
        export * from './a.js';
        export * from './b.js';
      `,
      "/node_modules/starlib/a.js": /* js */ `
        export const X = "x";
      `,
      // b.js has a syntax error — export * must load it anyway (conservative)
      "/node_modules/starlib/b.js": /* js */ `
        export const Y = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    // export * targets are always loaded, so the syntax error surfaces
    bundleErrors: {
      "/node_modules/starlib/b.js": ["Unexpected <<"],
    },
  });

  itBundled("barrel/NonBarrelWithLocalExports", {
    files: {
      "/entry.js": /* js */ `
        import { local } from 'mixedlib';
        console.log(local);
      `,
      "/node_modules/mixedlib/package.json": JSON.stringify({
        name: "mixedlib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/mixedlib/index.js": /* js */ `
        export const local = "local-value";
        export { Remote } from './Remote.js';
      `,
      "/node_modules/mixedlib/Remote.js": /* js */ `
        export const Remote = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    // Has local exports -> not a pure barrel -> all submodules parsed -> should error
    bundleErrors: {
      "/node_modules/mixedlib/Remote.js": ["Unexpected <<"],
    },
  });

  // --- import * (namespace import) must load all submodules ---

  itBundled("barrel/NamespaceImportLoadsAll", {
    files: {
      "/entry.js": /* js */ `
        import * as Lib from 'nslib';
        console.log(Lib.Button);
      `,
      "/node_modules/nslib/package.json": JSON.stringify({ name: "nslib", main: "./index.js" }),
      "/node_modules/nslib/index.js": /* js */ `
        export { Button } from './Button.js';
        export { Card } from './Card.js';
      `,
      "/node_modules/nslib/Button.js": /* js */ `
        export const Button = "button";
      `,
      // Card.js has syntax error — import * must still load it
      "/node_modules/nslib/Card.js": /* js */ `
        export const Card = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["nslib"],
    outdir: "/out",
    // import * forces loading ALL submodules, even ones not accessed
    bundleErrors: {
      "/node_modules/nslib/Card.js": ["Unexpected <<"],
    },
  });

  // --- Output equivalence: optimization must be transparent ---

  itBundled("barrel/OutputEquivalence", {
    files: {
      "/entry.js": /* js */ `
        import { A, B } from 'eqlib';
        console.log(A, B);
      `,
      "/node_modules/eqlib/package.json": JSON.stringify({ name: "eqlib", main: "./index.js" }),
      "/node_modules/eqlib/index.js": /* js */ `
        export { A } from './a.js';
        export { B } from './b.js';
        export { C } from './c.js';
      `,
      "/node_modules/eqlib/a.js": /* js */ `
        export const A = "aaa";
      `,
      "/node_modules/eqlib/b.js": /* js */ `
        export const B = "bbb";
      `,
      // c.js has syntax error — proves optimization is active (C not imported)
      "/node_modules/eqlib/c.js": /* js */ `
        export const C = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["eqlib"],
    outdir: "/out",
    onAfterBundle(api) {
      const content = api.readFile("/out/entry.js");
      // Both used values present, unused C was skipped
      expect(content).toContain("aaa");
      expect(content).toContain("bbb");
    },
  });

  // --- Default export re-export ---

  itBundled("barrel/DefaultReExport", {
    files: {
      "/entry.js": /* js */ `
        import { Button } from 'deflib';
        console.log(Button);
      `,
      "/node_modules/deflib/package.json": JSON.stringify({ name: "deflib", main: "./index.js" }),
      "/node_modules/deflib/index.js": /* js */ `
        export { default as Button } from './Button.js';
        export { default as Card } from './Card.js';
      `,
      "/node_modules/deflib/Button.js": /* js */ `
        export default "default-button";
      `,
      // Card.js has syntax error — should be skipped
      "/node_modules/deflib/Card.js": /* js */ `
        export default <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["deflib"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("default-button");
    },
  });

  // --- Import-then-export pattern (import { x } from './x'; export { x }) ---

  itBundled("barrel/ImportThenExport", {
    files: {
      "/entry.js": /* js */ `
        import { A } from 'itlib';
        console.log(A);
      `,
      "/node_modules/itlib/package.json": JSON.stringify({ name: "itlib", main: "./index.js" }),
      "/node_modules/itlib/index.js": /* js */ `
        import { A } from './a.js';
        import { B } from './b.js';
        export { A, B };
      `,
      "/node_modules/itlib/a.js": /* js */ `
        export const A = "import-then-a";
      `,
      // B.js has syntax error — if treated as pure barrel, should be skipped
      "/node_modules/itlib/b.js": /* js */ `
        export const B = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["itlib"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("import-then-a");
    },
  });

  // --- Re-export chain (barrel of barrels) ---

  itBundled("barrel/ReExportChain", {
    files: {
      "/entry.js": /* js */ `
        import { Deep } from 'chainlib';
        console.log(Deep);
      `,
      "/node_modules/chainlib/package.json": JSON.stringify({ name: "chainlib", main: "./index.js" }),
      "/node_modules/chainlib/index.js": /* js */ `
        export { Deep } from './components/index.js';
        export { Other } from './components/index.js';
      `,
      "/node_modules/chainlib/components/index.js": /* js */ `
        export { Deep } from './Deep.js';
        export { Other } from './Other.js';
      `,
      "/node_modules/chainlib/components/Deep.js": /* js */ `
        export const Deep = "deep-value";
      `,
      // Other.js has syntax error — should be skipped at both barrel levels
      "/node_modules/chainlib/components/Other.js": /* js */ `
        export const Other = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["chainlib"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("deep-value");
    },
  });

  // --- Star export mixed with named re-exports from same source ---

  itBundled("barrel/StarWithNamedFromSameSource", {
    files: {
      "/entry.js": /* js */ `
        import { specific } from 'mixstarlib';
        console.log(specific);
      `,
      "/node_modules/mixstarlib/package.json": JSON.stringify({
        name: "mixstarlib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/mixstarlib/index.js": /* js */ `
        export { specific } from './a.js';
        export * from './b.js';
      `,
      "/node_modules/mixstarlib/a.js": /* js */ `
        export const specific = "specific-val";
      `,
      // b.js has syntax error — export * targets are always loaded
      "/node_modules/mixstarlib/b.js": /* js */ `
        export const other = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    // export * targets are never deferred (avoids circular race conditions)
    bundleErrors: {
      "/node_modules/mixstarlib/b.js": ["Unexpected"],
    },
  });

  // --- Unused barrel import (import './barrel' with no names) ---

  itBundled("barrel/SideEffectOnlyImport", {
    files: {
      "/entry.js": /* js */ `
        import 'sidelib';
        console.log("loaded");
      `,
      "/node_modules/sidelib/package.json": JSON.stringify({
        name: "sidelib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/sidelib/index.js": /* js */ `
        export { A } from './a.js';
        export { B } from './b.js';
      `,
      // Both have syntax errors — but with sideEffects: false and no named imports,
      // the barrel is tree-shaken away so submodules shouldn't be parsed
      "/node_modules/sidelib/a.js": /* js */ `
        export const A = <<<SYNTAX_ERROR>>>;
      `,
      "/node_modules/sidelib/b.js": /* js */ `
        export const B = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      // Barrel is tree-shaken — no submodule errors surface
      api.expectFile("/out/entry.js").toContain("loaded");
    },
  });

  // --- Multiple importers needing different exports (late arrival) ---

  itBundled("barrel/MultipleImporters", {
    files: {
      "/entry.js": /* js */ `
        import { A } from 'multilib';
        import { getB } from './other.js';
        console.log(A, getB());
      `,
      "/other.js": /* js */ `
        import { B } from 'multilib';
        export function getB() { return B; }
      `,
      "/node_modules/multilib/package.json": JSON.stringify({ name: "multilib", main: "./index.js" }),
      "/node_modules/multilib/index.js": /* js */ `
        export { A } from './a.js';
        export { B } from './b.js';
        export { C } from './c.js';
      `,
      "/node_modules/multilib/a.js": /* js */ `
        export const A = "multi-a";
      `,
      "/node_modules/multilib/b.js": /* js */ `
        export const B = "multi-b";
      `,
      // c.js has syntax error — neither importer uses C, so it should be skipped
      "/node_modules/multilib/c.js": /* js */ `
        export const C = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["multilib"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("multi-a");
      api.expectFile("/out/entry.js").toContain("multi-b");
    },
  });

  // --- Ported from Rolldown: circular-exports ---
  // barrel-a has `export * from barrel-b`, barrel-b has `export { a as c } from barrel-a`
  // main imports `c` which resolves through the circular chain.

  itBundled("barrel/CircularExports", {
    files: {
      "/entry.js": /* js */ `
        import { c } from 'circlib';
        console.log(c);
      `,
      "/node_modules/circlib/package.json": JSON.stringify({
        name: "circlib",
        main: "./barrel-a/index.js",
        sideEffects: false,
      }),
      "/node_modules/circlib/barrel-a/index.js": /* js */ `
        export { a } from './a.js';
        export * from '../barrel-b/index.js';
      `,
      "/node_modules/circlib/barrel-a/a.js": /* js */ `
        export const a = 'aaa';
      `,
      "/node_modules/circlib/barrel-b/index.js": /* js */ `
        export { b } from './b.js';
        export { a as c } from '../barrel-a/index.js';
      `,
      "/node_modules/circlib/barrel-b/b.js": /* js */ `
        export const b = 'bbb';
      `,
    },
    outdir: "/out",
    // `c` is NOT in barrel-a's named re-exports, so export * loads barrel-b.
    // barrel-b is a star target so it's not optimized (all submodules loaded).
    // barrel-b re-exports `a as c` from barrel-a, un-deferring a.js.
    // c resolves to a.js's `a` value.
    run: { stdout: "aaa" },
  });

  // --- Ported from Rolldown: circular-star-exports ---
  // barrel-a: `export * from barrel-b`, barrel-b: `export * from barrel-a`
  // main imports `b` which is only in barrel-b

  itBundled("barrel/CircularStarExports", {
    files: {
      "/entry.js": /* js */ `
        import { b } from 'circstarlib';
        console.log(b);
      `,
      "/node_modules/circstarlib/package.json": JSON.stringify({
        name: "circstarlib",
        main: "./barrel-a/index.js",
        sideEffects: false,
      }),
      "/node_modules/circstarlib/barrel-a/index.js": /* js */ `
        export { a } from './a.js';
        export * from '../barrel-b/index.js';
      `,
      "/node_modules/circstarlib/barrel-a/a.js": /* js */ `
        export const a = 'aaa';
      `,
      "/node_modules/circstarlib/barrel-b/index.js": /* js */ `
        export * from './b.js';
        export * from '../barrel-a/index.js';
      `,
      "/node_modules/circstarlib/barrel-b/b.js": /* js */ `
        export const b = 'bbb';
      `,
    },
    outdir: "/out",
    // `b` is NOT in barrel-a's named re-exports → export * loaded →
    // barrel-b loaded. barrel-b is a star target so not optimized.
    // a.js stays deferred (nobody needs `a`).
    run: { stdout: "bbb" },
  });

  // --- Ported from Rolldown: self-re-export ---
  // barrel re-exports a symbol from itself

  itBundled("barrel/SelfReExport", {
    files: {
      "/entry.js": /* js */ `
        import { b } from 'selflib';
        console.log(b);
      `,
      "/node_modules/selflib/package.json": JSON.stringify({
        name: "selflib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/selflib/index.js": /* js */ `
        export { a } from './a.js';
        export { a as b } from './index.js';
        export { unused } from './unused.js';
      `,
      "/node_modules/selflib/a.js": /* js */ `
        export const a = 'self-a';
      `,
      // unused.js has syntax error — should be skipped (only `b` is imported)
      "/node_modules/selflib/unused.js": /* js */ `
        export const unused = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      // b resolves to a through the self-re-export, unused.js is skipped
      api.expectFile("/out/entry.js").toContain("self-a");
    },
  });

  // --- Ported from Rolldown: dynamic-import-entry ---
  // A submodule dynamically imports the barrel back

  itBundled("barrel/DynamicImportInSubmodule", {
    files: {
      "/entry.js": /* js */ `
        import { a } from 'dynlib';
        console.log(a);
      `,
      "/node_modules/dynlib/package.json": JSON.stringify({
        name: "dynlib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/dynlib/index.js": /* js */ `
        export { a } from './a.js';
        export { b } from './b.js';
      `,
      "/node_modules/dynlib/a.js": /* js */ `
        export const a = 'dyn-a';
        import('./index.js');
      `,
      // b.js has a syntax error — only a is imported, so b should be skipped
      "/node_modules/dynlib/b.js": /* js */ `
        export const b = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("dyn-a");
    },
  });

  // --- Ported from Rolldown: multiple-entries ---
  // Multiple entry points that each import different things from barrels

  itBundled("barrel/MultipleEntryPoints", {
    files: {
      "/entry1.js": /* js */ `
        import { a } from 'melib';
        console.log(a);
      `,
      "/entry2.js": /* js */ `
        import { b } from 'melib';
        console.log(b);
      `,
      "/node_modules/melib/package.json": JSON.stringify({
        name: "melib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/melib/index.js": /* js */ `
        export { a } from './a.js';
        export { b } from './b.js';
        export { c } from './c.js';
      `,
      "/node_modules/melib/a.js": /* js */ `
        export const a = 'me-a';
      `,
      "/node_modules/melib/b.js": /* js */ `
        export const b = 'me-b';
      `,
      // c.js syntax error — neither entry uses c, should be skipped
      "/node_modules/melib/c.js": /* js */ `
        export const c = <<<SYNTAX_ERROR>>>;
      `,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry1.js").toContain("me-a");
      api.expectFile("/out/entry2.js").toContain("me-b");
    },
  });

  // --- Ported from Rolldown: multiple-entries with cross-referencing barrels ---

  itBundled("barrel/CrossReferencingBarrels", {
    files: {
      "/entry1.js": /* js */ `
        import { a } from 'xreflib/barrel-a';
        console.log(a);
      `,
      "/entry2.js": /* js */ `
        import { b } from 'xreflib/barrel-b';
        console.log(b);
      `,
      "/entry3.js": /* js */ `
        import { c } from 'xreflib/barrel-c';
        console.log(c);
      `,
      "/node_modules/xreflib/package.json": JSON.stringify({
        name: "xreflib",
        sideEffects: false,
      }),
      "/node_modules/xreflib/barrel-a/index.js": /* js */ `
        export { a } from './a.js';
        export { b as d } from '../barrel-b/index.js';
        export * from '../barrel-b/index.js';
      `,
      "/node_modules/xreflib/barrel-a/a.js": /* js */ `
        export const a = 'xref-a';
      `,
      "/node_modules/xreflib/barrel-b/index.js": /* js */ `
        export { b } from './b.js';
        export { c } from './c.js';
        export * from '../barrel-a/index.js';
      `,
      "/node_modules/xreflib/barrel-b/b.js": /* js */ `
        export const b = 'xref-b';
      `,
      "/node_modules/xreflib/barrel-b/c.js": /* js */ `
        export const c = 'xref-c-unused';
      `,
      "/node_modules/xreflib/barrel-c.js": /* js */ `
        export { d as c } from './barrel-b/index.js';
      `,
    },
    entryPoints: ["/entry1.js", "/entry2.js", "/entry3.js"],
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "xref-a" },
      { file: "/out/entry2.js", stdout: "xref-b" },
      { file: "/out/entry3.js", stdout: "xref-b" },
    ],
  });

  // --- Ported from Rolldown: treeshake case-reexport-default ---
  // export { x as default } is a re-export, not an own export

  itBundled("barrel/ReExportAsDefault", {
    files: {
      "/entry.js": /* js */ `
        import val from 'redeflib';
        console.log(val);
      `,
      "/node_modules/redeflib/package.json": JSON.stringify({
        name: "redeflib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/redeflib/index.js": /* js */ `
        export { a } from './a.js';
        export { val as default } from './val.js';
        export { unused } from './unused.js';
      `,
      "/node_modules/redeflib/a.js": /* js */ `
        export const a = 'aaa';
      `,
      "/node_modules/redeflib/val.js": /* js */ `
        export const val = 'default-reexport-val';
      `,
      // unused.js has syntax error — should be skipped
      "/node_modules/redeflib/unused.js": /* js */ `
        export const unused = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("default-reexport-val");
    },
  });

  // --- CommonJS interop: barrel re-exports from CJS module ---

  itBundled("barrel/CJSInterop", {
    files: {
      "/entry.js": /* js */ `
        import { cjsVal } from 'cjslib';
        console.log(cjsVal);
      `,
      "/node_modules/cjslib/package.json": JSON.stringify({
        name: "cjslib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/cjslib/index.js": /* js */ `
        export { cjsVal } from './cjs-module.cjs';
        export { unused } from './unused.js';
      `,
      "/node_modules/cjslib/cjs-module.cjs": /* js */ `
        module.exports = { cjsVal: "from-cjs" };
      `,
      // unused.js has syntax error — should be skipped
      "/node_modules/cjslib/unused.js": /* js */ `
        export const unused = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("from-cjs");
    },
  });

  // --- Side effects in barrel body with sideEffects: false ---

  itBundled("barrel/SideEffectsInBarrelBody", {
    files: {
      "/entry.js": /* js */ `
        import { X } from 'sefxlib';
        console.log(X);
      `,
      "/node_modules/sefxlib/package.json": JSON.stringify({
        name: "sefxlib",
        main: "./index.js",
        sideEffects: false,
      }),
      // Barrel has console.log at top but all exports are re-exports.
      // It's still a pure barrel — optimization applies.
      "/node_modules/sefxlib/index.js": /* js */ `
        console.log("barrel loaded");
        export { X } from './x.js';
        export { Y } from './y.js';
      `,
      "/node_modules/sefxlib/x.js": /* js */ `
        export const X = "side-x";
      `,
      // y.js has syntax error — only X is imported, so Y should be skipped
      "/node_modules/sefxlib/y.js": /* js */ `
        export const Y = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("side-x");
    },
  });

  // --- Own default export: barrel with `export default` is NOT a pure barrel ---

  itBundled("barrel/OwnDefaultExport", {
    files: {
      "/entry.js": /* js */ `
        import lib from 'owndeflib';
        console.log(lib);
      `,
      "/node_modules/owndeflib/package.json": JSON.stringify({
        name: "owndeflib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/owndeflib/index.js": /* js */ `
        export { A } from './a.js';
        const val = "own-default";
        export default val;
      `,
      "/node_modules/owndeflib/a.js": /* js */ `
        export const A = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    // `export default val` is a local export, so this is NOT a pure barrel.
    // All submodules should be parsed, causing the syntax error.
    bundleErrors: {
      "/node_modules/owndeflib/a.js": ["Unexpected <<"],
    },
  });

  // --- import { default as X } syntax (named import of default) ---

  itBundled("barrel/NamedImportOfDefault", {
    files: {
      "/entry.js": /* js */ `
        import { default as Btn } from 'nidlib';
        console.log(Btn);
      `,
      "/node_modules/nidlib/package.json": JSON.stringify({
        name: "nidlib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/nidlib/index.js": /* js */ `
        export { default } from './btn.js';
        export { unused } from './unused.js';
      `,
      "/node_modules/nidlib/btn.js": /* js */ `
        export default "named-default-btn";
      `,
      // unused.js syntax error — should be skipped
      "/node_modules/nidlib/unused.js": /* js */ `
        export const unused = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("named-default-btn");
    },
  });

  // --- Only export * barrel (zero named re-exports) ---

  itBundled("barrel/OnlyExportStar", {
    files: {
      "/entry.js": /* js */ `
        import { X } from 'staronly';
        console.log(X);
      `,
      "/node_modules/staronly/package.json": JSON.stringify({
        name: "staronly",
        main: "./index.js",
        sideEffects: false,
      }),
      // No named re-exports — only export *. Both must be loaded.
      "/node_modules/staronly/index.js": /* js */ `
        export * from './a.js';
        export * from './b.js';
      `,
      "/node_modules/staronly/a.js": /* js */ `
        export const X = "star-only-x";
      `,
      // b.js has syntax error — export * must load it anyway
      "/node_modules/staronly/b.js": /* js */ `
        export const Y = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    // export * conservatively loads all targets
    bundleErrors: {
      "/node_modules/staronly/b.js": ["Unexpected <<"],
    },
  });

  // --- Entry point IS a barrel file ---

  itBundled("barrel/EntryPointIsBarrel", {
    files: {
      // The entry point itself is a pure re-export barrel.
      // Optimization should NOT apply to entry points — both submodules must load.
      "/entry.js": /* js */ `
        export { A } from './a.js';
        export { B } from './b.js';
      `,
      "/a.js": /* js */ `
        export const A = "entry-barrel-a";
      `,
      // b.js has syntax error — must still be loaded because entry points aren't optimized
      "/b.js": /* js */ `
        export const B = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    // Entry point is never treated as a barrel, so b.js is always loaded
    bundleErrors: {
      "/b.js": ["Unexpected <<"],
    },
  });

  // --- TypeScript type-only re-exports should be ignored ---

  itBundled("barrel/TypeOnlyReExports", {
    files: {
      "/entry.ts": /* ts */ `
        import { RealVal } from 'tslib';
        console.log(RealVal);
      `,
      "/node_modules/tslib/package.json": JSON.stringify({
        name: "tslib",
        main: "./index.ts",
        sideEffects: false,
      }),
      "/node_modules/tslib/index.ts": /* ts */ `
        export { RealVal } from './real.js';
        export type { MyType } from './types.js';
        export { unused } from './unused.js';
      `,
      "/node_modules/tslib/real.js": /* js */ `
        export const RealVal = "ts-real-val";
      `,
      "/node_modules/tslib/types.js": /* js */ `
        export const MyType = "should-not-matter";
      `,
      // unused.js has syntax error — should be skipped
      "/node_modules/tslib/unused.js": /* js */ `
        export const unused = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("ts-real-val");
    },
  });

  // --- Overlapping export * and named from same source ---

  itBundled("barrel/OverlappingStarAndNamed", {
    files: {
      "/entry.js": /* js */ `
        import { x } from 'overlaplib';
        console.log(x);
      `,
      "/node_modules/overlaplib/package.json": JSON.stringify({
        name: "overlaplib",
        main: "./index.js",
        sideEffects: false,
      }),
      // export * and named re-export from the SAME source
      "/node_modules/overlaplib/index.js": /* js */ `
        export { x } from './a.js';
        export * from './a.js';
        export { unused } from './unused.js';
      `,
      "/node_modules/overlaplib/a.js": /* js */ `
        export const x = "overlap-x";
        export const extra = "overlap-extra";
      `,
      // unused.js has syntax error — should be skipped
      "/node_modules/overlaplib/unused.js": /* js */ `
        export const unused = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("overlap-x");
    },
  });

  // --- Error diagnostics: needed submodule has errors ---

  itBundled("barrel/ErrorInNeededSubmodule", {
    files: {
      "/entry.js": /* js */ `
        import { Broken } from 'errlib';
        console.log(Broken);
      `,
      "/node_modules/errlib/package.json": JSON.stringify({
        name: "errlib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/errlib/index.js": /* js */ `
        export { Broken } from './broken.js';
        export { Ok } from './ok.js';
      `,
      "/node_modules/errlib/broken.js": /* js */ `
        export const Broken = <<<SYNTAX_ERROR>>>;
      `,
      "/node_modules/errlib/ok.js": /* js */ `
        export const Ok = "ok";
      `,
    },
    outdir: "/out",
    // Broken is explicitly imported — its submodule MUST be loaded and will error
    bundleErrors: {
      "/node_modules/errlib/broken.js": ["Unexpected <<"],
    },
  });

  // --- Runtime equivalence: output must execute correctly ---

  itBundled("barrel/RuntimeCorrectness", {
    files: {
      "/entry.js": /* js */ `
        import { Button } from 'runlib';
        console.log(Button);
      `,
      "/node_modules/runlib/package.json": JSON.stringify({ name: "runlib", main: "./index.js" }),
      "/node_modules/runlib/index.js": /* js */ `
        export { Button } from './Button.js';
        export { Card } from './Card.js';
      `,
      "/node_modules/runlib/Button.js": /* js */ `
        export const Button = "runtime-button";
      `,
      // Card.js has syntax error — skipped by optimization
      "/node_modules/runlib/Card.js": /* js */ `
        export const Card = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["runlib"],
    outdir: "/out",
    run: { stdout: "runtime-button" },
  });

  itBundled("barrel/RuntimeCorrectnessMultiple", {
    files: {
      "/entry.js": /* js */ `
        import { A, B } from 'runlib2';
        console.log(A + "," + B);
      `,
      "/node_modules/runlib2/package.json": JSON.stringify({ name: "runlib2", main: "./index.js" }),
      "/node_modules/runlib2/index.js": /* js */ `
        export { A } from './a.js';
        export { B } from './b.js';
        export { C } from './c.js';
      `,
      "/node_modules/runlib2/a.js": /* js */ `
        export const A = "aa";
      `,
      "/node_modules/runlib2/b.js": /* js */ `
        export const B = "bb";
      `,
      // c.js has syntax error — skipped
      "/node_modules/runlib2/c.js": /* js */ `
        export const C = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["runlib2"],
    outdir: "/out",
    run: { stdout: "aa,bb" },
  });

  // --- Renamed re-exports: export { foo as bar } ---

  itBundled("barrel/RenamedReExport", {
    files: {
      "/entry.js": /* js */ `
        import { bar } from 'renamelib';
        console.log(bar);
      `,
      "/node_modules/renamelib/package.json": JSON.stringify({ name: "renamelib", main: "./index.js" }),
      "/node_modules/renamelib/index.js": /* js */ `
        export { foo as bar } from './foo.js';
        export { baz as qux } from './baz.js';
      `,
      "/node_modules/renamelib/foo.js": /* js */ `
        export const foo = "renamed-foo";
      `,
      // baz.js has syntax error — only bar is imported (which is foo renamed)
      "/node_modules/renamelib/baz.js": /* js */ `
        export const baz = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["renamelib"],
    outdir: "/out",
    run: { stdout: "renamed-foo" },
  });

  // --- Multiple exports from same submodule (partial use) ---

  itBundled("barrel/MultipleExportsFromSameSubmodule", {
    files: {
      "/entry.js": /* js */ `
        import { A } from 'samesublib';
        console.log(A);
      `,
      "/node_modules/samesublib/package.json": JSON.stringify({ name: "samesublib", main: "./index.js" }),
      "/node_modules/samesublib/index.js": /* js */ `
        export { A, B } from './ab.js';
        export { C } from './c.js';
      `,
      "/node_modules/samesublib/ab.js": /* js */ `
        export const A = "same-a";
        export const B = "same-b";
      `,
      // c.js has syntax error — only A is imported which comes from ab.js
      "/node_modules/samesublib/c.js": /* js */ `
        export const C = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["samesublib"],
    outdir: "/out",
    // A and B share the same import record (ab.js), so ab.js is loaded.
    // c.js is deferred since C is unused.
    run: { stdout: "same-a" },
  });

  // --- Transitive deps of loaded submodules ---

  itBundled("barrel/TransitiveDeps", {
    files: {
      "/entry.js": /* js */ `
        import { Button } from 'translib';
        console.log(Button);
      `,
      "/node_modules/translib/package.json": JSON.stringify({ name: "translib", main: "./index.js" }),
      "/node_modules/translib/index.js": /* js */ `
        export { Button } from './Button.js';
        export { Card } from './Card.js';
      `,
      // Button.js imports a helper — its transitive deps must also load
      "/node_modules/translib/Button.js": /* js */ `
        import { helper } from './helper.js';
        export const Button = helper("btn");
      `,
      "/node_modules/translib/helper.js": /* js */ `
        export function helper(x) { return "helped-" + x; }
      `,
      // Card.js has syntax error — skipped
      "/node_modules/translib/Card.js": /* js */ `
        export const Card = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["translib"],
    outdir: "/out",
    // Button.js is loaded, its transitive dep helper.js is also loaded
    run: { stdout: "helped-btn" },
  });

  // --- Non-existent import: error message quality ---

  itBundled("barrel/NonExistentImport", {
    files: {
      "/entry.js": /* js */ `
        import { DoesNotExist } from 'nxlib';
        console.log(DoesNotExist);
      `,
      "/node_modules/nxlib/package.json": JSON.stringify({ name: "nxlib", main: "./index.js" }),
      "/node_modules/nxlib/index.js": /* js */ `
        export { A } from './a.js';
        export { B } from './b.js';
      `,
      "/node_modules/nxlib/a.js": /* js */ `
        export const A = "a";
      `,
      "/node_modules/nxlib/b.js": /* js */ `
        export const B = "b";
      `,
    },
    optimizeImports: ["nxlib"],
    outdir: "/out",
    // Importing a non-existent export should produce a clear error
    bundleErrors: {
      "/entry.js": ['"DoesNotExist"'],
    },
  });

  // --- Code splitting: barrel + splitting ---

  itBundled("barrel/CodeSplitting", {
    files: {
      "/entry1.js": /* js */ `
        import { A } from 'splitlib';
        console.log(A);
      `,
      "/entry2.js": /* js */ `
        import { B } from 'splitlib';
        console.log(B);
      `,
      "/node_modules/splitlib/package.json": JSON.stringify({ name: "splitlib", main: "./index.js" }),
      "/node_modules/splitlib/index.js": /* js */ `
        export { A } from './a.js';
        export { B } from './b.js';
        export { C } from './c.js';
      `,
      "/node_modules/splitlib/a.js": /* js */ `
        export const A = "split-a";
      `,
      "/node_modules/splitlib/b.js": /* js */ `
        export const B = "split-b";
      `,
      // c.js syntax error — neither entry imports C
      "/node_modules/splitlib/c.js": /* js */ `
        export const C = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["splitlib"],
    entryPoints: ["/entry1.js", "/entry2.js"],
    splitting: true,
    outdir: "/out",
    run: [
      { file: "/out/entry1.js", stdout: "split-a" },
      { file: "/out/entry2.js", stdout: "split-b" },
    ],
  });

  // --- Duplicate imports from same barrel in one file ---

  itBundled("barrel/DuplicateImports", {
    files: {
      "/entry.js": /* js */ `
        import { A } from 'duplib';
        import { B } from 'duplib';
        console.log(A + "," + B);
      `,
      "/node_modules/duplib/package.json": JSON.stringify({ name: "duplib", main: "./index.js" }),
      "/node_modules/duplib/index.js": /* js */ `
        export { A } from './a.js';
        export { B } from './b.js';
        export { C } from './c.js';
      `,
      "/node_modules/duplib/a.js": /* js */ `
        export const A = "dup-a";
      `,
      "/node_modules/duplib/b.js": /* js */ `
        export const B = "dup-b";
      `,
      // c.js syntax error — C unused
      "/node_modules/duplib/c.js": /* js */ `
        export const C = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["duplib"],
    outdir: "/out",
    run: { stdout: "dup-a,dup-b" },
  });

  // --- Resolve plugin + barrel optimization ---

  itBundled("barrel/ResolvePlugin", {
    files: {
      "/entry.js": /* js */ `
        import { A } from 'pluglib';
        console.log(A);
      `,
      "/node_modules/pluglib/package.json": JSON.stringify({ name: "pluglib", main: "./index.js" }),
      "/node_modules/pluglib/index.js": /* js */ `
        export { A } from './a.js';
        export { B } from './b.js';
      `,
      "/node_modules/pluglib/real-a.js": /* js */ `
        export const A = "resolved-by-plugin";
      `,
      // b.js has syntax error — should be skipped
      "/node_modules/pluglib/b.js": /* js */ `
        export const B = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["pluglib"],
    outdir: "/out",
    // Plugin rewrites ./a.js -> ./real-a.js
    plugins(builder) {
      builder.onResolve({ filter: /a\.js$/ }, args => {
        if (args.importer.includes("pluglib")) {
          return { path: args.importer.replace("index.js", "real-a.js") };
        }
      });
    },
    run: { stdout: "resolved-by-plugin" },
  });

  // --- Load plugin + barrel optimization ---

  itBundled("barrel/LoadPlugin", {
    files: {
      "/entry.js": /* js */ `
        import { A } from 'loadlib';
        console.log(A);
      `,
      "/node_modules/loadlib/package.json": JSON.stringify({ name: "loadlib", main: "./index.js" }),
      "/node_modules/loadlib/index.js": /* js */ `
        export { A } from './a.js';
        export { B } from './b.js';
      `,
      "/node_modules/loadlib/a.js": /* js */ `
        export const A = "original";
      `,
      // b.js has syntax error — should be skipped
      "/node_modules/loadlib/b.js": /* js */ `
        export const B = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["loadlib"],
    outdir: "/out",
    // Plugin transforms a.js content
    plugins(builder) {
      builder.onLoad({ filter: /loadlib\/a\.js$/ }, () => {
        return { contents: 'export const A = "transformed-by-plugin";', loader: "js" };
      });
    },
    run: { stdout: "transformed-by-plugin" },
  });

  // --- Late arrival needing a name from export * ---

  itBundled("barrel/LateArrivalExportStar", {
    files: {
      "/entry.js": /* js */ `
        import { A } from 'latestarlib';
        import { getB } from './other.js';
        console.log(A + "," + getB());
      `,
      "/other.js": /* js */ `
        import { B } from 'latestarlib';
        export function getB() { return B; }
      `,
      "/node_modules/latestarlib/package.json": JSON.stringify({ name: "latestarlib", main: "./index.js" }),
      "/node_modules/latestarlib/index.js": /* js */ `
        export { A } from './a.js';
        export * from './star.js';
      `,
      "/node_modules/latestarlib/a.js": /* js */ `
        export const A = "late-a";
      `,
      "/node_modules/latestarlib/star.js": /* js */ `
        export const B = "late-star-b";
      `,
    },
    optimizeImports: ["latestarlib"],
    outdir: "/out",
    // entry.js imports A (named re-export) — star.js deferred.
    // other.js imports B (NOT in named re-exports) — must un-defer star.js.
    run: { stdout: "late-a,late-star-b" },
  });

  // --- CJS output format ---

  itBundled("barrel/CJSOutputFormat", {
    files: {
      "/entry.js": /* js */ `
        import { A } from 'cjsoutlib';
        console.log(A);
      `,
      "/node_modules/cjsoutlib/package.json": JSON.stringify({ name: "cjsoutlib", main: "./index.js" }),
      "/node_modules/cjsoutlib/index.js": /* js */ `
        export { A } from './a.js';
        export { B } from './b.js';
      `,
      "/node_modules/cjsoutlib/a.js": /* js */ `
        export const A = "cjs-out-a";
      `,
      // b.js has syntax error — should be skipped
      "/node_modules/cjsoutlib/b.js": /* js */ `
        export const B = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["cjsoutlib"],
    format: "cjs",
    outdir: "/out",
    run: { stdout: "cjs-out-a" },
  });

  // --- BFS cycle safety: circular export * with nonexistent name must not hang ---

  itBundled("barrel/CircularStarNonexistent", {
    files: {
      "/entry.js": /* js */ `
        import { nope } from 'cyclelib';
        console.log(nope);
      `,
      "/node_modules/cyclelib/package.json": JSON.stringify({
        name: "cyclelib",
        main: "./a/index.js",
        sideEffects: false,
      }),
      "/node_modules/cyclelib/a/index.js": /* js */ `
        export { x } from './x.js';
        export * from '../b/index.js';
      `,
      "/node_modules/cyclelib/a/x.js": /* js */ `
        export const x = 'x';
      `,
      "/node_modules/cyclelib/b/index.js": /* js */ `
        export { y } from './y.js';
        export * from '../a/index.js';
      `,
      "/node_modules/cyclelib/b/y.js": /* js */ `
        export const y = 'y';
      `,
    },
    outdir: "/out",
    // `nope` doesn't exist in either barrel — must not hang, should error
    bundleErrors: {
      "/entry.js": ["No matching export"],
    },
  });

  // --- Deep barrel chain: 3+ levels ---

  itBundled("barrel/DeepBarrelChain", {
    files: {
      "/entry.js": /* js */ `
        import { leaf } from 'deeplib';
        console.log(leaf);
      `,
      "/node_modules/deeplib/package.json": JSON.stringify({
        name: "deeplib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/deeplib/index.js": /* js */ `
        export { leaf } from './mid/index.js';
        export { unused1 } from './unused1.js';
      `,
      "/node_modules/deeplib/mid/index.js": /* js */ `
        export { leaf } from './deep/index.js';
        export { unused2 } from '../unused2.js';
      `,
      "/node_modules/deeplib/mid/deep/index.js": /* js */ `
        export { leaf } from './leaf.js';
        export { unused3 } from '../../unused3.js';
      `,
      "/node_modules/deeplib/mid/deep/leaf.js": /* js */ `
        export const leaf = "deep-leaf-value";
      `,
      // All unused files have syntax errors — should be skipped at every level
      "/node_modules/deeplib/unused1.js": /* js */ `
        export const unused1 = <<<SYNTAX_ERROR>>>;
      `,
      "/node_modules/deeplib/unused2.js": /* js */ `
        export const unused2 = <<<SYNTAX_ERROR>>>;
      `,
      "/node_modules/deeplib/unused3.js": /* js */ `
        export const unused3 = <<<SYNTAX_ERROR>>>;
      `,
    },
    outdir: "/out",
    run: { stdout: "deep-leaf-value" },
  });

  // --- Two separate export-from statements pointing to the same source ---
  // This reproduces the ecma402-abstract pattern where the same file is
  // re-exported in two separate export-from blocks, and the second block
  // contains exports (like `invariant`) that must not be lost.

  itBundled("barrel/DuplicateExportFromSameSource", {
    files: {
      "/entry.js": /* js */ `
        import { invariant } from 'mylib';
        console.log(typeof invariant);
      `,
      "/node_modules/mylib/package.json": JSON.stringify({ name: "mylib", main: "./index.js" }),
      "/node_modules/mylib/index.js": /* js */ `
        export {
          createDataProperty,
          defineProperty,
        } from './utils.js';

        export { unrelated } from './other.js';

        export {
          invariant,
        } from './utils.js';
      `,
      "/node_modules/mylib/utils.js": /* js */ `
        export function createDataProperty() {}
        export function defineProperty() {}
        export function invariant(cond, msg) {
          if (!cond) throw new Error(msg);
        }
      `,
      "/node_modules/mylib/other.js": /* js */ `
        export const unrelated = <<<SYNTAX_ERROR>>>;
      `,
    },
    optimizeImports: ["mylib"],
    outdir: "/out",
    run: { stdout: "function" },
  });
});
