import { describe, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { itBundled, type BundlerTestInput } from "./expectBundled";

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
  // No code-splitting: the `import()` stays a lazy `init_x()` of the
  // ESM-wrapped importee, but its `exports_x` object is narrowed to the
  // names importers observe, so unused exports (and what only they pull in)
  // tree-shake. Evaluation order is exactly as written.
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
      // `d` tree-shaken, and no namespace object: `c` is bound to the export.
      api.expectFile("/out.js").toContain("return c(42)");
      api.expectFile("/out.js").not.toContain("exports_b");
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

  // `let`/`var` destructuring reads the namespace once like `const`, so it
  // narrows the same way.
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
        export const d = "DROPPED";
      `,
    },
    run: { stdout: "kept" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
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

  itBundled("dynamic_import_dce/SplittingPromiseAllDestructure", {
    files: {
      "/entry.js": /* js */ `
        const [{ a }, , b, { c: c2 = 5 }, x] = await Promise.all([
          import("./a.js"),
          import("./side.js"),
          import("./b.js"),
          import("./c.js"),
          Promise.resolve("x"),
          import("./unused.js"),
        ]);
        console.log(a, b.b1, b.b2, c2, x);
      `,
      "/a.js": `export const a = "a"; export const aDropped = "DROPPED_A";`,
      "/side.js": `globalThis.sideRan = true; export const s = "DROPPED_S";`,
      "/b.js": `export const b1 = "b1"; export const b2 = "b2"; export const b3 = "DROPPED_B";`,
      "/c.js": `export const c = "c"; export const cDropped = "DROPPED_C";`,
      "/unused.js": `export const u = "DROPPED_U";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "a b1 b2 c x" },
    onAfterBundle(api) {
      expect(api.readFile("/out/entry.js")).toContain("Promise.all([");
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/SplittingPromiseAllThenDestructure", {
    files: {
      "/entry.js": /* js */ `
        Promise.all([import("./a.js"), import("./b.js")]).then(([{ a }, b]) => console.log(a, b.b1));
      `,
      "/a.js": `export const a = "a"; export const aDropped = "DROPPED_A";`,
      "/b.js": `export const b1 = "b1"; export const b3 = "DROPPED_B";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "a b1" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/SplittingPromiseAllEscapeKeepsAll", {
    files: {
      "/entry.js": /* js */ `
        const [a, ...rest] = await Promise.all([import("./a.js"), import("./b.js")]);
        const all = await Promise.all([import("./c.js")]);
        const Promise2 = { all: (x) => globalThis.Promise.all(x) };
        { const Promise = Promise2; const [{ d }] = await Promise.all([import("./d.js")]); globalThis.dd = d; }
        console.log(JSON.stringify([Object.keys(a), Object.keys(rest[0]), Object.keys(all[0]), globalThis.dd]));
      `,
      "/a.js": `export const a1 = 1; export const a2 = 2;`,
      "/b.js": `export const b1 = 1; export const b2 = 2;`,
      "/c.js": `export const c1 = 1; export const c2 = 2;`,
      "/d.js": `export const d = "d"; export const d2 = 2;`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: '[["a1","a2"],["b1","b2"],["c1","c2"],"d"]' },
    onAfterBundle(api) {
      // shadowed `Promise` is not the global: d.js keeps every export
      expect(readAllOutputs(api.outdir)).toContain("d2");
    },
  });

  // `import(x);` / `await import(x);` / `await import(x).catch();` as statements
  // observe no exports: the importee keeps only its side effects.
  for (const splitting of [true, false]) {
    itBundled(`dynamic_import_dce/BareStatementSideEffectsOnly${splitting ? "Splitting" : "NoSplit"}`, {
      files: {
        "/entry.js": /* js */ `
          globalThis.ran = [];
          import("./a.js");
          await import("./b.js");
          await import("./c.js").catch(() => {});
          async function later() { await import("./d.js"); }
          await later();
          console.log(ran.filter(x => x !== "a").join());
        `,
        "/a.js": `ran.push("a"); export const a = "DROPPED_a";`,
        "/b.js": `ran.push("b"); export const b = "DROPPED_b";`,
        "/c.js": `ran.push("c"); export const c = "DROPPED_c";`,
        "/d.js": `ran.push("d"); export const d = "DROPPED_d";`,
      },
      splitting,
      format: "esm",
      outdir: "/out",
      run: { file: "/out/entry.js", stdout: "b,c,d" },
      onAfterBundle(api) {
        expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
      },
    });
  }

  itBundled("dynamic_import_dce/BareRequireStatementSideEffectsOnly", {
    files: {
      "/entry.ts": /* ts */ `
        export function load() { require("./a.ts"); }
        load();
        console.log(globalThis.ranA);
      `,
      "/a.ts": `globalThis.ranA = "a ran"; export const a = "DROPPED_a";`,
    },
    target: "bun",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "a ran" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // `await require(x);` reads `then` off the namespace; `require(x).catch()`
  // is a member access on the namespace, not on a promise.
  itBundled("dynamic_import_dce/AwaitedRequireStatementKeepsThen", {
    files: {
      "/entry.ts": /* ts */ `
        export async function f() { await require("./x.ts"); require("./y.ts").catch(); }
        await f();
        console.log(globalThis.hit, globalThis.caught);
      `,
      "/x.ts": `export function then(r: any) { (globalThis as any).hit = "then"; r(); } export const other = "DROPPED_X";`,
      "/y.ts": `function c() { (globalThis as any).caught = "catch"; } export { c as catch }; export const other = "DROPPED_Y";`,
    },
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "then catch" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // `const mod = COND ? require(x) : null` with `mod?.f()`, `if (mod)`, `mod &&`
  // — the gated-module pattern. With a build-time COND the conditional folds
  // before the declaration is analyzed; a runtime COND binds the local to each
  // branch's namespace.
  for (const [label, cond, defines] of [
    ["BuildTimeTrue", "FEATURE_ON", { FEATURE_ON: "true" }],
    ["Runtime", "globalThis.on !== false", {}],
  ] as const) {
    itBundled(`dynamic_import_dce/GatedRequire${label}`, {
      files: {
        "/entry.ts": /* ts */ `
          const mod = ${cond} ? require("./impl.ts") : null;
          const alt = ${cond} ? require("./a.ts") : require("./b.ts");
          const lazy = ${cond} ? await import("./lazy.ts") : undefined;
          export function run() {
            if (!mod) return "off";
            const T = mod && mod.Tool;
            return [mod?.render(), T.name, typeof mod, mod != null, alt.which, lazy ? lazy.v : 0].join(",");
          }
          console.log(run());
        `,
        "/impl.ts": `export function render() { return "r"; } export const Tool = { name: "t" }; export const unusedImpl = "DROP_IMPL";`,
        "/a.ts": `export const which = "a"; export const unusedA = "DROP_A";`,
        "/b.ts": `export const which = "b"; export const unusedB = "DROP_B";`,
        "/lazy.ts": `export const v = 7; export const unusedLazy = "DROP_LAZY";`,
      },
      define: defines,
      target: "bun",
      splitting: true,
      format: "esm",
      outdir: "/out",
      run: { file: "/out/entry.js", stdout: "r,t,object,true,a,7" },
      onAfterBundle(api) {
        expect(readAllOutputs(api.outdir)).not.toContain("DROP_");
      },
    });
  }

  // Both branches of a conditional namespace receive the local's reads —
  // member access, body destructure, `...rest` — and `x !== undefined` /
  // `null == x` count as tests whichever side the literal is on.
  itBundled("dynamic_import_dce/GatedRequireBothBranchesNarrowAlike", {
    files: {
      "/entry.ts": /* ts */ `
        function pick(useA: boolean) {
          const alt = useA ? require("./a.ts") : require("./b.ts");
          const { which, ...rest } = alt;
          if (alt !== undefined && null != alt) return [alt.tag, which, rest.other].join(",");
          return "none";
        }
        console.log(pick(true), pick(false));
      `,
      "/a.ts": `export const tag = "A", which = "a", other = "ao", dropA = "DROP_A";`,
      "/b.ts": `export const tag = "B", which = "b", other = "bo", dropB = "DROP_B";`,
    },
    target: "bun",
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "A,a,ao B,b,bo" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROP_");
    },
  });

  // `mod || x` / `mod ?? x` can yield the namespace itself: those escape.
  itBundled("dynamic_import_dce/GatedRequireOrEscapes", {
    files: {
      "/entry.ts": /* ts */ `
        const mod = globalThis.on !== false ? require("./impl.ts") : null;
        const m = mod || {};
        const n = (globalThis.on !== false ? require("./impl2.ts") : null) ?? {};
        console.log(JSON.stringify(Object.keys(m).sort()), JSON.stringify(Object.keys(n).sort()));
      `,
      "/impl.ts": `export const a = 1, b = 2;`,
      "/impl2.ts": `export const c = 1, d = 2;`,
    },
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: '["a","b"] ["c","d"]' },
  });

  // The value of a bare statement is discarded, but `return import(x)` and an
  // arrow expression body hand the namespace on: those keep everything.
  itBundled("dynamic_import_dce/ReturnedImportKeepsAll", {
    files: {
      "/entry.js": /* js */ `
        const f = () => import("./a.js");
        async function g() { return await import("./b.js"); }
        const [a, b] = [await f(), await g()];
        console.log(JSON.stringify(Object.keys(a)), JSON.stringify(Object.keys(b)));
      `,
      "/a.js": `export const a1 = 1; export const a2 = 2;`,
      "/b.js": `export const b1 = 1; export const b2 = 2;`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: '["a1","a2"] ["b1","b2"]' },
  });

  // The minifier inlines a single-use `const ns = await import(x)` into its
  // use; that use is what makes the namespace escape.
  for (const shape of ["return q", "throw q", "globalThis.z = q", "return [q]", "return { ...q }"]) {
    itBundled(`dynamic_import_dce/MinifyInlinedNamespaceLocalEscapes ${shape}`, {
      files: {
        "/entry.js": /* js */ `
          async function f() { const q = await import("./x.js"); ${shape}; }
          async function g() { let r = require("./x.js"); return r; }
          let v;
          try { v = await f(); } catch (e) { v = e; }
          v = globalThis.z ?? v;
          if (Array.isArray(v)) v = v[0];
          console.log(JSON.stringify(Object.keys(v).sort()), JSON.stringify(Object.keys(await g()).sort()));
        `,
        "/x.js": `export const a = "A"; export const b = "B";`,
      },
      minifySyntax: true,
      splitting: true,
      target: "bun",
      format: "esm",
      outdir: "/out",
      run: { file: "/out/entry.js", stdout: '["a","b"] ["a","b"]' },
    });
  }

  // A tracked access must not hide a use from the minifier: with one tracked
  // read and one escaping use, single-use substitution must not inline the
  // declaration away from under the second use.
  for (const minify of [false, true]) {
    itBundled(`dynamic_import_dce/TrackedAccessThenEscape${minify ? "Minify" : ""}`, {
      files: {
        "/entry.ts": /* ts */ `
          export function f() {
            const mod = require("./c.ts");
            const t = mod.T;
            if (t !== "v1") throw new Error("trip " + t);
            return mod;
          }
          export async function g() {
            const ns = await import("./c.ts");
            const t = ns.T;
            if (t !== "v1") throw new Error("trip " + t);
            return ns;
          }
          console.log(JSON.stringify(Object.keys(f()).sort()), JSON.stringify(Object.keys(await g()).sort()));
        `,
        "/c.ts": `export const T = "v1"; export const other = "o";`,
      },
      target: "bun",
      minifySyntax: minify,
      format: "esm",
      outdir: "/out",
      run: { file: "/out/entry.js", stdout: '["T","other"] ["T","other"]' },
    });
  }

  // The minifier substitutes a single-use `const x = cond ? (await import()).a() : b`
  // into its use and re-visits it; the re-visit must not mint a second,
  // untracked record for the same import().
  itBundled("dynamic_import_dce/MinifyRevisitDoesNotDuplicateRecord", {
    files: {
      "/entry.ts": /* ts */ `
        async function main() {
          const warm = process.argv.includes("--warm");
          const pin = !warm && process.env.X ? (await import("./s.ts")).pin() : undefined;
          const label = pin ? "pinned:" + pin : "unpinned";
          return label;
        }
        console.log(await main());
      `,
      "/s.ts": `export function pin() { return "p"; } export function other() { return "DROPPED"; }`,
    },
    minifySyntax: true,
    splitting: true,
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", env: { X: "1" }, stdout: "pinned:p" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // Locals merged by hoisting (duplicate `var`, `var` over a parameter) share
  // one symbol; their exports stay.
  itBundled("dynamic_import_dce/HoistedVarDestructureKeepsBoth", {
    files: {
      "/entry.js": /* js */ `
        async function f(c) {
          if (c) { var { a } = await import("./xa.js"); } else { var { a } = await import("./ya.js"); }
          return a();
        }
        function g(c) {
          if (c) { var { a } = require("./xa.js"); } else { var { a } = require("./ya.js"); }
          return a();
        }
        var { v } = await import("./xa.js"); const v1 = v; var { v } = await import("./ya.js");
        await import("./xa.js").then(({ w }) => { var w; globalThis.W = w; });
        function h() { var m = 1; { var { a, ...m } = require("./xa.js"); } return m.z; }
        console.log(await f(1), await f(0), g(1), g(0), v1, v, W, h());
      `,
      "/xa.js": `export function a() { return "XA"; } export const v = "XV"; export const w = "XW"; export const z = "XZ";`,
      "/ya.js": `export function a() { return "YA"; } export const v = "YV";`,
    },
    splitting: true,
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "XA YA XA YA XV YV XW XZ" },
  });

  // One local re-bound as the rest of two different imports: neither narrows.
  itBundled("dynamic_import_dce/RestLocalReboundKeepsAll", {
    files: {
      "/entry.js": /* js */ `
        var { a, ...r } = await import("./x.js"); const z1 = r.z;
        var { b, ...r } = await import("./y.js");
        console.log(a, b, z1, r.z, JSON.stringify(Object.keys(r).sort()));
      `,
      "/x.js": `export const a = "XA"; export const z = "XZ"; export const q = "XQ";`,
      "/y.js": `export const b = "YB"; export const z = "YZ"; export const q = "YQ";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: 'XA YB XZ YZ ["q","z"]' },
  });

  // `export const { a, ...rest }` — importers of this file observe `rest` whole.
  for (const splitting of [true, false]) {
    itBundled(`dynamic_import_dce/ExportedRestKeepsAll${splitting ? "Splitting" : "NoSplit"}`, {
      files: {
        "/mid.js": `export const { a, ...rest } = await import("./x.js");`,
        "/entry.js": `import { a, rest } from "./mid.js"; console.log(a, JSON.stringify(Object.keys(rest).sort()));`,
        "/x.js": `export const a = "A"; export const b = "B"; export const c = "C";`,
      },
      entryPoints: ["/entry.js"],
      splitting,
      format: "esm",
      outdir: "/out",
      run: { file: "/out/entry.js", stdout: 'A ["b","c"]' },
    });
  }

  // Direct `eval` can read a destructured local by name.
  itBundled("dynamic_import_dce/EvalReadsDestructuredLocal", {
    files: {
      "/entry.js": /* js */ `
        const { a } = await import("./x.js");
        const { b } = require("./x.js");
        console.log(eval("a"), eval("b"));
      `,
      "/x.js": `export const a = "A"; export const b = "B"; export const c = "C";`,
    },
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "A B" },
  });

  // Accepted divergence (rolldown and esbuild's static `import * as ns; ns.f()`
  // behave the same): a method called through the namespace receives the
  // narrowed namespace as `this`.
  itBundled("dynamic_import_dce/MethodCallThisIsNarrowedNamespace", {
    files: {
      "/entry.js": /* js */ `
        console.log((await import("./x.js")).who(), typeof (await import("./x.js")).self().other);
      `,
      "/x.js": `export function who() { return "who"; } export function self() { return this; } export const other = "DROPPED";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "who undefined" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // ── ported from webpack / rspack (cases/chunks/statical-dynamic-import*,
  //    cjs-tree-shaking/*, configCases/tree-shaking/side-effects-free-dynamic-import*) ──

  // webpack configCases/cjs-tree-shaking/side-effect-free-dynamic-import{,-transitive}:
  // an observe-nothing `import()` of a `sideEffects:false` package still
  // evaluates the module exactly once; only exports are dropped, and what the
  // module body itself reads from its own imports stays.
  for (const splitting of [true, false]) {
    itBundled(`dynamic_import_dce/WebpackSideEffectFreeDynamicImportEvaluates${splitting ? "Splitting" : "NoSplit"}`, {
      files: {
        "/entry.js": /* js */ `
          const ns = await import("lib");
          const {} = await import("lib");
          await import("lib").then(m => {});
          await import("lib");
          console.log(globalThis.ran, globalThis.v);
        `,
        "/node_modules/lib/package.json": JSON.stringify({ name: "lib", main: "index.js", sideEffects: false }),
        "/node_modules/lib/index.js": /* js */ `
          import { obj } from "./dep.js";
          globalThis.ran = (globalThis.ran || 0) + 1;
          globalThis.v = obj.value;
          export const a = 1;
          export const b = "DROPPED_B";
        `,
        "/node_modules/lib/dep.js": `export const obj = { value: 42 }; export const other = "DROPPED_OTHER";`,
      },
      splitting,
      format: "esm",
      outdir: "/out",
      run: { file: "/out/entry.js", stdout: "1 42" },
      onAfterBundle(api) {
        expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
      },
    });
  }

  // webpack cases/cjs-tree-shaking/reexport-require-binding (#21135): exporting
  // the namespace local is an escape; exporting a picked member is not.
  itBundled("dynamic_import_dce/WebpackReexportNamespaceBindingEscapes", {
    files: {
      "/mid.js": /* js */ `
        const ns = await import("./lib.js"); console.log(ns.a); export { ns };
        export const ns2 = require("./lib2.ts");
        const r = require("./lib3.ts"); export const picked = r.a;
      `,
      "/entry.js": /* js */ `
        import { ns, ns2, picked } from "./mid.js";
        console.log(JSON.stringify(Object.keys(ns).sort()), JSON.stringify(Object.keys(ns2).sort()), picked);
      `,
      "/lib.js": `export const a = "a", b = "b";`,
      "/lib2.ts": `export const c = "c", d = "d";`,
      "/lib3.ts": `export const a = "A3", dropped = "DROPPED_3";`,
    },
    entryPoints: ["/entry.js"],
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: 'a\n["a","b"] ["c","d"] A3' },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED_3");
    },
  });

  // rspack statical-dynamic-import: a spread in Promise.all's array makes the
  // element positions unknowable.
  itBundled("dynamic_import_dce/RspackPromiseAllSpreadInputKeepsAll", {
    files: {
      "/entry.js": /* js */ `
        const arr = [import("./a.js")];
        const [ns, { foo }] = await Promise.all([...arr, import("./b.js")]);
        console.log(JSON.stringify(Object.keys(ns).sort()), foo, JSON.stringify(Object.keys(await import("./b.js")).sort()));
      `,
      "/a.js": `export const bar = 1, x = 2;`,
      "/b.js": `export const foo = 1, y = "KEEP";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: '["bar","x"] 1 ["foo","y"]' },
  });

  // webpack statical-dynamic-import dir4 / rspack -members: `export * as ns`
  // barrels behind import(). Only the first level is narrowed.
  itBundled("dynamic_import_dce/WebpackExportStarAsBehindImport", {
    files: {
      "/entry.js": /* js */ `
        console.log((await import("./lib.js")).b.f());
        const { b: { bbb } } = await import("./lib.js");
        console.log(bbb);
      `,
      "/lib.js": `export * as a from "./a.js"; export * as b from "./b.js";`,
      "/a.js": `export const aaa = 1, drop_a = "DROP_A";`,
      "/b.js": `export function f() { return 1; } export const bbb = 2, keep_b = "KEEP_B";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1\n2" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).not.toContain("DROP_A");
      expect(all).toContain("KEEP_B");
    },
  });

  // webpack statical-dynamic-import dir2 + require-member-access-trimming: JSON importees.
  itBundled("dynamic_import_dce/WebpackJsonImportee", {
    files: {
      "/entry.js": /* js */ `
        console.log((await import("./data.json")).leaf);
        const { default: d } = await import("./data2.json");
        console.log(d.unused, (await import("./arr.json")).default.includes(2), require("./data3.json").leaf);
      `,
      "/data.json": `{ "leaf": "kept", "unused": "SENTINEL_1" }`,
      "/data2.json": `{ "leaf": "x", "unused": "SENTINEL_2" }`,
      "/data3.json": `{ "leaf": "kept3", "unused": "SENTINEL_3" }`,
      "/arr.json": `[1, 2, 3]`,
    },
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "kept\nSENTINEL_2 true kept3" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).toContain("SENTINEL_2");
    },
  });

  // webpack ImportParserPlugin getNonOptionalPart: an optional link *after* the
  // first member still narrows; only `ns?.a` keeps everything.
  itBundled("dynamic_import_dce/WebpackOptionalAfterFirstMember", {
    files: {
      "/entry.js": /* js */ `
        console.log((await import("./b.js")).a?.x, (await import("./b.js")).f?.());
        const ns = await import("./b.js");
        console.log(ns.g?.());
      `,
      "/b.js": `export const a = { x: 1 }; export const f = () => 2; export const g = undefined; export const z = "DROPPED";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1 2\nundefined" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // webpack statical-dynamic-import "arguments in call member chain" /
  // cjs-tree-shaking/parsing nested-require: tracked calls nested in the
  // argument list of another tracked member call.
  itBundled("dynamic_import_dce/WebpackNestedTrackedCallsInArguments", {
    files: {
      "/entry.js": /* js */ `
        console.log((await import("./l.js")).inc((await import("./l.js")).one));
        console.log(require("./m.ts").fn(require("./m.ts").value));
        const ns = await import("./l.js");
        await ns.wait((async () => { const m2 = await import("./k.js"); console.log(m2.a); })());
      `,
      "/l.js": `export const inc = x => x + 1, one = 1, wait = p => p, dropL = "DROP_L";`,
      "/m.ts": `export const fn = (a: number) => a + 1, value = 41, dropM = "DROP_M";`,
      "/k.js": `export const a = "a", dropK = "DROP_K";`,
    },
    target: "bun",
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "2\n42\na" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROP_");
    },
  });

  // rspack esmOutputCases/dynamic-import/import-self: importer top-level name
  // collides with the narrowed importee's export; same file also statically imported.
  itBundled("dynamic_import_dce/RspackImportSelfNameCollision", {
    files: {
      "/entry.js": /* js */ `
        import "./value.js";
        const conflict = 42;
        const { conflict: c } = await import("./value.js");
        console.log(conflict, c);
      `,
      "/value.js": `export const conflict = 24; export const other = "DROPPED";`,
    },
    format: "esm",
    run: { stdout: "42 24" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
    },
  });

  // webpack cases/chunks/circular-correctness: import() cycles across chunks
  // with narrowed targets and dead-branch bare imports.
  itBundled("dynamic_import_dce/WebpackCircularDynamicImports", {
    files: {
      "/entry.js": `import("./a.js").then(r => r.default()).then(r2 => console.log(r2.default()));`,
      "/a.js": `export default () => import("./c.js"); export const dropA = "DROP_A";`,
      "/b.js": `import "./x.js"; export default () => import("./c.js");`,
      "/c.js": `import x from "./x.js"; export default function () { if (Math.random() < -1) { import("./a.js"); import("./b.js"); } return x; }`,
      "/x.js": `export default "x";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "x" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROP_A");
    },
  });

  // webpack cjs-tree-shaking/require-member-access-deferred (whatwg-url): a
  // use that precedes `const Impl = require()` textually keeps everything.
  itBundled("dynamic_import_dce/WebpackRequireForwardReferenceKeepsAll", {
    files: {
      "/wrapper.ts": /* ts */ `
        export const setup = (o: any, a: any) => { o.impl = new Impl.implementation(a); return o; };
        export class URL { impl: any; constructor(u: string) { return setup(Object.create(URL.prototype), [u]); } }
        const Impl = require("./impl.ts");
      `,
      "/impl.ts": `export class implementation { href: string; constructor(a: string[]) { this.href = a[0]; } } export const unused = "KEEP_SENTINEL";`,
      "/entry.ts": `const { URL } = require("./wrapper.ts"); console.log(new URL("h").impl.href);`,
    },
    entryPoints: ["/entry.ts"],
    target: "bun",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "h" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).toContain("KEEP_SENTINEL");
    },
  });

  // webpack require-member-access: calling the namespace itself observes it whole.
  itBundled("dynamic_import_dce/WebpackCallingNamespaceKeepsAll", {
    files: {
      "/entry.js": /* js */ `
        const m = require("./b.ts"); let r; try { r = m(); } catch { r = "threw"; }
        const n = await import("./b.ts"); try { n(); } catch {}
        console.log(r, JSON.stringify(Object.keys(m).sort()), JSON.stringify(Object.keys(n).sort()));
      `,
      "/b.ts": `export const x = "x", y = "y";`,
    },
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: 'threw ["x","y"] ["x","y"]' },
  });

  // webpack JavascriptParser._preWalkObjectPattern: string-literal keys narrow;
  // a computed key (even a constant one) keeps everything.
  itBundled("dynamic_import_dce/WebpackStringAndComputedKeys", {
    files: {
      "/entry.js": /* js */ `
        const { "a": x, 'b': y } = await import("./l.js");
        const { ["c"]: z } = await import("./l2.js");
        console.log(x, y, z);
      `,
      "/l.js": `export const a = 1, b = 2, dropL = "DROP_L";`,
      "/l2.js": `export const c = 3, keepL2 = "KEEP_L2";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1 2 3" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).not.toContain("DROP_L");
      expect(all).toContain("KEEP_L2");
    },
  });

  // rspack builtinCases/rspack/dynamic-import: a no-substitution template
  // literal specifier is a plain string; a folded concatenation is too.
  itBundled("dynamic_import_dce/RspackTemplateAndConcatSpecifier", {
    files: {
      "/entry.js": /* js */ `
        await import(\`./b.js\`).then(({ b }) => console.log(b));
        await import("./chi" + "ld.js").then(({ a }) => console.log(a));
      `,
      "/b.js": `export const b = "b", dropB = "DROP_B";`,
      "/child.js": `export const a = "a", x = "X_OTHER";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "b\na" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROP_B");
    },
  });

  // webpack cases/cjs-tree-shaking/require-destructuring: the require() twins
  // of default value / alias / body destructure / member mix.
  for (const splitting of [true, false]) {
    itBundled(`dynamic_import_dce/WebpackRequireDestructuringShapes${splitting ? "Splitting" : "NoSplit"}`, {
      files: {
        "/entry.ts": /* ts */ `
          function t() {
            const { a = "fb", b: rb } = require("./m.ts");
            const m = require("./m2.ts");
            const { c } = m;
            const { d } = m;
            return [a, rb, c, d, m.e];
          }
          console.log(JSON.stringify(t()));
        `,
        "/m.ts": `export const a = undefined, b = "b", dropM = "DROP_M";`,
        "/m2.ts": `export const c = 1, d = 2, e = 3, dropM2 = "DROP_M2";`,
      },
      target: "bun",
      splitting,
      format: "esm",
      outdir: "/out",
      run: { file: "/out/entry.js", stdout: '["fb","b",1,2,3]' },
      onAfterBundle(api) {
        expect(readAllOutputs(api.outdir)).not.toContain("DROP_M");
      },
    });
  }

  // webpack ImportParserPlugin getImportAttributes: an options argument does
  // not disable the analysis.
  itBundled("dynamic_import_dce/WebpackImportOptionsArgument", {
    files: {
      "/entry.js": /* js */ `
        const { d } = await import("./d.js", { with: { type: "javascript" } });
        console.log(d);
        await import("./e.js", {}).then(({ e }) => console.log(e));
      `,
      "/d.js": `export const d = "k", dropD = "DROP_D";`,
      "/e.js": `export const e = 1, dropE = "DROP_E";`,
    },
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "k\n1" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROP_");
    },
  });

  // webpack statical-dynamic-import-then-destructuring "deep": nested pattern
  // in the `.then` parameter; rspack: empty nested pattern in Promise.all.
  itBundled("dynamic_import_dce/WebpackNestedPatternInThenAndPromiseAll", {
    files: {
      "/entry.js": /* js */ `
        await import("./l.js").then(({ cfg: { name }, list: [first] }) => console.log(name, first));
        const [{ bar: {}, used }] = await Promise.all([import("./a.js")]);
        console.log(used);
      `,
      "/l.js": `export const cfg = { name: "n" }, list = ["f"], dropped = "DROP_L";`,
      "/a.js": `export const bar = {}, used = 1, dropped = "DROP_A";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "n f\n1" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROP_");
    },
  });

  // webpack cases/cjs-tree-shaking/remove-unused-requires: all of these observe
  // nothing; the module's side effect still runs once.
  itBundled("dynamic_import_dce/WebpackUnusedRequireForms", {
    files: {
      "/entry.ts": /* ts */ `
        const {} = require("./p.ts");
        if ((globalThis as any).c) require("./p.ts");
        (require)("./p.ts");
        console.log((globalThis as any).n);
      `,
      "/p.ts": `export const unused = "DROP_P"; (globalThis as any).n = ((globalThis as any).n || 0) + 1;`,
    },
    target: "bun",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROP_P");
    },
  });

  // rolldown: tree_shaking/dynamic_import_body_destructure — destructuring a
  // namespace local in a later statement narrows the same as `ns.foo`; keys
  // accumulate across statements and merge with member accesses; a
  // re-exported key is kept without a local read.
  for (const splitting of [true, false]) {
    itBundled(`dynamic_import_dce/RolldownBodyDestructure${splitting ? "Splitting" : "NoSplit"}`, {
      files: {
        "/entry.js": /* js */ `
          await import("./then_lib.js").then(ns => {
            const { a } = ns;
            const { b = 1 } = ns;
            const { c, ...rest } = ns;
            console.log(a, b, c, ns.d, rest.e);
          });
          const m = await import("./await_lib.js");
          const { used } = m;
          const { used: used2 } = m;
          export const { reExported } = m;
          console.log(used, used2, m.member);
        `,
        "/then_lib.js": /* js */ `
          export const a = "a";
          export const b = "b";
          export const c = "c";
          export const d = "d";
          export const e = "e";
          export const f = "f-DROPPED";
        `,
        "/await_lib.js": /* js */ `
          export const used = "used";
          export const reExported = "reExported";
          export const member = "member";
          export const unused = "unused-DROPPED";
        `,
        "/consumer.js": `import { reExported } from "./out/entry.js"; console.log(reExported);`,
      },
      splitting,
      format: "esm",
      outdir: "/out",
      run: { file: "/consumer.js", stdout: "a b c d e\nused used member\nreExported" },
      onAfterBundle(api) {
        expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
      },
    });
  }

  // rolldown: tree_shaking/dynamic_import_body_destructure_bailout
  itBundled("dynamic_import_dce/RolldownBodyDestructureBailout", {
    files: {
      "/entry.js": /* js */ `
        const k = globalThis.k ?? "b";
        await import("./computed_lib.js").then(ns => {
          const { [k]: x } = ns;
          console.log(x);
        });
        let m = await import("./reassigned_lib.js");
        console.log(Object.keys(m).length);
        m = { a: 1 };
        const { a } = m;
        console.log(a);
      `,
      "/computed_lib.js": `export const a = "KEEP_a"; export const b = "KEEP_b";`,
      "/reassigned_lib.js": `export const a = "KEEP_ra"; export const b = "KEEP_rb";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "KEEP_b\n2\n1" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      for (const k of ["KEEP_a", "KEEP_b", "KEEP_ra", "KEEP_rb"]) expect(all).toContain(k);
    },
  });

  // Nested pattern: the outer key is observed, inner shape is opaque.
  itBundled("dynamic_import_dce/NestedPatternKeepsOuterKey", {
    files: {
      "/entry.js": /* js */ `
        const { cfg: { name }, other: [first] } = await import("./lib.js");
        console.log(name, first);
      `,
      "/lib.js": `export const cfg = { name: "n" }; export const other = ["f"]; export const dropped = "DROPPED";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "n f" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // `ns["c"]` with a string literal is a static member access.
  itBundled("dynamic_import_dce/ComputedStringMemberNarrows", {
    files: {
      "/entry.js": /* js */ `
        const ns = await import("./lib.js");
        console.log(ns["c"], (await import("./lib2.js"))["x"]);
      `,
      "/lib.js": `export const c = "c"; export const d = "DROPPED1";`,
      "/lib2.js": `export const x = "x"; export const y = "DROPPED2";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "c x" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // A folded `"a" + "b"` key reads `ab`. The parser keeps the folded string
  // as a chain of parts, and the first part alone is "a".
  for (const splitting of [true, false]) {
    itBundled(`dynamic_import_dce/FoldedStringKey${splitting ? "Splitting" : "NoSplit"}`, {
      files: {
        "/entry.js": /* js */ `
          const ns = await import("./lib.js");
          console.log(ns["a" + "b"], ns["a" + "-b"], ns["" + "x"]);
        `,
        "/lib.js": `export const a = "a", ab = "ab", x = "x"; export { x as "a-b" };`,
      },
      splitting,
      format: "esm",
      outdir: "/out",
      run: { file: "/out/entry.js", stdout: "ab x x" },
    });

    // An enum member is folded without minification too.
    itBundled(`dynamic_import_dce/FoldedEnumKeyNarrows${splitting ? "Splitting" : "NoSplit"}`, {
      files: {
        "/entry.ts": /* ts */ `
          enum K { AB = "a" + "b", X = "" + "x" }
          const ns = await import("./lib.js");
          console.log(ns[K.AB], ns[K.X]);
        `,
        "/lib.js": `export const a = "DROPPED", ab = "ab", x = "x";`,
      },
      splitting,
      format: "esm",
      outdir: "/out",
      run: { file: "/out/entry.js", stdout: "ab x" },
      onAfterBundle(api) {
        expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
      },
    });
  }

  // rolldown: chunk_merging/already_loaded_unexported_read_namespace_extraction
  // — a tracked read of a name the importee does not export stays `undefined`
  // and does not disturb the exports that do exist.
  itBundled("dynamic_import_dce/UnexportedReadIsUndefined", {
    files: {
      "/entry.js": /* js */ `
        const app = await import("./app.js").then(m => ({ done: m.done, n: m.n }));
        console.log(await app.done, app.n);
      `,
      "/app.js": /* js */ `
        import { compute } from "./shared.js";
        export const own = "DROPPED";
        export const done = import("./lazy.js").then(m => m.lazyValue);
      `,
      "/lazy.js": `import { compute } from "./shared.js"; export const lazyValue = compute(42);`,
      "/shared.js": `export function compute(x) { return x * 2; }`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "84 undefined" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // rolldown: code_splitting/dynamic_import_and_static_import_one_file — a
  // static `import * as ns` observes every export, so a dynamic import of the
  // same file is not narrowed underneath it.
  itBundled("dynamic_import_dce/StaticStarAndDynamicSameFile", {
    files: {
      "/entry.js": /* js */ `
        import * as fooNs from "./foo.js";
        const { foo } = await import("./foo.js");
        console.log(foo, JSON.stringify(Object.keys(fooNs).sort()));
        import("./foo.js").then(mod => console.log(JSON.stringify(Object.keys(mod).sort())));
      `,
      "/foo.js": `export const foo = 1; export const bar = 2;`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: '1 ["bar","foo"]\n["bar","foo"]' },
  });

  // rolldown: topics/tla/inline_dynamic_import — the same module imported
  // statically (default binding) and dynamically (escaping namespace) without
  // splitting: one instance, static binding sees the initialized value.
  itBundled("dynamic_import_dce/NoSplitStaticAndDynamicSameModule", {
    files: {
      "/entry.js": /* js */ `
        const run = async () => await import("./a.js").then(({ buildDevConfig }) => buildDevConfig());
        console.log(await run());
      `,
      "/a.js": /* js */ `
        import { getEnv } from "./b.js";
        export const buildDevConfig = async () => await getEnv();
        export const unusedA = "DROPPED_A";
      `,
      "/b.js": /* js */ `
        import config from "./c.js";
        const ccc = await import("./c.js");
        export async function getEnv() {
          return config.aaa.bbb[0] + (ccc.default === config);
        }
      `,
      "/c.js": `export default { aaa: { bbb: ["/demo/"] } }; export const unusedC = "DROPPED_C";`,
    },
    format: "esm",
    run: { stdout: "/demo/true" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED_A");
      api.expectFile("/out.js").not.toContain("DROPPED_C");
    },
  });

  // rolldown: chunk_merging/dynamic_import_host_exporting_then — if the chunk
  // serving `import("./target.js")` also carried another module's callable
  // `then` export, awaiting the import would call it instead of yielding the
  // namespace. The dynamic entry's namespace must expose only target.js's
  // exports whatever chunk it lands in.
  itBundled("dynamic_import_dce/HostChunkThenExportNotOnNamespace", {
    files: {
      "/a.js": /* js */ `
        export const targetPromise = import("./target.js");
        const t = await targetPromise;
        console.log("a", t.value, typeof t.then);
      `,
      "/b.js": /* js */ `
        import "./observer.js";
        import { then } from "./then-export.js";
        console.log("b", typeof then);
      `,
      "/observer.js": `globalThis.observed = true;`,
      "/target.js": `import "./then-export.js"; export const value = 1;`,
      "/then-export.js": `export function then(resolve) { resolve("not the namespace"); }`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "a 1 undefined" },
      { file: "/out/b.js", stdout: "b function" },
    ],
  });

  // ──────────────────────────────────────────────────────────────────────
  // Split `require()` (target bun): a `require()` of an ES module is a chunk
  // of its own loaded with `import.meta.require()`, so the same narrowing
  // applies to `const {x} = require()`, `require().x` and `const ns =
  // require(); ns.x`.
  // ──────────────────────────────────────────────────────────────────────

  itBundled("dynamic_import_dce/SplitRequireDestructureNarrows", {
    files: {
      "/entry.ts": /* ts */ `
        export function tool() {
          const { c } = require("./b.ts");
          return c(42);
        }
        console.log(tool());
      `,
      "/b.ts": /* ts */ `
        export const c = (x: number) => x + 1;
        export const d = "DROPPED";
      `,
    },
    splitting: true,
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "43" },
    onAfterBundle(api) {
      expect(api.readFile("/out/entry.js")).toContain("import.meta.require(");
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/SplitRequireDotNarrows", {
    files: {
      "/entry.ts": /* ts */ `
        export function tool() {
          return require("./b.ts").c(42);
        }
        console.log(tool());
      `,
      "/b.ts": /* ts */ `
        export const c = (x: number) => x + 1;
        export const d = "DROPPED";
      `,
    },
    splitting: true,
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "43" },
    onAfterBundle(api) {
      expect(api.readFile("/out/entry.js")).toContain("import.meta.require(");
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/SplitRequireNamespaceLocalNarrows", {
    files: {
      "/entry.ts": /* ts */ `
        export function tool() {
          const ns = require("./b.ts");
          return ns.c(42) + ns.e;
        }
        console.log(tool());
      `,
      "/b.ts": /* ts */ `
        export const c = (x: number) => x + 1;
        export const d = "DROPPED";
        export const e = 1;
      `,
    },
    splitting: true,
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "44" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/SplitRequireEscapeKeepsAll", {
    files: {
      "/entry.ts": /* ts */ `
        export function tool() {
          const ns = require("./b.ts");
          return JSON.stringify(Object.keys(ns).sort());
        }
        console.log(tool());
      `,
      "/b.ts": /* ts */ `
        export const c = 1;
        export const d = 2;
      `,
    },
    splitting: true,
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: '["c","d"]' },
  });

  itBundled("dynamic_import_dce/SplitRequireUntrackedDestructureKeepsAll", {
    files: {
      "/entry.ts": /* ts */ `
        export function tool() {
          const { [String("c")]: c, ...rest } = require("./b.ts");
          return c + JSON.stringify(Object.keys(rest).sort());
        }
        console.log(tool());
      `,
      "/b.ts": /* ts */ `
        export const c = 1;
        export const d = 2;
      `,
    },
    splitting: true,
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: '1["d"]' },
  });

  itBundled("dynamic_import_dce/SplitRequireAndImportUnion", {
    files: {
      "/entry.ts": /* ts */ `
        export function tool() {
          return require("./b.ts").c;
        }
        const { d } = await import("./b.ts");
        console.log(tool(), d);
      `,
      "/b.ts": /* ts */ `
        export const c = 1;
        export const d = 2;
        export const e = "DROPPED";
      `,
    },
    splitting: true,
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1 2" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED");
    },
  });

  // `require()` of an ES module returns its `module.exports` export when it
  // has one; narrowing must keep it.
  itBundled("dynamic_import_dce/SplitRequireKeepsModuleExportsExport", {
    files: {
      "/entry.ts": /* ts */ `
        export function tool() {
          return require("./b.ts").c;
        }
        console.log(tool());
      `,
      "/b.ts": /* ts */ `
        export const c = "WRONG";
        const cjs = { c: "right" };
        export { cjs as "module.exports" };
      `,
    },
    splitting: true,
    target: "bun",
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "right" },
  });

  // Without splitting, `require()` of an ES module returns
  // `__toCommonJS(exports_b)`; the export object is narrowed the same way.
  itBundled("dynamic_import_dce/NoSplitRequireNarrows", {
    files: {
      "/entry.ts": /* ts */ `
        export function tool() {
          const { c } = require("./b.ts");
          return c + require("./b.ts").e;
        }
        console.log(tool());
      `,
      "/b.ts": /* ts */ `
        export const c = 1;
        export const d = "DROPPED";
        export const e = 2;
      `,
    },
    target: "bun",
    run: { stdout: "3" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
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
        // destructured + re-exported -> only "a" of d1
        export const { a } = await import("./d1.js");
        // namespace captured as default export -> bail, keep all of d2
        export default await import("./d2.js");
        // namespace captured as const -> bail, keep all of d3
        export const d3 = await import("./d3.js");
        // arrow returns the namespace promise -> bail, keep all of d4
        export const d4 = () => import("./d4.js");
        // arrow returns the .then() promise, not the namespace -> only "a" of d5
        export const d5 = () => import("./d5.js").then(mod => mod.a);

        const ns4 = await d4();
        console.log(a, d3.a, d3.b, ns4.a, ns4.b, await d5());
      `,
      "/d1.js": /* js */ `
        export const a = "d1a";
        export const b = "DROP_d1b";
      `,
      "/d5.js": /* js */ `
        export const a = "d5a";
        export const b = "DROP_d5b";
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
      stdout: "d1a d3a KEEP_d3b d4a KEEP_d4b d5a",
    },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).not.toContain("DROP_d1b");
      expect(all).not.toContain("DROP_d5b");
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

  // rolldown: tree_shaking/side_effect_free_dynamic_importee — all three
  // importees observe no exports (`.then(({a,b}) => [])` with unused locals,
  // bare `await import()`, unused `const ns = await import()`).
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
          export const a = "DROPPED_lib2";
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

  itBundled("dynamic_import_dce/SplittingThenRejectHandlerNarrows", {
    // The rejection handler never observes the namespace, so the chunk can
    // still narrow to the fulfillment handler's destructure (rolldown parity).
    files: {
      "/entry.js": /* js */ `
        await import("./b.js").then(({ c }) => console.log(c), err => console.log("caught"));
      `,
      "/b.js": `export const c = 1; export const d = "DROP_d";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROP_d");
    },
  });

  // `.catch(h).then(({a})=>…)` — `.then`'s receiver is the `.catch()` ECall,
  // not an EImport, so the tracker never fires and all exports are kept. Pin
  // this so a future "walk through .catch/.finally" refactor can't silently
  // narrow a chunk whose error handler observes the full namespace.
  itBundled("dynamic_import_dce/BailoutCatchThenChain", {
    files: {
      "/entry.js": /* js */ `
        await import("./b.js").catch(e => {}).then(({ c }) => console.log(c));
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

  // `.then(function(m){…})` — `function` bodies can reach the namespace via
  // `arguments[0]` without ever referencing `m`. Tracking must bail (all
  // exports kept) for both split and inline mode.
  itBundled("dynamic_import_dce/SplittingThenFunctionArgumentsBailout", {
    files: {
      "/entry.js": /* js */ `
        await import("./lib.js").then(function (m) { console.log(arguments[0].b); });
      `,
      "/lib.js": `export const a = "A"; export const b = "KEEP_B";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "KEEP_B" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).toContain("KEEP_B");
    },
  });

  itBundled("dynamic_import_dce/InlineThenFunctionArgumentsBailout", {
    files: {
      "/entry.js": /* js */ `
        import("./lib.js").then(function (m) { console.log(arguments[0].b); });
      `,
      "/lib.js": `export const a = "A"; export const b = "KEEP_B";`,
    },
    format: "esm",
    run: { stdout: "KEEP_B" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("KEEP_B");
    },
  });

  // `export const {x} = await import(...)` — `x` is re-exported without any
  // local read (use_count_estimate == 0); the key still counts as observed
  // (rolldown tree_shaking/issue_4646 d1).
  itBundled("dynamic_import_dce/SplittingExportedDestructureKept", {
    files: {
      "/entry.js": `export const { value } = await import("./lib.js");`,
      "/lib.js": `export const value = "KEEP_VALUE"; export const unused = "DROPPED";`,
      "/consumer.js": `import { value } from "./out/entry.js"; console.log(value);`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/consumer.js", stdout: "KEEP_VALUE" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).toContain("KEEP_VALUE");
      expect(all).not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/InlineExportedDestructureKept", {
    files: {
      "/entry.js": `export const { value } = await import("./lib.js");`,
      "/lib.js": `export const value = "KEEP_VALUE"; export const unused = "DROPPED";`,
      "/consumer.js": `import { value } from "./out.js"; console.log(value);`,
    },
    format: "esm",
    run: { file: "/consumer.js", stdout: "KEEP_VALUE" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("KEEP_VALUE");
      api.expectFile("/out.js").not.toContain("DROPPED");
    },
  });

  // `let {c}` where `c` is never read — the destructure still runs against a
  // real (now empty) namespace object, and `c` is dropped from it.
  itBundled("dynamic_import_dce/InlineLetDestructureUnused", {
    files: {
      "/entry.js": /* js */ `
        async function main() { let { c } = await import("./b.js"); console.log("after"); }
        await main();
      `,
      "/b.js": `export const c = "DROPPED";`,
    },
    format: "esm",
    run: { stdout: "after" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("exports_b");
      api.expectFile("/out.js").not.toContain("DROPPED");
    },
  });

  // `let {c}` reassigned later: the local is a plain snapshot, unaffected by
  // narrowing.
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
      "/b.js": `export const c = "original"; export const d = "DROPPED";`,
    },
    run: { stdout: "original\nreassigned\noriginal\nreassigned" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
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

  // Static side only names {A}; dynamic side names {A,B,C}. The shared chunk
  // should export the union and tree-shake D.
  itBundled("dynamic_import_dce/SplittingStaticNamedPlusDynamicTracked", {
    files: {
      "/a.js": `import { A } from './lib.js'; console.log(A);`,
      "/b.js": `const { A, B, C } = await import('./lib.js'); console.log(A, B, C);`,
      "/lib.js": `export const A = 1; export const B = 2; export const C = 3; export const D = "DROP_D";`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "1" },
      { file: "/out/b.js", stdout: "1 2 3" },
    ],
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROP_D");
    },
  });

  // Static side names {D} (so D is needed) disjoint from dynamic {A,B,C}.
  // E is referenced by neither and must drop.
  itBundled("dynamic_import_dce/SplittingStaticNamedDisjointFromDynamic", {
    files: {
      "/a.js": `import { D } from './lib.js'; console.log(D);`,
      "/b.js": `const { A, B, C } = await import('./lib.js'); console.log(A, B, C);`,
      "/lib.js": `export const A = 1; export const B = 2; export const C = 3; export const D = "KEEP_D"; export const E = "DROP_E";`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: [
      { file: "/out/a.js", stdout: "KEEP_D" },
      { file: "/out/b.js", stdout: "1 2 3" },
    ],
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).toContain("KEEP_D");
      expect(all).not.toContain("DROP_E");
    },
  });

  // `export * from` re-exports the whole namespace, so the importee must keep
  // every export even when the only dynamic importer tracked a single alias.
  itBundled("dynamic_import_dce/SplittingExportStarPlusDynamicTracked", {
    files: {
      "/a.js": `export * from './lib.js';`,
      "/b.js": `const { A } = await import('./lib.js'); console.log(A);`,
      "/consumer.js": `import { B } from './out/a.js'; console.log(B);`,
      "/lib.js": `export const A = 1; export const B = "KEEP_B";`,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: [
      { file: "/out/b.js", stdout: "1" },
      { file: "/consumer.js", stdout: "KEEP_B" },
    ],
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).toContain("KEEP_B");
    },
  });

  // `const {missing} = await import()` is valid JS (binds `undefined`); the
  // unknown name simply matches no export.
  itBundled("dynamic_import_dce/InlineDestructureMissingExport", {
    files: {
      "/entry.js": /* js */ `
        const { missing } = await import("./b.js");
        console.log(missing);
      `,
      "/b.js": `export const a = "DROPPED";`,
    },
    run: { stdout: "undefined" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
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
  // — the body destructure is tracked like `ns.a`.
  itBundled("dynamic_import_dce/IntermediateDestructureNarrows", {
    files: {
      "/entry.js": /* js */ `
        const ns = await import("./b.js");
        const { a } = ns;
        console.log(a, ns.b);
      `,
      "/b.js": `export const a = 1; export const b = "KEEP_b"; export const c = "DROPPED_c";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1 KEEP_b" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROPPED_c");
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
  // Semantics preserved without code-splitting: narrowing the importee's
  // export object never moves its evaluation. Each case below would change
  // behavior under rollup-style `inlineDynamicImports` hoisting; the expected
  // output is what the unbundled program prints.
  // ──────────────────────────────────────────────────────────────────────

  // A never-reached `await import()` never evaluates the importee.
  itBundled("dynamic_import_dce/NoSplitDeadBranchStaysLazy", {
    files: {
      "/entry.js": /* js */ `
        if (globalThis.NEVER) {
          const { c } = await import("./b.js");
          console.log(c);
        }
        console.log("done");
      `,
      "/b.js": `console.log("b-side-effect"); export const c = 1; export const d = "DROPPED";`,
    },
    format: "esm",
    run: { stdout: "done" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
    },
  });

  // The importee runs at the `await`, after the preceding statement.
  itBundled("dynamic_import_dce/NoSplitEvaluationOrder", {
    files: {
      "/entry.js": /* js */ `
        globalThis.FLAG = "set";
        const { v } = await import("./b.js");
        console.log(v);
      `,
      "/b.js": `export const v = globalThis.FLAG ?? "UNSET"; export const d = "DROPPED";`,
    },
    format: "esm",
    run: { stdout: "set" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
    },
  });

  // A throwing importee rejects the `import()` inside the `try`.
  itBundled("dynamic_import_dce/NoSplitTryCatchCatches", {
    files: {
      "/entry.js": /* js */ `
        try {
          const { c } = await import("./b.js");
          console.log(c);
        } catch (e) {
          console.log("caught");
        }
      `,
      "/b.js": `if (!globalThis.NO_BOOM) throw new Error("x"); export const c = 1;`,
    },
    format: "esm",
    run: { stdout: "caught" },
  });

  itBundled("dynamic_import_dce/NoSplitTryAwaitThenCatches", {
    files: {
      "/entry.js": /* js */ `
        try {
          await import("./b.js").then(({ c }) => console.log(c));
        } catch (e) {
          console.log("caught", e.message);
        }
      `,
      "/b.js": `throw new Error("boom"); export const c = 1;`,
    },
    format: "esm",
    run: { stdout: "caught boom" },
  });

  // The `await` checkpoint stays.
  itBundled("dynamic_import_dce/NoSplitAwaitCheckpointKept", {
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
    run: { stdout: "1,3,2" },
  });

  // Importee with TLA stays behind the `import()`; the entry is not a TLA
  // module on its account.
  itBundled("dynamic_import_dce/NoSplitImporteeHasTLA", {
    files: {
      "/entry.js": /* js */ `
        export async function load() { const { v } = await import("./tla.js"); return v; }
        console.log(await load());
      `,
      "/tla.js": `export const v = await Promise.resolve(42); export const d = "DROPPED";`,
    },
    format: "esm",
    run: { stdout: "42" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
    },
  });

  itBundled("dynamic_import_dce/NoSplitThenTargetHasTLA", {
    files: {
      "/entry.js": `import("./tla.js").then(({ v }) => console.log(v));`,
      "/tla.js": `export const v = await Promise.resolve(42); export const d = "DROPPED";`,
    },
    format: "esm",
    run: { stdout: "42" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
    },
  });

  // Importee exports `then`. Unbundled, `await import()` resolves through it.
  // That is intentionally not special-cased without splitting: `v` is bound to
  // the export.
  itBundled("dynamic_import_dce/NoSplitThenableImportee", {
    files: {
      "/entry.js": /* js */ `
        const { v } = await import("./b.js");
        console.log(v);
      `,
      "/b.js": `export const v = "direct"; export function then(r) { r({ v: "unwrapped" }); }`,
    },
    format: "esm",
    run: { stdout: "direct" },
  });

  // With splitting the importee is a real ES module, so `then` is called.
  itBundled("dynamic_import_dce/SplittingThenableImportee", {
    files: {
      "/entry.js": /* js */ `
        const { v } = await import("./b.js");
        console.log(v);
      `,
      "/b.js": `export const v = "direct"; export function then(r) { r({ v: "unwrapped" }); }`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "unwrapped" },
  });

  // `const {x}` is a snapshot, not a live binding.
  itBundled("dynamic_import_dce/NoSplitDestructureIsSnapshot", {
    files: {
      "/entry.js": /* js */ `
        const { x, bump } = await import("./b.js");
        bump();
        console.log(x);
      `,
      "/b.js": `export let x = 1; export const bump = () => { x = 2; };`,
    },
    format: "esm",
    run: { stdout: "1" },
  });

  // Reassigning a destructured `.then` param is local.
  itBundled("dynamic_import_dce/NoSplitThenParamReassignIsLocal", {
    files: {
      "/entry.js": /* js */ `
        await import("./m.js").then(({ foo }) => {
          foo = "patched";
          return import("./m.js").then(m2 => console.log(foo, m2.foo));
        });
      `,
      "/m.js": `export let foo = "orig";`,
    },
    format: "esm",
    run: { stdout: "patched orig" },
  });

  // Importee that statically imports the importer: the cycle completes at
  // the `await`, after `value` is initialized.
  itBundled("dynamic_import_dce/NoSplitCycleThroughImporter", {
    files: {
      "/entry.js": /* js */ `
        export const value = "V";
        const { helper } = await import("./b.js");
        console.log(helper);
      `,
      "/b.js": /* js */ `
        import { value } from "./entry.js";
        export const helper = value + "!";
        export const d = "DROPPED";
      `,
    },
    format: "esm",
    run: { stdout: "V!" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
    },
  });

  // `.then(fn).catch(err)` — same explicit-rejection-handler signal as
  // `.then(fn, err)` (InlineThenRejectHandlerBails). The flag is set by the
  // existing then/catch chain walker, so the importee stays wrapped and the
  // throw routes to the handler.
  itBundled("dynamic_import_dce/InlineThenCatchChainBails", {
    files: {
      "/entry.js": /* js */ `
        await import("./b.js").then(({ c }) => console.log(c)).catch(err => console.log("caught", err.message));
      `,
      "/b.js": `throw new Error("boom"); export const c = 1;`,
    },
    run: { stdout: "caught boom" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__esm");
    },
  });

  itBundled("dynamic_import_dce/SplittingThenCatchChainNarrows", {
    files: {
      "/entry.js": /* js */ `
        await import("./b.js").then(({ c }) => console.log(c)).catch(err => console.log("caught"));
      `,
      "/b.js": `export const c = 1; export const d = "DROP_d";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "1" },
    onAfterBundle(api) {
      expect(readAllOutputs(api.outdir)).not.toContain("DROP_d");
    },
  });

  // A hoisted function declaration that closes over `ns` reads it BEFORE the
  // `const ns = await import()` line registers it for tracking, so the use
  // count stays > 0 and the chunk keeps every export. rolldown over-shakes
  // here (narrows to {a} → `f()` returns undefined); pin our correct behavior.
  itBundled("dynamic_import_dce/SplittingHoistedForwardRefKeepsAll", {
    files: {
      "/entry.js": /* js */ `
        function f() { return ns.b; }
        const ns = await import("./b.js");
        console.log(ns.a, f());
      `,
      "/b.js": `export const a = "A"; export const b = "KEEP_B"; export const c = "KEEP_C";`,
    },
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "A KEEP_B" },
    onAfterBundle(api) {
      const all = readAllOutputs(api.outdir);
      expect(all).toContain("KEEP_B");
      expect(all).toContain("KEEP_C");
    },
  });

  // `.then((...ns) => …)` — `ns` binds to `[namespace]`, not the namespace,
  // so `ns.b` is `undefined`. Tracking must bail or `ns.b` would rewrite to
  // the live export.
  itBundled("dynamic_import_dce/InlineThenRestParamBails", {
    files: {
      "/entry.js": /* js */ `
        await import("./b.js").then((...ns) => console.log(ns.b));
      `,
      "/b.js": `export const a = "KEEP_A"; export const b = "KEEP_B";`,
    },
    format: "esm",
    run: { stdout: "undefined" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("KEEP_A");
      api.expectFile("/out.js").toContain("KEEP_B");
    },
  });

  // `(await import(...)).foo = v` — writing to the namespace must not route
  // into the import-item path (which would emit a build-time "Cannot assign
  // to import" error). The namespace stays untracked so all exports are kept.
  itBundled("dynamic_import_dce/InlineAwaitDotAssignBails", {
    files: {
      "/entry.js": /* js */ `
        async function f() {
          (await import("./b.js")).foo = 1;
          console.log("ok");
        }
        await f();
      `,
      "/b.js": `export const foo = 0; export const bar = "KEEP_BAR";`,
    },
    format: "esm",
    run: { stdout: "ok" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("KEEP_BAR");
    },
  });

  // Direct `eval()` in the same scope as `(await import(...)).foo` — the
  // synthetic namespace ref is not a source-visible name, so eval cannot
  // observe it; the rewrite is still safe.
  itBundled("dynamic_import_dce/InlineAwaitDotWithEval", {
    files: {
      "/entry.js": /* js */ `
        async function f() {
          eval("1");
          return (await import("./b.js")).foo;
        }
        console.log(await f());
      `,
      "/b.js": `export const foo = 7; export const bar = 99;`,
    },
    format: "esm",
    run: { stdout: "7" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("99");
    },
  });

  // `const {x, x: y}` — duplicate property keys with distinct binding names
  // are valid JS. The alias map is keyed by property name, so tracking must
  // bail to keep both bindings declared.
  itBundled("dynamic_import_dce/InlineDuplicateDestructureKeyBails", {
    files: {
      "/entry.js": /* js */ `
        const { foo, foo: bar } = await import("./b.js");
        console.log(foo, bar);
      `,
      "/b.js": `export const foo = 3;`,
    },
    format: "esm",
    run: { stdout: "3 3" },
    onAfterBundle(api) {
      // The original destructure must survive so both bindings are declared.
      api.expectFile("/out.js").toMatch(/\{\s*foo:\s*\w+,\s*foo:\s*bar\s*\}/);
    },
  });

  // `const ns = await import(); ns.foo = v` — assigning a namespace property
  // must not turn into a build-time "Cannot assign to import" error. The
  // namespace use stays counted so the record bails to the wrapped path.
  itBundled("dynamic_import_dce/InlineConstNsAssignBails", {
    files: {
      "/entry.js": /* js */ `
        async function f() {
          const ns = await import("./a.js");
          ns.foo = 1;
          console.log(ns.foo, ns.bar);
        }
        await f();
      `,
      "/a.js": `export let foo = 0; export const bar = "KEEP_BAR";`,
    },
    format: "esm",
    run: { stdout: "0 KEEP_BAR" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("KEEP_BAR");
    },
  });

  // A sibling `require()` forces ESM-wrap propagation onto the importee. The
  // surviving `import()` for a tree-shaken record still prints the importee's
  // `exports_ref`, so that symbol must stay imported.
  itBundled("dynamic_import_dce/InlineThenWrappedSiblingExportsRefLive", {
    files: {
      "/entry.js": /* js */ `
        require("./a");
        await import("./b").then(({ x }) => console.log(x));
      `,
      "/a.js": `import "./b"; export const aa = 1;`,
      "/b.js": `export const x = 1; export const y = 2;`,
    },
    format: "esm",
    run: { stdout: "1" },
  });

  // `.then(...).finally(...).catch(err)` — `.finally` must propagate the
  // outer `.catch` through the chain so the importee stays wrapped.
  itBundled("dynamic_import_dce/InlineThenFinallyCatchChainBails", {
    files: {
      "/entry.js": /* js */ `
        await import("./b.js")
          .then(({ c }) => console.log(c))
          .finally(() => console.log("cleanup"))
          .catch(err => console.log("caught", err.message));
      `,
      "/b.js": `throw new Error("boom"); export const c = 1;`,
    },
    run: { stdout: "cleanup\ncaught boom" },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("__esm");
    },
  });

  // The assign-target bail must not catch unwrapped `const m = require()`
  // namespaces — `m.foo = v` on those is a build-time error (esbuild parity).
  itBundled("dynamic_import_dce/UnwrapCjsAssignStillErrors", {
    files: {
      "/entry.js": /* js */ `
        const m = require("react");
        m.foo = 1;
        console.log(m.foo);
      `,
      "/node_modules/react/index.js": `export const foo = 0; export const bar = 2;`,
      "/node_modules/react/package.json": `{"name": "react", "main": "./index.js"}`,
    },
    format: "esm",
    bundleErrors: { "/entry.js": ['Cannot assign to import "foo"'] },
  });

  // ──────────────────────────────────────────────────────────────────────
  // No namespace object. When every use of a narrowed importee names its
  // exports, the `import()` / `require()` evaluates to an object literal of
  // the exports a destructuring pattern reads, or to `{}` for a namespace
  // local whose reads print the exports themselves. `__export`, `exports_x`
  // and the helpers go away. Each case runs as ESM and CJS, minified and not.
  // ──────────────────────────────────────────────────────────────────────

  const minify = { minifySyntax: true, minifyIdentifiers: true, minifyWhitespace: true };
  const elisionVariants = {
    esm: { format: "esm" },
    cjs: { format: "cjs" },
    esmMinify: { format: "esm", ...minify },
    cjsMinify: { format: "cjs", ...minify },
  } as const;

  function itElides(
    name: string,
    opts: {
      files: Record<string, string>;
      stdout: string;
      variants?: (keyof typeof elisionVariants)[];
      /** Some call still needs the namespace object. */
      keepsNamespace?: boolean;
      /** Checks on the unminified `/out.js`. */
      output?: (out: string) => void;
    },
  ) {
    for (const variant of opts.variants ?? (Object.keys(elisionVariants) as (keyof typeof elisionVariants)[])) {
      const options = elisionVariants[variant];
      itBundled(`dynamic_import_dce/Elide${name}_${variant}`, {
        files: opts.files,
        ...options,
        run: { stdout: opts.stdout },
        onAfterBundle(api) {
          const out = api.readFile("/out.js");
          expect(out).not.toContain("DROPPED");
          if (!("minifyIdentifiers" in options)) {
            if (opts.keepsNamespace) {
              expect(out).toContain("__export");
            } else {
              expect(out).not.toContain("__export");
              expect(out).not.toMatch(/exports_\w/);
            }
            opts.output?.(out);
          }
        },
      });
    }
  }

  itBundled("dynamic_import_dce/ElideIsExample", {
    files: {
      "/entry.ts": /* ts */ `
        const { isOdd } = await import("./is");
        console.log(isOdd(3));
      `,
      "/is.ts": /* ts */ `
        export function isNumber(n) { return typeof n === "number"; }
        export function isOdd(n) { return isNumber(n) && n % 2 === 1; }
        export function isEven(n) { return !isOdd(n); }
      `,
    },
    run: { stdout: "true" },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain("await Promise.resolve();");
      expect(out).toContain("console.log(isOdd(3))");
      expect(out).not.toContain("isEven");
      expect(out).not.toContain("__export");
      expect(out).not.toContain("__defProp");
      expect(out).not.toContain("exports_is");
    },
  });

  // The importee's top-level code runs when the `import()` resolves.
  itElides("Order", {
    files: {
      "/entry.js": /* js */ `
        async function main() {
          console.log("before");
          const { x } = await import("./x.js");
          console.log("after", x);
          const loaded = import("./y.js").then(({ y }) => console.log("then", y));
          console.log("sync after import()");
          await loaded;
        }
        main();
      `,
      "/x.js": `console.log("x init"); export const x = 1; export const d = "DROPPED";`,
      "/y.js": `console.log("y init"); export const y = 2; export const d = "DROPPED";`,
    },
    stdout: "before\nx init\nafter 1\nsync after import()\ny init\nthen 2",
    output(out) {
      expect(out).toContain("await Promise.resolve().then(() => init_x());");
      expect(out).toContain("init_y(), {}");
    },
  });

  // A throwing importee rejects the `import()` (caught by the surrounding
  // `try`), and every later `import()` / `require()` throws the same error.
  itElides("InitThrows", {
    files: {
      "/entry.js": /* js */ `
        async function load() {
          try {
            const { z } = await import("./bad.js");
            return z;
          } catch (e) {
            return e;
          }
        }
        function loadSync() {
          try {
            const { z } = require("./bad.js");
            return z;
          } catch (e) {
            return e;
          }
        }
        async function main() {
          const first = await load();
          const second = await load();
          console.log(first instanceof Error, first.message, first === second, loadSync() === first);
          await import("./bad.js").then(
            ns => console.log("resolved", ns.z),
            e => console.log("rejected", e === first),
          );
        }
        main();
      `,
      "/bad.js": /* js */ `
        console.log("bad init");
        throw new Error("boom");
        export const z = 1;
        export const d = "DROPPED";
      `,
    },
    stdout: "bad init\ntrue boom true true\nrejected true",
  });

  // A read through the namespace is live: it prints the binding.
  itElides("LiveRead", {
    files: {
      "/entry.js": /* js */ `
        async function main() {
          const ns = await import("./x.js");
          console.log(ns.b);
          ns.bump();
          console.log(ns.b, ns["b"]);
          const r = require("./x.js");
          r.bump();
          console.log(r.b);
          await import("./x.js").then(m => {
            m.bump();
            console.log(m.b);
          });
        }
        main();
      `,
      "/x.js": /* js */ `
        export let b = 1;
        export function bump() { b++; }
        export const d = "DROPPED";
      `,
    },
    stdout: "1\n2 2\n3\n4",
    output(out) {
      expect(out).toContain("console.log(b, b)");
    },
  });

  // A destructured binding is a snapshot taken when the pattern runs. An
  // export that can change stays a copy, so its call keeps the object.
  itElides("Snapshot", {
    keepsNamespace: true,
    files: {
      "/entry.js": /* js */ `
        async function main() {
          const { b } = await import("./x.js");
          const ns = await import("./x.js");
          ns.bump();
          const { b: b2 } = ns;
          ns.bump();
          const { b: b3 } = require("./x.js");
          ns.bump();
          console.log(b, b2, b3, ns.b);
        }
        main();
      `,
      "/x.js": /* js */ `
        console.log("x init");
        export let b = 1;
        export function bump() { b++; }
        export const d = "DROPPED";
      `,
    },
    stdout: "x init\n1 2 3 4",
    output(out) {
      expect(out).toContain("const { b: b3 } = (init_x(), __toCommonJS(exports_x));");
    },
  });

  // `init_x()` of an importee with top-level await is a promise: the object
  // is built after it settles. (CJS output has no top-level await.)
  itElides("TopLevelAwaitInImportee", {
    variants: ["esm", "esmMinify"],
    files: {
      "/entry.js": /* js */ `
        console.log("before");
        const { u } = await import("./t.js");
        const ns = await import("./t.js");
        console.log("got", u, ns.t);
        await import("./t.js").then(ns => console.log("then", ns.t));
      `,
      "/t.js": /* js */ `
        console.log("t start");
        export let t = "early";
        export const u = "u";
        await 0;
        t = "late";
        console.log("t end");
        export const d = "DROPPED";
      `,
    },
    stdout: "before\nt start\nt end\ngot u late\nthen late",
    output(out) {
      expect(out).toContain("await init_t().then(() => ({}))");
    },
  });

  // The importee statically imports the module that dynamically imports it.
  itElides("Cycle", {
    files: {
      "/entry.js": /* js */ `
        import { run } from "./a.js";
        run();
      `,
      "/a.js": /* js */ `
        export const fromA = "a";
        export async function run() {
          const { fromX, readA } = await import("./x.js");
          const x = await import("./x.js");
          console.log(fromX, readA(), x.readA());
        }
      `,
      "/x.js": /* js */ `
        import { fromA } from "./a.js";
        console.log("x init", fromA);
        export const fromX = "x";
        export function readA() { return fromA; }
        export const d = "DROPPED";
      `,
    },
    stdout: "x init a\nx a a",
  });

  // A default value reads the name off the real object.
  itElides("ThenAndPromiseAll", {
    keepsNamespace: true,
    files: {
      "/entry.js": /* js */ `
        async function main() {
          await import("./x.js").then(({ a, b: renamed = "default" }) => console.log("then", a, renamed));
          await import("./x.js").then(ns => console.log("ns", ns.a));
          await import("./x.js").then(() => console.log("bare"));
          const [{ a }, ns, , { missing = "fallback" }] = await Promise.all([
            import("./x.js"),
            import("./x.js"),
            import("./x.js"),
            import("./x.js"),
          ]);
          console.log(a, ns.a, missing);
        }
        main();
      `,
      "/x.js": `console.log("x init"); export const a = "a"; export const d = "DROPPED";`,
    },
    stdout: "x init\nthen a default\nns a\nbare\na a fallback",
  });

  // `...rest` is a copy of the real object.
  itElides("Rest", {
    keepsNamespace: true,
    files: {
      "/entry.js": /* js */ `
        async function main() {
          const { a, ...rest } = await import("./x.js");
          console.log(a, rest.b, rest.c, rest.a);
        }
        main();
      `,
      "/x.js": `export const a = "a", b = "b"; export let c = "c"; export const d = "DROPPED";`,
    },
    stdout: "a b c undefined",
  });

  // `ns.name` of a name that is not an export reads `undefined`, as it does on
  // a namespace object (which has no prototype). `__proto__` is an export like
  // any other.
  itElides("OddKeys", {
    files: {
      "/entry.js": /* js */ `
        async function main() {
          const ns = await import("./x.js");
          const { a, "with-dash": w, "__proto__": pp } = await import("./x.js");
          console.log(a, w, pp);
          console.log(ns.missing, ns.constructor, ns["with-dash"], ns["__proto__"], typeof ns);
        }
        main();
      `,
      "/x.js": /* js */ `
        const p = "P";
        export { p as "__proto__", p as "with-dash" };
        export const a = "a";
        export const d = "DROPPED";
      `,
    },
    stdout: "a P P\nundefined undefined P P object",
  });

  // A pattern reads a name the importee does not export off the real object.
  itElides("PatternReadsMissingName", {
    keepsNamespace: true,
    files: {
      "/entry.js": /* js */ `
        async function main() {
          const { b, missing } = await import("./x.js");
          console.log(b, missing);
        }
        main();
      `,
      "/x.js": `export const b = 2; export const d = "DROPPED";`,
    },
    stdout: "2 undefined",
  });

  // A wrapped importer turns its top-level declarations into assignments;
  // the pattern's source is still the object literal.
  itElides("WrappedImporter", {
    files: {
      "/entry.js": /* js */ `
        async function main() {
          const { show } = await import("./inner.js");
          show();
        }
        main();
      `,
      "/inner.js": /* js */ `
        const { b } = require("./x.js");
        const ns = require("./x.js");
        const one = ns.a, two = ns.b;
        export function show() { console.log(b, one, two, ns.a); }
      `,
      "/x.js": `console.log("x init"); export const a = "a", b = "b"; export const d = "DROPPED";`,
    },
    stdout: "x init\nb a b a",
  });

  // The minifier's `a = ns.x, b = ns.y` => `{x: a, y: b} = ns` would read `{}`.
  itElides("SameTargetDestructuring", {
    files: {
      "/entry.js": /* js */ `
        const ns = require("./x.js");
        const one = ns.a, two = ns.b;
        console.log(one, two);
      `,
      "/x.js": `console.log("x init"); export const a = "a", b = "b"; export const d = "DROPPED";`,
    },
    stdout: "x init\na b",
  });

  itElides("ReExport", {
    files: {
      "/entry.js": /* js */ `
        async function main() {
          const { a, renamed } = await import("./barrel.js");
          const ns = await import("./barrel.js");
          console.log(a, renamed, ns.star);
        }
        main();
      `,
      "/barrel.js": /* js */ `
        export { a, b as renamed } from "./x.js";
        export * from "./y.js";
        export const d = "DROPPED";
      `,
      "/x.js": `export const a = "a", b = "b"; export const d2 = "DROPPED";`,
      "/y.js": `export const star = "star"; export const d3 = "DROPPED";`,
    },
    stdout: "a b star",
  });

  // `export *` of the importee, from a file imported statically, does not need
  // its namespace object either.
  itElides("ExportStarOfImportee", {
    variants: ["esm", "esmMinify"],
    files: {
      "/entry.js": `import { a as viaBarrel } from "./barrel.js"; const { a } = await import("./x.js"); console.log(a, viaBarrel);`,
      "/barrel.js": `export * from "./x.js";`,
      "/x.js": `export const a = "a"; export const d = "DROPPED";`,
    },
    stdout: "a a",
  });

  // Intentionally not special-cased: unbundled, `await import()` would call a
  // `then` export. Bundled, the import resolves to `{}`.
  itElides("ThenExport", {
    files: {
      "/entry.js": /* js */ `
        async function main() {
          const { a } = await import("./x.js");
          console.log(a);
        }
        main();
      `,
      "/x.js": `export function then(resolve) { resolve({ a: "DROPPED" }); } export const a = "a";`,
    },
    stdout: "a",
  });

  // `import * as z; export { z }` (zod, Effect): a `const` destructured from
  // the call is bound like `import { z }`, so `z.a` reads the export and the
  // rest of the namespace tree-shakes.
  itElides("NamespaceExport", {
    files: {
      "/entry.js": /* js */ `
        async function main() {
          const { z } = await import("./lib.js");
          const { z: fromRequire } = require("./lib.js");
          console.log(z.a(), fromRequire.b, z.b === fromRequire.b);
        }
        main();
      `,
      "/lib.js": `import * as z from "./external.js"; export { z }; export const d = "DROPPED";`,
      "/external.js": /* js */ `
        export function a() { return "a"; }
        export const b = "b";
        export const unused = "DROPPED";
      `,
    },
    stdout: "a b true",
  });

  itElides("NamespaceExportReadsOnly", {
    files: {
      "/entry.js": /* js */ `
        async function main() {
          const { z } = await import("./lib.js");
          console.log(z.a(), z.b);
        }
        main();
      `,
      "/lib.js": `import * as z from "./external.js"; export { z };`,
      "/external.js": `export function a() { return "a"; } export const b = "b"; export const unused = "DROPPED";`,
    },
    stdout: "a b",
    output(out) {
      expect(out).toContain("console.log(a(), b)");
    },
  });

  // A `var` redeclared in another branch is one variable, so it stays a local.
  itElides("VarRedeclaredInBranches", {
    keepsNamespace: true,
    files: {
      "/entry.js": /* js */ `
        async function pick(first) {
          if (first) {
            var { a } = await import("./x.js");
          } else {
            var { a } = await import("./y.js");
          }
          return a;
        }
        pick(true).then(a => pick(false).then(b => console.log(a, b)));
      `,
      "/x.js": `export const a = "x"; export const d = "DROPPED";`,
      "/y.js": `export const a = "y"; export const d = "DROPPED";`,
    },
    stdout: "x y",
  });

  // A read off a split chunk's namespace is not matched: a name it can't see
  // (from `export *` of an external) must not print `undefined`.
  itBundled("dynamic_import_dce/SplitChunkExternalStarRead", {
    files: {
      "/entry.js": /* js */ `
        const mod = await import("./reexports.js");
        const { rfs } = await import("./reexports.js");
        console.log(typeof mod.join, typeof mod.rfs, typeof rfs);
      `,
      "/reexports.js": /* js */ `
        export * from "node:path";
        export { readFileSync as rfs } from "node:fs";
      `,
    },
    target: "bun",
    format: "esm",
    splitting: true,
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "function function function" },
  });

  // A `var` with another declaration is one variable, so it stays a local.
  itElides("VarDeclaredTwice", {
    keepsNamespace: true,
    files: {
      "/entry.js": /* js */ `
        var a = 1;
        var { a } = await import("./x.js");
        for (var b of [3]) {}
        var { b } = await import("./x.js");
        console.log(a, b, (await import("./other.js")).a);
      `,
      "/x.js": `export const a = 2, b = 4;`,
      "/other.js": `import { a } from "./x.js"; export { a };`,
    },
    variants: ["esm", "esmMinify"],
    stdout: "2 4 2",
  });

  // A `{...rest}` copy of the same namespace still needs `a` in the object.
  itElides("RestBesideBoundName", {
    keepsNamespace: true,
    files: {
      "/entry.js": /* js */ `
        async function main() {
          const ns = await import("./x.js");
          const { ...rest } = ns;
          const { a } = ns;
          console.log(rest.a, a);
        }
        main();
      `,
      "/x.js": `export const a = 1; export const d = "DROPPED";`,
    },
    stdout: "1 1",
  });

  itElides("EnumBoundName", {
    files: {
      "/entry.ts": /* ts */ `
        async function main() {
          const { E } = await import("./x.ts");
          console.log(E.A, E.B);
        }
        main();
      `,
      "/x.ts": `export enum E { A = 1, B = 2 } export const d = "DROPPED";`,
    },
    stdout: "1 2",
  });

  // An importer of the file that destructured the name must not bind
  // through it: that would load the split chunk eagerly.
  itBundled("dynamic_import_dce/ReexportedDestructuredNameStaysLazy", {
    files: {
      "/entry.js": `import { a } from "./mid.js"; console.log("entry", a);`,
      "/mid.js": /* js */ `
        console.log("mid start");
        const { a } = await import("./x.js");
        export { a };
      `,
      "/x.js": `console.log("x init"); export const a = 1;`,
    },
    splitting: true,
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "mid start\nx init\nentry 1" },
  });

  // `require()` reads `default` off `module.exports`.
  itBundled("dynamic_import_dce/RequireDefaultOfLiftedCommonJS", {
    files: {
      "/entry.js": /* js */ `
        const { default: d, a } = require("./lib.cjs");
        console.log(d, a);
      `,
      "/lib.cjs": `exports.a = 1;`,
    },
    run: { stdout: "undefined 1" },
  });

  // A wrapped importer hoists its top-level names out of the closure. A bound
  // name is the export's own binding (here a class), so it is not redeclared.
  itElides("WrappedImporterBoundClass", {
    files: {
      "/entry.js": `const { y } = require("./b.js"); console.log(y);`,
      "/b.js": `const { z } = require("./a.js"); export const y = z.v;`,
      "/a.js": `export class z { static v = "zv" } export const d = "DROPPED";`,
    },
    stdout: "zv",
  });

  // No single export to bind to: the name reads `undefined`, with no warning.
  itBundled("dynamic_import_dce/AmbiguousStarExportIsQuiet", {
    files: {
      "/entry.js": `const { q } = await import("./amb.js"); console.log(q);`,
      "/amb.js": `export * from "./x.js"; export * from "./y.js";`,
      "/x.js": `export const q = 1;`,
      "/y.js": `export const q = 2;`,
    },
    run: { stdout: "undefined" },
    bundleWarnings: {},
  });

  // `const p = ns.foo, q = ns.bar` must not become `{foo: p, bar: q} = ns`
  // when `ns` is a bound name: there is no namespace object to read.
  itElides("BoundNamespaceSameTargetReads", {
    files: {
      "/entry.js": /* js */ `
        async function main() {
          const { ns } = await import("./a.js");
          const p = ns.foo, q = ns.bar;
          console.log(p, q);
        }
        main();
      `,
      "/a.js": `import * as ns from "./c.js"; export { ns }; export const d = "DROPPED";`,
      "/c.js": `export const foo = 1, bar = 2;`,
    },
    stdout: "1 2",
  });

  // A `"sideEffects": false` barrel: the names the pattern reads without
  // binding them (a default value, a nested pattern) keep their re-exports.
  itBundled("dynamic_import_dce/BarrelKeepsUnboundNames", {
    files: {
      "/entry.js": /* js */ `
        const { a, b = "default", c: { x } } = await import("barrel");
        console.log(a, b, x);
      `,
      "/node_modules/barrel/package.json": `{ "name": "barrel", "sideEffects": false }`,
      "/node_modules/barrel/index.js": /* js */ `
        export { a } from "./a.js";
        export { b } from "./b.js";
        export { c } from "./c.js";
      `,
      "/node_modules/barrel/a.js": `export const a = "A";`,
      "/node_modules/barrel/b.js": `export const b = "B";`,
      "/node_modules/barrel/c.js": `export const c = { x: "X" };`,
    },
    run: { stdout: "A B X" },
  });

  // Only the re-exports a tracked call reads are loaded from the barrel.
  itBundled("dynamic_import_dce/BarrelLoadsOnlyReadNames", {
    files: {
      "/entry.js": /* js */ `
        const { a } = await import("barrel");
        console.log(a, (await import("barrel")).b);
      `,
      "/node_modules/barrel/package.json": `{ "name": "barrel", "sideEffects": false }`,
      "/node_modules/barrel/index.js": /* js */ `
        export { a } from "./a.js";
        export { b } from "./b.js";
        export { c } from "./c.js";
      `,
      "/node_modules/barrel/a.js": `export const a = "A";`,
      "/node_modules/barrel/b.js": `export const b = "B";`,
      "/node_modules/barrel/c.js": `export const c = "DROPPED";`,
    },
    run: { stdout: "A B" },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("DROPPED");
    },
  });

  // A direct `eval` in the exporting file can assign the export, so the
  // destructured name stays a snapshot.
  itBundled("dynamic_import_dce/EvalAssignedExportStaysSnapshot", {
    files: {
      "/entry.js": /* js */ `
        const { a, set } = await import("./b.js");
        set();
        console.log(a);
      `,
      "/b.js": `export let a = 1; export function set() { eval("a = 2"); }`,
    },
    run: { stdout: "1" },
  });

  // A CommonJS module lifted to ESM keeps its exports in assignment order.
  itBundled("dynamic_import_dce/LiftedCommonJSNamespaceReads", {
    files: {
      "/entry.js": /* js */ `
        const ns = await import("react");
        console.log(ns.useState(1)[0], ns.useId(), ns.version);
      `,
      "/node_modules/react/package.json": `{ "name": "react", "main": "index.js" }`,
      "/node_modules/react/index.js": /* js */ `
        "use strict";
        function useState(i) { return [i]; }
        function useId() { return "id"; }
        exports.useState = useState;
        exports.useId = useId;
        exports.version = "19.0.0";
      `,
    },
    run: { stdout: "1 id 19.0.0" },
  });

  // `ns` holds one of two namespaces, so `a` has no single export.
  itBundled("dynamic_import_dce/DestructureOfEitherNamespace", {
    files: {
      "/entry.js": /* js */ `
        async function f(c) {
          const ns = c ? await import("./x.js") : await import("./y.js");
          const { a } = ns;
          return a;
        }
        console.log(await f(true), await f(false));
      `,
      "/x.js": `export const a = "x";`,
      "/y.js": `export const a = "y";`,
    },
    run: { stdout: "x y" },
  });

  itBundled("dynamic_import_dce/DestructureOfFileWithoutExportsIsQuiet", {
    files: {
      "/entry.js": `const { foo } = await import("./notes.txt"); console.log(foo);`,
      "/notes.txt": `hello`,
    },
    run: { stdout: "undefined" },
    bundleWarnings: {},
  });

  // A lifted CommonJS export changes through `exports.x`, so a destructured
  // copy of it stays a snapshot.
  itBundled("dynamic_import_dce/LiftedCommonJSDestructureIsSnapshot", {
    files: {
      "/entry.js": `const { count, inc } = await import("react"); inc(); console.log(count);`,
      "/node_modules/react/package.json": `{ "name": "react", "main": "index.js" }`,
      "/node_modules/react/index.js": `exports.count = 0; exports.inc = function () { exports.count++; };`,
    },
    run: { stdout: "0" },
  });

  // ── Cases that keep the namespace object ──────────────────────────────

  function itKeepsNamespace(
    name: string,
    opts: Omit<BundlerTestInput, "files" | "run" | "onAfterBundle"> & {
      files: Record<string, string>;
      stdout?: string;
      expected: string;
    },
  ) {
    const { files, stdout, expected, ...rest } = opts;
    itBundled(`dynamic_import_dce/KeepNamespace${name}`, {
      files,
      ...rest,
      run: stdout === undefined ? undefined : { stdout, file: rest.outdir ? "/out/entry.js" : undefined },
      onAfterBundle(api) {
        expect(rest.outdir ? readAllOutputs(api.outdir) : api.readFile("/out.js")).toContain(expected);
      },
    });
  }

  itKeepsNamespace("Escapes", {
    files: {
      "/entry.js": `const ns = await import("./x.js"); console.log(Object.keys(ns).join());`,
      "/x.js": `export const a = "a"; export const b = "b";`,
    },
    stdout: "a,b",
    expected: "__export(exports_x",
  });

  itKeepsNamespace("CommonJS", {
    files: {
      "/entry.js": `const { a } = await import("./x.cjs"); console.log(a);`,
      "/x.cjs": `exports.a = "a";`,
    },
    stdout: "a",
    expected: "__toESM(require_x())",
  });

  itKeepsNamespace("External", {
    files: {
      "/entry.js": `const { a } = await import("ext"); console.log(a);`,
    },
    external: ["ext"],
    expected: `import("ext")`,
  });

  itKeepsNamespace("ImportStarValue", {
    files: {
      "/entry.js": `import "./other.js"; const { a } = await import("./x.js"); console.log(a);`,
      "/other.js": `import * as ns from "./x.js"; console.log(typeof ns);`,
      "/x.js": `export const a = "a";`,
    },
    stdout: "object\na",
    expected: "__export(exports_x",
  });

  // A read with no local to bind (`(await import(x)).a`, `require(x).a`) reads
  // the namespace object, as does one that `import * as` from the same file
  // makes a value.
  itKeepsNamespace("CallMemberRead", {
    files: {
      "/entry.js": /* js */ `
        const { bump } = await import("./x.js");
        console.log((await import("./x.js")).b, require("./x.js").b);
        bump();
        console.log(require("./x.js")["b"]);
      `,
      "/x.js": `export let b = 1; export function bump() { b++; }`,
    },
    stdout: "1 1\n2",
    expected: "__export(exports_x",
  });

  // A local that may hold either namespace, or null.
  itKeepsNamespace("ConditionalLocal", {
    files: {
      "/entry.js": `const ns = process.argv.length > 99 ? null : require("./x.js"); if (ns) console.log(ns.a);`,
      "/x.js": `export const a = "a";`,
    },
    stdout: "a",
    expected: "__export(exports_x",
  });

  // `require()` of an ES module reads `__esModule` off the `__toCommonJS()` copy.
  itKeepsNamespace("RequireEsModuleMarker", {
    files: {
      "/entry.js": `console.log(require("./x.js").__esModule, require("./x.js").a);`,
      "/x.js": `export const a = "a";`,
    },
    stdout: "true a",
    expected: "__toCommonJS(exports_x)",
  });

  // With splitting, the importee is its own chunk and a real ES module.
  itKeepsNamespace("Splitting", {
    files: {
      "/entry.js": `const { a } = await import("./x.js"); console.log(a);`,
      "/x.js": `export const a = "a"; export const b = "DROPPED";`,
    },
    splitting: true,
    outdir: "/out",
    stdout: "a",
    expected: `import("./x-`,
  });
});
