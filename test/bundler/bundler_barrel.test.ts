import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";
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

  // A "sideEffects" array must not enable barrel deferral: a deferred
  // re-export target may itself be listed in the array. See #40650.
  itBundled("barrel/SideEffectsArrayKeepsListedReExport", {
    files: {
      "/entry.js": /* js */ `
        import { plain } from 'effectful';
        console.log(plain('x'));
      `,
      "/node_modules/effectful/package.json": JSON.stringify({
        name: "effectful",
        main: "./src/index.js",
        sideEffects: ["./src/effect.js"],
      }),
      "/node_modules/effectful/src/index.js": /* js */ `
        export { plain } from './plain.js';
        export { TABLE } from './effect.js';
      `,
      "/node_modules/effectful/src/plain.js": /* js */ `
        export const plain = s => s + "!";
      `,
      "/node_modules/effectful/src/effect.js": /* js */ `
        export const TABLE = {};
        TABLE.marker = "THE_SIDE_EFFECT_RAN";
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("THE_SIDE_EFFECT_RAN");
    },
  });

  itBundled("barrel/SideEffectsArrayGlobKeepsListedReExport", {
    files: {
      "/entry.js": /* js */ `
        import { plain } from 'effectful';
        console.log(plain('x'));
      `,
      "/node_modules/effectful/package.json": JSON.stringify({
        name: "effectful",
        main: "./src/index.js",
        sideEffects: ["**/effect.js"],
      }),
      "/node_modules/effectful/src/index.js": /* js */ `
        export { plain } from './plain.js';
        export { TABLE } from './effect.js';
      `,
      "/node_modules/effectful/src/plain.js": /* js */ `
        export const plain = s => s + "!";
      `,
      "/node_modules/effectful/src/effect.js": /* js */ `
        export const TABLE = {};
        TABLE.marker = "THE_SIDE_EFFECT_RAN";
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("THE_SIDE_EFFECT_RAN");
    },
  });

  // A module the array does not list is still tree-shaken away.
  itBundled("barrel/SideEffectsArrayDropsUnlistedReExport", {
    files: {
      "/entry.js": /* js */ `
        import { plain } from 'effectful';
        console.log(plain('x'));
      `,
      "/node_modules/effectful/package.json": JSON.stringify({
        name: "effectful",
        main: "./src/index.js",
        sideEffects: ["./src/plain.js"],
      }),
      "/node_modules/effectful/src/index.js": /* js */ `
        export { plain } from './plain.js';
        export { TABLE } from './effect.js';
      `,
      "/node_modules/effectful/src/plain.js": /* js */ `
        export const plain = s => s + "!";
      `,
      "/node_modules/effectful/src/effect.js": /* js */ `
        export const TABLE = {};
        TABLE.marker = "THE_SIDE_EFFECT_RAN";
      `,
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").not.toContain("THE_SIDE_EFFECT_RAN");
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

  // Regression test for #31146.
  //
  // `optimizeImports` is documented as being equivalent to a package having
  // `"sideEffects": false` in its package.json. That equivalence held for
  // *pure* barrels (the parse-skip path). For *mixed* barrels (a local
  // export alongside re-exports — common in real-world packages like
  // cheerio) the parse-skip path bails, and before this fix `optimizeImports`
  // gave zero bundle-size benefit. `"sideEffects": false` kept working
  // because the linker tree-shakes unused re-export targets independently.
  // The fix propagates `optimizeImports` through to the resolver's
  // `primary_side_effects_data` so the linker does the same work here.
  //
  // The long string-concat expressions are intentional: short literal values
  // get inlined and DCE'd regardless of `optimizeImports`, so the assertion
  // needs a payload the bundler can't constant-fold away.
  itBundled("barrel/OptimizeImportsMixedBarrel", {
    files: {
      "/entry.js": /* js */ `
        import { Alpha } from 'mixedopt';
        console.log(Alpha);
      `,
      "/node_modules/mixedopt/package.json": JSON.stringify({
        name: "mixedopt",
        main: "./index.js",
        // No sideEffects field — optimization relies on optimizeImports.
      }),
      "/node_modules/mixedopt/index.js": /* js */ `
        export { Alpha } from './Alpha.js';
        export { Beta } from './Beta.js';
        export const VERSION = "1.0.0";
      `,
      "/node_modules/mixedopt/Alpha.js": /* js */ `
        export const Alpha = "ALPHA_MARKER_" + "aaaaaaaa".repeat(10);
      `,
      "/node_modules/mixedopt/Beta.js": /* js */ `
        export const Beta = "BETA_MARKER_" + "bbbbbbbb".repeat(10);
      `,
    },
    optimizeImports: ["mixedopt"],
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("ALPHA_MARKER_");
      api.expectFile("/out/entry.js").not.toContain("BETA_MARKER_");
    },
  });

  // Same scenario but the resolution path goes through a plugin that
  // returns undefined (onResolve "NoMatch"), forcing the bundler down the
  // `run_resolver` → `enqueue_parse_task` fallback. That path wasn't
  // propagating `primary_side_effects_data` at all (pre-existing bug that
  // also made `sideEffects: false` fail on the plugin NoMatch fallback),
  // so the optimizeImports override was getting dropped before it reached
  // the linker. Companion to `OptimizeImportsMixedBarrel`.
  itBundled("barrel/OptimizeImportsMixedBarrelWithPluginNoMatch", {
    files: {
      "/entry.js": /* js */ `
        import { Alpha } from 'mixedoptplug';
        console.log(Alpha);
      `,
      "/node_modules/mixedoptplug/package.json": JSON.stringify({
        name: "mixedoptplug",
        main: "./index.js",
      }),
      "/node_modules/mixedoptplug/index.js": /* js */ `
        export { Alpha } from './Alpha.js';
        export { Beta } from './Beta.js';
        export const VERSION = "1.0.0";
      `,
      "/node_modules/mixedoptplug/Alpha.js": /* js */ `
        export const Alpha = "ALPHA_MARKER_" + "aaaaaaaa".repeat(10);
      `,
      "/node_modules/mixedoptplug/Beta.js": /* js */ `
        export const Beta = "BETA_MARKER_" + "bbbbbbbb".repeat(10);
      `,
    },
    optimizeImports: ["mixedoptplug"],
    outdir: "/out",
    // Filter /.*/ so the plugin intercepts every resolve — including the
    // nested `./Alpha.js` / `./Beta.js` specifiers — and returns undefined
    // for all of them. Each goes through `run_resolver` → `enqueue_parse_task`.
    // Without the enqueue_parse_task fix, `side_effects = loader.side_effects()`
    // was stamped as HasSideEffects for every submodule and Beta leaked into
    // the bundle even though entry.js only reads Alpha.
    plugins(builder) {
      builder.onResolve({ filter: /.*/ }, () => undefined);
    },
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("ALPHA_MARKER_");
      api.expectFile("/out/entry.js").not.toContain("BETA_MARKER_");
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

  itBundled("barrel/NamespaceReExportCycleThroughStarTarget", {
    files: {
      "/entry.js": /* js */ `
        import { keep } from 'looplib/w.js';
        import { other } from 'looplib/g.js';
        import { x, y, deepValue } from 'looplib';
        console.log(typeof x + " " + y + " " + keep + " " + deepValue + " " + other);
      `,
      "/node_modules/looplib/package.json": JSON.stringify({
        name: "looplib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/looplib/index.js": /* js */ `
        export * from './t.js';
      `,
      "/node_modules/looplib/t.js": /* js */ `
        export { x } from './w.js';
        export * from './r.js';
        export * from './g.js';
      `,
      "/node_modules/looplib/w.js": /* js */ `
        import * as ns from './t.js';
        export { ns as x };
        export { keep } from './keep.js';
      `,
      "/node_modules/looplib/keep.js": /* js */ `
        export const keep = "KEEP";
      `,
      "/node_modules/looplib/r.js": /* js */ `
        export const y = "Y";
      `,
      "/node_modules/looplib/g.js": /* js */ `
        export { deepValue } from './deep.js';
        export { other } from './other.js';
      `,
      "/node_modules/looplib/deep.js": /* js */ `
        export const deepValue = "DEEP";
      `,
      "/node_modules/looplib/other.js": /* js */ `
        export const other = "OTHER";
      `,
    },
    outdir: "/out",
    run: { stdout: "object Y KEEP DEEP OTHER" },
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
  // A submodule dynamically imports the barrel back. When the namespace it
  // yields can be observed (here it escapes to a global), every barrel export
  // must be preserved; a bare `import('./index.js');` statement observes
  // nothing, so only the statically imported `a` survives.
  for (const [name, stmt, keepsB] of [
    ["barrel/DynamicImportInSubmodule", `import('./index.js').then(ns => { globalThis.ns = ns; });`, true],
    ["barrel/DynamicImportInSubmoduleBare", `import('./index.js');`, false],
  ] as const) {
    itBundled(name, {
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
          ${stmt}
        `,
        "/node_modules/dynlib/b.js": /* js */ `
          export const b = 'dyn-b';
        `,
      },
      outdir: "/out",
      onAfterBundle(api) {
        api.expectFile("/out/entry.js").toContain("dyn-a");
        if (keepsB) api.expectFile("/out/entry.js").toContain("dyn-b");
        else api.expectFile("/out/entry.js").not.toContain("dyn-b");
      },
    });
  }

  // Dynamic import returns the full namespace at runtime — consumer can access any export.
  // When a file also has a static named import of the same barrel, the barrel
  // optimization must not drop exports the dynamic import might use.
  // Previously, the dynamic import was ignored if a static import already seeded
  // requested_exports, producing invalid JS (export clause referencing undeclared symbol).
  itBundled("barrel/DynamicImportWithStaticImportSameTarget", {
    files: {
      "/entry.js": /* js */ `
        import { a } from "barrel";
        console.log(a);
        const run = async () => {
          const { b } = await import("barrel");
          console.log(b);
        };
        run();
      `,
      "/node_modules/barrel/package.json": JSON.stringify({
        name: "barrel",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/barrel/index.js": /* js */ `
        export { a } from "./a.js";
        export { b } from "./b.js";
      `,
      "/node_modules/barrel/a.js": /* js */ `
        export const a = "A";
      `,
      "/node_modules/barrel/b.js": /* js */ `
        export const b = "B";
      `,
    },
    splitting: true,
    format: "esm",
    target: "bun",
    outdir: "/out",
    run: {
      stdout: "A\nB",
    },
  });

  // Same as above but static and dynamic importers are in separate files.
  // This was parse-order dependent — if the static importer's
  // scheduleBarrelDeferredImports ran first, it seeded .partial and the dynamic
  // importer's escalation was skipped. Now import() always escalates to .all.
  itBundled("barrel/DynamicImportWithStaticImportSeparateFiles", {
    files: {
      "/static-user.js": /* js */ `
        import { a } from "barrel2";
        console.log(a);
      `,
      "/dynamic-user.js": /* js */ `
        const run = async () => {
          const { b } = await import("barrel2");
          console.log(b);
        };
        run();
      `,
      "/node_modules/barrel2/package.json": JSON.stringify({
        name: "barrel2",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/barrel2/index.js": /* js */ `
        export { a } from "./a.js";
        export { b } from "./b.js";
      `,
      "/node_modules/barrel2/a.js": /* js */ `
        export const a = "A";
      `,
      "/node_modules/barrel2/b.js": /* js */ `
        export const b = "B";
      `,
    },
    entryPoints: ["/static-user.js", "/dynamic-user.js"],
    splitting: true,
    format: "esm",
    target: "bun",
    outdir: "/out",
    run: [
      { file: "/out/static-user.js", stdout: "A" },
      { file: "/out/dynamic-user.js", stdout: "B" },
    ],
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

  // --- Each barrel record is resolved once ---

  // a.js is only discovered through the barrel, so its request for Broken and C
  // always arrives after the barrel deferred both. Un-deferring Broken reports
  // the failure. Un-deferring C must not resolve Broken (and report it) again.
  itBundled("barrel/UnDeferReportsUnresolvableSiblingOnce", {
    files: {
      "/entry.js": /* js */ `
        import { A } from 'oncelib';
        console.log(A);
      `,
      "/node_modules/oncelib/package.json": JSON.stringify({
        name: "oncelib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/oncelib/index.js": /* js */ `
        export { A } from './a.js';
        export { Broken } from './missing.js';
        export { C } from './c.js';
      `,
      "/node_modules/oncelib/a.js": /* js */ `
        import { Broken, C } from 'oncelib';
        export const A = Broken + C;
      `,
      "/node_modules/oncelib/c.js": /* js */ `
        export const C = "c";
      `,
    },
    outfile: "/out.js",
    bundleErrors: {
      "/node_modules/oncelib/index.js": ['Could not resolve: "./missing.js"'],
    },
  });

  // A re-export that resolves as external never gets a source_index. Requests
  // for it from importers must not resolve the barrel again, so the onResolve
  // plugin runs once for the record.
  itBundled("barrel/ExternalReExportResolvesOnce", () => {
    const resolved: string[] = [];
    return {
      files: {
        "/entry.js": /* js */ `
          import { React } from 'extlib';
          import { other } from './other.js';
          console.log(React, other);
        `,
        "/other.js": /* js */ `
          import { React } from 'extlib';
          export const other = React;
        `,
        "/node_modules/extlib/package.json": JSON.stringify({
          name: "extlib",
          main: "./index.js",
          sideEffects: false,
        }),
        "/node_modules/extlib/index.js": /* js */ `
          export { default as React } from 'react';
          export { B } from './b.js';
        `,
        // Nobody imports B, so b.js must stay deferred.
        "/node_modules/extlib/b.js": /* js */ `
          export const B = <<<SYNTAX_ERROR>>>;
        `,
      },
      outfile: "/out.js",
      plugins(builder) {
        resolved.length = 0;
        builder.onResolve({ filter: /^react$/ }, args => {
          resolved.push(args.path);
          return { path: args.path, external: true };
        });
      },
      onAfterBundle(api) {
        expect(resolved).toEqual(["react"]);
        api.expectFile("/out.js").toContain('from "react"');
      },
    };
  });

  // Un-deferring a.js resolves only that record. The external record, which
  // also has no source_index, is not dispatched to the plugin again. late.js is
  // loaded only after the react answer, so its request for A arrives after the
  // barrel deferred a.js.
  itBundled("barrel/ExternalReExportNotResolvedAgainOnUnDefer", () => {
    const resolved: string[] = [];
    return {
      files: {
        "/entry.js": /* js */ `
          import { React } from 'latelib';
          import './late.js';
          console.log(React);
        `,
        "/late.js": ``,
        "/node_modules/latelib/package.json": JSON.stringify({
          name: "latelib",
          main: "./index.js",
          sideEffects: false,
        }),
        "/node_modules/latelib/index.js": /* js */ `
          export { default as React } from 'react';
          export { A } from './a.js';
          export { B } from './b.js';
        `,
        "/node_modules/latelib/a.js": /* js */ `
          export const A = "late-lib-a";
        `,
        // Nobody imports B, so b.js must stay deferred.
        "/node_modules/latelib/b.js": /* js */ `
          export const B = <<<SYNTAX_ERROR>>>;
        `,
      },
      outfile: "/out.js",
      plugins(builder) {
        resolved.length = 0;
        const reactResolved = Promise.withResolvers<void>();
        builder.onResolve({ filter: /^react$/ }, args => {
          resolved.push(args.path);
          reactResolved.resolve();
          return { path: args.path, external: true };
        });
        builder.onLoad({ filter: /late\.js$/ }, async () => {
          await reactResolved.promise;
          return { contents: `import { A } from 'latelib'; console.log(A);`, loader: "js" };
        });
      },
      onAfterBundle(api) {
        expect(resolved).toEqual(["react"]);
        api.expectFile("/out.js").toContain('from "react"');
        api.expectFile("/out.js").toContain("late-lib-a");
      },
    };
  });

  // When the plugin does not answer, the record falls back to the resolver and
  // the failure is reported. Resolving the barrel again reported it twice.
  itBundled("barrel/UnresolvableReExportReportedOnce", {
    files: {
      "/entry.js": /* js */ `
        import { Missing } from 'missinglib';
        console.log(Missing);
      `,
      "/node_modules/missinglib/package.json": JSON.stringify({
        name: "missinglib",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/missinglib/index.js": /* js */ `
        export { Missing } from 'not-installed-pkg';
        export { B } from './b.js';
      `,
      "/node_modules/missinglib/b.js": /* js */ `
        export const B = "b";
      `,
    },
    outfile: "/out.js",
    plugins(builder) {
      builder.onResolve({ filter: /^not-installed-pkg$/ }, () => undefined);
    },
    bundleErrors: {
      "/node_modules/missinglib/index.js": ['Could not resolve: "not-installed-pkg"'],
    },
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
      builder.onLoad({ filter: /loadlib[\/\\]a\.js$/ }, () => {
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

  // Regression: barrel-optimized-away imports were being recorded in ESM bytecode
  // ModuleInfo (postProcessJSChunk section 2 scanned original AST, saw the s_import
  // with invalid source_index, and recorded the relative specifier as external).
  // At runtime the compiled binary would crash with "Cannot find module './sub/Unused.js'".
  itBundled("barrel/ESMBytecodeCompileSkipsDeferredImports", {
    files: {
      "/entry.js": /* js */ `
        import { used } from 'barrellib';
        console.log(used());
      `,
      "/node_modules/barrellib/package.json": JSON.stringify({
        name: "barrellib",
        type: "module",
        sideEffects: false,
        main: "./index.js",
      }),
      "/node_modules/barrellib/index.js": /* js */ `
        import Unused from './sub/Unused.js';
        import { used } from './sub/used.js';
        export { Unused, used };
      `,
      "/node_modules/barrellib/sub/Unused.js": /* js */ `
        export default class Unused {}
      `,
      "/node_modules/barrellib/sub/used.js": /* js */ `
        export function used() { return 'ok'; }
      `,
    },
    target: "bun",
    format: "esm",
    bytecode: true,
    compile: true,
    run: { stdout: "ok" },
  });

  // Regression for #36832: a namespace import of a barrel must re-request every
  // re-exported name from the module it comes from, even when that module sits
  // behind a second barrel that was already parsed with only a partial request
  // set. Parse-completion order decides which case you get, so this test
  // biases the order: the file holding "import * as ns" is made large enough
  // that every small barrel file is parsed (and its unused re-exports
  // deferred) long before the namespace request arrives. Without the fix the
  // inner barrel's deferred records are never un-deferred, the module body is
  // silently dropped, and the output references undeclared symbols.
  itBundled("barrel/NamespaceImportUndefersChainedBarrels", {
    files: {
      "/entry.js": /* js */ `
        import { alpha } from 'pkg-a';
        import { use } from './big.js';
        console.log(alpha, use());
      `,
      "/big.js":
        `import * as ns from 'pkg-a';\n` +
        `export function use() { return take(ns); }\n` +
        `function take(obj) { return obj.beta; }\n` +
        Array.from({ length: 5000 }, (_, i) => `export const filler_${i} = ${i};`).join("\n"),
      "/node_modules/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/pkg-a/index.js": /* js */ `
        export { alpha } from './alpha.js';
        export { beta } from 'pkg-b';
      `,
      "/node_modules/pkg-a/alpha.js": /* js */ `
        import { gamma } from 'pkg-b';
        export const alpha = "alpha_" + gamma;
      `,
      "/node_modules/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/pkg-b/index.js": /* js */ `
        export { gamma } from './gamma.js';
        export { beta } from './beta.js';
      `,
      "/node_modules/pkg-b/gamma.js": /* js */ `
        export const gamma = "gamma";
      `,
      "/node_modules/pkg-b/beta.js": /* js */ `
        export const beta = "BETA_VALUE_MARKER";
      `,
    },
    target: "bun",
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      // The body of pkg-b/beta.js must land in the output; when its record
      // stays deferred the module is dropped while ns.beta still references
      // its symbol.
      api.expectFile("/out/entry.js").toContain("BETA_VALUE_MARKER");
    },
    run: { stdout: "alpha_gamma BETA_VALUE_MARKER" },
  });

  // Companion to the test above for the `export *` shape of #36832: the inner
  // barrel parses first (discovered directly by the entry) and defers its
  // unrequested re-exports before the star exporter or the namespace import
  // are known. The namespace request must still reach the `export *` target
  // and un-defer its records.
  itBundled("barrel/NamespaceImportRequestsExportStarTargets", {
    files: {
      "/entry.js": /* js */ `
        import { gamma } from 'pkg-b';
        import { use } from './big.js';
        console.log(gamma, use());
      `,
      "/big.js":
        `import * as ns from 'pkg-a';\n` +
        `export function use() { return take(ns); }\n` +
        `function take(obj) { return obj.beta; }\n` +
        Array.from({ length: 5000 }, (_, i) => `export const filler_${i} = ${i};`).join("\n"),
      "/node_modules/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/pkg-a/index.js": /* js */ `
        export * from 'pkg-b';
      `,
      "/node_modules/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        main: "./index.js",
        sideEffects: false,
      }),
      "/node_modules/pkg-b/index.js": /* js */ `
        export { gamma } from './gamma.js';
        export { beta } from './beta.js';
      `,
      "/node_modules/pkg-b/gamma.js": /* js */ `
        export const gamma = "gamma";
      `,
      "/node_modules/pkg-b/beta.js": /* js */ `
        export const beta = "BETA_STAR_MARKER";
      `,
    },
    target: "bun",
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("BETA_STAR_MARKER");
    },
    run: { stdout: "gamma BETA_STAR_MARKER" },
  });

  // --- Entry points are never barrels ---
  // An entry point's exports are the public interface of the build. Nothing
  // imports an entry point, so a deferred record would never be un-deferred
  // and the output would export bindings that were shaken away.
  // https://github.com/oven-sh/bun/issues/40578

  itBundled("barrel/EntryPointPureReExportSideEffectsFalse", {
    files: {
      "/entry.ts": /* ts */ `export { a } from './a';`,
      "/a.ts": /* ts */ `export const a = 1;`,
      "/package.json": JSON.stringify({ name: "repro", sideEffects: false }),
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("a = 1");
    },
  });

  itBundled("barrel/EntryPointImportThenExportSideEffectsFalse", {
    files: {
      "/entry.ts": /* ts */ `
        import { a } from './a';
        export { a };
      `,
      "/a.ts": /* ts */ `export const a = 1;`,
      "/package.json": JSON.stringify({ name: "repro", sideEffects: false }),
    },
    outdir: "/out",
    onAfterBundle(api) {
      api.expectFile("/out/entry.js").toContain("a = 1");
    },
  });

  // The barrel deferral must produce the same output no matter in which order
  // the parse tasks finish. When a request un-defers a barrel record, every
  // alias the barrel imports through that record has to propagate to the next
  // barrel, the same set Phase 1 seeding propagates for a record that is live
  // when the barrel finishes parsing. Otherwise the inner barrel's records
  // stay deferred in one order and live in another, the symbol binding flips,
  // and minified identifier names differ between builds of an unchanged tree.
  // https://github.com/oven-sh/bun/issues/40657
  test("barrel deferral does not depend on parse completion order", async () => {
    // A large comment slows down the parse of the file that carries it
    // without changing the minified output: comments are excluded from the
    // output and from the identifier char-frequency table, and both trees
    // carry exactly one copy of the same comment.
    const pad = "// " + Buffer.alloc(4_000_000, "x").toString() + "\n";

    const makeFiles = (padConsumer: 1 | 2) => ({
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", sideEffects: false }),
      "node_modules/dep/outer.js": `
        export { other } from './impl-other.js';
        export { used, extraA, extraB, extraC, extraD, extraE } from './inner.js';
      `,
      "node_modules/dep/inner.js": `
        export { used } from './impl-used.js';
        export { extraA, extraB, extraC, extraD, extraE } from './impl-extra.js';
      `,
      "node_modules/dep/impl-used.js": `export function used() { return 'used value'; }`,
      "node_modules/dep/impl-other.js": `export function other() { return 'other value'; }`,
      "node_modules/dep/impl-extra.js": `
        export function extraA() { return 'A' + extraB(); }
        export function extraB() { return 'B' + extraC(); }
        export function extraC() { return 'C' + extraD(); }
        export function extraD() { return 'D' + extraE(); }
        export function extraE() { return 'E'; }
      `,
      "consumer1.js":
        (padConsumer === 1 ? pad : "") +
        `
        import { other } from 'dep/outer.js';
        import { extraA } from 'dep/impl-extra.js';
        export function c1() { return other() + extraA(); }
      `,
      "consumer2.js":
        (padConsumer === 2 ? pad : "") +
        `
        import { used } from 'dep/outer.js';
        export function c2() { return used(); }
      `,
      "entry.js": `
        import { c1 } from './consumer1.js';
        import { c2 } from './consumer2.js';
        console.log(c1(), c2());
      `,
    });

    const build = async (root: string) => {
      const out = await Bun.build({
        entrypoints: [join(root, "entry.js")],
        target: "browser",
        format: "esm",
        minify: true,
      });
      return await out.outputs.find(o => o.kind === "entry-point")!.text();
    };

    // Tree A: consumer2 parses slowly, so the barrels finish before anything
    // requests "used" and outer's record to inner is deferred, then
    // un-deferred late. Tree B: consumer1 parses slowly, so "used" is
    // requested before outer parses and the record is live from the start.
    using dirA = tempDir("barrel-order-a", makeFiles(2));
    using dirB = tempDir("barrel-order-b", makeFiles(1));

    const a = await build(String(dirA));
    const b = await build(String(dirB));
    expect(a).toContain("used value");
    expect(a).toBe(b);
  });
});
