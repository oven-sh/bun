import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { cases, tree, type Entry } from "../js/bun/resolve/import-meta-glob-cases";
import { itBundled, type BundlerTestInput } from "./expectBundled";

// Nothing exists above the bundle's root, and the bundler can't resolve a path with a query, so skip those cases.
const files = Object.fromEntries(
  Object.entries(tree)
    .filter(([path]) => path.startsWith("proj/"))
    .map(([path, contents]) => [path.slice("proj".length), contents]),
);
const bundled = cases.filter(([code]) => !code.includes("outside.ts") && !/query: ("[^"]|\{ )/.test(code));

const allCases = {
  files: {
    ...files,
    "/src/main.ts": `
      import { describeGlob } from "./harness.js";
      (async () => {
        console.log(JSON.stringify([\n${bundled.map(([code]) => `await describeGlob(${code}),`).join("\n")}\n]));
      })();`,
  },
  entryPoints: ["/src/main.ts"],
  outdir: "/out",
  run: {
    file: "/out/main.js",
    validate({ stdout }: { stdout: string }) {
      const actual: Entry[][] = JSON.parse(stdout);
      for (const [i, [code, expected]] of bundled.entries()) {
        expect([code, actual[i]]).toEqual([code, expected]);
      }
    },
  },
};

const modules = {
  "/modules/a.ts": `export const used = "a"; export const unused = "DROP a"; export default "DROP default a";`,
  "/modules/b.ts": `export const used = "b"; export const unused = "DROP b"; export default "DROP default b";`,
};

describe("bundler", () => {
  itBundled("import-meta-glob/TargetBrowser", { ...allCases, target: "browser" });
  itBundled("import-meta-glob/TargetBun", { ...allCases, target: "bun" });
  itBundled("import-meta-glob/TargetNode", { ...allCases, target: "node", run: { ...allCases.run, runtime: "node" } });
  itBundled("import-meta-glob/FormatCJS", { ...allCases, target: "node", format: "cjs" });
  itBundled("import-meta-glob/Splitting", { ...allCases, splitting: true });
  itBundled("import-meta-glob/Minify", {
    ...allCases,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
  });
  itBundled("import-meta-glob/Compile", {
    ...allCases,
    outdir: undefined,
    compile: true,
    run: { validate: allCases.run.validate },
  });

  itBundled("import-meta-glob/LazyEntriesAreChunks", {
    entryPoints: ["/entry.ts"],
    files: {
      ...modules,
      "/entry.ts": `
        const lazy = import.meta.glob("./modules/*.ts");
        console.log(Object.keys(lazy).join(), (await lazy["./modules/b.ts"]()).used);`,
    },
    outdir: "/out",
    splitting: true,
    onAfterBundle(api) {
      expect(
        readdirSync(api.outdir)
          .map(name => name.replace(/-[^.]+/, ""))
          .sort(),
      ).toEqual(["a.js", "b.js", "entry.js"]);
      api.expectFile("/out/entry.js").not.toContain("DROP");
    },
    run: { file: "/out/entry.js", stdout: "./modules/a.ts,./modules/b.ts b" },
  });

  itBundled("import-meta-glob/EagerNamedImportIsTreeShaken", {
    entryPoints: ["/entry.ts"],
    files: {
      ...modules,
      "/entry.ts": `console.log(JSON.stringify(import.meta.glob("./modules/*.ts", { eager: true, import: "used" })));`,
    },
    dce: true,
    run: { stdout: `{"./modules/a.ts":"a","./modules/b.ts":"b"}` },
  });

  for (const splitting of [false, true]) {
    itBundled(`import-meta-glob/LazyNamedImportIsTreeShaken${splitting ? "Splitting" : ""}`, {
      entryPoints: ["/entry.ts"],
      files: {
        ...modules,
        "/entry.ts": `
          const lazy = import.meta.glob("./modules/*.ts", { import: "used" });
          console.log(await lazy["./modules/a.ts"](), await lazy["./modules/b.ts"]());`,
      },
      outdir: "/out",
      splitting,
      onAfterBundle(api) {
        for (const name of readdirSync(api.outdir)) api.expectFile("/out/" + name).not.toContain("DROP");
      },
      run: { file: "/out/entry.js", stdout: "a b" },
    });
  }

  itBundled("import-meta-glob/ObjectKeysBundlesNothing", {
    entryPoints: ["/entry.ts"],
    files: {
      ...modules,
      "/entry.ts": `
        console.log(Object.keys(import.meta.glob("./modules/*.ts")).join());
        console.log(Object.keys(import.meta.glob("./modules/*.ts", { eager: true })).join());`,
    },
    dce: true,
    run: { stdout: "./modules/a.ts,./modules/b.ts\n./modules/a.ts,./modules/b.ts" },
  });

  itBundled("import-meta-glob/UnusedResultIsRemoved", {
    entryPoints: ["/entry.ts"],
    files: {
      ...modules,
      "/entry.ts": `
        const DROP = import.meta.glob("./modules/*.ts");
        console.log("kept");`,
    },
    dce: true,
    run: { stdout: "kept" },
  });

  const assets = {
    "/assets/icon.svg": "<svg/>",
    "/assets/query.sql": "select 1",
  };

  itBundled("import-meta-glob/QueryRaw", {
    entryPoints: ["/entry.ts"],
    files: {
      ...assets,
      "/entry.ts": `
        const lazy = import.meta.glob("./assets/*", { query: "?raw", import: "default" });
        console.log(await lazy["./assets/query.sql"]());
        console.log(JSON.stringify(import.meta.glob("./assets/*", { query: "?raw", import: "default", eager: true })));`,
    },
    outdir: "/out",
    onAfterBundle(api) {
      expect(readdirSync(api.outdir)).toEqual(["entry.js"]);
    },
    run: { file: "/out/entry.js", stdout: `select 1\n{"./assets/icon.svg":"<svg/>","./assets/query.sql":"select 1"}` },
  });

  itBundled("import-meta-glob/QueryUrl", {
    entryPoints: ["/entry.ts"],
    files: {
      ...assets,
      "/entry.ts": `
        const lazy = import.meta.glob("./assets/*", { query: "?url", import: "default" });
        console.log(await lazy["./assets/query.sql"]());
        console.log(JSON.stringify(import.meta.glob("./assets/*", { query: "?url", import: "default", eager: true })));`,
    },
    outdir: "/out",
    assetNaming: "[name].[ext]",
    onAfterBundle(api) {
      expect(readdirSync(api.outdir).sort()).toEqual(["entry.js", "icon.svg", "query.sql"]);
    },
    run: {
      file: "/out/entry.js",
      stdout: `./query.sql\n{"./assets/icon.svg":"./icon.svg","./assets/query.sql":"./query.sql"}`,
    },
  });

  itBundled("import-meta-glob/TsconfigPathsAndPackageImports", {
    entryPoints: ["/entry.ts"],
    files: {
      ...modules,
      "/tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./modules/*"] } } }`,
      "/package.json": `{ "imports": { "#modules/*": "./modules/*" } }`,
      "/entry.ts": `
        console.log(JSON.stringify(import.meta.glob("@/*.ts", { eager: true, import: "used" })));
        console.log(JSON.stringify(import.meta.glob("#modules/b.ts", { eager: true, import: "used" })));`,
    },
    run: { stdout: `{"/modules/a.ts":"a","/modules/b.ts":"b"}\n{"/modules/b.ts":"b"}` },
  });

  itBundled("import-meta-glob/PluginsSeeTheImports", {
    entryPoints: ["/entry.ts"],
    files: {
      "/notes/one.note": "first",
      "/notes/two.note": "second",
      "/entry.ts": `
        const lazy = import.meta.glob("./notes/*.note", { import: "default" });
        console.log(await lazy["./notes/one.note"]());
        console.log(JSON.stringify(import.meta.glob("./notes/*.note", { import: "default", eager: true })));`,
    },
    plugins(build) {
      build.onLoad({ filter: /\.note$/ }, async ({ path }) => ({
        loader: "js",
        contents: `export default ${JSON.stringify("note: " + (await Bun.file(path).text()))};`,
      }));
    },
    run: { stdout: `note: first\n{"./notes/one.note":"note: first","./notes/two.note":"note: second"}` },
  });

  itBundled("import-meta-glob/ModuleOfAPlugin", {
    entryPoints: ["/entry.ts"],
    files: {
      ...modules,
      "/entry.ts": `import "virtual:relative";`,
    },
    plugins(build) {
      build.onResolve({ filter: /^virtual:/ }, ({ path }) => ({ path, namespace: "virtual" }));
      build.onLoad({ filter: /./, namespace: "virtual" }, () => ({
        loader: "ts",
        contents: `try { import.meta.glob("./modules/*.ts"); } catch (error) { console.log(error.message); }`,
      }));
    },
    run: {
      stdout: `Expected a glob pattern in a module that is not a file to start with "/", but got "./modules/*.ts"`,
    },
  });

  const invalid = [
    `Expected a glob pattern to be a string literal, but got identifier`,
    `Expected the "import.meta.glob" option "eager" to be a boolean literal, but got identifier`,
    `Expected a glob pattern to start with "/", "./", "../", "**" or a path alias, but got "modules/*.ts"`,
  ];
  const invalidCalls = `
    const pattern = "./modules/*.ts", eager = true;
    for (const call of [
      () => import.meta.glob(pattern),
      () => import.meta.glob("./modules/*.ts", { eager }),
      () => import.meta.glob("modules/*.ts"),
    ])
      try { call(); } catch (error) { console.log(error.name + ": " + error.message); }
    console.log(import.meta.glob ? import.meta.glob(pattern) : "fallback");`;

  itBundled("import-meta-glob/CallsThatCannotBeReplacedThrowWhenReached", {
    entryPoints: ["/entry.ts"],
    files: { ...modules, "/entry.ts": invalidCalls },
    bundleWarnings: { "/entry.ts": [...invalid, invalid[0]] },
    run: { stdout: [...invalid.map(message => "TypeError: " + message), "fallback"].join("\n") },
  });

  // An inlined constant still doesn't count as a literal.
  itBundled("import-meta-glob/CallsThatCannotBeReplacedAreTheSameWithMinifySyntax", {
    entryPoints: ["/entry.ts"],
    files: { ...modules, "/entry.ts": invalidCalls },
    minifySyntax: true,
    bundleWarnings: { "/entry.ts": [...invalid, invalid[0]] },
    run: { stdout: [...invalid.map(message => "TypeError: " + message), "fallback"].join("\n") },
  });

  itBundled("import-meta-glob/NoWarningForAPackage", {
    entryPoints: ["/entry.ts"],
    files: { ...modules, "/entry.ts": `import "dep";`, "/node_modules/dep/index.js": invalidCalls },
    run: { stdout: [...invalid.map(message => "TypeError: " + message), "fallback"].join("\n") },
  });

  itBundled("import-meta-glob/AFileThatAssignsToItCallsWhatItAssigned", {
    entryPoints: ["/entry.ts"],
    files: {
      ...modules,
      "/entry.ts": `
        const load = () => import.meta.glob("./modules/*.ts", { eager: true });
        import.meta.glob ??= pattern => "own " + pattern;
        console.log(load());`,
    },
    target: "bun",
    run: { stdout: "own ./modules/*.ts" },
  });

  // Bun replaces a direct call in every file it transpiles. That includes a bundle it runs (only a bundle for Bun
  // starts with `// @bun`) and a bundle it bundles again. So a call that `bun build` did not replace must not be
  // printed as a direct call. Each file prints what its calls give.
  const printing = (setup: string, calls: Record<string, string>) => ({
    source: `${setup}
      const print = call => { try { const value = call(); return value && typeof value === "object" ? Object.keys(value).join() : String(value); } catch (error) { return error.name; } };
      console.log(JSON.stringify([${Object.keys(calls).map(call => `print(() => ${call})`)}]));`,
    printed: JSON.stringify(Object.values(calls)),
  });
  const notDirect = {
    'import.meta["glob"]("./pages/*.js")': "TypeError",
    'import.meta[`glob`]("./pages/*.js")': "TypeError",
    '(true ? import.meta : 0).glob("./pages/*.js")': "TypeError",
    '(null ?? import.meta).glob("./pages/*.js")': "TypeError",
    '(0, import.meta).glob("./pages/*.js")': "TypeError",
    'import.meta[key]("./pages/*.js")': "TypeError",
    "inlined()": "TypeError",
    "substituted()": "TypeError",
  };
  const notDirectSetup = `
    const key = "glob";
    function inlined(x) { let k = "glob"; x = import.meta[k]("./pages/*.js"); return x; }
    function substituted(x) { const meta = import.meta; x = meta.glob("./pages/*.js"); return x; }`;
  const kept = {
    // The assignment that makes Bun keep the calls of a file is not in the output.
    "/dead.js": printing(
      `if (false) import.meta.glob = 0;
       globalThis.unreached = () => import.meta.glob("./effects/*.js", { eager: true });`,
      {
        'import.meta.glob("./pages/*.js")': "TypeError",
        'import.meta.glob("./pages/*.js").x': "TypeError",
        'new (import.meta.glob("./pages/*.js"))()': "TypeError",
        'import.meta.glob("./pages/*.js")`x`': "TypeError",
        "typeof import.meta.glob": "undefined",
        "globalThis.effects": "undefined",
      },
    ),
    "/shaken.js": printing(`function install() { import.meta.glob = 0; }`, {
      'import.meta.glob("./pages/*.js")': "TypeError",
    }),
    // Nothing is assigned, and no call is direct until the visit pass folds or inlines something.
    "/not-direct.js": printing(notDirectSetup, { ...notDirect, "typeof import.meta.glob": "undefined" }),
    // The assignment is in the output, so the function of the file is called.
    "/assigned.js": printing(
      `import.meta.glob = function (...args) { return JSON.stringify([this === import.meta, ...args]); };`,
      { 'import.meta.glob("./pages/*.js", { eager: true })': '[true,"./pages/*.js",{"eager":true}]' },
    ),
  };
  const keptFiles = Object.keys(kept);
  const keptSources = Object.fromEntries(Object.entries(kept).map(([file, { source }]) => [file, source]));
  const nextTo = (outdir: string) => ({
    [`${outdir}/pages/next-to-the-output.js`]: "",
    [`${outdir}/effects/next-to-the-output.js`]: `globalThis.effects = "imported";`,
  });
  const nextToTheOutput = nextTo("/out");
  // Loads the output of every file, and expects what the source files print.
  const readAll = keptFiles.map(file => `await import(".${file}");`).join("\n");
  const reads = (outdir: string) => ({
    file: `${outdir}/read.mjs`,
    stdout: Object.values(kept)
      .map(({ printed }) => printed)
      .join("\n"),
  });

  const writers: Record<string, Partial<BundlerTestInput>> = {
    bun: { target: "bun" },
    node: { target: "node" },
    browser: { target: "browser" },
    cjs: { target: "node", format: "cjs" },
    minify: { target: "node", minifySyntax: true, minifyWhitespace: true },
  };
  for (const [writer, options] of Object.entries(writers)) {
    itBundled(`import-meta-glob/BunDoesNotReplaceACallThatTheBundleKept/${writer}`, {
      files: keptSources,
      entryPoints: keptFiles,
      outdir: "/out",
      ...options,
      runtimeFiles: {
        ...nextToTheOutput,
        ...nextTo("/out/again"),
        "/out/read.mjs": readAll,
        "/out/again/read.mjs": readAll,
      },
      async onAfterBundle(api) {
        for (const file of keptFiles) api.expectFile("/out" + file).not.toContain("import.meta.glob(");
        await Bun.build({
          entrypoints: keptFiles.map(file => api.outdir + file),
          outdir: api.outdir + "/again",
          target: "bun",
          minify: true,
        });
        for (const file of keptFiles) {
          api.expectFile("/out/again" + file).not.toContain("import.meta.glob(");
          api.expectFile("/out/again" + file).not.toContain("next-to-the-output");
        }
      },
      run: [
        reads("/out"),
        reads("/out/again"),
        // Node has no `import.meta.glob`, so it shows what a call gives when nothing replaces it.
        ...(writer === "node" ? [{ ...reads("/out"), runtime: "node" as const }] : []),
      ],
    });
  }

  // `bun build --no-bundle` replaces nothing. It prints a direct call as it is written, for the transpile that reads
  // its output, and any other call so that it stays a call.
  itBundled("import-meta-glob/NoBundleKeepsTheCallsOfAFileThatAssignsToIt", {
    files: { "/dead.js": kept["/dead.js"].source },
    bundling: false,
    outdir: "/out",
    runtimeFiles: nextToTheOutput,
    run: { file: "/out/dead.js", stdout: kept["/dead.js"].printed },
  });
  for (const minifySyntax of [false, true]) {
    const entry = printing(
      `${notDirectSetup}
       function direct(x) { const a = import.meta.glob("./pages/*.js"); x = a ? 1 : 0; return x; }
       function directInABranch(x) { const a = x.length; x = a ? import.meta.glob("./pages/*.js") : 0; return x; }`,
      {
        'import.meta.glob("./pages/*.js")': "./pages/next-to-the-output.js",
        "direct()": "1",
        'directInABranch("x")': "./pages/next-to-the-output.js",
        ...notDirect,
      },
    );
    itBundled(`import-meta-glob/NoBundleLeavesOnlyADirectCallForTheRun${minifySyntax ? "MinifySyntax" : ""}`, {
      files: { "/entry.js": entry.source },
      bundling: false,
      outdir: "/out",
      minifySyntax,
      runtimeFiles: nextToTheOutput,
      run: { file: "/out/entry.js", stdout: entry.printed },
    });
  }

  // `bun build --dts` also writes the bundle with its types kept, and `--aot` reads that file as it reads a source
  // file. The harness has no option for `--dts`, so this builds once more with it.
  itBundled("import-meta-glob/TheBundleWithItsTypesKeepsTheCallToo", {
    entryPoints: ["/entry.ts"],
    files: {
      "/tsconfig.json": `{ "compilerOptions": { "strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "esnext", "types": [] } }`,
      "/package.json": `{ "name": "pages", "version": "1.0.0" }`,
      "/entry.ts": `
        declare global { interface ImportMeta { glob: (pattern: string) => Record<string, unknown> } }
        import.meta.glob = pattern => ({ own: pattern });
        export const pages = import.meta.glob("./pages/*.ts");`,
    },
    outdir: "/out",
    async onAfterBundle(api) {
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "./entry.ts", "--outdir", "typed", "--dts"],
        cwd: api.root,
        env: { ...bunEnv, NO_COLOR: "1" },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      api.expectFile("/typed/entry.aot.ts").toContain("const pages = ");
      api.expectFile("/typed/entry.aot.ts").not.toContain("import.meta.glob(");
    },
  });

  // No transpile reads what the module loader prints or what an executable holds. So both print the call as they
  // always did, and the error of a call that finds no function still names `import.meta.glob`.
  const callsNoFunction = `try { import.meta["glob"]("./pages/*.js"); } catch (error) { console.log(error.message); }`;
  test.concurrent("import-meta-glob/TheModuleLoaderPrintsAKeptCallAsBefore", async () => {
    using dir = tempDir("import-meta-glob", { "entry.js": callsNoFunction });
    await using run = Bun.spawn({
      cmd: [bunExe(), "entry.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect(stdout).toStartWith("import.meta.glob is not a function");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });
  itBundled("import-meta-glob/AnExecutablePrintsAKeptCallAsBefore", {
    files: { "/entry.js": callsNoFunction },
    compile: true,
    run: { stdout: /^import\.meta\.glob is not a function/ },
  });

  itBundled("import-meta-glob/NotCalled", {
    entryPoints: ["/entry.ts"],
    files: {
      ...modules,
      "/entry.ts": `
        console.log(Object.keys(import.meta.glob("./modules/a.ts")).join(), typeof import.meta.glob, import.meta.glob?.("./modules/*.ts"));`,
    },
    dce: true,
    run: { stdout: "./modules/a.ts undefined undefined" },
  });
});
