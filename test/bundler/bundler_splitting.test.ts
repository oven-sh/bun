import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { itBundled } from "./expectBundled";

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

  // import() of a stylesheet must resolve to the stylesheet's JS exports (the
  // CSS modules class map), so the stylesheet needs a JS chunk of its own next
  // to its CSS. Previously the import() was rewritten to the .css output.
  itBundled("splitting/DynamicImportOfCSSModuleExports", {
    files: {
      "/entry.js": `
        const mod = await import('./styles.module.css');
        console.log(Object.keys(mod).join(','), mod.foo === mod.default.foo, /^foo_/.test(mod.foo));
      `,
      "/styles.module.css": `.foo { color: red; }`,
    },
    entryPoints: ["/entry.js"],
    splitting: true,
    outdir: "/out",
    metafile: true,
    onAfterBundle(api) {
      expect(api.readFile("/out/entry.js")).toMatch(/import\("\.\/styles\.module-[a-z0-9]+\.js"\)/);
      // The entry's own CSS bundle still carries the dynamically imported stylesheet.
      expect(api.readFile("/out/entry.css")).toContain("color: red");

      const { outputs } = JSON.parse(api.readFile("/metafile.json"));
      const stylesheetChunks = Object.entries<any>(outputs).filter(
        ([file, output]) => file.endsWith(".js") && output.entryPoint === "styles.module.css",
      );
      expect(stylesheetChunks).toEqual([
        [
          expect.stringMatching(/styles\.module-[a-z0-9]+\.js$/),
          expect.objectContaining({
            exports: ["default", "foo"],
            cssBundle: expect.stringMatching(/\.css$/),
          }),
        ],
      ]);
      const entry = Object.entries<any>(outputs).find(([file]) => file.endsWith("entry.js"))![1];
      expect(entry.imports.filter((i: { kind: string }) => i.kind === "dynamic-import")).toEqual([
        { path: stylesheetChunks[0][0], kind: "dynamic-import" },
      ]);
      // The chunk declares what it exports. The export clause alone is emitted
      // when the stylesheet's exports are not kept alive.
      expect(api.readFile(join("/out", stylesheetChunks[0][0]))).toMatchInlineSnapshot(`
        "// styles.module.css
        var foo = "foo_-MSaAA";
        var styles_module_default = {
          foo
        };
        export {
          styles_module_default as default,
          foo
        };
        "
      `);
    },
    run: {
      file: "/out/entry.js",
      env,
      stdout: "default,foo true true",
    },
  });

  // A stylesheet that one entry point imports statically and another one
  // import()s: the static importer keeps its own inline copy of the stylesheet's
  // JS (it does not import the stylesheet's chunk), the dynamic importer loads
  // the chunk. Liveness is per file, not per chunk, so once the stylesheet is
  // import()ed somewhere, the static importer's copy carries every export too,
  // not only the `foo` it uses.
  itBundled("splitting/StaticAndDynamicImportOfSameCSSModule", {
    files: {
      "/static.js": `
        import { foo } from './styles.module.css';
        console.log('static', /^foo_/.test(foo));
      `,
      "/dynamic.js": `
        const mod = await import('./styles.module.css');
        console.log('dynamic', Object.keys(mod).join(','), /^bar_/.test(mod.default.bar));
      `,
      "/styles.module.css": `
        .foo { color: red; }
        .bar { color: blue; }
      `,
    },
    entryPoints: ["/static.js", "/dynamic.js"],
    splitting: true,
    outdir: "/out",
    metafile: true,
    onAfterBundle(api) {
      expect(api.readFile("/out/static.js")).toMatchInlineSnapshot(`
        "// styles.module.css
        var foo = "foo_-MSaAA";
        var bar = "bar_-MSaAA";
        var styles_module_default = {
          foo,
          bar
        };

        // static.js
        console.log("static", /^foo_/.test(foo));
        "
      `);
      expect(api.readFile("/out/dynamic.js")).toMatch(/import\("\.\/styles\.module-[a-z0-9]+\.js"\)/);

      const { outputs } = JSON.parse(api.readFile("/metafile.json"));
      const stylesheetChunks = Object.keys(outputs).filter(
        file => file.endsWith(".js") && outputs[file].entryPoint === "styles.module.css",
      );
      expect(stylesheetChunks).toEqual([expect.stringMatching(/styles\.module-[a-z0-9]+\.js$/)]);
      const importsOf = (name: string): { path: string; kind: string }[] =>
        outputs[Object.keys(outputs).find(file => file.endsWith(name))!].imports;
      expect(importsOf("dynamic.js")).toContainEqual({ path: stylesheetChunks[0], kind: "dynamic-import" });
      expect(importsOf("static.js").map(i => i.path)).not.toContain(stylesheetChunks[0]);
    },
    run: [
      {
        file: "/out/static.js",
        env,
        stdout: "static true",
      },
      {
        file: "/out/dynamic.js",
        env,
        stdout: "dynamic bar,default,foo true",
      },
    ],
  });

  // A stylesheet that is both a user-specified entry point and import()ed only
  // gets its CSS output (entry point kinds are exclusive), so the import() is
  // still rewritten to the .css output (or, with --css-chunking, to whatever
  // chunk is at index 0) instead of a JS chunk exporting the class map.
  itBundled("splitting/DynamicImportOfUserSpecifiedCSSEntryPoint", {
    todo: true,
    files: {
      "/entry.js": `
        const mod = await import('./styles.module.css');
        console.log(Object.keys(mod).join(','), /^foo_/.test(mod.foo));
      `,
      "/styles.module.css": `.foo { color: red; }`,
    },
    entryPoints: ["/entry.js", "/styles.module.css"],
    splitting: true,
    outdir: "/out",
    onAfterBundle(api) {
      expect(api.readFile("/out/entry.js")).toMatch(/import\("\.\/styles\.module[^"]*\.js"\)/);
    },
    run: {
      file: "/out/entry.js",
      env,
      stdout: "default,foo true",
    },
  });

  // A stylesheet the user passes as an entry point still only produces CSS.
  itBundled("splitting/UserSpecifiedCSSEntryPointHasNoJSChunk", {
    files: {
      "/entry.js": `console.log('entry')`,
      "/styles.module.css": `.foo { color: red; }`,
    },
    entryPoints: ["/entry.js", "/styles.module.css"],
    splitting: true,
    outdir: "/out",
    metafile: true,
    onAfterBundle(api) {
      const { outputs } = JSON.parse(api.readFile("/metafile.json"));
      const stylesheetOutputs = Object.entries<any>(outputs)
        .filter(([, output]) => output.entryPoint === "styles.module.css")
        .map(([file]) => file.slice(file.lastIndexOf("/") + 1));
      expect(stylesheetOutputs).toEqual(["styles.module.css"]);
    },
  });

  // With --css-chunking the import()ed stylesheet shares its CSS chunk with the
  // importing entry point. The import() must still point at the stylesheet's JS
  // chunk (it used to be rewritten to the importing entry point's own chunk).
  test("splitting/DynamicImportOfCSSModuleWithCSSChunking", async () => {
    using dir = tempDir("splitting-css-chunking-dynamic-import", {
      "entry.js": `
        import './styles.module.css';
        import('./styles.module.css').then(mod => console.log(Object.keys(mod).join(','), /^foo_/.test(mod.default.foo)));
      `,
      "styles.module.css": `.foo { color: red; }`,
    });
    const root = String(dir);

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--splitting", "--css-chunking", "--outdir", "out", "./entry.js"],
      env: bunEnv,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [buildOut, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildErr).toBe("");
    expect(buildOut).toContain("entry.js");
    expect(buildExit).toBe(0);

    const outputs = readdirSync(join(root, "out")).sort();
    expect(outputs.filter(file => file.endsWith(".css"))).toEqual(["entry.css"]);
    expect(outputs.filter(file => file.endsWith(".js"))).toEqual([
      "entry.js",
      expect.stringMatching(/^styles\.module-[a-z0-9]+\.js$/),
    ]);
    expect(readFileSync(join(root, "out", "entry.js"), "utf8")).toMatch(/import\("\.\/styles\.module-[a-z0-9]+\.js"\)/);

    await using run = Bun.spawn({
      cmd: [bunExe(), join(root, "out", "entry.js")],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [runOut, runErr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(runErr).toBe("");
    expect(runOut).toBe("default,foo true\n");
    expect(runExit).toBe(0);
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
});
