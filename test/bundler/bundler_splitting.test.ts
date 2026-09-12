import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SourceMapConsumer } from "source-map";
import { itBundled, type BundlerTestBundleAPI } from "./expectBundled";

const env = {
  ...bunEnv,
  // Deflake these tests that check import evaluation order is consistent.
  BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1",
};

describe("bundler", () => {
  itBundled("splitting/DynamicImportCSSFile", {
    files: {
      "/client.tsx": `import('./test')`,
      "/test.ts": `
        import './test.css'
        console.log('test.ts loaded')
      `,
      "/test.css": `.aaa { color: red; }`,
    },
    entryPoints: ["/client.tsx"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/client.js",
      env,
      stdout: "test.ts loaded",
    },
  });

  itBundled("splitting/DynamicImportMultipleCSSImports", {
    files: {
      "/entry.js": `
        import('./module1').then(() => console.log('module1 loaded'));
        import('./module2').then(() => console.log('module2 loaded'));
      `,
      "/module1.js": `
        import './styles1.css'
        console.log('module1.js executed')
      `,
      "/module2.js": `
        import './styles2.css'
        console.log('module2.js executed')
      `,
      "/styles1.css": `.class1 { color: red; }`,
      "/styles2.css": `.class2 { color: blue; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "module1.js executed\nmodule2.js executed\nmodule1 loaded\nmodule2 loaded",
    },
  });

  itBundled("splitting/StaticAndDynamicCSSImports", {
    files: {
      "/entry.js": `
        import './static.css';
        import('./dynamic').then(() => console.log('dynamic module loaded'));
      `,
      "/dynamic.js": `
        import './dynamic.css'
        console.log('dynamic.js executed')
      `,
      "/static.css": `.static { color: green; }`,
      "/dynamic.css": `.dynamic { color: purple; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "dynamic.js executed\ndynamic module loaded",
    },
  });

  itBundled("splitting/NestedDynamicImportWithCSS", {
    files: {
      "/entry.js": `
        import('./level1').then(() => console.log('level1 loaded'));
      `,
      "/level1.js": `
        import './level1.css'
        console.log('level1.js executed')
        import('./level2').then(() => console.log('level2 loaded from level1'));
      `,
      "/level2.js": `
        import './level2.css'
        console.log('level2.js executed')
      `,
      "/level1.css": `.level1 { color: red; }`,
      "/level2.css": `.level2 { color: blue; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      // The spec-compliant module loader resolves the inner dynamic import's
      // load before the outer .then callback runs (matches Node).
      stdout: "level1.js executed\nlevel2.js executed\nlevel1 loaded\nlevel2 loaded from level1",
    },
  });

  itBundled("splitting/SharedCSSBetweenChunks", {
    files: {
      "/entry.js": `
        import('./moduleA').then(() => console.log('moduleA loaded'));
        import('./moduleB').then(() => console.log('moduleB loaded'));
      `,
      "/moduleA.js": `
        import './shared.css'
        import './moduleA.css'
        console.log('moduleA.js executed')
      `,
      "/moduleB.js": `
        import './shared.css'
        import './moduleB.css'
        console.log('moduleB.js executed')
      `,
      "/shared.css": `.shared { color: green; }`,
      "/moduleA.css": `.moduleA { color: red; }`,
      "/moduleB.css": `.moduleB { color: blue; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "moduleA.js executed\nmoduleB.js executed\nmoduleA loaded\nmoduleB loaded",
    },
  });

  itBundled("splitting/DynamicImportChainWithCSS", {
    files: {
      "/entry.js": `
        const chain = () => import('./chain1')
          .then(() => {
            console.log('chain1 loaded');
            return import('./chain2');
          })
          .then(() => {
            console.log('chain2 loaded');
            return import('./chain3');
          })
          .then(() => {
            console.log('chain3 loaded');
          });
        chain();
      `,
      "/chain1.js": `
        import './chain1.css'
        console.log('chain1.js executed')
      `,
      "/chain2.js": `
        import './chain2.css'
        console.log('chain2.js executed')
      `,
      "/chain3.js": `
        import './chain3.css'
        console.log('chain3.js executed')
      `,
      "/chain1.css": `.chain1 { color: red; }`,
      "/chain2.css": `.chain2 { color: green; }`,
      "/chain3.css": `.chain3 { color: blue; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "chain1.js executed\nchain1 loaded\nchain2.js executed\nchain2 loaded\nchain3.js executed\nchain3 loaded",
    },
  });

  itBundled("splitting/ConditionalDynamicImportWithCSS", {
    files: {
      "/entry.js": `
        const condition = true;
        if (condition) {
          import('./moduleTrue').then(() => console.log('true branch loaded'));
        } else {
          import('./moduleFalse').then(() => console.log('false branch loaded'));
        }
      `,
      "/moduleTrue.js": `
        import './true.css'
        console.log('moduleTrue.js executed')
      `,
      "/moduleFalse.js": `
        import './false.css'
        console.log('moduleFalse.js executed')
      `,
      "/true.css": `.true { color: green; }`,
      "/false.css": `.false { color: red; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "moduleTrue.js executed\ntrue branch loaded",
    },
  });

  itBundled("splitting/MultipleEntryPointsWithSharedCSS", {
    files: {
      "/entry1.js": `
        import './shared.css'
        import './entry1.css'
        console.log('entry1.js executed')
      `,
      "/entry2.js": `
        import './shared.css'
        import './entry2.css'
        console.log('entry2.js executed')
      `,
      "/shared.css": `.shared { font-size: 16px; }`,
      "/entry1.css": `.entry1 { color: red; }`,
      "/entry2.css": `.entry2 { color: blue; }`,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: [
      {
        file: "/out/entry1.js",
        env,
        stdout: "entry1.js executed",
      },
      {
        file: "/out/entry2.js",
        env,
        stdout: "entry2.js executed",
      },
    ],
  });

  itBundled("splitting/DynamicImportWithOnlyCSSNoJS", {
    files: {
      "/entry.js": `
        import('./styles.css').then(() => console.log('CSS import succeeded')).catch(err => console.log('CSS import failed:', err.message));
      `,
      "/styles.css": `.styles { color: blue; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "CSS import succeeded",
    },
  });

  itBundled("splitting/CircularDynamicImportsWithCSS", {
    files: {
      "/entry.js": `
        import('./a').then(module => {
          console.log('a loaded from entry');
          return import('./b');
        }).then(module => {
          console.log('b loaded from entry, value:', module.bValue);
        });
      `,
      "/a.js": `
        import './a.css'
        console.log('a.js executed')
      `,
      "/b.js": `
        import './b.css'
        console.log('b.js executed')
        export const bValue = 'B';
        // Import a to create circular dependency
        import * as A from './a';
        console.log('b.js imports a', A);
      `,
      "/a.css": `.a { color: red; }`,
      "/b.css": `.b { color: blue; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    env: "inline",
    format: "esm",
    run: {
      file: "/out/entry.js",
      env,
      stdout: "a.js executed\na loaded from entry\nb.js executed\nb.js imports a {}\nb loaded from entry, value: B",
    },
  });

  // An `import()` target only referenced from a part that tree shaking removes
  // must not get a chunk. `define` turns the gate into a compile-time `false`.
  const deadDynamicImportFiles = {
    "/main.ts": /* ts */ `
      import { openSecretDialog } from './launchers.ts'
      if (FEATURE_SECRET) {
        openSecretDialog().then(x => console.log(x))
      }
      console.log("main")
    `,
    "/launchers.ts": /* ts */ `
      export async function openSecretDialog() {
        const { SecretDialog } = await import('./secret.ts')
        return SecretDialog()
      }
    `,
    "/secret.ts": /* ts */ `
      export function SecretDialog() { return 'internal only' }
    `,
  };

  const jsFilesIn = (api: BundlerTestBundleAPI) =>
    readdirSync(api.outdir)
      .filter(f => f.endsWith(".js"))
      .sort();

  // The non-entry chunk whose code contains `marker`.
  const chunkContaining = (api: BundlerTestBundleAPI, marker: string) => {
    const chunk = jsFilesIn(api).find(f => api.readFile("/out/" + f).includes(marker));
    expect(chunk).toBeDefined();
    expect(chunk).not.toBe("main.js");
    return chunk!;
  };
  // The chunk holding secret.ts, which must be separate from the entry point.
  const secretChunk = (api: BundlerTestBundleAPI) => chunkContaining(api, "internal only");

  for (const backend of ["cli", "api"] as const) {
    itBundled(`splitting/DeadDynamicImportTargetGetsNoChunk-${backend}`, {
      files: deadDynamicImportFiles,
      entryPoints: ["/main.ts"],
      splitting: true,
      outdir: "/out",
      format: "esm",
      metafile: true,
      backend,
      define: { FEATURE_SECRET: "false" },
      assertNotPresent: { "/out/main.js": "internal only" },
      onAfterBundle(api) {
        expect(jsFilesIn(api)).toEqual(["main.js"]);
        const metafile = JSON.parse(api.readFile("/metafile.json"));
        expect(Object.keys(metafile.inputs).some(k => k.endsWith("secret.ts"))).toBe(false);
        expect(Object.keys(metafile.outputs)).toHaveLength(1);
      },
      run: { file: "/out/main.js", stdout: "main" },
    });
  }

  itBundled("splitting/DeadDynamicImportTargetNoSplittingReference", {
    files: deadDynamicImportFiles,
    entryPoints: ["/main.ts"],
    outdir: "/out",
    format: "esm",
    define: { FEATURE_SECRET: "false" },
    assertNotPresent: { "/out/main.js": "internal only" },
    onAfterBundle(api) {
      expect(jsFilesIn(api)).toEqual(["main.js"]);
    },
    run: { file: "/out/main.js", stdout: "main" },
  });

  // With tree shaking off every `import()` target keeps its chunk, as before.
  itBundled("splitting/DeadDynamicImportTargetKeptWithoutTreeShaking", {
    files: deadDynamicImportFiles,
    entryPoints: ["/main.ts"],
    splitting: true,
    treeShaking: false,
    // The CLI has no flag to disable tree shaking.
    backend: "api",
    outdir: "/out",
    format: "esm",
    define: { FEATURE_SECRET: "false" },
    onAfterBundle(api) {
      secretChunk(api);
    },
    run: { file: "/out/main.js", stdout: "main" },
  });

  itBundled("splitting/LiveDynamicImportTargetStillGetsChunk", {
    files: deadDynamicImportFiles,
    entryPoints: ["/main.ts"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    define: { FEATURE_SECRET: "true" },
    onAfterBundle(api) {
      api.expectFile("/out/main.js").toContain(`import("./${secretChunk(api)}")`);
    },
    run: { file: "/out/main.js", stdout: "main\ninternal only" },
  });

  // live → import() → a → import() → b: liveness has to propagate through the
  // dynamically imported chunk, not just from the user entry point.
  itBundled("splitting/DynamicImportChainLiveness", {
    files: {
      "/main.ts": /* ts */ `
        import { loadA, loadDeadA } from './launchers.ts'
        if (FEATURE) loadDeadA()
        loadA().then(x => console.log(x))
        console.log("main")
      `,
      "/launchers.ts": /* ts */ `
        export async function loadA() { return (await import('./a.ts')).a() }
        export async function loadDeadA() { return (await import('./dead-a.ts')).a() }
      `,
      "/a.ts": /* ts */ `
        export async function a() { return "a:" + (await import('./b.ts')).b() }
      `,
      "/b.ts": /* ts */ `
        export function b() { return "b" }
      `,
      "/dead-a.ts": /* ts */ `
        export async function a() { return "DEAD_A:" + (await import('./dead-b.ts')).b() }
      `,
      "/dead-b.ts": /* ts */ `
        export function b() { return "DEAD_B" }
      `,
    },
    entryPoints: ["/main.ts"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    define: { FEATURE: "false" },
    onAfterBundle(api) {
      const contents = jsFilesIn(api).map(f => api.readFile("/out/" + f));
      expect(contents.filter(c => c.includes('"a:"'))).toHaveLength(1);
      expect(contents.filter(c => c.includes('return "b"'))).toHaveLength(1);
      const all = contents.join("\n");
      expect(all).not.toContain("DEAD_A");
      expect(all).not.toContain("DEAD_B");
    },
    run: { file: "/out/main.js", stdout: "main\na:b" },
  });

  // A dead `import()` target that live code also imports statically stays in
  // the output (it is live), and keeps its own chunk because it is an entry point.
  itBundled("splitting/DeadDynamicImportTargetAlsoStaticallyImported", {
    files: {
      ...deadDynamicImportFiles,
      "/main.ts": /* ts */ `
        import { openSecretDialog } from './launchers.ts'
        import { SecretDialog } from './secret.ts'
        if (FEATURE_SECRET) {
          openSecretDialog().then(x => console.log(x))
        }
        console.log("main", SecretDialog())
      `,
    },
    entryPoints: ["/main.ts"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    define: { FEATURE_SECRET: "false" },
    onAfterBundle(api) {
      api.expectFile("/out/main.js").toContain(`from "./${secretChunk(api)}"`);
    },
    run: { file: "/out/main.js", stdout: "main internal only" },
  });

  // Chunks fold into a chunk that is loaded under the same conditions, so no
  // entry point loads more or less code than before; --min-chunk-size also
  // folds side-effect-free chunks below that size into a chunk more entries
  // load. `bun build` names chunks `[name]-[hash].js`; strip the hash so
  // expectations can name outputs.
  const jsOutputs = (api: BundlerTestBundleAPI) => jsFilesIn(api).map(f => f.replace(/-[a-z0-9]{8}\.js$/, ".js"));
  const jsOutput = (api: BundlerTestBundleAPI, name: string) =>
    api.readFile("/out/" + jsFilesIn(api).find(f => f === `${name}.js` || f.startsWith(`${name}-`))!);

  itBundled("splitting/FoldsSharedIntoEntry", {
    files: {
      "/entry.js": /* js */ `
        import { shared } from './shared.js'
        import { helper } from './helper.js'
        console.log('entry', shared(), helper())
        import('./lazy.js').then(m => console.log('lazy', m.lazy()))
      `,
      "/lazy.js": /* js */ `
        import { shared } from './shared.js'
        import { helper } from './helper.js'
        export function lazy() { return shared() + helper() }
      `,
      "/shared.js": /* js */ `
        console.log('shared')
        export function shared() { return 41 }
      `,
      "/helper.js": /* js */ `
        export function helper() { return 1 }
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      // Keyed by importers alone this is entry.js importing everything from
      // an {entry, lazy} chunk with all of the code, and lazy.js.
      expect(jsOutputs(api)).toEqual(["entry.js", "lazy.js"]);
      api.expectFile("/out/entry.js").toContain("41");
      api.expectFile("/out/entry.js").not.toMatch(/^\s*import\s*[{"]/m);
      expect(api.readFile("/out/entry.js").match(/^\s*export\b/gm)).toHaveLength(1);
      expect(jsOutput(api, "lazy")).toMatch(/import\s*\{\s*shared,\s*helper\s*\}\s*from "\.\/entry\.js"/);
    },
    run: { file: "/out/entry.js", stdout: "shared\nentry 41 1\nlazy 42" },
  });

  // A CommonJS module shared with an import() target folds into the entry
  // like anything else: the entry chunk exports its `require_x` wrapper and
  // the lazy chunk calls it, so the body still runs once, on first use.
  itBundled("splitting/FoldsSharedCommonJSIntoEntry", {
    files: {
      "/entry.js": /* js */ `
        import './start.js'
        import { counter } from './shared.cjs'
        console.log('entry', counter())
        import('./lazy.js').then(m => console.log('lazy', m.lazy()))
      `,
      "/start.js": /* js */ `
        console.log('entry start')
      `,
      "/lazy.js": /* js */ `
        import { counter } from './shared.cjs'
        export function lazy() { return counter() }
      `,
      "/shared.cjs": /* js */ `
        console.log('shared evaluated')
        let n = 0
        module.exports = Object.assign(function () {}, { counter: () => ++n })
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsOutputs(api)).toEqual(["entry.js", "lazy.js"]);
      expect(jsOutput(api, "lazy")).toMatch(/require_shared\s*\}\s*from "\.\/entry\.js"/);
      api.expectFile("/out/entry.js").toContain("shared evaluated");
    },
    run: { file: "/out/entry.js", stdout: "entry start\nshared evaluated\nentry 1\nlazy 2" },
  });

  // import() of a CommonJS module that the entry also requires: the module
  // lives in entry.js and the import() target chunk is
  // `export default require_x()` over the entry's wrapper.
  itBundled("splitting/FoldsDynamicallyImportedCommonJSIntoEntry", {
    files: {
      "/entry.js": /* js */ `
        import { counter } from './shared.cjs'
        console.log('entry', counter())
        import('./shared.cjs').then(m => console.log('lazy', m.default.counter()))
      `,
      "/shared.cjs": /* js */ `
        console.log('shared evaluated')
        let n = 0
        exports.counter = () => ++n
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsOutputs(api)).toEqual(["entry.js", "shared.js"]);
      expect(jsOutput(api, "shared")).toContain('from "./entry.js"');
      api.expectFile("/out/entry.js").toContain("shared evaluated");
    },
    run: { file: "/out/entry.js", stdout: "shared evaluated\nentry 1\nlazy 2" },
  });

  // A binding shared across chunks carries one bundle-wide name that every
  // chunk's renamer pins; locals that already have that name (top level or
  // nested) are renamed around it and the import stays bare.
  itBundled("splitting/CrossChunkNameCollidesWithLocal", {
    files: {
      "/a.js": /* js */ `
        import { foo } from './shared.js'
        function foo2() { return 'a-foo2' }
        var local = (function () { var foo = 'nested'; return foo })()
        console.log(foo(), foo2(), local)
      `,
      "/b.js": /* js */ `
        import { foo as sharedFoo } from './shared.js'
        function foo() { return 'b-local-foo' }
        console.log(sharedFoo(), foo())
      `,
      "/shared.js": /* js */ `
        export function foo() { return 'shared' }
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      api.expectFile("/out/a.js").toMatch(/import\s*\{\s*foo\s*\}\s*from/);
      api.expectFile("/out/b.js").toMatch(/import\s*\{\s*foo\s*\}\s*from/);
    },
    run: [
      { file: "/out/a.js", stdout: "shared a-foo2 nested" },
      { file: "/out/b.js", stdout: "shared b-local-foo" },
    ],
  });

  // Same under --minify-identifiers: the shared bindings take the shortest
  // names bundle-wide; a chunk with many hot locals of its own must not hand
  // one of those names out again, and both clauses stay free of `as`.
  itBundled("splitting/CrossChunkNameCollidesWithLocalMinified", {
    files: {
      "/a.js": /* js */ `
        import { s0, s1, s2 } from './shared.js'
        ${Array.from({ length: 80 }, (_, i) => `var l${i} = ${i}; l${i}++; l${i}++; l${i}++; l${i}++;`).join("\n")}
        console.log(s0() + s1() + s2(), ${Array.from({ length: 80 }, (_, i) => `l${i}`).join("+")})
      `,
      "/b.js": /* js */ `
        import { s0, s1, s2 } from './shared.js'
        console.log(s0() + s1() + s2())
      `,
      "/shared.js": /* js */ `
        export function s0() { return 1 }
        export function s1() { return 20 }
        export function s2() { return 300 }
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    minifyIdentifiers: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      for (const f of jsFilesIn(api)) {
        const out = api.readFile("/out/" + f);
        for (const clause of out.match(/(?:import|export)\s*\{[^}]*\}/g) ?? []) expect(clause).not.toContain(" as ");
      }
    },
    run: [
      { file: "/out/a.js", stdout: `321 ${80 * 4 + (79 * 80) / 2}` },
      { file: "/out/b.js", stdout: "321" },
    ],
  });

  // Direct eval keeps every name in its scope chain as written — including a
  // CommonJS-wrapped file's top level — so the bundle-wide namer must route
  // around those names, and the shared bindings such a file declares fall
  // back to `export { name as alias }`.
  itBundled("splitting/CrossChunkNamesWithDirectEvalMinified", {
    files: {
      "/a.js": /* js */ `
        import { a, b } from './shared.js'
        var x = 'ax'
        function a2() { return 'local-a2' }
        console.log(a(), b, eval('x'), eval('a2()'))
      `,
      "/b.js": /* js */ `
        import { a, b } from './shared.js'
        console.log(a(), b)
      `,
      "/shared.js": /* js */ `
        export function a() { return 'A' }
        export var b = eval('"B"')
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    minifyIdentifiers: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      api.expectFile("/out/a.js").toContain('var x = "ax"');
    },
    run: [
      { file: "/out/a.js", stdout: "A B ax local-a2" },
      { file: "/out/b.js", stdout: "A B" },
    ],
  });
  // The eval file's *import* bindings must not be pinned: the linker merges
  // them into the exporter's symbol, and a third chunk importing that symbol
  // would then print it under its source name without having reserved it.
  itBundled("splitting/DirectEvalDoesNotPinSharedExport", {
    files: {
      "/e.js": /* js */ `
        import { a } from './shared.js'
        var x = 'ex'
        console.log(a(), eval('x'))
      `,
      "/p.js": /* js */ `
        import { a, b } from './shared.js'
        ${Array.from({ length: 120 }, (_, i) => `var l${i} = ${i}; l${i}++; l${i}++; l${i}++;`).join("\n")}
        console.log(a(), b(), ${Array.from({ length: 120 }, (_, i) => `l${i}`).join("+")})
      `,
      "/q.js": /* js */ `
        import { a, b } from './shared.js'
        console.log(a(), b())
      `,
      "/shared.js": /* js */ `
        export function a() { return 'A' }
        export function b() { return 'B' }
      `,
    },
    entryPoints: ["/e.js", "/p.js", "/q.js"],
    splitting: true,
    minifyIdentifiers: true,
    outdir: "/out",
    format: "esm",
    run: [
      { file: "/out/e.js", stdout: "A ex" },
      { file: "/out/p.js", stdout: `A B ${120 * 3 + (119 * 120) / 2}` },
      { file: "/out/q.js", stdout: "A B" },
    ],
  });
  itBundled("splitting/CrossChunkNamesWithDirectEval", {
    files: {
      "/a.js": /* js */ `
        import { a, b } from './shared.js'
        var x = 'ax'
        function a2() { return 'local-a2' }
        console.log(a(), b, eval('x'), eval('a2()'))
      `,
      "/b.js": /* js */ `
        import { a, b } from './shared.js'
        console.log(a(), b)
      `,
      "/shared.js": /* js */ `
        export function a() { return 'A' }
        export var b = eval('"B"')
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    run: [
      { file: "/out/a.js", stdout: "A B ax local-a2" },
      { file: "/out/b.js", stdout: "A B" },
    ],
  });

  // Two chunks that import() each other reach the same set of chunks; their
  // content hashes must still differ, or hash-only naming collides.
  itBundled("splitting/ChunkImportCycleDistinctHashes", {
    files: {
      "/a.js": /* js */ `
        export function a() { return 'a' }
        import('./b.js').then(m => console.log(a(), m.b()))
      `,
      "/b.js": /* js */ `
        export function b() { return 'b' }
        export const again = () => import('./a.js')
      `,
    },
    entryPoints: ["/a.js", "/b.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    entryNaming: "[hash].[ext]",
    onAfterBundle(api) {
      // a, b, and the modulepreload runtime both entries share.
      expect(readdirSync(api.outdir).filter(f => f.endsWith(".js"))).toHaveLength(3);
    },
  });
  // A file whose every part was tree-shaken gets no chunk: two such files
  // reached by different sets of entries used to become two empty chunks
  // with the same content hash ("Multiple files share the same output path").
  itBundled("splitting/NoChunkForFilesWithNoLiveParts", {
    files: {
      "/entry.js": `await import('./a.js'); await import('./b.js'); await import('./e.js')`,
      "/a.js": `import './c.js'; import './d.js'; console.log('a')`,
      "/b.js": `import './c.js'; import './shared.js'; console.log('b')`,
      "/e.js": `import './d.js'; console.log('e')`,
      "/c.js": `export function dead() {}`,
      // only live part is a bare import of an unwrapped file: prints nothing either
      "/d.js": `import './shared.js'; export function dead() {}`,
      "/shared.js": `console.log('shared')`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    minifySyntax: true,
    outdir: "/out",
    chunkNaming: "chunk-[hash].[ext]",
    onAfterBundle(api) {
      // entry + the three import() targets + shared.js's chunk; nothing for c.js / d.js
      expect(readdirSync(api.outdir).filter(f => f.endsWith(".js"))).toHaveLength(5);
    },
    run: { file: "/out/entry.js", stdout: "shared\na\nb\ne" },
  });
  // A file whose live parts are only re-exports of unwrapped files prints
  // nothing either: its importers bind to the re-exported file directly. It
  // used to get a chunk holding just the banner, which nothing imported.
  itBundled("splitting/NoChunkForReExportOnlyFiles", {
    files: {
      "/entry.js": /* js */ `
        export async function main() {
          const a = await import('./a.js'); const b = await import('./b.js'); const e = await import('./e.js');
          a.run(); b.run(); e.run();
        }
        main();
      `,
      "/a.js": /* js */ `
        import { greet } from './barrel.js'; import { shout } from './barrel2.js';
        export function run() { console.log(greet('a'), shout('a')) }
      `,
      "/b.js": /* js */ `
        import { greet } from './barrel.js';
        export function run() { console.log(greet('b')) }
      `,
      "/e.js": /* js */ `
        import { shout } from './barrel2.js';
        export function run() { console.log(shout('e')) }
      `,
      "/barrel.js": `export { greet } from "./impl.js";`,
      "/barrel2.js": `export { shout } from "./impl.js";`,
      "/impl.js": /* js */ `
        export function greet(s) { return "hi " + s }
        export function shout(s) { return s.toUpperCase() }
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    target: "bun",
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: true,
    banner: "// LICENSE BANNER",
    outdir: "/out",
    onAfterBundle(api) {
      // entry + the three import() targets + impl.js's chunk; nothing for barrel.js / barrel2.js
      expect(readdirSync(api.outdir).filter(f => f.endsWith(".js"))).toHaveLength(5);
    },
    run: { file: "/out/entry.js", stdout: "hi a A\nhi b\nE" },
  });
  // The same for `export *` and `export * as ns` of an unwrapped file, and
  // for a file whose only statements are an import and an `export {}`.
  itBundled("splitting/NoChunkForExportStarOrClauseOnlyFiles", {
    files: {
      "/entry.js": /* js */ `
        export async function main() {
          const a = await import('./a.js'); const b = await import('./b.js'); const e = await import('./e.js');
          a.run(); b.run(); e.run();
        }
        main();
      `,
      "/a.js": /* js */ `
        import { greet } from './star.js'; import { impl } from './ns.js'; import { shout } from './clause.js';
        export function run() { console.log(greet('a'), impl.shout('a'), shout('a')) }
      `,
      "/b.js": /* js */ `
        import { greet } from './star.js'; import { shout } from './clause.js';
        export function run() { console.log(greet('b'), shout('b')) }
      `,
      "/e.js": /* js */ `
        import { impl } from './ns.js';
        export function run() { console.log(impl.shout('e')) }
      `,
      "/star.js": `export * from "./impl.js";`,
      "/ns.js": `export * as impl from "./impl.js";`,
      "/clause.js": `import { shout } from "./impl.js"; export { shout };`,
      "/impl.js": /* js */ `
        export function greet(s) { return "hi " + s }
        export function shout(s) { return s.toUpperCase() }
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      // entry + the three import() targets + impl.js's chunk + the runtime chunk
      // (`__export` builds the `impl` namespace object); nothing for star.js / ns.js / clause.js
      expect(readdirSync(api.outdir).filter(f => f.endsWith(".js"))).toHaveLength(6);
    },
    run: { file: "/out/entry.js", stdout: "hi a A A\nhi b B\nE" },
  });
  // A file that prints nothing still belongs to its chunk, because the walk
  // that orders a chunk's imports starts from the chunk's files: an import()
  // target that only re-exports loads its targets in source order.
  itBundled("splitting/ReExportOnlyEntryKeepsImportOrder", {
    files: {
      "/entry.js": /* js */ `
        const m = await import('./barrel.js');
        console.log(m.a, m.b);
        await import('./x.js'); await import('./y.js');
      `,
      "/barrel.js": `export { b } from "./implB.js"; export { a } from "./implA.js";`,
      "/x.js": `import { a } from "./implA.js"; export const x = a;`,
      "/y.js": `import { b } from "./implB.js"; export const y = b;`,
      "/implA.js": `console.log("A"); export const a = "a";`,
      "/implB.js": `console.log("B"); export const b = "b";`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "B\nA\na b" },
  });
  // The same inside a shared chunk: the walk reaches barrel.js before other.js
  // and prints implB.js (kept only for its side effects) from there.
  itBundled("splitting/ReExportOnlyFileKeepsChunkOrder", {
    files: {
      "/entry.js": `await import('./a.js'); await import('./b.js');`,
      "/a.js": `import { x } from "./barrel.js"; import "./other.js"; console.log("a", x);`,
      "/b.js": `import { x } from "./barrel.js"; import "./other.js"; console.log("b", x);`,
      "/barrel.js": `export { y } from "./implB.js"; export { x } from "./implA.js";`,
      "/other.js": `console.log("other");`,
      "/implA.js": `console.log("A"); export const x = "x";`,
      "/implB.js": `console.log("B"); export const y = "y";`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "A\nB\nother\na x\nb x" },
  });
  // An entry point with exports of its own keeps its module namespace as
  // written: shared code is not folded into it (which would add exports),
  // but the chunks that are always loaded with it still fold into one.
  itBundled("splitting/EntryWithExportsKeepsSignature", {
    files: {
      "/entry.js": /* js */ `
        import { a } from './a.js'
        import { b } from './b.js'
        export const version = a() + b()
        export const loadA = () => import('./lazy-a.js')
        export const loadB = () => import('./lazy-b.js')
      `,
      "/lazy-a.js": /* js */ `
        import { a } from './a.js'
        export const run = () => a()
      `,
      "/lazy-b.js": /* js */ `
        import { b } from './b.js'
        export const run = () => b()
      `,
      "/a.js": /* js */ `
        console.log('a')
        export const a = () => 1
      `,
      "/b.js": /* js */ `
        console.log('b')
        export const b = () => 2
      `,
      "/run.js": /* js */ `
        const m = await import('./out/entry.js')
        console.log(Object.keys(m).sort().join(','), m.version, (await m.loadA()).run(), (await m.loadB()).run())
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      // Keyed by importers alone: entry, lazy-a, lazy-b, {entry,lazy-a}, {entry,lazy-b}.
      // Both shared chunks are loaded exactly when entry is, so they become one.
      expect(jsFilesIn(api)).toHaveLength(4);
    },
    run: { file: "/run.js", stdout: "a\nb\nloadA,loadB,version 3 1 2" },
  });

  itBundled("splitting/MinChunkSizeRequiresSplittingAPI", {
    files: { "/entry.js": `console.log(1)` },
    entryPoints: ["/entry.js"],
    minChunkSize: 1024,
    outdir: "/out",
    backend: "api",
    bundleErrors: { "<bun>": ["minChunkSize requires splitting to be true."] },
  });

  // With top-level await the entry can still be mid-evaluation when the
  // import() it awaits links, so a chunk importing back from entry.js would
  // wait on it forever; the shared chunk stays.
  itBundled("splitting/TopLevelAwaitKeepsSharedChunk", {
    files: {
      "/entry.js": /* js */ `
        import { shared } from './shared.js'
        const m = await import('./lazy.js')
        console.log('entry', shared(), m.lazy())
      `,
      "/lazy.js": /* js */ `
        import { shared } from './shared.js'
        export function lazy() { return shared() + 1 }
      `,
      "/shared.js": /* js */ `
        export function shared() { return 41 }
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsFilesIn(api)).toHaveLength(3);
      expect(jsOutput(api, "lazy")).not.toContain('from "./entry.js"');
    },
    run: { file: "/out/entry.js", stdout: "entry 41 42" },
  });

  // An entry point imports every chunk its code reaches, for their side
  // effects, even when it uses nothing from one — unless loading that chunk
  // runs nothing.
  itBundled("splitting/NoBareImportOfSideEffectFreeChunk", {
    files: {
      "/a.js": /* js */ `
        import { x } from './lib.js'
        import { z } from './pure.js'
        console.log('a', x)
      `,
      "/b.js": /* js */ `
        import { x } from './lib.js'
        import { z } from './pure.js'
        console.log('b', x)
      `,
      "/c.js": /* js */ `
        import { z } from './pure.js'
        console.log('c', z())
      `,
      "/lib.js": /* js */ `
        export const x = 1
        console.log('lib')
      `,
      "/pure.js": /* js */ `
        import { d } from './pure-dep.js'
        export const z = () => d
      `,
      "/pure-dep.js": /* js */ `
        export const d = 2
      `,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      // a.js and b.js reach the {a, b, c} chunk (pure.js + pure-dep.js) but
      // use nothing from it and loading it runs nothing: only the lib.js
      // chunk is imported. c.js uses \`z\`.
      const importsIn = (name: string) =>
        [...api.readFile("/out/" + name).matchAll(/^\s*import\s*(\{[^}]*\})?\s*(?:from\s*)?"/gm)].map(
          m => m[1] ?? "bare",
        );
      expect(importsIn("a.js")).toEqual([expect.stringContaining("x")]);
      expect(importsIn("b.js")).toEqual([expect.stringContaining("x")]);
      expect(importsIn("c.js")).toEqual([expect.stringContaining("z")]);
    },
    run: [
      { file: "/out/a.js", stdout: "lib\na 1" },
      { file: "/out/c.js", stdout: "c 2" },
    ],
  });

  // A re-export from a `"sideEffects": false` barrel prints nothing: the
  // importer binds straight to the module that declares the name. So an entry
  // point reaches, through the barrel, only the modules it uses, and a module
  // only an import() uses lives in that import()'s chunk.
  const sideEffectFreeBarrel = {
    "/node_modules/pkg/package.json": JSON.stringify({ name: "pkg", main: "index.js", sideEffects: false }),
    "/node_modules/pkg/index.js": /* js */ `
      export { A } from './a.js'
      export { B } from './b.js'
    `,
    "/node_modules/pkg/a.js": /* js */ `
      export const A = 'AAAA'
    `,
    "/node_modules/pkg/b.js": /* js */ `
      export const B = 'BBBB_MARK'
    `,
  };

  itBundled("splitting/SideEffectFreeBarrelLeavesLazyModulesToTheirChunk", {
    files: {
      ...sideEffectFreeBarrel,
      "/entry.js": /* js */ `
        import { A } from 'pkg'
        console.log(A)
        import('./lazy.js').then(m => m.run())
      `,
      "/lazy.js": /* js */ `
        import { B } from 'pkg'
        export function run() { console.log(B) }
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsOutputs(api)).toEqual(["entry.js", "lazy.js"]);
      api.expectFile("/out/entry.js").toContain("AAAA");
      api.expectFile("/out/entry.js").not.toContain("BBBB_MARK");
      expect(jsOutput(api, "lazy")).toContain("BBBB_MARK");
      expect(jsOutput(api, "lazy")).not.toContain("import ");
    },
    run: { file: "/out/entry.js", stdout: "AAAA\nBBBB_MARK" },
  });

  // The same through a namespace whose properties bind directly.
  itBundled("splitting/SideEffectFreeBarrelNamespacePropertyAccess", {
    files: {
      ...sideEffectFreeBarrel,
      "/entry.js": /* js */ `
        import * as pkg from 'pkg'
        console.log(pkg.A)
        import('./lazy.js').then(m => m.run())
      `,
      "/lazy.js": /* js */ `
        import * as pkg from 'pkg'
        export function run() { console.log(pkg.B) }
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsOutputs(api)).toEqual(["entry.js", "lazy.js"]);
      api.expectFile("/out/entry.js").not.toContain("BBBB_MARK");
      expect(jsOutput(api, "lazy")).toContain("BBBB_MARK");
    },
    run: { file: "/out/entry.js", stdout: "AAAA\nBBBB_MARK" },
  });

  // Without splitting, each entry point's bundle holds only what that entry
  // uses from the barrel.
  itBundled("splitting/SideEffectFreeBarrelPerEntryWithoutSplitting", {
    files: {
      ...sideEffectFreeBarrel,
      "/e1.js": /* js */ `
        import { A } from 'pkg'
        console.log(A)
      `,
      "/e2.js": /* js */ `
        import { B } from 'pkg'
        console.log(B)
      `,
    },
    entryPoints: ["/e1.js", "/e2.js"],
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      api.expectFile("/out/e1.js").toContain("AAAA");
      api.expectFile("/out/e1.js").not.toContain("BBBB_MARK");
      api.expectFile("/out/e2.js").toContain("BBBB_MARK");
      api.expectFile("/out/e2.js").not.toContain("AAAA");
    },
    run: [
      { file: "/out/e1.js", stdout: "AAAA" },
      { file: "/out/e2.js", stdout: "BBBB_MARK" },
    ],
  });

  // A barrel that does not declare itself side-effect free still loads every
  // module it re-exports wherever it is imported: b.js may have side effects,
  // and they run before the entry's own code.
  itBundled("splitting/BarrelWithSideEffectsLoadsEveryReExport", {
    files: {
      "/entry.js": /* js */ `
        import { A } from './lib/index.js'
        console.log(A)
        import('./lazy.js').then(m => m.run())
      `,
      "/lazy.js": /* js */ `
        import { B } from './lib/index.js'
        export function run() { console.log(B) }
      `,
      "/lib/index.js": /* js */ `
        export { A } from './a.js'
        export { B } from './b.js'
      `,
      "/lib/a.js": /* js */ `
        export const A = 'AAAA'
      `,
      "/lib/b.js": /* js */ `
        console.log('b runs')
        export const B = 'BBBB_MARK'
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsOutputs(api)).toEqual(["entry.js", "lazy.js"]);
      api.expectFile("/out/entry.js").toContain("BBBB_MARK");
    },
    run: { file: "/out/entry.js", stdout: "b runs\nAAAA\nBBBB_MARK" },
  });

  // Ported from Rollup's chunking-form/samples/chunk-assigment-in-dynamic.
  itBundled("splitting/SideEffectFreeCommonJSSharedByTwoLazyChunks", {
    files: {
      "/node_modules/icons/package.json": JSON.stringify({ name: "icons", main: "c.js", sideEffects: false }),
      "/node_modules/icons/c.js": /* js */ `
        exports.preFaPrint = { foo: 1 };
        exports.faPrint = exports.preFaPrint;
      `,
      "/entry.js": /* js */ `
        const a = await import('./a.js')
        const b = await import('./b.js')
        console.log(a.A().icon.foo, b.B().icon.foo)
      `,
      "/a.js": /* js */ `
        import { faPrint } from 'icons'
        export function A() { return { icon: faPrint } }
      `,
      "/b.js": /* js */ `
        import { faPrint } from 'icons'
        export function B() { return { icon: faPrint } }
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    run: { file: "/out/entry.js", stdout: "1 1" },
  });

  // Ported from Rollup's chunking-form/samples/deoptimized-module-with-dynamic-import.
  itBundled("splitting/SideEffectFreeModuleWithTopLevelDynamicImport", {
    files: {
      "/node_modules/loader/package.json": JSON.stringify({ name: "loader", main: "index.js", sideEffects: false }),
      "/node_modules/loader/index.js": /* js */ `
        export function fn() { return 'fn' }
        import('./cjs.js')
      `,
      "/node_modules/loader/cjs.js": /* js */ `
        export const cjs = 'cjs-value'
      `,
      "/entry.js": /* js */ `
        import { value, loadCjs } from './a.js'
        console.log(value)
        loadCjs().then(m => console.log(m.cjs))
      `,
      "/a.js": /* js */ `
        import { fn } from 'loader'
        export const value = fn()
        export function loadCjs() { return import('loader/cjs.js') }
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    run: { file: "/out/entry.js", stdout: "fn\ncjs-value" },
  });

  // Ported from Rollup's chunking-form/samples/namespace-reexport-side-effect-cache.
  itBundled("splitting/SideEffectFreeStarBarrelKeepsEffectForEveryEntry", {
    files: {
      "/node_modules/lib/package.json": JSON.stringify({
        name: "lib",
        main: "index.js",
        sideEffects: ["./foo.js", "./effect.js"],
      }),
      "/node_modules/lib/index.js": `export * from './foo.js'`,
      "/node_modules/lib/foo.js": /* js */ `
        export { foo } from './fooImpl.js'
        import './effect.js'
      `,
      "/node_modules/lib/effect.js": `console.log('side effect')`,
      "/node_modules/lib/fooImpl.js": `export const foo = 'foo'`,
      "/entry1.js": /* js */ `
        import { foo } from 'lib'
        console.log('entry1', foo)
      `,
      "/entry2.js": /* js */ `
        import { foo } from 'lib'
        console.log('entry2', foo)
      `,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    run: [
      { file: "/out/entry1.js", stdout: "side effect\nentry1 foo" },
      { file: "/out/entry2.js", stdout: "side effect\nentry2 foo" },
    ],
  });

  // Ported from Rollup's chunking-form/samples/side-effect-free-dependencies/module-side-effects-reexports-{1,2,3}.
  for (const [name, main] of [
    ["ExportFrom", `export { value } from 'dep1'`],
    ["ImportThenExport", `import { value } from 'dep1'\nexport { value }`],
    ["ExportStar", `export * from 'dep1'`],
  ]) {
    itBundled(`splitting/EntryReExportsThroughSideEffectFreeStarChain${name}`, {
      files: {
        "/node_modules/dep1/package.json": JSON.stringify({ name: "dep1", main: "index.js", sideEffects: false }),
        "/node_modules/dep1/index.js": `export * from './dep2.js'`,
        "/node_modules/dep1/dep2.js": `export const value = 42`,
        "/main.js": main,
        "/use.js": /* js */ `
          import { value } from './main.js'
          console.log(value)
        `,
      },
      entryPoints: ["/main.js", "/use.js"],
      splitting: true,
      outdir: "/out",
      format: "esm",
      run: { file: "/out/use.js", stdout: "42" },
    });
  }

  // Ported from Rollup's chunking-form/samples/side-effect-free-dependencies/module-side-effects-empty-imports.
  itBundled("splitting/SideEffectFreeImportUnusedByOneEntry", {
    files: {
      "/node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "index.js", sideEffects: false }),
      "/node_modules/dep/index.js": /* js */ `
        export default 'DEP_VALUE'
        console.log('dep body')
      `,
      "/main1.js": /* js */ `
        import value from 'dep'
        console.log('main1', value)
      `,
      "/main2.js": /* js */ `
        import value from 'dep'
        console.log('main2')
      `,
    },
    entryPoints: ["/main1.js", "/main2.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsOutputs(api)).toEqual(["main1.js", "main2.js"]);
      api.expectFile("/out/main1.js").toContain("DEP_VALUE");
      api.expectFile("/out/main2.js").not.toContain("DEP_VALUE");
      api.expectFile("/out/main2.js").not.toContain("import ");
    },
    run: [
      { file: "/out/main1.js", stdout: "dep body\nmain1 DEP_VALUE" },
      { file: "/out/main2.js", stdout: "main2" },
    ],
  });

  // Ported from Rollup's function/samples/module-side-effects/reexports; lib.js still runs, as in esbuild.
  for (const splitting of [false, true]) {
    itBundled(`splitting/SideEffectFreeReExportRunsOnlyUsedModule${splitting ? "" : "NoSplitting"}`, {
      files: {
        "/node_modules/lib/package.json": JSON.stringify({ name: "lib", main: "lib.js", sideEffects: false }),
        "/node_modules/lib/lib.js": /* js */ `
          globalThis.effects.push('lib')
          export { value as value1 } from './dep1.js'
          export { value as value2 } from './dep2.js'
        `,
        "/node_modules/lib/dep1.js": /* js */ `
          globalThis.effects.push('dep1')
          export const value = 'dep1'
        `,
        "/node_modules/lib/dep2.js": /* js */ `
          globalThis.effects.push('dep2')
          export const value = 'dep2'
        `,
        "/setup.js": `globalThis.effects = []`,
        "/entry.js": /* js */ `
          import './setup.js'
          import { value1 } from 'lib'
          console.log(value1, JSON.stringify(globalThis.effects))
        `,
      },
      entryPoints: ["/entry.js"],
      splitting,
      outdir: "/out",
      format: "esm",
      run: { file: "/out/entry.js", stdout: `dep1 ["dep1","lib"]` },
    });
  }

  // Ported from Rollup's function/samples/tree-shake-module-side-effects-dependencies.
  itBundled("splitting/SideEffectFreeModuleKeepsImpureDependencyInLazyChunk", {
    files: {
      "/node_modules/lib/package.json": JSON.stringify({ name: "lib", main: "dep.js", sideEffects: ["./effect.js"] }),
      "/node_modules/lib/dep.js": /* js */ `
        import './effect.js'
        export const value = true
      `,
      "/node_modules/lib/effect.js": /* js */ `
        import { updateSharedValue } from './shared.js'
        updateSharedValue()
      `,
      "/node_modules/lib/shared.js": /* js */ `
        export let sharedValue = 'original'
        export function updateSharedValue() { sharedValue = 'updated' }
      `,
      "/entry.js": /* js */ `
        import('./lazy.js').then(m => m.run())
      `,
      "/lazy.js": /* js */ `
        import { value } from 'lib'
        import { sharedValue } from 'lib/shared.js'
        export function run() { console.log(value, sharedValue) }
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    run: { file: "/out/entry.js", stdout: "true updated" },
  });

  // Ported from Rolldown's tree_shaking/advanced_barrel_exports_bailout_dynamic_key.
  itBundled("splitting/SideEffectFreeBarrelNamespaceComputedKey", {
    files: {
      ...sideEffectFreeBarrel,
      "/entry.js": /* js */ `
        import * as pkg from 'pkg'
        console.log(pkg.A)
        import('./lazy.js').then(m => m.run('B'))
      `,
      "/lazy.js": /* js */ `
        import * as pkg from 'pkg'
        export function run(key) { console.log(pkg[key]) }
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    run: { file: "/out/entry.js", stdout: "AAAA\nBBBB_MARK" },
  });

  // Ported from Rolldown's tree_shaking/advanced_barrel_exports2.
  itBundled("splitting/SideEffectFreeRenamedNamespaceReExport", {
    files: {
      "/node_modules/pkg/package.json": JSON.stringify({ name: "pkg", main: "shared.js", sideEffects: false }),
      "/node_modules/pkg/a.js": /* js */ `
        export const c = 1000
        export const b = 500
        export const a = 100
      `,
      "/node_modules/pkg/c.js": `export * as c from './a.js'`,
      "/node_modules/pkg/shared.js": /* js */ `
        import { c } from './c.js'
        export { c as a }
      `,
      "/entry.js": /* js */ `
        import * as ns from 'pkg'
        console.log(ns.a.b)
        import('./lazy.js').then(m => m.run())
      `,
      "/lazy.js": /* js */ `
        import * as ns from 'pkg'
        export function run() { console.log(ns.a['a'], Object.keys(ns.a).sort().join()) }
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    run: { file: "/out/entry.js", stdout: "500\n100 a,b,c" },
  });

  // Ported from Rolldown's code_splitting/issue_8184.
  itBundled("splitting/StaticAndDynamicCycleAcrossTwoEntries", {
    files: {
      "/dbp-1.js": `import './a.js'`,
      "/dbp-activity-showcase.js": `import('./dbp-2.js').then(() => console.log('done'))`,
      "/dbp-2.js": `import './b.js'`,
      "/a.js": /* js */ `
        import './c.js'
        console.log('a')
      `,
      "/b.js": /* js */ `
        import './a.js'
        import './x.js'
        console.log('b')
      `,
      "/c.js": /* js */ `
        import('./a.js')
        console.log('c')
      `,
      "/x.js": /* js */ `
        console.log('x')
        module.exports = 42
      `,
    },
    entryPoints: ["/dbp-1.js", "/dbp-activity-showcase.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    run: [
      { file: "/out/dbp-1.js", stdout: "c\na" },
      { file: "/out/dbp-activity-showcase.js", stdout: "c\na\nx\nb\ndone" },
    ],
  });

  // Ported from Rolldown's code_splitting/issue_5276_2.
  itBundled("splitting/NamespaceImportAndDynamicImportOfSameModule", {
    files: {
      "/entry.js": /* js */ `
        import * as ns from './imp.js'
        console.log(ns.imp2, ns.imp22)
        import('./imp.js').then(m => console.log(m.imp22))
      `,
      "/imp.js": /* js */ `
        export const imp2 = 2
        export const imp22 = 22
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    run: { file: "/out/entry.js", stdout: "2 22\n22" },
  });

  // Ported from Rolldown's tree_shaking/unused_dynamic_imported_chunk.
  itBundled("splitting/SideEffectFreeModuleDynamicImportInLiveFunction", {
    files: {
      "/node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "index.js", sideEffects: false }),
      "/node_modules/dep/index.js": /* js */ `
        export async function loadTS() { return import('./dynamic.js') }
      `,
      "/node_modules/dep/dynamic.js": /* js */ `
        console.log('dynamic')
        export const ok = 'OK'
      `,
      "/entry.js": /* js */ `
        import { loadTS } from 'dep'
        console.log('entry')
        loadTS().then(m => console.log(m.ok))
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsOutputs(api)).toEqual(["dynamic.js", "entry.js"]);
      api.expectFile("/out/entry.js").not.toContain('"OK"');
      expect(jsOutput(api, "dynamic")).toContain('"OK"');
    },
    run: { file: "/out/entry.js", stdout: "entry\ndynamic\nOK" },
  });

  // The chunks an output file imports, in statement order.
  const chunkImportsIn = (api: BundlerTestBundleAPI, name: string) =>
    [...api.readFile("/out/" + name).matchAll(/^import\b[^;]*?"\.\/([^"]+)";$/gms)].map(m => m[1]);

  // Two shared chunks are imported in the order the entry first reaches
  // them, not in chunk index order.
  itBundled("splitting/EvaluationOrderOfSharedChunkImports", {
    files: {
      "/e1.js": /* js */ `
        import { b } from './b.js'
        import { a } from './a.js'
        console.log('e1', a + b, JSON.stringify(globalThis.log))
      `,
      "/e2.js": /* js */ `
        import { a } from './a.js'
        console.log('e2', a)
      `,
      "/e3.js": /* js */ `
        import { b } from './b.js'
        console.log('e3', b)
      `,
      "/a.js": /* js */ `
        (globalThis.log ||= []).push('a')
        export const a = 'a'
      `,
      "/b.js": /* js */ `
        (globalThis.log ||= []).push('b')
        export const b = 'b'
      `,
    },
    entryPoints: ["/e1.js", "/e2.js", "/e3.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      // Three entries and a chunk each for a.js and b.js; nothing had to be cut.
      expect(jsFilesIn(api)).toHaveLength(5);
      const imports = chunkImportsIn(api, "e1.js");
      expect(imports).toHaveLength(2);
      expect(api.readFile("/out/" + imports[0])).toContain('push("b")');
      expect(api.readFile("/out/" + imports[1])).toContain('push("a")');
    },
    run: { file: "/out/e1.js", stdout: 'e1 ab ["b","a"]' },
  });

  // import() of another chunk is printed as import(); it does not pull the
  // runtime's __require into the bundle.
  itBundled("splitting/DynamicImportDoesNotNeedRequireShim", {
    files: {
      "/entry.js": /* js */ `
        import('./lazy.js').then(m => console.log(m.default))
      `,
      "/lazy.js": /* js */ `
        export default 'lazy'
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    target: "browser",
    onAfterBundle(api) {
      expect(jsFilesIn(api)).toHaveLength(2);
      for (const f of jsFilesIn(api)) api.expectFile("/out/" + f).not.toContain("require");
    },
    run: { file: "/out/entry.js", stdout: "lazy" },
  });

  // A chunk shared only by lazy modules must stay lazy: folding it anywhere
  // would make the entry (or one of the lazy modules) load it early.
  itBundled("splitting/MinChunkSizeKeepsLazyOnlySharedChunk", {
    files: {
      "/entry.js": /* js */ `
        console.log('entry')
        import('./a.js').then(m => m.a()).then(() => import('./b.js')).then(m => m.b())
      `,
      "/a.js": /* js */ `
        import { common } from './common.js'
        export function a() { console.log('a', common) }
      `,
      "/b.js": /* js */ `
        import { common } from './common.js'
        export function b() { console.log('b', common) }
      `,
      "/common.js": /* js */ `
        console.log('common evaluated')
        export const common = 'c'
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    minChunkSize: 1024 * 1024,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsFilesIn(api)).toHaveLength(4);
      api.expectFile("/out/entry.js").not.toContain("common evaluated");
    },
    run: { file: "/out/entry.js", stdout: "entry\ncommon evaluated\na c\nb c" },
  });

  // `b` is only ever loaded through `a`, so code shared by exactly {a, b} is
  // always loaded together with `a`'s own chunk — but `a` has exports, and
  // folding into it would add `helper` to what `import('./a.js')` resolves
  // to, so the shared chunk stays.
  itBundled("splitting/MinChunkSizeFoldsNestedLazyShared", {
    files: {
      "/entry.js": /* js */ `
        console.log('entry')
        import('./a.js').then(m => m.a())
      `,
      "/a.js": /* js */ `
        import { helper } from './helper.js'
        export function a() {
          console.log('a', helper())
          return import('./b.js').then(m => m.b())
        }
      `,
      "/b.js": /* js */ `
        import { helper } from './helper.js'
        export function b() { console.log('b', helper()) }
      `,
      "/helper.js": /* js */ `
        export function helper() { return 'h' }
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    minChunkSize: 1024 * 1024,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsFilesIn(api)).toHaveLength(4);
      api.expectFile("/out/entry.js").not.toContain("helper");
      expect(jsOutput(api, "b")).not.toMatch(/from "\.\/a-[a-z0-9]{8}\.js"/);
    },
    run: { file: "/out/entry.js", stdout: "entry\na h\nb h" },
  });

  // With two user entries that both `import()` the same module, code shared
  // by {entry1, lazy} must not fold into entry1: entry2 can load `lazy`
  // without ever running entry1. Its top-level side effect also keeps it out
  // of the chunk all three entries load.
  itBundled("splitting/MinChunkSizeKeepsSharedWithSeparateEntry", {
    files: {
      "/entry1.js": /* js */ `
        import { shared } from './shared.js'
        console.log('entry1', shared())
        import('./lazy.js').then(m => console.log('lazy', m.lazy()))
      `,
      "/entry2.js": /* js */ `
        console.log('entry2')
        import('./lazy.js').then(m => console.log('lazy', m.lazy()))
      `,
      "/lazy.js": /* js */ `
        import { shared } from './shared.js'
        export function lazy() { return shared() + 1 }
      `,
      "/shared.js": /* js */ `
        console.log('shared evaluated')
        export function shared() { return 41 }
      `,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    splitting: true,
    minChunkSize: 1024 * 1024,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      // entry1, entry2, lazy, the {entry1, lazy} chunk, and the {entry1, entry2} modulepreload runtime.
      expect(jsFilesIn(api)).toHaveLength(5);
      expect(jsOutput(api, "lazy")).not.toContain('from "./entry1.js"');
    },
    run: [
      { file: "/out/entry1.js", stdout: "shared evaluated\nentry1 41\nlazy 42" },
      { file: "/out/entry2.js", stdout: "entry2\nshared evaluated\nlazy 42" },
    ],
  });

  // A chunk with no top-level side effects may fold into a chunk loaded by a
  // superset of its entries (here: the common.js chunk every entry loads, so
  // entry1 carries an unused function); one with side effects may not.
  itBundled("splitting/MinChunkSizeFoldsPureChunkIntoSuperset", {
    files: {
      "/entry1.js": /* js */ `
        import './common.js'
        import { impure } from './impure.js'
        console.log('entry1', impure())
        import('./lazy.js').then(m => console.log('lazy', m.lazy()))
      `,
      "/entry2.js": /* js */ `
        import './common.js'
        import { pure } from './pure.js'
        console.log('entry2', pure())
        import('./lazy.js').then(m => console.log('lazy', m.lazy()))
      `,
      "/lazy.js": /* js */ `
        import './common.js'
        import { pure } from './pure.js'
        import { impure } from './impure.js'
        export function lazy() { return pure() + impure() }
      `,
      "/common.js": /* js */ `
        console.log('common evaluated')
      `,
      "/pure.js": /* js */ `
        export function pure() { return 40 }
      `,
      // Padded: what an entry may gain from such folds is a small fraction of
      // the source it already loads, and entry1 must afford pure.js.
      "/impure.js": /* js */ `
        console.log('impure evaluated')
        export function impure() { return 2 }
        // ${Buffer.alloc(8 * 1024, "padding ").toString()}
      `,
    },
    entryPoints: ["/entry1.js", "/entry2.js"],
    splitting: true,
    minChunkSize: 1024 * 1024,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      // entry1, entry2, lazy, the {entry1, lazy} chunk holding impure.js, and
      // the common.js chunk every entry loads, now also holding pure.js
      // (formerly its own {entry2, lazy} chunk).
      expect(jsFilesIn(api)).toHaveLength(5);
      const pureChunk = jsFilesIn(api).find(f => api.readFile("/out/" + f).includes("return 40"))!;
      api.expectFile("/out/" + pureChunk).toContain("common evaluated");
      api.expectFile("/out/" + pureChunk).not.toContain("impure evaluated");
      api.expectFile("/out/entry1.js").toContain(`"./${pureChunk}"`);
    },
    run: [
      { file: "/out/entry1.js", stdout: "common evaluated\nimpure evaluated\nentry1 2\nlazy 42" },
      { file: "/out/entry2.js", stdout: "common evaluated\nentry2 40\nimpure evaluated\nlazy 42" },
    ],
  });

  // The folded code is exported from the entry chunk for the lazy chunk to
  // import; those aliases must not collide with the entry's own exports.
  itBundled("splitting/MinChunkSizeEntryExportAliasCollision", {
    files: {
      "/entry.js": /* js */ `
        import { shared } from './shared.js'
        export { shared }
        export const lazy = import('./lazy.js').then(m => m.lazy())
      `,
      "/lazy.js": /* js */ `
        import { shared } from './shared.js'
        export function lazy() { return shared() + 1 }
      `,
      "/shared.js": /* js */ `
        export function shared() { return 41 }
      `,
      "/run.js": /* js */ `
        import { shared, lazy } from './out/entry.js'
        console.log(shared(), await lazy)
      `,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    minChunkSize: 1024,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      // entry.js exports `shared` itself, so nothing folds into it.
      expect(jsFilesIn(api)).toHaveLength(3);
    },
    run: { file: "/run.js", stdout: "41 42" },
  });

  // A user entry point that is also import()ed is still a process root:
  // nothing is guaranteed to be loaded before it, so the {main, d} chunk is
  // not "always loaded with main" and must not fold into main.js.
  itBundled("splitting/MinChunkSizeKeepsImportedUserEntryAsRoot", {
    files: {
      "/main.js": /* js */ `
        import { shared } from './shared.js'
        console.log('main', shared())
        import('./b.js')
      `,
      "/b.js": /* js */ `
        console.log('b')
        import('./d.js').then(m => console.log('d', m.d()))
      `,
      "/d.js": /* js */ `
        import { shared } from './shared.js'
        export function d() { return shared() + 1 }
      `,
      "/shared.js": /* js */ `
        export function shared() { return 41 }
      `,
    },
    entryPoints: ["/main.js", "/b.js"],
    splitting: true,
    minChunkSize: 1024,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      // main, b, d, the {main, d} chunk holding shared.js, and the {main, b} modulepreload runtime.
      expect(jsFilesIn(api)).toHaveLength(5);
      api.expectFile("/out/main.js").not.toContain("41");
      expect(jsOutput(api, "d")).not.toContain('from "./main.js"');
    },
    run: { file: "/out/b.js", stdout: "b\nd 42" },
  });

  // `cmd` is import()ed from main and from `sub`, which only repl loads, so
  // whichever way it loads, main or repl came first: the {main, repl, cmd}
  // chunk is loaded exactly when the {main, repl} chunk is and folds into it,
  // even though no single entry precedes `cmd` on every path.
  itBundled("splitting/FoldsChunkWhoseImportersTheKeyCovers", {
    files: {
      "/main.js": /* js */ `
        import { shared } from './shared.js'
        import { common } from './common.js'
        console.log('main', shared(), common())
        import('./cmd.js').then(m => console.log('cmd', m.cmd()))
      `,
      "/repl.js": /* js */ `
        import { shared } from './shared.js'
        import { common } from './common.js'
        console.log('repl', shared(), common())
        import('./sub.js')
      `,
      "/sub.js": /* js */ `
        console.log('sub')
        import('./cmd.js').then(m => console.log('cmd', m.cmd()))
      `,
      "/cmd.js": /* js */ `
        import { shared } from './shared.js'
        export function cmd() { return shared() + 1 }
      `,
      "/shared.js": /* js */ `
        console.log('shared evaluated')
        export function shared() { return 41 }
      `,
      "/common.js": /* js */ `
        export function common() { return 'common' }
      `,
    },
    entryPoints: ["/main.js", "/repl.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      // main, repl, sub, cmd, and one {main, repl} chunk holding common.js
      // and shared.js.
      expect(jsFilesIn(api)).toHaveLength(5);
      const sharedChunk = chunkContaining(api, "shared evaluated");
      api.expectFile("/out/" + sharedChunk).toContain("common");
      expect(jsOutput(api, "cmd")).toContain(`from "./${sharedChunk}"`);
    },
    run: [
      { file: "/out/main.js", stdout: "shared evaluated\nmain 41 common\ncmd 42" },
      { file: "/out/repl.js", stdout: "shared evaluated\nrepl 41 common\nsub\ncmd 42" },
    ],
  });

  // Lazy modules that import() each other: `d` is only reached through `x`,
  // which `main` or `y` loads, and `y` only through `x`, so `main` always
  // comes first and the {main, d} chunk folds into main.js.
  itBundled("splitting/FoldsChunkBehindDynamicImportCycle", {
    files: {
      "/main.js": /* js */ `
        import { shared } from './shared.js'
        console.log('main', shared())
        import('./x.js')
      `,
      "/x.js": /* js */ `
        console.log('x')
        export const y = () => import('./y.js')
        import('./d.js').then(m => console.log('d', m.d()))
      `,
      "/y.js": /* js */ `
        export const x = () => import('./x.js')
      `,
      "/d.js": /* js */ `
        import { shared } from './shared.js'
        export function d() { return shared() + 1 }
      `,
      "/shared.js": /* js */ `
        export function shared() { return 41 }
      `,
    },
    entryPoints: ["/main.js"],
    splitting: true,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsOutputs(api)).toEqual(["d.js", "main.js", "x.js", "y.js"]);
      api.expectFile("/out/main.js").toContain("41");
      expect(jsOutput(api, "d")).toContain('from "./main.js"');
    },
    run: { file: "/out/main.js", stdout: "main 41\nx\nd 42" },
  });

  // Folding a chunk with side effects into a pure one (rule 1) makes the
  // result impure, so it may not then move into a superset chunk (rule 2).
  itBundled("splitting/MinChunkSizeFoldedImpurityBlocksSupersetFold", {
    files: {
      "/a.js": /* js */ `
        import { kx } from './px.js'
        import { my } from './my.js'
        import { big } from './big.js'
        console.log('a', kx + my + big.length)
        import('./x.js')
        import('./y.js')
      `,
      "/b.js": /* js */ `
        import { kx } from './px.js'
        import { my } from './my.js'
        import { big } from './big.js'
        console.log('b', kx + my + big.length)
      `,
      "/c.js": /* js */ `
        import { big } from './big.js'
        console.log('c', big.length)
      `,
      "/x.js": /* js */ `
        import { kx } from './px.js'
        import { big } from './big.js'
        console.log('x', kx + big.length)
      `,
      "/y.js": /* js */ `
        import { my } from './my.js'
        console.log('y', my)
      `,
      // Larger than my.js so it is the class parent the side effect folds into.
      "/px.js": /* js */ `
        export const kx = 1 // ${Buffer.alloc(100, "p").toString()}
      `,
      "/my.js": /* js */ `
        console.log('my.js side effect')
        export const my = 2
      `,
      "/big.js": /* js */ `
        export const big = "${Buffer.alloc(20000, "x").toString()}"
      `,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    splitting: true,
    minChunkSize: 1024,
    outdir: "/out",
    format: "esm",
    run: { file: "/out/c.js", stdout: "c 20000" },
  });

  // A static import of a CommonJS module is a top-level require_lib() call
  // in the importer. f.js may still move into g.js's chunk: that chunk
  // imports main.js, which has already made the call by then, so repeating it
  // does nothing.
  itBundled("splitting/MinChunkSizeFoldsImporterOfInitializedWrappedModule", {
    files: {
      "/main.js": /* js */ `
        import lib from './lib.cjs'
        import { shared } from './shared.js'
        console.log('main', shared.length + lib.v)
        const routes = { a: () => import('./a.js'), b: () => import('./b.js'), c: () => import('./c.js') }
        if (process.argv[2]) routes[process.argv[2]]().then(m => console.log(m.default()))
      `,
      "/a.js": /* js */ `
        import { f } from './f.js'
        import { g } from './g.js'
        export default () => 'a ' + (f() + g())
      `,
      "/b.js": /* js */ `
        import { f } from './f.js'
        import { g } from './g.js'
        export default () => 'b ' + (f() + g())
      `,
      "/c.js": /* js */ `
        import { g } from './g.js'
        export default () => 'c ' + g()
      `,
      "/f.js": /* js */ `
        import lib from './lib.cjs'
        export const f = () => lib.v
      `,
      "/g.js": /* js */ `
        import { shared } from './shared.js'
        console.log('g evaluated')
        export const g = () => shared.length
      `,
      "/lib.cjs": /* js */ `
        console.log('lib evaluated')
        module.exports = { v: 1 }
      `,
      "/shared.js": /* js */ `
        export const shared = "${Buffer.alloc(20000, "x").toString()}"
      `,
    },
    entryPoints: ["/main.js"],
    splitting: true,
    minChunkSize: 1024,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      // main, a, b, c and g.js's chunk, now holding f.js.
      expect(jsFilesIn(api)).toHaveLength(5);
      api.expectFile("/out/" + chunkContaining(api, "g evaluated")).toContain("var f = ");
    },
    run: [
      { file: "/out/main.js", stdout: "lib evaluated\nmain 20001" },
      { file: "/out/main.js", args: ["a"], stdout: "lib evaluated\nmain 20001\ng evaluated\na 20001" },
    ],
  });

  // c.js moves into t.js's chunk as above. r1 imports c.js, then x.js, then
  // t.js: c.js's require_lib() call (a no-op there) must not pull the whole
  // t.js chunk, and its side effect, ahead of x.js's chunk.
  itBundled("splitting/MinChunkSizeHoistedRequireKeepsChunkOrder", {
    files: {
      "/main.js": /* js */ `
        import lib from './lib.cjs'
        import { shared } from './shared.js'
        console.log('main', shared.length + lib.v)
        const routes = { r1: () => import('./r1.js'), r2: () => import('./r2.js'), r3: () => import('./r3.js') }
        if (process.argv[2]) routes[process.argv[2]]()
      `,
      "/r1.js": /* js */ `
        import { c } from './c.js'
        import './x.js'
        import { t } from './t.js'
        console.log('r1', c() + t)
      `,
      "/r2.js": /* js */ `
        import { c } from './c.js'
        import { t } from './t.js'
        console.log('r2', c() + t)
      `,
      "/r3.js": /* js */ `
        import './x.js'
        import { t } from './t.js'
        console.log('r3', t)
      `,
      "/c.js": /* js */ `
        import lib from './lib.cjs'
        export const c = () => lib.v
      `,
      "/x.js": `console.log('x')`,
      "/t.js": /* js */ `
        import { shared } from './shared.js'
        console.log('t evaluated')
        export const t = shared.length
      `,
      "/lib.cjs": /* js */ `
        console.log('lib evaluated')
        module.exports = { v: 1 }
      `,
      "/shared.js": /* js */ `
        export const shared = "${Buffer.alloc(20000, "x").toString()}"
      `,
    },
    entryPoints: ["/main.js"],
    splitting: true,
    minChunkSize: 1024,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      // main, r1, r2, r3, x.js's chunk and t.js's chunk, now holding c.js.
      expect(jsFilesIn(api)).toHaveLength(6);
      api.expectFile("/out/" + chunkContaining(api, "t evaluated")).toContain("var c = ");
    },
    run: { file: "/out/main.js", args: ["r1"], stdout: "lib evaluated\nmain 20001\nx\nt evaluated\nr1 20001" },
  });

  // Here nothing main.js loads initializes lib.cjs, so moving f.js (and its
  // require_lib() call) into main.js would run lib.cjs at startup.
  itBundled("splitting/MinChunkSizeKeepsFirstInitializerOfWrappedModule", {
    files: {
      "/main.js": /* js */ `
        import { shared } from './shared.js'
        console.log('main', shared.length)
        const routes = { a: () => import('./a.js'), b: () => import('./b.js') }
        if (process.argv[2]) routes[process.argv[2]]().then(m => console.log(m.default()))
      `,
      "/a.js": /* js */ `
        import { f } from './f.js'
        export default () => 'a ' + f()
      `,
      "/b.js": /* js */ `
        import { f } from './f.js'
        export default () => 'b ' + f()
      `,
      "/f.js": /* js */ `
        import lib from './lib.cjs'
        export const f = () => lib.v
      `,
      "/lib.cjs": /* js */ `
        console.log('lib evaluated')
        module.exports = { v: 1 }
      `,
      "/shared.js": /* js */ `
        export const shared = "${Buffer.alloc(20000, "x").toString()}"
      `,
    },
    entryPoints: ["/main.js"],
    splitting: true,
    minChunkSize: 1024 * 1024,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsFilesIn(api)).toHaveLength(4);
      api.expectFile("/out/main.js").not.toContain("lib evaluated");
    },
    run: [
      { file: "/out/main.js", stdout: "main 20000" },
      { file: "/out/main.js", args: ["b"], stdout: "main 20000\nlib evaluated\nb 1" },
    ],
  });

  // Off unless asked for, on every target; `minChunkSize: 0` is the same as
  // leaving it out.
  for (const [name, options, outputs] of [
    ["Browser", {}, 4],
    ["BrowserZero", { minChunkSize: 0 }, 4],
    ["BrowserOn", { minChunkSize: 16 * 1024 }, 3],
    ["Bun", { target: "bun" }, 4],
    ["BunOn", { target: "bun", minChunkSize: 16 * 1024 }, 3],
    ["Node", { target: "node" }, 4],
  ] as const) {
    itBundled("splitting/MinChunkSizeDefault" + name, {
      files: {
        "/main.js": /* js */ `
          import { shared } from './shared.js'
          console.log('main', shared.length)
          const routes = { a: () => import('./a.js'), b: () => import('./b.js') }
          if (process.argv[2]) routes[process.argv[2]]().then(m => console.log(m.default()))
        `,
        "/a.js": /* js */ `
          import { f } from './f.js'
          export default () => 'a ' + f()
        `,
        "/b.js": /* js */ `
          import { f } from './f.js'
          export default () => 'b ' + f()
        `,
        "/f.js": /* js */ `
          export const f = () => 1
        `,
        "/shared.js": /* js */ `
          export const shared = "${Buffer.alloc(20000, "x").toString()}"
        `,
      },
      entryPoints: ["/main.js"],
      splitting: true,
      outdir: "/out",
      format: "esm",
      ...options,
      onAfterBundle(api) {
        expect(jsFilesIn(api)).toHaveLength(outputs);
      },
      run: { file: "/out/main.js", args: ["a"], stdout: "main 20000\na 1" },
    });
  }

  // pkg's barrel stays live (`export *`) inside entry.js and has import
  // records for b.js and b2.js, which only lazy routes use. Those records print
  // nothing and must not count as entry.js importing the b.js chunks: if they
  // did, c.js (which does import them) could move into entry.js, entry.js
  // would import the b.js chunk, and that chunk imports require_lib from
  // entry.js — a static cycle that reads require_lib before it is assigned.
  itBundled("splitting/MinChunkSizeBarrelRecordIsNotAnImport", {
    files: {
      "/entry.js": /* js */ `
        import lib from "lib"
        import { A } from "pkg"
        import { big } from "./big.js"
        console.log("entry", A, lib.v, big.length)
        if (process.argv[2] === "r1") import("./r1.js")
        if (process.argv[2] === "all") [import("./r2.js"), import("./r3.js"), import("./r4.js")]
      `,
      "/big.js": `export const big = "${Buffer.alloc(40000, "x").toString()}"`,
      "/c.js": /* js */ `
        import { B, B2 } from "pkg"
        export const c = () => B + B2
      `,
      "/r1.js": `import { c } from "./c.js"; console.log("r1", c())`,
      "/r2.js": `import { c } from "./c.js"; console.log("r2", c())`,
      "/r3.js": `import { B } from "pkg"; console.log("r3", B)`,
      "/r4.js": `import { B2 } from "pkg"; console.log("r4", B2)`,
      "/node_modules/pkg/package.json": JSON.stringify({ name: "pkg", main: "index.js", sideEffects: false }),
      "/node_modules/pkg/index.js": /* js */ `
        export * from "./star.js"
        export { A } from "./a.js"
        export { B } from "./b.js"
        export { B2 } from "./b2.js"
      `,
      "/node_modules/pkg/star.js": `export const S = 1`,
      "/node_modules/pkg/a.js": `export const A = "A"`,
      // A top-level require() runs lib, so these chunks have a side effect and
      // may only be imported where they already were.
      "/node_modules/pkg/b.js": `const lib = require("lib"); export const B = lib.v`,
      "/node_modules/pkg/b2.js": `const lib = require("lib"); export const B2 = lib.w`,
      "/node_modules/lib/package.json": JSON.stringify({ name: "lib", main: "index.js" }),
      "/node_modules/lib/index.js": `module.exports = { v: 1, w: 2 }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    minChunkSize: 1024,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      // entry, r1..r4, and the c.js, b.js and b2.js chunks.
      expect(jsFilesIn(api)).toHaveLength(8);
      expect(api.readFile("/out/entry.js")).not.toMatch(/^import /m);
    },
    run: { file: "/out/entry.js", args: ["r1"], stdout: "entry A 1 40000\nr1 3" },
  });

  // An entry point runs its own code when loaded, so its chunk never moves,
  // whatever it imports.
  itBundled("splitting/MinChunkSizeKeepsImporterOfWrappedModule", {
    files: {
      "/main.js": /* js */ `
        import { shared } from './shared.js'
        console.log('main', shared.length)
        import('./lazy.js').then(m => console.log('lazy', m.f()))
      `,
      "/lazy.js": /* js */ `
        import lib from './lib.cjs'
        import { shared } from './shared.js'
        export const f = () => shared.length + lib.v
      `,
      "/lib.cjs": /* js */ `
        console.log('lib evaluated')
        module.exports = { v: 1 }
      `,
      "/shared.js": /* js */ `
        export const shared = "${Buffer.alloc(20000, "x").toString()}"
      `,
    },
    entryPoints: ["/main.js"],
    splitting: true,
    minChunkSize: 1024,
    outdir: "/out",
    format: "esm",
    run: { file: "/out/main.js", stdout: "main 20000\nlib evaluated\nlazy 20001" },
  });

  // The {x, y} chunk (c0.js, c.js) folds into q.js's {x, y, z, w} chunk and
  // takes d.js's {x, y, z} chunk along as a new import of it, so d.js is then
  // loaded wherever q.js is and folds there too; nothing may land in main.js,
  // which must not run q.js's side effect at startup.
  itBundled("splitting/MinChunkSizeTracksLoadConditionsAcrossFolds", {
    files: {
      "/main.js": /* js */ `
        import { mxy } from './mxy.js'
        console.log('main', mxy.length)
        if (process.argv[2]) {
          import('./x.js'); import('./y.js'); import('./z.js'); import('./w.js')
        }
      `,
      // c0.js is visited before c.js, so the {x, y} chunk is a candidate
      // before d.js's {x, y, z} chunk is.
      "/x.js": /* js */ `
        import { c0 } from './c0.js'
        import { mxy } from './mxy.js'
        import { c } from './c.js'
        import { q } from './q.js'
        console.log('x', mxy.length, c() + c0(), q)
      `,
      "/y.js": /* js */ `
        import { c0 } from './c0.js'
        import { mxy } from './mxy.js'
        import { c } from './c.js'
        import { q } from './q.js'
        console.log('y', mxy.length, c() + c0(), q)
      `,
      "/z.js": /* js */ `
        import { zd } from './zd.js'
        import { q } from './q.js'
        console.log('z', zd(), q)
      `,
      "/w.js": /* js */ `
        import { q } from './q.js'
        console.log('w', q)
      `,
      "/c0.js": /* js */ `
        export function c0() { return 0 }
      `,
      "/c.js": /* js */ `
        import { d } from './d.js'
        export function c() { return d() + 1 }
      `,
      "/zd.js": /* js */ `
        import { d } from './d.js'
        export function zd() { return d() + 2 }
      `,
      "/d.js": /* js */ `
        export function d() { return 1 }
      `,
      "/mxy.js": /* js */ `
        export const mxy = "${Buffer.alloc(12000, "x").toString()}"
      `,
      "/q.js": /* js */ `
        console.log('q evaluated')
        export const q = "${Buffer.alloc(8000, "q").toString()}".length
      `,
    },
    entryPoints: ["/main.js"],
    splitting: true,
    minChunkSize: 1024,
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      // main (with mxy.js), x, y, z, w and the q.js chunk holding c0, c and d.
      expect(jsFilesIn(api)).toHaveLength(6);
      const q = chunkContaining(api, "q evaluated");
      for (const f of ["c0", "c", "d"]) api.expectFile("/out/" + q).toContain(`function ${f}()`);
      api.expectFile("/out/main.js").not.toContain("q evaluated");
    },
    run: { file: "/out/main.js", stdout: "main 12000" },
  });

  // Import attributes describe the source file; once the target is a chunk
  // they are dropped (an external target keeps them).
  itBundled("splitting/DynamicImportAttributesDroppedForChunk", {
    files: {
      "/entry.js": /* js */ `
        const { default: d } = await import("./d.json", { with: { type: "json" } });
        const ext = import("./ext.json", { with: { type: "json" } }).catch(() => {});
        console.log(d.k);
      `,
      "/d.json": `{ "k": "v" }`,
    },
    external: ["./ext.json"],
    splitting: true,
    format: "esm",
    outdir: "/out",
    run: { file: "/out/entry.js", stdout: "v" },
    onAfterBundle(api) {
      const entry = api.readFile("/out/entry.js");
      expect(entry).toMatch(/import\("\.\/d-[a-z0-9]+\.js"\)/);
      expect(entry).toMatch(/import\("\.\/ext\.json", \{\s*with: \{\s*type: "json"/);
    },
  });

  // With target bun, a require() of a bundled ES module becomes a chunk of its
  // own, loaded synchronously with import.meta.require() when the call runs.
  const splitRequireFiles = {
    "/main.ts": /* ts */ `
      import { getTool } from './registry.ts'
      console.log("main")
      console.log(getTool().name)
    `,
    "/registry.ts": /* ts */ `
      export function getTool() {
        return require('./tool.ts').Tool
      }
    `,
    "/tool.ts": /* ts */ `
      import { helper } from './helper.ts'
      console.log("tool evaluated")
      export const Tool = { name: "tool:" + helper() }
    `,
    "/helper.ts": /* ts */ `
      export function helper() { return "helped" }
    `,
  };

  const toolChunk = (api: BundlerTestBundleAPI) => chunkContaining(api, "tool evaluated");

  for (const backend of ["cli", "api"] as const) {
    itBundled(`splitting/SplitRequireEmitsChunk-${backend}`, {
      files: splitRequireFiles,
      entryPoints: ["/main.ts"],
      splitting: true,
      target: "bun",
      outdir: "/out",
      format: "esm",
      metafile: true,
      backend,
      assertNotPresent: { "/out/main.js": "tool evaluated" },
      onAfterBundle(api) {
        const chunk = toolChunk(api);
        api.expectFile("/out/main.js").toContain(`import.meta.require("./${chunk}")`);
        const metafile = JSON.parse(api.readFile("/metafile.json"));
        const output = (name: string) =>
          Object.entries<any>(metafile.outputs).find(([k]) => k.endsWith("/" + name))![1];
        expect(output("main.js").imports.map((i: any) => i.kind)).toEqual(["require-call"]);
        expect(output("main.js").imports[0].path.endsWith("/" + chunk)).toBe(true);
        expect(Object.keys(output(chunk).inputs).some(k => k.endsWith("tool.ts"))).toBe(true);
      },
      run: { file: "/out/main.js", stdout: "main\ntool evaluated\ntool:helped" },
    });
  }

  itBundled("splitting/SplitRequireOffKeepsWrapper", {
    files: splitRequireFiles,
    entryPoints: ["/main.ts"],
    splitting: true,
    splitRequire: false,
    target: "bun",
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsFilesIn(api)).toEqual(["main.js"]);
      api.expectFile("/out/main.js").not.toContain("import.meta.require");
    },
    run: { file: "/out/main.js", stdout: "main\ntool evaluated\ntool:helped" },
  });

  // The require() is inside a function that tree shaking removes: no chunk,
  // the same as a dead import().
  itBundled("splitting/SplitRequireDeadTargetGetsNoChunk", {
    files: {
      ...splitRequireFiles,
      "/main.ts": /* ts */ `
        import { getTool } from './registry.ts'
        if (FEATURE_TOOL) console.log(getTool().name)
        console.log("main")
      `,
    },
    entryPoints: ["/main.ts"],
    splitting: true,
    target: "bun",
    outdir: "/out",
    format: "esm",
    define: { FEATURE_TOOL: "false" },
    onAfterBundle(api) {
      expect(jsFilesIn(api)).toEqual(["main.js"]);
      api.expectFile("/out/main.js").not.toContain("tool evaluated");
    },
    run: { file: "/out/main.js", stdout: "main" },
  });

  // A CommonJS target keeps the in-chunk wrapper: require() must keep
  // returning module.exports, not a namespace.
  itBundled("splitting/SplitRequireLeavesCommonJSTargetInline", {
    files: {
      "/main.ts": /* ts */ `
        console.log(require('./cjs.js').value, require('./cjs.js')())
      `,
      "/cjs.js": /* js */ `
        module.exports = function () { return "called" }
        module.exports.value = "cjs value"
      `,
    },
    entryPoints: ["/main.ts"],
    splitting: true,
    target: "bun",
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsFilesIn(api)).toEqual(["main.js"]);
    },
    run: { file: "/out/main.js", stdout: "cjs value called" },
  });

  // A split require() of a lifted `module.exports = require()` file that the
  // linker wraps again because its target is CommonJS: the chunk's only
  // export is `default: module.exports`, so the call reads `.default` and
  // returns `module.exports`, not the chunk namespace.
  // https://github.com/oven-sh/bun/issues/41236
  itBundled("splitting/SplitRequireOfRewrappedLiftedCommonJS#41236", {
    files: {
      "/main.ts": /* ts */ `
        let m;
        try {
          m = require("react-dom");
        } catch {}
        console.log(typeof m, m.version, m.default());
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
    entryPoints: ["/main.ts"],
    splitting: true,
    target: "bun",
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      const chunk = chunkContaining(api, "side effect");
      api.expectFile("/out/main.js").toContain(`import.meta.require("./${chunk}").default`);
    },
    run: { file: "/out/main.js", stdout: "side effect\nobject 19.0.0 rendered" },
  });

  // When the lift target is itself lifted, the chunk stays an ES module and
  // the split require() returns its namespace with no `.default` read.
  itBundled("splitting/SplitRequireOfLiftedCommonJSStaysEsm", {
    files: {
      "/main.ts": /* ts */ `
        let m;
        try {
          m = require("react-dom");
        } catch {}
        console.log(m.version, m.render());
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
    entryPoints: ["/main.ts"],
    splitting: true,
    target: "bun",
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      const chunk = chunkContaining(api, "side effect");
      api.expectFile("/out/main.js").toContain(`import.meta.require("./${chunk}")`);
      api.expectFile("/out/main.js").not.toContain(".default");
    },
    run: { file: "/out/main.js", stdout: "side effect\n19.0.0 rendered" },
  });

  // A top-level require() in a module that the required chunk imports back
  // (the registry ↔ tool shape): the chunk is evaluated while the entry is
  // still evaluating and sees the entry's hoisted functions through live
  // bindings, the same as the in-chunk wrapper did.
  itBundled("splitting/SplitRequireCycleDuringEvaluation", {
    files: {
      "/main.ts": /* ts */ `
        import { tools } from './registry.ts'
        console.log(tools.map(t => t.name).join(","))
      `,
      "/registry.ts": /* ts */ `
        export function buildTool(name: string) { return { name } }
        export const tools = [require('./tool.ts').Tool, require('./tool2.ts').Tool]
      `,
      "/tool.ts": /* ts */ `
        import { buildTool } from './registry.ts'
        export const Tool = buildTool("tool")
      `,
      "/tool2.ts": /* ts */ `
        import { buildTool } from './registry.ts'
        import { Tool as Other } from './tool.ts'
        export const Tool = buildTool("tool2-sees-" + Other.name)
      `,
    },
    entryPoints: ["/main.ts"],
    splitting: true,
    target: "bun",
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsFilesIn(api).length).toBeGreaterThan(1);
    },
    run: { file: "/out/main.js", stdout: "tool,tool2-sees-tool" },
  });

  // A file shared by the entry and a require()d chunk must not fold into the
  // entry chunk: the require() runs while the entry is still evaluating, so
  // code placed after the call site would be uninitialized when the chunk
  // reads it. An import() target, by contrast, only runs after the entry.
  itBundled("splitting/SplitRequireKeepsSharedCodeOutOfRequirer", {
    files: {
      "/main.ts": /* ts */ `
        import { tools } from './registry.ts'
        import { shared } from './shared.ts'
        console.log(tools[0].name, shared.name)
      `,
      "/registry.ts": /* ts */ `
        export const tools = [require('./tool.ts').Tool]
      `,
      "/tool.ts": /* ts */ `
        import { shared } from './shared.ts'
        export const Tool = { name: "tool:" + shared.name }
      `,
      "/shared.ts": /* ts */ `
        export const shared = { name: "shared" }
      `,
    },
    entryPoints: ["/main.ts"],
    splitting: true,
    target: "bun",
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      api.expectFile("/out/main.js").not.toContain('name: "shared"');
      api.expectFile("/out/" + chunkContaining(api, "tool:")).not.toContain('from "./main.js"');
    },
    run: { file: "/out/main.js", stdout: "tool:shared shared" },
  });

  // Browser-side files of a server build (an imported HTML page's scripts)
  // cannot call import.meta.require; their require() keeps the wrapper.
  itBundled("splitting/SplitRequireLeavesBrowserFilesOfServerBuildAlone", {
    files: {
      "/main.ts": /* ts */ `
        import page from './index.html'
        console.log(typeof page, require('./server-helper.ts').value)
      `,
      "/server-helper.ts": /* ts */ `export const value = "server"`,
      "/index.html": /* html */ `<script src="./client.ts"></script>`,
      "/client.ts": /* ts */ `console.log(require('./client-helper.ts').value)`,
      "/client-helper.ts": /* ts */ `export const value = "client"`,
    },
    entryPoints: ["/main.ts"],
    splitting: true,
    target: "bun",
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      api.expectFile("/out/main.js").toContain("import.meta.require(");
      const client = jsFilesIn(api).find(f => api.readFile("/out/" + f).includes('"client"'));
      expect(client).toBeDefined();
      api.expectFile("/out/" + client!).not.toContain("import.meta.require");
    },
  });

  // require() and import() of the same file share one chunk and one namespace.
  itBundled("splitting/SplitRequireSharesChunkWithDynamicImport", {
    files: {
      "/main.ts": /* ts */ `
        const sync = require('./tool.ts')
        import('./tool.ts').then(ns => console.log(ns === sync, ns.Tool === sync.Tool))
      `,
      "/tool.ts": /* ts */ `
        console.log("tool evaluated")
        export const Tool = { name: "tool" }
      `,
    },
    entryPoints: ["/main.ts"],
    splitting: true,
    target: "bun",
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      const chunk = toolChunk(api);
      api.expectFile("/out/main.js").toContain(`import.meta.require("./${chunk}")`);
      api.expectFile("/out/main.js").toContain(`import("./${chunk}")`);
    },
    run: { file: "/out/main.js", stdout: "tool evaluated\ntrue true" },
  });

  // Other targets cannot call import.meta.require: require() keeps the wrapper.
  itBundled("splitting/SplitRequireIsBunTargetOnly", {
    files: splitRequireFiles,
    entryPoints: ["/main.ts"],
    splitting: true,
    target: "node",
    outdir: "/out",
    format: "esm",
    onAfterBundle(api) {
      expect(jsFilesIn(api)).toEqual(["main.js"]);
      api.expectFile("/out/main.js").not.toContain("import.meta.require");
    },
    run: { file: "/out/main.js", stdout: "main\ntool evaluated\ntool:helped" },
  });

  // Browser ESM: every split `import()` first inserts <link rel=modulepreload>
  // for the chunks its target statically imports (transitively), so a deep
  // chunk chain downloads in parallel instead of one round trip per level.
  // `document` is shimmed; each appended link prints its file name.
  const preloadShim = /* js */ `
    globalThis.links = [];
    globalThis.document = {
      createElement: tag => ({ tag }),
      querySelector: () => null,
      head: {
        appendChild: link => {
          if (link.crossOrigin !== "") throw new Error("crossOrigin " + link.crossOrigin);
          if (link.nonce !== undefined) throw new Error("nonce " + link.nonce);
          links.push(link.rel + " " + String(link.href).split("/").pop());
        },
      },
    };
  `;
  // r0 -> a1 -> a2 -> ... -> aN; each aK also reached by route rK, so every aK is its own chunk.
  const preloadChainFiles = (n: number) => {
    const files: Record<string, string> = {
      "/r0.js": `import { a1 } from "./a1.js"; export default () => "r0:" + a1();`,
    };
    for (let i = 1; i <= n; i++) {
      files[`/r${i}.js`] = `import { a${i} } from "./a${i}.js"; export default () => "r${i}:" + a${i}();`;
      files[`/a${i}.js`] =
        (i < n ? `import { a${i + 1} } from "./a${i + 1}.js";\n` : "") +
        `export const a${i} = () => "a${i}" + ${i < n ? `a${i + 1}()` : `""`};`;
    }
    return files;
  };
  itBundled("splitting/ModulePreloadDynamicImportClosure", {
    files: {
      "/entry.js": /* js */ `
        const routes = [
          () => import("./r0.js"), () => import("./r1.js"), () => import("./r2.js"), () => import("./r3.js"),
          () => import("./r4.js"), () => import("./r5.js"), () => import("./r6.js"), () => import("./leaf.js"),
        ];
        export const nav = i => routes[i]();
      `,
      "/leaf.js": `export default () => "leaf"`,
      ...preloadChainFiles(6),
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    runtimeFiles: {
      "/test.js": /* js */ `
        ${preloadShim}
        const { nav } = await import("./out/entry.js");
        console.log("load", JSON.stringify(links));
        const pending = nav(0);
        // every chunk r0 reaches, before r0 itself has even been fetched
        console.log("nav", links.length, new Set(links).size);
        console.log((await pending).default());
        links.length = 0;
        await nav(3); // a3..a6 already preloaded
        await nav(7); // no static imports: nothing to do
        await nav(0);
        console.log("again", JSON.stringify(links));
      `,
      "/no-document.js": /* js */ `
        const { nav } = await import("./out/entry.js");
        console.log((await nav(0)).default(), (await nav(7)).default());
      `,
    },
    onAfterBundle(api) {
      const entry = api.readFile("/out/entry.js");
      expect(entry).toMatch(/^__chunks\(import\.meta\.url,\s*\[/m);
      expect(entry.match(/__preload\("(\w+)"\), import\("\.\/[^"]+-\1\.js"\)/g)).toHaveLength(8);
      // one chunk per aK: the chain really is 6 deep
      for (let i = 1; i < 6; i++) {
        expect(api.readFile("/out/" + chunkContaining(api, `"a${i}"`))).not.toContain(`"a${i + 1}"`);
      }
    },
    run: [
      { file: "/test.js", stdout: "load []\nnav 6 6\nr0:a1a2a3a4a5a6\nagain []" },
      { file: "/no-document.js", stdout: "r0:a1a2a3a4a5a6 leaf" },
    ],
  });
  itBundled("splitting/ModulePreloadSyntaxShapes", {
    files: {
      "/entry.js": /* js */ `
        const a = await import("./a.js");
        const { b } = await import("./b.js");
        const c = await import("./c.js").then(m => m.c);
        const d = () => import("./d.js");
        function e() { return import("./e.js") }
        const all = [import("./f.js"), \`\${import("./g.js")}\`];
        import("./h.js");
        console.log(a.a, b, c, (await d()).d, (await e()).e, (await all[0]).f, all[1]);
      `,
      ...Object.fromEntries("abcdefgh".split("").map(l => [`/${l}.js`, `export const ${l} = "${l}"`])),
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    minifySyntax: true,
    onAfterBundle(api) {
      expect(api.readFile("/out/entry.js").match(/__preload\("\w+"\), ?import\(/g)).toHaveLength(8);
    },
    run: { file: "/out/entry.js", stdout: "a b c d e f [object Promise]" },
  });
  itBundled("splitting/ModulePreloadMinifiedTwoEntriesOnePage", {
    files: {
      "/one.js": `globalThis.one = () => import("./r0.js")`,
      "/two.js": `globalThis.two = () => import("./r2.js")`,
      ...preloadChainFiles(3),
    },
    entryPoints: ["/one.js", "/two.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    minifyIdentifiers: true,
    minifyWhitespace: true,
    runtimeFiles: {
      "/test.js": /* js */ `
        ${preloadShim}
        await import("./out/one.js");
        await import("./out/two.js");
        const r2 = await two();
        console.log(links.length, r2.default());
        const r0 = await one();
        console.log(links.length, r0.default());
      `,
    },
    onAfterBundle(api) {
      for (const entry of ["one", "two"]) {
        expect(api.readFile(`/out/${entry}.js`)).not.toContain("__chunks");
        expect(api.readFile(`/out/${entry}.js`)).toMatch(/[$\w]+\(import\.meta\.url,\[/);
      }
    },
    // the {a2, a3} chunk is linked once, through two(); one() finds it already seen
    run: { file: "/test.js", stdout: "1 r2:a2a3\n1 r0:a1a2a3" },
  });
  itBundled("splitting/ModulePreloadPublicPathAndNestedEntry", {
    files: {
      "/pages/deep/entry.js": `export const nav = () => import("../../r0.js")`,
      "/other.js": `export const nav = () => import("./r2.js")`,
      ...preloadChainFiles(2),
    },
    entryPoints: ["/pages/deep/entry.js", "/other.js"],
    outputPaths: ["/out/pages/deep/entry.js", "/out/other.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    runtimeFiles: {
      "/test.js": /* js */ `
        ${preloadShim}
        document.head.appendChild = link => links.push(new URL(link.href).pathname);
        const { nav } = await import("./out/pages/deep/entry.js");
        await nav();
        // a2's chunk (shared with r2) sits at the outdir root, two levels up from the entry
        console.log(JSON.stringify(links.map(l => l.slice(l.lastIndexOf("/out/")).replace(/[^/]+$/, "X.js"))));
      `,
    },
    onAfterBundle(api) {
      // graph paths are relative to the registering chunk, like its imports
      expect(api.readFile("/out/pages/deep/entry.js")).toMatch(
        /__chunks\(import\.meta\.url,\[.*"\.\.\/\.\.\/r0-\w+\.js"/,
      );
    },
    run: { file: "/test.js", stdout: `["/out/X.js"]` },
  });
  itBundled("splitting/ModulePreloadAbsolutePublicPath", {
    files: {
      "/entry.js": `export const nav = () => import("./r0.js")`,
      "/other.js": `export const nav = () => import("./r2.js")`,
      ...preloadChainFiles(2),
    },
    entryPoints: ["/entry.js", "/other.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    publicPath: "https://cdn.example.com/v1/",
    onAfterBundle(api) {
      const entry = api.readFile("/out/entry.js");
      expect(entry).toMatch(/__preload\("(\w+)"\), import\("https:\/\/cdn\.example\.com\/v1\/r0-\1\.js"\)/);
      const [ids, nodes] = JSON.parse("[" + entry.match(/__chunks\(import\.meta\.url,(\[.*\]),0\);/)![1] + "]") as [
        string[],
        [string, ...number[]][],
      ];
      expect(ids.length).toBeGreaterThan(3);
      expect(nodes).toHaveLength(ids.length);
      const paths = nodes.map(node => node[0]);
      for (const path of paths) expect(path).toStartWith("https://cdn.example.com/v1/");
    },
  });
  // rolldown build-import-analysis/then-with-nested-import: each import() in a
  // .then() chain preloads its own target's imports, when it runs.
  itBundled("splitting/ModulePreloadNestedThen", {
    files: {
      "/entry.js": /* js */ `
        export const run = () =>
          import("./lib1.js")
            .then(m => (console.log(links.length, m.v1()), import("./lib2.js")))
            .then(m => console.log(links.length, m.v2()));
        export const others = () => [import("./o1.js"), import("./o2.js")];
      `,
      "/lib1.js": `import { s1 } from "./s1.js"; export const v1 = () => s1;`,
      "/lib2.js": `import { s2 } from "./s2.js"; export const v2 = () => s2;`,
      "/o1.js": `export { s1 } from "./s1.js";`,
      "/o2.js": `export { s2 } from "./s2.js";`,
      "/s1.js": `export const s1 = 100;`,
      "/s2.js": `export const s2 = 200;`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    runtimeFiles: {
      "/test.js": /* js */ `
        ${preloadShim}
        const { run } = await import("./out/entry.js");
        await run();
      `,
    },
    onAfterBundle(api) {
      const indices = [...api.readFile("/out/entry.js").matchAll(/__preload\("(\w+)"\), import\(/g)].map(m => m[1]);
      expect(indices).toHaveLength(4);
      expect(new Set(indices).size).toBe(4);
    },
    run: { file: "/test.js", stdout: "1 100\n2 200" },
  });
  // vite html.ts getImportedChunks `seen`: a chunk reached along two import
  // paths is linked once.
  itBundled("splitting/ModulePreloadHTMLDiamond", {
    files: {
      "/a.html": `<!DOCTYPE html><html><head><script type="module" src="./a.js"></script></head><body></body></html>`,
      "/b.html": `<!DOCTYPE html><html><head><script type="module" src="./b.js"></script></head><body></body></html>`,
      "/c.html": `<!DOCTYPE html><html><head><script type="module" src="./c.js"></script></head><body></body></html>`,
      "/a.js": `import { x } from "./x.js"; import { y } from "./y.js"; console.log(x(), y());`,
      "/b.js": `import { x } from "./x.js"; console.log(x());`,
      "/c.js": `import { y } from "./y.js"; console.log(y());`,
      "/x.js": `import { shared } from "./shared.js"; export const x = () => "x" + shared();`,
      "/y.js": `import { shared } from "./shared.js"; export const y = () => "y" + shared();`,
      "/shared.js": `export const shared = () => "shared";`,
    },
    entryPoints: ["/a.html", "/b.html", "/c.html"],
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      const hrefs = [
        ...api.readFile("/out/a.html").matchAll(/<link rel="modulepreload" crossorigin href="([^"]+)">/g),
      ].map(m => m[1]);
      // x's chunk, y's chunk, shared's chunk
      expect(hrefs).toHaveLength(3);
      expect(new Set(hrefs).size).toBe(3);
      const script = api.readFile("/out/a.html").match(/<script type="module" crossorigin src="([^"]+)">/)![1];
      expect(hrefs).not.toContain(script);
    },
  });
  // Chunks that import() each other: the registered graph and the preload walk
  // both terminate, and each side links the static imports of the other once.
  itBundled("splitting/ModulePreloadImportCycle", {
    files: {
      "/a.js": /* js */ `
        import { sa } from "./sa.js";
        export const a = () => "a" + sa;
        export const toB = () => import("./b.js");
      `,
      "/b.js": /* js */ `
        import { sb } from "./sb.js";
        export const b = () => "b" + sb;
        export const toA = () => import("./a.js");
      `,
      "/other.js": `export const both = () => [import("./sa.js"), import("./sb.js")];`,
      "/sa.js": `export const sa = 1;`,
      "/sb.js": `export const sb = 2;`,
    },
    entryPoints: ["/a.js", "/b.js", "/other.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    runtimeFiles: {
      "/test.js": /* js */ `
        ${preloadShim}
        const { toB } = await import("./out/a.js");
        const { b, toA } = await toB();
        console.log(links.length, b());
        const { a } = await toA();
        console.log(links.length, a());
        await toB();
        console.log(links.length);
      `,
    },
    onAfterBundle(api) {
      for (const entry of ["a", "b"]) {
        expect(api.readFile(`/out/${entry}.js`)).toMatch(/__chunks\(import\.meta\.url,\[/);
        expect(api.readFile(`/out/${entry}.js`)).toMatch(/__preload\("\w+"\), import\(/);
      }
    },
    // Going to b links sb's chunk; sa's chunk loaded with a, so coming back links nothing.
    run: { file: "/test.js", stdout: "1 b2\n1 a1\n1" },
  });
  // vite dynamic-import playground "should not preload for non-analyzable urls"
  itBundled("splitting/ModulePreloadSkipsNonAnalyzableImport", {
    files: {
      "/entry.js": /* js */ `
        export const known = () => import("./page.js");
        export const unknown = name => [import(globalThis.somewhere), import("./pages/" + name + ".js")];
      `,
      "/page.js": `export { shared } from "./shared.js";`,
      "/other.js": `export { shared } from "./shared.js";`,
      "/shared.js": `export const shared = 1;`,
      "/pages/p.js": `export default "p";`,
    },
    entryPoints: ["/entry.js", "/other.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      const entry = api.readFile("/out/entry.js");
      expect(entry.match(/__preload\("\w+"\), import\(/g)).toHaveLength(1);
      expect(entry).toMatch(/__preload\("(\w+)"\), import\("\.\/page-\1\.js"\)/);
      expect(entry).toContain("import(globalThis.somewhere)");
    },
  });
  itBundled("splitting/ModulePreloadDisabled", {
    files: {
      "/index.html": `<!DOCTYPE html><html><head><script type="module" src="./entry.js"></script></head><body></body></html>`,
      "/entry.js": `import { nav } from "./other.js"; globalThis.go = () => [nav(), import("./r0.js")];`,
      "/other.js": `export const nav = () => import("./r2.js")`,
      ...preloadChainFiles(2),
    },
    entryPoints: ["/index.html", "/other.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    modulePreload: false,
    onAfterBundle(api) {
      for (const file of readdirSync(api.outdir)) {
        expect(api.readFile("/out/" + file)).not.toMatch(/__preload|__chunks|modulepreload/);
      }
    },
  });
  // An entry another entry imports keeps its code in a shared chunk; its own
  // (re-exporting) entry chunk still registers the graph.
  itBundled("splitting/ModulePreloadEntryImportedByEntry", {
    files: {
      "/index.js": `import { go } from "./lib.js"; export const run = go;`,
      "/lib.js": `export const go = () => import("./r0.js");`,
      "/other.js": `export const nav = () => import("./r2.js")`,
      ...preloadChainFiles(2),
    },
    entryPoints: ["/index.js", "/lib.js", "/other.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    runtimeFiles: {
      "/test.js": /* js */ `
        ${preloadShim}
        const { go } = await import("./out/lib.js");
        console.log((await go()).default(), links.length);
      `,
    },
    onAfterBundle(api) {
      for (const entry of ["index", "lib"]) {
        expect(api.readFile(`/out/${entry}.js`)).toMatch(/__chunks\(import\.meta\.url,\[/);
      }
      for (const file of jsFilesIn(api)) {
        if (!["index.js", "lib.js", "other.js"].includes(file))
          expect(api.readFile("/out/" + file)).not.toContain("(import.meta.url,");
      }
    },
    run: { file: "/test.js", stdout: "r0:a1a2 1" },
  });
  // import() of another user-specified entry point is a split import() too.
  itBundled("splitting/ModulePreloadImportOfUserEntry", {
    files: {
      "/a.js": `export const go = () => import("./b.js");`,
      "/b.js": `import { s } from "./s.js"; export const b = () => "b" + s;`,
      "/c.js": `export { s } from "./s.js";`,
      "/s.js": `export const s = 1;`,
    },
    entryPoints: ["/a.js", "/b.js", "/c.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    runtimeFiles: {
      "/test.js": /* js */ `
        ${preloadShim}
        const { go } = await import("./out/a.js");
        const m = await go();
        console.log(m.b(), links.length);
      `,
    },
    onAfterBundle(api) {
      expect(api.readFile("/out/a.js")).toMatch(/__chunks\(import\.meta\.url,\[/);
      expect(api.readFile("/out/a.js")).toMatch(/__preload\("\w+"\), import\("\.\/b\.js"\)/);
    },
    run: { file: "/test.js", stdout: "b1 1" },
  });
  // An entry that reaches no split import() (after tree shaking) is left exactly as it was.
  itBundled("splitting/ModulePreloadLeavesStaticEntryAlone", {
    files: {
      "/lazy-page.js": `export const nav = () => import("./r0.js");`,
      "/static-page.js": `import { a2 } from "./a2.js"; console.log(a2()); function dead() { return import("./r0.js") }`,
      ...preloadChainFiles(2),
    },
    entryPoints: ["/lazy-page.js", "/static-page.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      expect(api.readFile("/out/lazy-page.js")).toMatch(/__chunks\(import\.meta\.url,\[/);
      expect(api.readFile("/out/static-page.js")).not.toMatch(/__chunks|__preload/);
      // lazy-page, static-page, r0, and the a2 chunk both pages share: no separate runtime chunk
      expect(jsFilesIn(api)).toHaveLength(4);
    },
    run: { file: "/out/static-page.js", stdout: "a2" },
  });
  // vite importAnalysisBuild: links carry the page's <meta property="csp-nonce"> nonce.
  itBundled("splitting/ModulePreloadCspNonce", {
    files: {
      "/entry.js": `export const nav = () => import("./r0.js")`,
      "/other.js": `export const nav = () => import("./r2.js")`,
      ...preloadChainFiles(2),
    },
    entryPoints: ["/entry.js", "/other.js"],
    splitting: true,
    outdir: "/out",
    target: "browser",
    runtimeFiles: {
      "/test.js": /* js */ `
        const links = [];
        globalThis.document = {
          createElement: tag => ({ tag }),
          querySelector: sel => (sel === "meta[property=csp-nonce]" ? { nonce: "abc123" } : null),
          head: { appendChild: link => links.push(link.nonce) },
        };
        const { nav } = await import("./out/entry.js");
        await nav();
        console.log(JSON.stringify(links));
      `,
    },
    run: { file: "/test.js", stdout: `["abc123"]` },
  });
  for (const target of ["bun", "node"] as const) {
    itBundled(`splitting/ModulePreloadIsBrowserOnly_${target}`, {
      files: {
        "/entry.js": `export const nav = () => import("./r0.js")`,
        "/other.js": `export const nav = () => import("./r2.js")`,
        ...preloadChainFiles(2),
      },
      entryPoints: ["/entry.js", "/other.js"],
      splitting: true,
      outdir: "/out",
      target,
      onAfterBundle(api) {
        for (const file of jsFilesIn(api)) {
          expect(api.readFile("/out/" + file)).not.toMatch(/__preload|__chunks|modulepreload/);
        }
      },
    });
  }

  // N same-named cross-chunk exports must get unique aliases in O(N) total
  // (ExportRenamer::next_renamed_name). Debug/ASAN builds blow past the 15s
  // cap with far fewer files than release, hence the scaled N.
  test("splitting/ManyCrossChunkExportAliasCollisions", async () => {
    const N = isDebug || isASAN ? 2500 : 20000;
    const THRESHOLD_MS = 15000;

    const files: Record<string, string> = {};
    let imports = "";
    let uses = "";
    for (let i = 0; i < N; i++) {
      files[`s${i}.js`] = `export const shared = ${i};\n`;
      imports += `import { shared as s${i} } from "./s${i}.js";\n`;
      uses += `t += s${i};\n`;
    }
    // Flat statement list keeps every import live without building a deep AST.
    const entryBody = imports + "let t = 0;\n" + uses + `console.log(t, s0, s${N - 1});\n`;
    files["e1.js"] = entryBody;
    files["e2.js"] = entryBody;

    using dir = tempDir("splitting-export-alias-collisions", files);
    const root = String(dir);

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--splitting", "--format=esm", "--outdir", "out", "./e1.js", "./e2.js"],
      env: bunEnv,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      timeout: THRESHOLD_MS,
      killSignal: "SIGKILL",
    });
    const [buildOut, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    if (build.signalCode !== null) {
      throw new Error(
        `bun build did not finish within ${THRESHOLD_MS}ms for ${N} colliding cross-chunk export names ` +
          `(signal ${build.signalCode})\nstdout:\n${buildOut}\nstderr:\n${buildErr}`,
      );
    }
    if (buildExit !== 0) {
      throw new Error(`bun build exited ${buildExit}\nstdout:\n${buildOut}\nstderr:\n${buildErr}`);
    }

    // The shared chunk's export clause must hand out a unique alias for every
    // `shared` symbol; verify by inspecting the generated chunk and by running
    // the output.
    const outDir = join(root, "out");
    const chunkName = readdirSync(outDir).find(f => f !== "e1.js" && f !== "e2.js" && f.endsWith(".js"));
    expect(chunkName).toBeDefined();
    const chunk = readFileSync(join(outDir, chunkName!), "utf8");
    const clause = chunk.match(/export\s*\{([^}]*)\}/)?.[1] ?? "";
    const aliases = clause
      .split(",")
      .map(part => {
        const bits = part.trim().split(/\s+as\s+/);
        return bits[bits.length - 1];
      })
      .filter(Boolean);
    expect(aliases.length).toBe(N);
    expect(new Set(aliases).size).toBe(N);
    for (const a of aliases) expect(a).toMatch(/^shared\d*$/);

    await using run = Bun.spawn({
      cmd: [bunExe(), join(outDir, "e1.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [runOut, runErr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    if (runExit !== 0) {
      throw new Error(`running e1.js exited ${runExit}\nstdout:\n${runOut}\nstderr:\n${runErr}`);
    }
    expect(runOut.trim()).toBe(`${(N * (N - 1)) / 2} 0 ${N - 1}`);
  }, 60_000);

  // Chunks are printed with placeholders where they refer to other chunks and
  // assets; the placeholders are replaced once every output path is known.
  // These pin the two per-chunk decisions of that step: what the written paths
  // are relative to, and whether the chunk's source map is corrected for the
  // replacements (which is also what adds the `//# debugId` comment).
  describe.concurrent("splitting/ChunkReferencePaths", () => {
    const adminSource = `import { util } from "../../shared/util.js";\nexport const page = [import("../site/index.js"), util("admin")];\n`;
    const files = {
      "pages/admin/index.js": adminSource,
      "pages/site/index.js": `import { util } from "../../shared/util.js";\nexport const page = util("site");\n`,
      "shared/util.js": `export function util(x) {\n  return "util:" + x;\n}\n`,
    };

    async function buildAdminEntry(
      root: string,
      options: { sourcemap: "none" | "linked"; publicPath?: string; outdir?: string },
    ) {
      const result = await Bun.build({
        entrypoints: [join(root, "pages/admin/index.js"), join(root, "pages/site/index.js")],
        root,
        splitting: true,
        ...options,
      });
      expect(result.logs).toBeEmpty();
      const admin = result.outputs.find(o => o.path.replaceAll("\\", "/").endsWith("pages/admin/index.js"))!;
      const map = result.outputs.find(o => o.path === admin.path + ".map");
      return { code: await admin.text(), map: map && JSON.parse(await map.text()) };
    }

    // `util("admin")` follows the dynamic import on the same line, so the map
    // only points at it if the mappings were shifted by the difference between
    // the placeholder and the path written over it.
    async function expectUtilCallToBeMapped(code: string, map: object) {
      const generatedLines = code.split("\n");
      const line = generatedLines.findIndex(l => l.includes('util("admin")')) + 1;
      expect(line).toBeGreaterThan(0);
      const column = generatedLines[line - 1].indexOf('util("admin")');
      const original = await SourceMapConsumer.with(map, null, consumer =>
        consumer.originalPositionFor({ line, column }),
      );
      expect({
        source: original.source?.replaceAll("\\", "/").split("/").slice(-3).join("/"),
        line: original.line,
        column: original.column,
      }).toEqual({
        source: "pages/admin/index.js",
        line: 2,
        column: adminSource.split("\n")[1].indexOf('util("admin")'),
      });
    }

    test("references are relative to the directory of the importing chunk", async () => {
      using dir = tempDir("splitting-reference-paths", files);
      const { code, map } = await buildAdminEntry(String(dir), { sourcemap: "none" });
      expect(code).toMatch(/from "\.\.\/\.\.\/chunk-[a-z0-9]+\.js"/);
      expect(code).toContain('import("../site/index.js")');
      expect(code).not.toContain("//# debugId=");
      expect(map).toBeUndefined();
    });

    test("a public path makes references outdir-relative regardless of the importing chunk's directory", async () => {
      using dir = tempDir("splitting-reference-paths-public", files);
      const { code, map } = await buildAdminEntry(String(dir), {
        sourcemap: "linked",
        publicPath: "https://cdn.example/app/",
      });
      expect(code).toMatch(/from "https:\/\/cdn\.example\/app\/chunk-[a-z0-9]+\.js"/);
      expect(code).toContain('import("https://cdn.example/app/pages/site/index.js")');
      expect(code).toContain("//# debugId=");
      await expectUtilCallToBeMapped(code, map);
    });

    test("the source map accounts for the paths written over the placeholders", async () => {
      using dir = tempDir("splitting-reference-paths-sourcemap", files);
      const { code, map } = await buildAdminEntry(String(dir), { sourcemap: "linked" });
      expect(code).toContain('import("../site/index.js")');
      expect(code).toContain("//# debugId=");
      await expectUtilCallToBeMapped(code, map);
    });

    test("writing to an outdir resolves references the same way as an in-memory build", async () => {
      using dir = tempDir("splitting-reference-paths-outdir", files);
      const inMemory = await buildAdminEntry(String(dir), { sourcemap: "linked" });
      const onDisk = await buildAdminEntry(String(dir), { sourcemap: "linked", outdir: join(String(dir), "out") });
      expect(onDisk.code).toBe(inMemory.code);
      expect(onDisk.map.mappings).toBe(inMemory.map.mappings);
      expect(readFileSync(join(String(dir), "out", "pages", "admin", "index.js"), "utf8")).toBe(inMemory.code);
      await expectUtilCallToBeMapped(onDisk.code, onDisk.map);
    });
  });
});
