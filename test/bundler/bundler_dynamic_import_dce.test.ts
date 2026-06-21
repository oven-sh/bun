import { describe, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { itBundled } from "./expectBundled";

function readAllOutputs(outdir: string) {
  return readdirSync(outdir)
    .filter(f => f.endsWith(".js"))
    .map(f => readFileSync(path.join(outdir, f), "utf8"))
    .join("\n");
}

// Tree-shaking of `import()` results. esbuild does not implement this
// (evanw/esbuild#3987, #4255); coverage here is ported from rolldown's
// `tree_shaking/dynamic_import_*` and rspack's `statical-dynamic-import*`
// fixtures plus Bun-specific cases.

describe("bundler", () => {
  // ──────────────────────────────────────────────────────────────────────
  // Inline mode (no code-splitting): the importee is hoisted, bindings
  // become E::ImportIdentifier, and unused exports are dropped.
  // ──────────────────────────────────────────────────────────────────────

  itBundled("dynamic_import_dce/AwaitDestructure", {
    files: {
      "/entry.js": /* js */ `
        async function foo() {
          const { c } = await import("./b");
          return c(42);
        }
        console.log(await foo());
      `,
      "/b.js": /* js */ `
        export const c = x => x + 1;
        export const d = 99;
      `,
    },
    dce: true,
    run: { stdout: "43" },
    onAfterBundle(api) {
      // The importee must be hoisted (no wrapper, no Promise stub) and `d`
      // must be tree-shaken.
      api.expectFile("/out.js").not.toContain("__esm");
      api.expectFile("/out.js").not.toContain("init_");
      api.expectFile("/out.js").not.toContain("Promise.resolve");
      api.expectFile("/out.js").not.toContain("99");
    },
  });

  itBundled("dynamic_import_dce/AwaitDestructureAlias", {
    files: {
      "/entry.js": /* js */ `
        const { c: x } = await import("./b");
        console.log(x);
      `,
      "/b.js": /* js */ `
        export const c = "kept";
        export const d = "DROPPED";
      `,
    },
    dce: true,
    run: { stdout: "kept" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/AwaitDot", {
    files: {
      "/entry.js": /* js */ `
        console.log((await import("./b")).c);
      `,
      "/b.js": /* js */ `
        export const c = "kept";
        export const d = "DROPPED";
      `,
    },
    dce: true,
    run: { stdout: "kept" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/AwaitIndex", {
    files: {
      "/entry.js": /* js */ `
        console.log((await import("./b"))["c"]);
      `,
      "/b.js": /* js */ `
        export const c = "kept";
        export const d = "DROPPED";
      `,
    },
    dce: true,
    run: { stdout: "kept" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
    },
  });

  // `let`/`var` destructured bindings are mutable, so inline mode does NOT
  // hoist them to immutable import bindings — the importee stays wrapped and
  // keeps all exports. Split mode still narrows (the destructure runs at
  // runtime against the chunk's namespace).
  itBundled("dynamic_import_dce/LetBinding", {
    files: {
      "/entry.js": /* js */ `
        async function foo() {
          let { c } = await import("./b");
          return c;
        }
        console.log(await foo());
      `,
      "/b.js": /* js */ `
        export const c = "kept";
        export const d = "KEEP_d";
      `,
    },
    run: { stdout: "kept" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("KEEP_d");
    },
  });

  itBundled("dynamic_import_dce/TwoSitesUnion", {
    files: {
      "/entry.js": /* js */ `
        const { c } = await import("./b");
        const { d } = await import("./b");
        console.log(c, d);
      `,
      "/b.js": /* js */ `
        export const c = 1;
        export const d = 2;
        export const e = "DROPPED";
      `,
    },
    dce: true,
    run: { stdout: "1 2" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
    },
  });

  // ── bail-outs: pattern not simple enough → behave exactly as before ──

  itBundled("dynamic_import_dce/BailoutRest", {
    files: {
      "/entry.js": /* js */ `
        const { c, ...rest } = await import("./b");
        console.log(c, rest.d);
      `,
      "/b.js": /* js */ `
        export const c = 1;
        export const d = 99;
      `,
    },
    run: { stdout: "1 99" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("99");
    },
  });

  itBundled("dynamic_import_dce/BailoutDefault", {
    files: {
      "/entry.js": /* js */ `
        const { c = 1, d } = await import("./b");
        console.log(c, d);
      `,
      "/b.js": /* js */ `
        export const c = undefined;
        export const d = 99;
      `,
    },
    run: { stdout: "1 99" },
  });

  itBundled("dynamic_import_dce/BailoutComputed", {
    files: {
      "/entry.js": /* js */ `
        const k = "c";
        const { [k]: c } = await import("./b");
        console.log(c);
      `,
      "/b.js": /* js */ `
        export const c = 1;
        export const d = 99;
      `,
    },
    run: { stdout: "1" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("99");
    },
  });

  // ──────────────────────────────────────────────────────────────────────
  // Split mode (code-splitting on): the `await import()` call is kept
  // verbatim (lazy chunk load) but the chunk's exported set is narrowed
  // to only the names every importer actually consumed.
  // ──────────────────────────────────────────────────────────────────────

  itBundled("dynamic_import_dce/SplittingNarrowedExports", {
    files: {
      "/entry.js": /* js */ `
        async function foo() {
          const { c } = await import("./b");
          return c(42);
        }
        console.log(await foo());
      `,
      "/b.js": /* js */ `
        export const c = x => x + 1;
        export const d = "DROPPED";
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "43" },
    onAfterBundle(api) {
      // The entry chunk must keep the lazy `import()`; the `b` chunk must
      // not export (or even contain) `d`.
      const entry = api.readFile("/out/entry.js");
      expect(entry).toContain("import(");
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/SplittingTwoImportersUnion", {
    files: {
      "/a.js": /* js */ `
        const { c } = await import("./lib");
        console.log("a", c);
      `,
      "/b.js": /* js */ `
        const { d } = await import("./lib");
        console.log("b", d);
      `,
      "/lib.js": /* js */ `
        export const c = 1;
        export const d = 2;
        export const e = "DROPPED";
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a 1" },
      { file: "/out/b.js", stdout: "b 2" },
    ],
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/SplittingEscapeKeepsAll", {
    files: {
      "/entry.js": /* js */ `
        const ns = await import("./b");
        console.log(JSON.stringify(Object.keys(ns).sort()));
      `,
      "/b.js": /* js */ `
        export const c = 1;
        export const d = 2;
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: '["c","d"]' },
  });

  itBundled("dynamic_import_dce/SplittingAwaitDot", {
    files: {
      "/entry.js": /* js */ `
        console.log((await import("./b")).c);
      `,
      "/b.js": /* js */ `
        export const c = "kept";
        export const d = "DROPPED";
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "kept" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/SplittingThenDestructure", {
    files: {
      "/entry.js": /* js */ `
        import("./b").then(({ c }) => console.log(c));
      `,
      "/b.js": /* js */ `
        export const c = "kept";
        export const d = "DROPPED";
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "kept" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // ── ported from rolldown tree_shaking/dynamic_import_* ──

  // rolldown: tree_shaking/dynamic_import_await_destruct
  itBundled("dynamic_import_dce/RolldownAwaitDestructPartial", {
    files: {
      "/entry.js": /* js */ `
        const { foo: x, thing: a } = await import("./lib.js");
        console.log(x);
      `,
      "/lib.js": /* js */ `
        export const foo = "foo";
        export const thing = "thing";
        export const bar = "DROPPED1";
        export const other = "DROPPED2";
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "foo" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).not.toContain("DROPPED1");
      expect(all).not.toContain("DROPPED2");
      // `thing` is destructured but `a` is never read; per-reference
      // filtering drops it from the chunk (the property name still appears
      // in the entry's destructure pattern, so check for the value form).
      expect(all).not.toContain('"thing"');
    },
  });

  // rolldown: tree_shaking/dynamic_import_then_destructur_unused
  itBundled("dynamic_import_dce/RolldownThenDestructurePartial", {
    files: {
      "/entry.js": /* js */ `
        import("./lib.js").then(({ foo: x, thing: a }) => console.log(x));
      `,
      "/lib.js": /* js */ `
        export const foo = "foo";
        export const thing = "thing";
        export const bar = "DROPPED";
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "foo" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // rolldown: tree_shaking/dynamic_import_bailout
  itBundled("dynamic_import_dce/RolldownBailoutNamespaceCaptured", {
    files: {
      "/entry.js": /* js */ `
        import("./lib.js").then(ns => console.log(ns.foo, ns));
      `,
      "/lib.js": /* js */ `
        export const foo = "foo";
        export const bar = "bar";
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).toContain('"foo"');
      expect(all).toContain('"bar"');
    },
  });

  // ── ported from rspack normalCases/chunks/statical-dynamic-import* ──

  // rspack: statical-dynamic-import-members
  itBundled("dynamic_import_dce/RspackSplittingAwaitMember", {
    files: {
      "/entry.js": /* js */ `
        const v = (await import("./b")).a;
        console.log(v);
      `,
      "/b.js": /* js */ `
        export const a = "kept";
        export const b = "DROPPED";
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "kept" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/TargetCjs", {
    files: {
      "/entry.js": /* js */ `
        const { c } = await import("./b.cjs");
        console.log(c);
      `,
      "/b.cjs": /* js */ `
        module.exports = { c: 1, d: 2 };
      `,
    },
    run: { stdout: "1" },
  });

  // ──────────────────────────────────────────────────────────────────────
  // Ported from rolldown / rspack fixtures (via workflow)
  // ──────────────────────────────────────────────────────────────────────

  itBundled("dynamic_import_dce/RolldownAwaitDestruct", {
    files: {
      "/entry.js": /* js */ `
        // destructured await import (with rename) should narrow the dynamic chunk
        // to only the consumed keys, including through 'export *' and named re-exports.
        const { foo: x, thing: a } = await import("./lib.js");
        console.log(x, a);
  
        async function test() {
          const { thing: t, bar: barbarbar } = await import("./lib.js");
          barbarbar;
        }
      `,
      "/lib.js": /* js */ `
        export var foo = "foo";
        export var bar = "bar";
        export * from "./a.js";
        export { thing, stuff } from "./a2.js";
      `,
      "/a.js": /* js */ `
        export const other = "DROPPED_OTHER";
      `,
      "/a2.js": /* js */ `
        export const thing = "thing";
        export const stuff = "DROPPED_STUFF";
      `,
    },
    format: "esm",
    splitting: true,
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "foo thing" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      // 'other' is reachable only via `export * from './a.js'` and is never destructured.
      expect(all).not.toContain("DROPPED_OTHER");
      // 'stuff' is reachable only via `export { thing, stuff } from './a2.js'` and is never destructured.
      expect(all).not.toContain("DROPPED_STUFF");
    },
  });

  itBundled("dynamic_import_dce/RolldownDynamicImportBailout", {
    files: {
      "/entry.js": /* js */ `
        import("./lib.js").then((ns) => {
          console.log(ns.foo, ns.thing, ns.bar, ns.other, ns.stuff);
          return [ns.foo, ns.thing, ns];
        });
      `,
      "/lib.js": /* js */ `
        export var bar = "KEEP_BAR";
        export * from "./a.js";
        export { thing, stuff } from "./a2.js";
      `,
      "/a.js": /* js */ `
        export const other = "KEEP_OTHER";
      `,
      "/a2.js": /* js */ `
        export const thing = "KEEP_THING";
        export const stuff = "KEEP_STUFF";
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "undefined KEEP_THING KEEP_BAR KEEP_OTHER KEEP_STUFF" },
    onAfterBundle(api) {
      // Namespace object `ns` escapes the .then callback (used as a value, not just property access),
      // so the bundler must bail out of dynamic-import export tracking and keep every export.
      const all = readAllOutputs(api.outdir);
      expect(all).toContain("KEEP_BAR");
      expect(all).toContain("KEEP_OTHER");
      expect(all).toContain("KEEP_THING");
      expect(all).toContain("KEEP_STUFF");
    },
  });

  itBundled("dynamic_import_dce/RolldownDynamicImportEval", {
    files: {
      "/entry.js": /* js */ `
        const ns = await import("./lib.js");
        console.log(eval("ns.a"), eval("ns.b"));
        import("./lib2.js").then((res) => {});
      `,
      "/lib.js": `export * from "./a.js";`,
      "/a.js": /* js */ `
        export const a = "KEEP_A";
        export const b = "KEEP_B";
      `,
      "/lib2.js": `export * from "./b.js";`,
      "/b.js": /* js */ `
        export const c = "KEEP_C";
        export const d = "KEEP_D";
      `,
    },
    format: "esm",
    splitting: true,
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "KEEP_A KEEP_B" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      // direct eval() in scope of the awaited namespace must force a bailout: every export of lib.js is kept
      expect(all).toContain("KEEP_A");
      expect(all).toContain("KEEP_B");
      // .then((res) => {}) is in the same eval scope, so it bails too:
      // every export of lib2.js is kept.
      expect(all).toContain("KEEP_C");
      expect(all).toContain("KEEP_D");
    },
  });

  itBundled("dynamic_import_dce/RolldownDynamicImportIssue5340", {
    files: {
      "/entry.js": /* js */ `
          const foo = async () => await import("./dagre.js");
          const ns = await foo();
          console.log(await ns.render());
        `,
      "/dagre.js": /* js */ `
          export const render = async () => "KEEP_render";
        `,
    },
    format: "esm",
    splitting: true,
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "KEEP_render" },
    onAfterBundle(api) {
      // Namespace escapes (returned from arrow), so all importee exports must be kept.
      expect(readAllOutputs(api.outdir)).toContain("KEEP_render");
    },
  });

  itBundled("dynamic_import_dce/RolldownDynamicImportThenDestructur", {
    files: {
      "/entry.js": /* js */ `
          import("./lib.js").then(({ foo: x, thing: a }) => {
            console.log(x, a);
          });
        `,
      "/lib.js": /* js */ `
          export var foo = "foo";
          export var bar = "DROPPED";
        `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "foo undefined" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/RolldownIssue4646", {
    files: {
      "/entry.js": /* js */ `
        // destructured: only 'a' is consumed -> d1.b should be tree-shaken
        export const { a } = await import("./d1.js");
        // namespace captured as default export -> bail, keep all of d2
        export default await import("./d2.js");
        // namespace captured as const -> bail, keep all of d3
        export const d3 = await import("./d3.js");
        // arrow returns the namespace promise -> bail, keep all of d4
        export const d4 = () => import("./d4.js");
  
        const ns4 = await d4();
        console.log(a, d3.a, d3.b, ns4.a, ns4.b);
      `,
      "/d1.js": /* js */ `
        export const a = "d1a";
        export const b = "DROPPED_d1b";
      `,
      "/d2.js": /* js */ `
        export const a = "d2a";
        export const b = "KEEP_d2b";
      `,
      "/d3.js": /* js */ `
        export const a = "d3a";
        export const b = "KEEP_d3b";
      `,
      "/d4.js": /* js */ `
        export const a = "d4a";
        export const b = "KEEP_d4b";
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: {
      file: "/out/entry.js",
      stdout: "d1a d3a KEEP_d3b d4a KEEP_d4b",
    },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      // d1: destructured await import -> unused export 'b' is dropped from the dynamic chunk
      expect(all).not.toContain("DROPPED");
      // d2/d3/d4: namespace escapes -> bail out, all exports retained
      expect(all).toContain("KEEP_d2b");
      expect(all).toContain("KEEP_d3b");
      expect(all).toContain("KEEP_d4b");
    },
  });

  itBundled("dynamic_import_dce/RolldownIssue4682", {
    files: {
      "/entry.js": /* js */ `
        import('./dynamic.js').then(async ({ lazyLoad }) => {
          await lazyLoad();
        });
      `,
      "/dynamic.js": /* js */ `
        import './dynamic-side-effect.js';
        export const lazyLoad = async () => {
          console.log('lazyLoad called');
        };
        export const unused = "DROPPED";
      `,
      "/dynamic-side-effect.js": /* js */ `
        console.log('dynamic side-effect');
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: {
      file: "/out/entry.js",
      stdout: "dynamic side-effect\nlazyLoad called",
    },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      // unused export is tree-shaken from the dynamic chunk because
      // .then(({ lazyLoad }) => ...) tracks only the consumed names
      expect(all).not.toContain("DROPPED");
      // but the side-effect-only static dependency of the dynamic module
      // must still be preserved (rolldown issue #4682)
      expect(all).toContain("dynamic side-effect");
    },
  });

  itBundled("dynamic_import_dce/RolldownUnusedDynamicImportedChunk", {
    files: {
      "/entry.js": /* js */ `
          import "./dep.js";
          console.log("entry");
        `,
      "/dep.js": /* js */ `
          console.log("dep");
          export async function loadTS() {
            try {
              return import("./dynamic.js");
            } catch (e) {
              throw e;
            }
          }
        `,
      "/dynamic.js": /* js */ `
          console.log("DROPPED");
        `,
    },
    run: { stdout: "dep\nentry" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
      api.expectFile("/out.js").not.toContain("loadTS");
    },
  });

  itBundled("dynamic_import_dce/RolldownIssue2859ThenSpreadNamespace", {
    files: {
      "/entry.js": /* js */ `
        import("./lib.js").then(exports => {
          const all = { ...exports };
          console.log(all.foo, all.bar, all.default);
        });
      `,
      "/lib.js": /* js */ `
        export const foo = "KEPT_FOO";
        export let bar = "";
        bar = "KEPT_BAR";
        export default "KEPT_DEFAULT";
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "KEPT_FOO KEPT_BAR KEPT_DEFAULT" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).toContain("KEPT_FOO");
      expect(all).toContain("KEPT_BAR");
      expect(all).toContain("KEPT_DEFAULT");
    },
  });

  itBundled("dynamic_import_dce/RolldownIssue2859SelfImportSpreadBail", {
    files: {
      "/entry.js": /* js */ `
        export const foo = 'foo';
        export let bar = '';
        bar = 'bar';
        export default 'default';
  
        import('./entry.js').then((exports) => {
          const all = { ...exports };
          console.log(all.foo, all.bar, all.default);
        });
      `,
    },
    format: "esm",
    run: { stdout: "foo bar default" },
  });

  itBundled("dynamic_import_dce/RolldownInlineDynamicImportsThenNarrow", {
    files: {
      "/entry.js": /* js */ `
        import('./lib.js').then((res) => {
          console.log(res.a);
          return res.a;
        });
      `,
      "/lib.js": /* js */ `
        export * from './module.js';
      `,
      "/module.js": /* js */ `
        export const a = 'KEPT_A';
        export const b = 'DROPPED_B';
      `,
    },
    run: { stdout: "KEPT_A" },
    onAfterBundle(api) {
      // .then((res) => res.a) tracks `res.a` as the only used export and
      // hoists it; the unused re-export `b` is tree-shaken.
      api.expectFile("/out.js").toContain("KEPT_A");
      api.expectFile("/out.js").not.toContain("DROPPED_B");
    },
  });

  itBundled("dynamic_import_dce/RolldownAwaitImportDestructuring", {
    files: {
      "/entry.js": /* js */ `
        const { foo } = await import("./lib.js");
        const { bar } = await import("./lib.js");
        console.log(foo, bar);
      `,
      "/lib.js": /* js */ `
        export const foo = 100;
        export const bar = 200;
        export const unused = "DROPPED";
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "100 200" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/RolldownAwaitImportMemberAccess", {
    files: {
      "/entry.js": /* js */ `
        const a = (await import("./lib.js")).foo;
        const b = (await import("./lib.js")).bar;
        console.log(a, b);
      `,
      "/lib.js": /* js */ `
        export const foo = 100;
        export const bar = 200;
        export const unused = "DROPPED";
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "100 200" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/RolldownThenWithDestructuring", {
    files: {
      "/entry.js": /* js */ `
          const a = await import("./lib.js").then(({ foo }) => foo);
          const b = await import("./lib.js").then(({ bar }) => bar);
          console.log(a, b);
        `,
      "/lib.js": /* js */ `
          export const foo = 100;
          export const bar = 200;
          export const unused = "DROPPED";
        `,
    },
    format: "esm",
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
    run: { file: "/out/entry.js", stdout: "100 200" },
  });

  itBundled("dynamic_import_dce/RspackStaticalDynamicImportDestructuring", {
    // Ported from rspack normalCases/chunks/statical-dynamic-import-destructuring.
    // Only the flat-destructuring case is ported; the original fixture also asserts
    // nested destructuring (`const { a: { aaa } } = await import(...)`) and
    // intermediate-variable destructuring (`const m = await import(...); const { x } = m;`),
    // both of which are bail-outs in Bun's current implementation.
    files: {
      "/entry.js": /* js */ `
        const { default: def, used } = await import("./lib.js");
        console.log(def, used);
      `,
      "/lib.js": /* js */ `
        export default 3;
        export const used = "KEPT";
        export const unused = "DROPPED";
      `,
    },
    format: "esm",
    splitting: true,
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "3 KEPT" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/RspackStaticalDynamicImportMembers", {
    files: {
      "/entry.js": /* js */ `
        const a = (await import("./lib.js")).a;
        const c = (await import("./lib.js")).c;
        const fromTla = (await import("./tla.js")).val;
        console.log(a, c, fromTla);
      `,
      "/lib.js": /* js */ `
        export const a = "KEEP_A";
        export const b = "DROPPED_LIB_B";
        export const c = "KEEP_C";
      `,
      "/tla.js": /* js */ `
        export const val = (await import("./value.js")).x;
        export const other = "DROPPED_TLA_OTHER";
      `,
      "/value.js": /* js */ `
        export const x = "KEEP_X";
        export const y = "DROPPED_VALUE_Y";
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "KEEP_A KEEP_C KEEP_X" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).not.toContain("DROPPED_LIB_B");
      expect(all).not.toContain("DROPPED_TLA_OTHER");
      expect(all).not.toContain("DROPPED_VALUE_Y");
    },
  });

  itBundled("dynamic_import_dce/RspackStaticalDynamicImportThenDestructuring", {
    files: {
      "/entry.js": /* js */ `
        import("./lib.js").then(({ default: def, a }) => {
          console.log(def, a);
        });
      `,
      "/lib.js": /* js */ `
        export const a = "kept-a";
        export const b = "DROPPED-b";
        export const c = "DROPPED-c";
        export default "kept-default";
      `,
    },
    format: "esm",
    splitting: true,
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "kept-default kept-a" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/RspackDynamicImportUnused", {
    files: {
      "/entry.js": /* js */ `
        const { a, b } = await import("./lib");
        console.log(a, b);
      `,
      "/lib.js": /* js */ `
        export const a = "property-a";
        export const b = "property-b";
        export const c = "DROPPED_C";
        export const d = "DROPPED_D";
      `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "property-a property-b" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).not.toContain("DROPPED");
      expect(all).toContain("property-a");
      expect(all).toContain("property-b");
    },
  });

  itBundled("dynamic_import_dce/RspackIssue13287", {
    files: {
      "/entry.js": /* js */ `
        import { data } from "./shared.js";
        const d = data.default;
        console.log(d.name, d.version, Object.keys(d.bin)[0]);
      `,
      "/shared.js": /* js */ `
        export const data = await import("./data.json");
      `,
      "/data.json": JSON.stringify({
        name: "KEEP_NAME_SENTINEL",
        version: "KEEP_VERSION_SENTINEL",
        bin: { cli: "KEEP_BIN_SENTINEL" },
      }),
    },
    format: "esm",
    run: { stdout: "KEEP_NAME_SENTINEL KEEP_VERSION_SENTINEL cli" },
    onAfterBundle(api) {
      // Namespace from `await import()` is captured whole and re-exported (escapes),
      // so tree-shaking must bail and every JSON property must survive in the bundle.
      api.expectFile("/out.js").toContain("KEEP_NAME_SENTINEL");
      api.expectFile("/out.js").toContain("KEEP_VERSION_SENTINEL");
      api.expectFile("/out.js").toContain("KEEP_BIN_SENTINEL");
    },
  });

  // ──────────────────────────────────────────────────────────────────────
  // Ported from rolldown tree_shaking/* and rspack statical-dynamic-import*
  // (second batch). Each test notes where Bun's tracker diverges.
  // ──────────────────────────────────────────────────────────────────────

  // rolldown: tree_shaking/dynamic_import_await
  // Adapted: dropped the unused-namespace binding (`const lib2 = await import()`)
  // and the bare `await import()` statement — both are bails in Bun and would
  // pin every export. The remaining `lib.foo`/`lib.bar`/['baz'] accesses must
  // narrow the chunk; re-exports from a.js/a2.js must be dropped.
  itBundled("dynamic_import_dce/RolldownDynamicImportAwait", {
    files: {
      "/entry.js": /* js */ `
          const lib = await import("./lib.js");
          console.log(lib.foo, lib.bar, (await import("./lib.js"))["baz"]);
        `,
      "/lib.js": /* js */ `
          export var foo = "foo";
          export var bar = "bar";
          export var baz = "baz";
          export * from "./a.js";
          export { thing, stuff } from "./a2.js";
        `,
      "/a.js": /* js */ `
          export const other = "DROPPED_other";
        `,
      "/a2.js": /* js */ `
          export const thing = "DROPPED_thing";
          export const stuff = "DROPPED_stuff";
        `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "foo bar baz" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).not.toContain("DROPPED");
      expect(api.readFile("/out/entry.js")).toContain("import(");
    },
  });

  // rolldown: tree_shaking/dynamic_import_then
  // Adapted: split into two libs so the `({ ...rest })` rest-pattern (a BAIL
  // in Bun — rolldown tracks `rest.other`) doesn't pin the exports the
  // `(ns) => ns.x` arm is supposed to drop.
  itBundled("dynamic_import_dce/RolldownDynamicImportThen", {
    files: {
      "/entry.js": /* js */ `
          const r1 = await import("./lib1.js").then((ns) => [ns.foo, ns.thing]);
          const r2 = await import("./lib2.js").then(({ ...rest }) => rest.other);
          console.log(r1.join(","), r2);
        `,
      "/lib1.js": /* js */ `
          export var foo = "foo";
          export var bar = "DROPPED_bar";
          export { thing, stuff } from "./a2.js";
        `,
      "/a2.js": /* js */ `
          export const thing = "thing";
          export const stuff = "DROPPED_stuff";
        `,
      "/lib2.js": /* js */ `
          export const other = "other";
          export const unused = "DROPPED_lib2";
        `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "foo,thing other" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).not.toContain("DROPPED");
    },
  });

  // rolldown: tree_shaking/dynamic_import_then_destructur_unused
  // `({ foo: x, bar: a }) => use(x)` — `a` is destructured but never read,
  // so `bar` must NOT be pinned (per-reference granularity).
  itBundled("dynamic_import_dce/RolldownThenDestructurUnused", {
    files: {
      "/entry.js": /* js */ `
          const r = await import("./lib.js").then(({ foo: x, bar: a }) => x);
          console.log(r);
        `,
      "/lib.js": /* js */ `
          export var foo = "foo";
          export var bar = "DROPPED";
        `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "foo" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // rolldown: tree_shaking/dynamic_import_then_empty_param
  // `.then(() => …)` tracks zero exports; with a side-effect-free importee
  // every export is dropped from the chunk.
  itBundled("dynamic_import_dce/RolldownDynamicImportThenEmptyParam", {
    files: {
      "/entry.js": /* js */ `
          await import("./lib.js").then(() => console.log("done"));
        `,
      "/lib.js": /* js */ `
          export var foo = "DROPPED_foo";
          export var bar = "DROPPED_bar";
          export var baz = "DROPPED_baz";
        `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "done" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // rolldown: tree_shaking/side_effect_free_dynamic_importee
  // Adapted: rolldown eliminates all three importees. Bun handles the
  // `.then(({a,b}) => …)` shape (unused locals → lib.js dropped) and the
  // unused `const ns = await import()` (lib3.js dropped). Bare
  // `await import()` is intentionally NOT tracked — `import("x");` is the
  // canonical side-effect-only load, and narrowing it to Partial({}) breaks
  // `sideEffects:false` + `export {a} from` chains (see
  // edgecase/EsmSideEffectsFalseWithSideEffectsExportFromCodeSplitting).
  itBundled("dynamic_import_dce/RolldownSideEffectFreeDynamicImportee", {
    files: {
      "/entry.js": /* js */ `
          await import("./lib.js").then(({ foo: x, thing: t }) => []);
          await import("./lib2.js");
          const ns3 = await import("./lib3.js");
          console.log("ok");
        `,
      "/lib.js": /* js */ `
          export var foo = "DROPPED_foo";
          export var bar = "DROPPED_bar";
        `,
      "/lib2.js": /* js */ `
          export const a = "KEEP_lib2";
        `,
      "/lib3.js": /* js */ `
          export const a = "DROPPED_lib3";
        `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "ok" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).not.toContain("DROPPED");
      expect(all).toContain("KEEP_lib2");
    },
  });

  // rolldown: builtin-plugin/build-import-analysis/then-with-property-access
  // `await import().then(m => m.x)` — same module imported twice with
  // different property reads; chunk must export the union {foo, bar} only.
  itBundled("dynamic_import_dce/RolldownThenWithPropertyAccess", {
    files: {
      "/entry.js": /* js */ `
          const a = await import("./lib.js").then((m) => m.foo);
          const b = await import("./lib.js").then((m) => m.bar);
          console.log(a, b);
        `,
      "/lib.js": /* js */ `
          export const foo = 100;
          export const bar = 200;
          export const unused = "DROPPED";
        `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "100 200" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // rolldown: builtin-plugin/build-import-analysis/then-with-nested-import
  // An `import().then(m => …)` whose body contains another `import().then()`
  // with a shadowing `m` — both must be tracked independently.
  itBundled("dynamic_import_dce/RolldownThenWithNestedImport", {
    files: {
      "/entry.js": /* js */ `
          const a = await import("./lib1.js").then(
            (m) => (console.log(m.foo), import("./lib2.js").then((m) => m.bar)),
          );
          console.log(a);
        `,
      "/lib1.js": /* js */ `
          export const foo = 100;
          export const unused1 = "DROPPED1";
        `,
      "/lib2.js": /* js */ `
          export const bar = 200;
          export const unused2 = "DROPPED2";
        `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "100\n200" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // rspack: normalCases/chunks/statical-dynamic-import
  // Rewritten: rspack asserts via __webpack_exports_info__.usedExports; we
  // assert via output sentinels. Ports the `let m = await import(); m.x`
  // shape and the inner-scope test (an outer `m.b` on a plain object must
  // not pin `b` on the inner namespace). var-redecl and webpackExports
  // magic-comment cases omitted.
  itBundled("dynamic_import_dce/RspackStaticalDynamicImport", {
    files: {
      "/entry.js": /* js */ `
          const m = await import("./a.js");
          console.log(m.default, m.a);
          let outer = { b: "outer" };
          console.log(outer.b);
          await (async () => {
            let outer = await import("./b.js");
            console.log(outer.a);
          })();
        `,
      "/a.js": /* js */ `
          export const a = 1;
          export const unused = "DROPPED_a";
          export default 3;
        `,
      "/b.js": /* js */ `
          export const a = "inner";
          export const b = "DROPPED_b";
        `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "3 1\nouter\ninner" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // rspack: normalCases/chunks/statical-dynamic-import-then
  // Rewritten to sentinel assertions. Ports `.then(m => m.x)` plus the
  // "analyze then arguments" case (a `.then(() => import().then(m2 => …))`
  // chain — outer importee gets zero exports, inner gets {a}).
  // Reassignment-bail and magic-comment cases omitted.
  itBundled("dynamic_import_dce/RspackStaticalDynamicImportThen", {
    files: {
      "/entry.js": /* js */ `
          await import("./a.js").then(m => {
            console.log(m.default, m.a);
          });
          await import("./outer.js").then(() => {
            return import("./inner.js").then(m2 => {
              console.log(m2.a);
            });
          });
        `,
      "/a.js": /* js */ `
          export const a = 1;
          export const unused = "DROPPED_a";
          export default 3;
        `,
      "/outer.js": /* js */ `
          export const x = "DROPPED_outer";
        `,
      "/inner.js": /* js */ `
          export const a = "inner";
          export const b = "DROPPED_inner";
        `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "3 1\ninner" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // rspack: configCases/strict-this-context/statical-dynamic-import-this
  // Bun has no strictThisContextOnImports knob. Port the runtime-correctness
  // half: `m.f()` on a tracked namespace must call `f` with the right value
  // and `f` must survive while siblings are dropped.
  itBundled("dynamic_import_dce/RspackStaticalDynamicImportThis", {
    files: {
      "/entry.js": /* js */ `
          let m = await import("./lib.js");
          console.log(m.f());
          await import("./lib.js").then(m2 => console.log(m2.f()));
        `,
      "/lib.js": /* js */ `
          export function f() { return "called"; }
          export const unused = "DROPPED";
        `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "called\ncalled" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).not.toContain("DROPPED");
      expect(api.readFile("/out/entry.js")).toContain("import(");
    },
  });

  // rspack: configCases/strict-this-context/context-dynamic-import-this
  // Bun does not bundle template-literal `import(\`./dir/${x}\`)` — it is
  // left as a real runtime import. Assert the call is emitted verbatim and
  // resolves against a runtime-provided file.
  itBundled("dynamic_import_dce/RspackContextDynamicImportThis", {
    files: {
      "/entry.js": 'const name = "a";\n' + "const m = await import(`./dir/${name}.js`);\n" + "console.log(m.f());\n",
    },
    runtimeFiles: {
      "/out/dir/a.js": `export function f() { return "runtime"; }`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "runtime" },
    onAfterBundle(api) {
      expect(api.readFile("/out/entry.js")).toContain("import(");
    },
  });

  // rspack: diagnosticsCases/module-parse-failed/webpack-exports-warning
  // Bun ignores the `webpackExports` magic comment entirely. The destructure
  // pulls only `a`, so `b` (named in the comment) and `c` must still be
  // dropped — static analysis wins; no warning is expected.
  itBundled("dynamic_import_dce/RspackWebpackExportsWarning", {
    files: {
      "/entry.js": /* js */ `
          const { a } = await import(/* webpackExports: ["a", "b"] */ "./lib.js");
          console.log(a);
        `,
      "/lib.js": /* js */ `
          export const a = "property-a";
          export const b = "DROPPED_b";
          export const c = "DROPPED_c";
          export const d = "DROPPED_d";
        `,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "property-a" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // ──────────────────────────────────────────────────────────────────────
  // P0 — correctness
  // ──────────────────────────────────────────────────────────────────────

  // `.then(onFulfilled, onRejected)` — a rejection handler signals the import
  // may fail; hoisting would make it dead. Bun bails so the importee stays
  // wrapped and the handler still fires.
  itBundled("dynamic_import_dce/InlineThenRejectHandlerBails", {
    files: {
      "/entry.js": /* js */ `
        import("./b.js").then(({ c }) => console.log(c), err => console.log("caught", err.message));
      `,
      "/b.js": `throw new Error("boom"); export const c = 1;`,
    },
    run: { stdout: "caught boom" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__esm");
    },
  });

  itBundled("dynamic_import_dce/SplittingThenRejectHandlerBails", {
    files: {
      "/entry.js": /* js */ `
        await import("./b.js").then(({ c }) => console.log(c), err => console.log("caught"));
      `,
      "/b.js": `export const c = 1; export const d = "KEEP_d";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).toContain("KEEP_d");
    },
  });

  // `let {c}` is mutable: hoisting it to an immutable import binding would
  // break reassignment. Inline mode bails (importee stays wrapped, all
  // exports kept).
  itBundled("dynamic_import_dce/InlineLetDestructureReassigned", {
    files: {
      "/entry.js": /* js */ `
        async function main() {
          let { c } = await import("./b.js");
          console.log(c);
          c = "reassigned";
          console.log(c);
        }
        await main();
        await main();
      `,
      "/b.js": `export const c = "original"; export const d = "KEEP_d";`,
    },
    run: { stdout: "original\nreassigned\noriginal\nreassigned" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("KEEP_d");
    },
  });

  // `var ns` redeclaration resolves to the same symbol; tracking would
  // clobber the alias map between decls. Bun bails (rspack does the same).
  itBundled("dynamic_import_dce/BailoutVarRedeclare", {
    files: {
      "/entry.js": /* js */ `
        var ns = await import("./a.js");
        console.log(ns.foo);
        var ns = await import("./b.js");
        console.log(ns.bar);
      `,
      "/a.js": `export const foo = "KEEP_FOO"; export const x = 1;`,
      "/b.js": `export const bar = "KEEP_BAR"; export const y = 2;`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "KEEP_FOO\nKEEP_BAR" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).toContain("KEEP_FOO");
      expect(all).toContain("KEEP_BAR");
    },
  });

  // A file that is BOTH statically imported and a tracked `import()` target
  // must keep every export the static side may need.
  itBundled("dynamic_import_dce/SplittingStaticStarPlusDynamicTracked", {
    files: {
      "/a.js": `import * as ns from './lib.js'; console.log(JSON.stringify(Object.keys(ns).filter(k => k !== "default").sort()));`,
      "/b.js": `const { x } = await import('./lib.js'); console.log(x);`,
      "/lib.js": `export const x = 1; export const y = "KEEP_y"; export const z = "KEEP_z";`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: '["x","y","z"]' },
      { file: "/out/b.js", stdout: "1" },
    ],
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).toContain("KEEP_y");
      expect(all).toContain("KEEP_z");
    },
  });

  // `const {missing} = await import()` is valid JS (binds `undefined`). The
  // synthetic import item is marked Generated so the linker warns instead of
  // erroring on a NoMatch.
  itBundled("dynamic_import_dce/InlineDestructureMissingExport", {
    files: {
      "/entry.js": /* js */ `
        const { missing } = await import("./b.js");
        console.log(missing);
      `,
      "/b.js": `export const a = 1;`,
    },
    run: { stdout: "undefined" },
    bundleWarnings: {
      "/entry.js": ['Import "missing" will always be undefined because there is no matching export in "b.js"'],
    },
  });

  // CJS importee: the chunk's `default` is synthesized FROM the filtered
  // alias list, so narrowing to {default} would empty it. Bun keeps all
  // exports for non-ESM importees (rspack does the same).
  itBundled("dynamic_import_dce/SplittingCjsDefault", {
    files: {
      "/entry.js": /* js */ `
        const m = await import("./cjs.cjs");
        console.log(m.default.a, m.default.b);
      `,
      "/cjs.cjs": `exports.a = 1; exports.b = 2;`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1 2" },
  });

  // ──────────────────────────────────────────────────────────────────────
  // P2 — newly-handled patterns
  // ──────────────────────────────────────────────────────────────────────

  // Bare `import("x");` / `await import("x");` as a statement is NOT tracked
  // (intentional divergence from rolldown). `import("x");` is the canonical
  // side-effect-only load; narrowing to Partial({}) drops re-export chains
  // under `sideEffects:false` — see edgecase/EsmSideEffectsFalseWith… (#12758).
  itBundled("dynamic_import_dce/BareStatementKeepsAll", {
    files: {
      "/entry.js": /* js */ `
        import("./a.js");
        await import("./b.js");
        console.log("ok");
      `,
      "/a.js": `export const x = "KEEP_A";`,
      "/b.js": `console.log("b-side"); export const x = "KEEP_B";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "b-side\nok" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).toContain("KEEP_A");
      expect(all).toContain("KEEP_B");
    },
  });

  // `{a = 1}` records the key (rolldown parity) but keeps the destructure
  // intact (the default applies at runtime). Split mode narrows; inline mode
  // bails to the wrapped path.
  itBundled("dynamic_import_dce/SplittingDefaultValue", {
    files: {
      "/entry.js": /* js */ `
        const { c = "fallback", d } = await import("./b.js");
        console.log(c, d);
      `,
      "/b.js": `export const c = undefined; export const d = 99; export const e = "DROPPED";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "fallback 99" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // Empty destructure `{}` / `({}) => …` records Partial({}) → every export
  // dropped (rolldown parity). Side effects of the importee survive.
  itBundled("dynamic_import_dce/SplittingEmptyDestructure", {
    files: {
      "/entry.js": /* js */ `
        const {} = await import("./a.js");
        await import("./b.js").then(({}) => console.log("ok"));
      `,
      "/a.js": `console.log("a-side"); export const a = "DROPPED_a";`,
      "/b.js": `export const b = "DROPPED_b";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "a-side\nok" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // Multi-declarator `const {a} = await import(x), {b} = await import(y)` —
  // each declarator is tracked independently in split mode; inline mode keeps
  // the statement (no hoist) so the importees stay wrapped.
  itBundled("dynamic_import_dce/SplittingMultiDeclarator", {
    files: {
      "/entry.js": /* js */ `
        const { a } = await import("./x.js"), { b } = await import("./y.js");
        console.log(a, b);
      `,
      "/x.js": `export const a = 1; export const c = "DROPPED_x";`,
      "/y.js": `export const b = 2; export const c = "DROPPED_y";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1 2" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // ──────────────────────────────────────────────────────────────────────
  // P3 — bail-out / negative coverage
  // ──────────────────────────────────────────────────────────────────────

  // rolldown bails module-wide on `eval()` anywhere; Bun bails per binding
  // scope. `eval()` in a sibling function cannot observe the namespace, so
  // narrowing is safe.
  itBundled("dynamic_import_dce/SplittingEvalSiblingScope", {
    files: {
      "/entry.js": /* js */ `
        async function a() { const { c } = await import("./lib.js"); console.log(c); }
        function b() { eval("1"); }
        b();
        await a();
      `,
      "/lib.js": `export const c = 1; export const d = "DROPPED";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // Reassigning the namespace local must bail (relies on assign-LHS counting
  // as a use so `use_count_estimate > 0`). rspack tests this explicitly.
  itBundled("dynamic_import_dce/BailoutReassign", {
    files: {
      "/entry.js": /* js */ `
        let m = await import("./lib.js");
        console.log(m.a);
        m = {};
        await import("./lib2.js").then(n => { console.log(n.a); n = {}; });
      `,
      "/lib.js": `export const a = 1; export const b = "KEEP_B";`,
      "/lib2.js": `export const a = 2; export const b = "KEEP_B2";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1\n2" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).toContain("KEEP_B");
      expect(all).toContain("KEEP_B2");
    },
  });

  // `{a, ...rest}` where `rest` is enumerated (not just `rest.x`) must bail
  // — every export survives. rspack hard-bails on rest; Bun tracks but the
  // escaping use of `rest` forces `merge_all`.
  itBundled("dynamic_import_dce/BailoutRestEnumerated", {
    files: {
      "/entry.js": /* js */ `
        const { c, ...rest } = await import("./b.js");
        console.log(c, JSON.stringify(Object.keys(rest).filter(k => k !== "default").sort()));
      `,
      "/b.js": `export const c = 1; export const d = "KEEP_D"; export const e = "KEEP_E";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: '1 ["d","e"]' },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).toContain("KEEP_D");
      expect(all).toContain("KEEP_E");
    },
  });

  // `({a} = await import())` (assignment, not declaration) — Bun does not
  // track this shape; the record bails and all exports survive.
  itBundled("dynamic_import_dce/BailoutAssignmentDestructure", {
    files: {
      "/entry.js": /* js */ `
        let a;
        ({ a } = await import("./b.js"));
        console.log(a);
      `,
      "/b.js": `export const a = 1; export const b = "KEEP_b";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).toContain("KEEP_b");
    },
  });

  // Computed index on a tracked namespace local: `ns[key]` with non-literal
  // `key` must bail (the key is not statically known).
  itBundled("dynamic_import_dce/BailoutComputedIndexOnNs", {
    files: {
      "/entry.js": /* js */ `
        const ns = await import("./b.js");
        const k = "d";
        console.log(ns[k]);
      `,
      "/b.js": `export const c = 1; export const d = "KEEP_d";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "KEEP_d" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).toContain("KEEP_d");
    },
  });

  // `const ns = await import()` with BOTH `ns.a` (decrements use_count) and
  // bare `ns` (increments) — net > 0 → bail.
  itBundled("dynamic_import_dce/BailoutAwaitNsMixedUse", {
    files: {
      "/entry.js": /* js */ `
        const ns = await import("./b.js");
        console.log(ns.c, JSON.stringify(Object.keys(ns).filter(k => k !== "default").sort()));
      `,
      "/b.js": `export const c = 1; export const d = 2;`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: '1 ["c","d"]' },
  });

  // Same importee: one tracked + one escaped → `merge_all` wins (sticky).
  itBundled("dynamic_import_dce/SplittingTrackedThenEscapedSameTarget", {
    files: {
      "/entry.js": /* js */ `
        const { a } = await import("./lib.js");
        globalThis.ns = await import("./lib.js");
        console.log(a, globalThis.ns.b);
      `,
      "/lib.js": `export const a = "A"; export const b = "KEEP_B";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "A KEEP_B" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).toContain("KEEP_B");
    },
  });

  // Optional chaining `(await import())?.c` / `ns?.c` — gated out by the
  // existing `optional_chain.is_none()` check; bails and keeps all exports.
  itBundled("dynamic_import_dce/BailoutOptionalChain", {
    files: {
      "/entry.js": /* js */ `
        console.log((await import("./b.js"))?.c);
        const ns = await import("./b.js");
        console.log(ns?.d);
      `,
      "/b.js": `export const c = "kept-c"; export const d = "kept-d"; export const e = "KEEP_e";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "kept-c\nkept-d" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).toContain("KEEP_e");
    },
  });

  // Intermediate-variable destructure: `const ns = await import(); const {a} = ns`
  // — the second destructure consumes `ns` whole → bail.
  itBundled("dynamic_import_dce/BailoutIntermediateDestructure", {
    files: {
      "/entry.js": /* js */ `
        const ns = await import("./b.js");
        const { a } = ns;
        console.log(a, ns.b);
      `,
      "/b.js": `export const a = 1; export const b = "KEEP_b"; export const c = "KEEP_c";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1 KEEP_b" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).toContain("KEEP_c");
    },
  });

  // Inline mode: `.then(ns => …)` where `ns` escapes (passed whole). The
  // import-item refs eagerly minted for `ns.foo` get a `namespace_alias`
  // fallback; the importee stays wrapped and exposes every export.
  itBundled("dynamic_import_dce/InlineThenNamespaceEscapes", {
    files: {
      "/entry.js": /* js */ `
        await import("./x.js").then(ns => {
          console.log(ns.a);
          console.log(JSON.stringify(Object.keys(ns).filter(k => k !== "default").sort()));
        });
      `,
      "/x.js": `export const a = 1; export const b = "KEEP_b";`,
    },
    run: { stdout: '1\n["a","b"]' },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("KEEP_b");
    },
  });

  // ──────────────────────────────────────────────────────────────────────
  // Intentional semantic changes (eager hoist) — inline mode only.
  //
  // Bun's inline mode (no code-splitting) hoists a fully-tracked
  // `await import()` to a static import, matching rollup
  // `inlineDynamicImports`. The importee evaluates eagerly at chunk load,
  // not at the original `await` site. These tests pin that behavior so a
  // future contributor doesn't "fix" it as a bug.
  // ──────────────────────────────────────────────────────────────────────

  // Conditional / never-reached `await import()` still evaluates the importee
  // (its side effects run unconditionally).
  itBundled("dynamic_import_dce/InlineHoistsFromDeadBranch", {
    files: {
      "/entry.js": /* js */ `
        if (globalThis.NEVER) {
          const { c } = await import("./b.js");
          console.log(c);
        }
        console.log("done");
      `,
      "/b.js": `console.log("b-side-effect"); export const c = 1;`,
    },
    format: "esm",
    run: { stdout: "b-side-effect\ndone" },
  });

  // The importee reads mutable state set on a line before the original
  // `await`. After hoisting it sees the pre-assignment value. esbuild/rspack
  // print "set"; Bun's inline hoist prints "UNSET" (rollup parity).
  itBundled("dynamic_import_dce/InlineHoistOrderingHazard", {
    files: {
      "/entry.js": /* js */ `
        globalThis.FLAG = "set";
        const { v } = await import("./b.js");
        console.log(v);
      `,
      "/b.js": `export const v = globalThis.FLAG ?? "UNSET";`,
    },
    format: "esm",
    run: { stdout: "UNSET" },
  });

  // `try { const {a} = await import("./throws") } catch {}` — the throw is
  // hoisted to chunk-load time and is NOT caught (rollup
  // `inlineDynamicImports` parity). Use a `with`-style runtime guard so the
  // bundle still runs.
  itBundled("dynamic_import_dce/InlineTryCatchHoisted", {
    files: {
      "/entry.js": /* js */ `
        try {
          const { c } = await import("./b.js");
          console.log(c);
        } catch (e) {
          console.log("caught");
        }
      `,
      "/b.js": `if (globalThis.BOOM) throw new Error("x"); export const c = 1;`,
    },
    format: "esm",
    run: { stdout: "1" },
    onAfterBundle(api) {
      // b.js is hoisted (no ESM wrapper) — the `throw` lives at chunk top.
      api.expectFile("/out.js").not.toContain("__esm");
    },
  });

  // The `await` checkpoint is removed for the destructure / dot shapes
  // (rollup keeps it). Microtask ordering changes but the program still runs
  // to completion with the correct values.
  itBundled("dynamic_import_dce/InlineAwaitCheckpointDropped", {
    files: {
      "/entry.js": /* js */ `
        const order = [];
        async function f() { order.push(1); const { c } = await import("./b.js"); order.push(c); }
        const p = f(); order.push(3); await p;
        console.log(order.join(","));
      `,
      "/b.js": `export const c = 2;`,
    },
    format: "esm",
    run: { stdout: "1,2,3" },
  });

  // Importee with TLA: hoisting makes the entry chunk itself a TLA module.
  // For `format: "esm"` this is a behavior change (entry blocks on the
  // importee) but the output runs correctly.
  itBundled("dynamic_import_dce/InlineImporteeHasTLA", {
    files: {
      "/entry.js": /* js */ `
        export async function load() { const { v } = await import("./tla.js"); return v; }
        console.log(await load());
      `,
      "/tla.js": `export const v = await Promise.resolve(42);`,
    },
    format: "esm",
    run: { stdout: "42" },
  });
});
