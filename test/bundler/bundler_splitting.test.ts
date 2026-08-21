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

  // The chunk holding secret.ts, which must be separate from the entry point.
  const secretChunk = (api: BundlerTestBundleAPI) => {
    const chunk = jsFilesIn(api).find(f => api.readFile("/out/" + f).includes("internal only"));
    expect(chunk).toBeDefined();
    expect(chunk).not.toBe("main.js");
    return chunk!;
  };

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
