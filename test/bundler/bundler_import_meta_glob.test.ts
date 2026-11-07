import { describe, expect } from "bun:test";
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

  // An eager glob is the same as its import statements written at the top of the file, wherever the call stands, as
  // in Vite. So the files that it matches are evaluated before the file's other imports.
  const eager = `import.meta.glob("./modules/*.ts", { eager: true })`;
  type CallSite = { code: string; globbed?: string[]; logs?: string };
  const callSites: Record<string, CallSite> = {
    between: { code: `import "./first.ts"; ${eager}; import "./last.ts";` },
    behind: { code: `import "./first.ts"; import "./last.ts"; ${eager};` },
    ahead: { code: `${eager}; import "./first.ts"; import "./last.ts";` },
    kept: {
      code: `import "./first.ts"; const kept = ${eager}; import "./last.ts"; globalThis.loaded.push("kept " + Object.keys(kept));`,
      logs: "./modules/a.ts,./modules/b.ts",
    },
    called: { code: `import "./first.ts"; import "./last.ts"; function load() { return ${eager}; } load();` },
    uncalled: { code: `import "./first.ts"; import "./last.ts"; function unused() { return ${eager}; }` },
    two: {
      code: `import "./first.ts"; ${eager}; import.meta.glob("./more/*.ts", { eager: true }); import "./last.ts";`,
      globbed: ["modules/a", "modules/b", "more/c"],
    },
    duplicate: { code: `import "./first.ts"; import "./modules/b.ts"; ${eager}; import "./last.ts";` },
    reexport: { code: `export * from "./first.ts"; ${eager}; export * from "./last.ts";` },
    named: {
      code: `
        import "./first.ts";
        const names = import.meta.glob("./modules/*.ts", { eager: true, import: "name" });
        import "./last.ts";
        globalThis.loaded.push("named " + Object.values(names));`,
      logs: "modules/a,modules/b",
    },
    mixed: {
      code: `
        import "./first.ts";
        const lazy = import.meta.glob("./more/*.ts");
        ${eager};
        import "./last.ts";
        globalThis.loaded.push("mixed " + Object.keys(lazy));`,
      logs: "./more/c.ts",
    },
    // A lowered top-level `using` keeps every statement of the file in one part.
    using: { code: `import "./first.ts"; ${eager}; import "./last.ts"; using unused = null;` },
  };
  const pushes = (name: string) => `(globalThis.loaded ??= []).push("${name}");`;
  /** The directory `dir` with `files` in it. Each of its modules pushes "<dir> <name>" when it is evaluated. */
  const directory = (dir: string, files: Record<string, string>) => ({
    ...Object.fromEntries(
      ["first", "last", "modules/a", "modules/b", "more/c"].map(name => [
        `/${dir}/${name}.ts`,
        `${pushes(`${dir} ${name}`)} export const name = "${name}";`,
      ]),
    ),
    ...Object.fromEntries(Object.entries(files).map(([name, code]) => [`/${dir}/${name}`, code])),
  });
  /** What a call site in `dir` pushes, in order. */
  const loadedBy = (dir: string, { globbed = ["modules/a", "modules/b"], logs }: Partial<CallSite> = {}) =>
    [...globbed, "first", "last", ...(logs ? [logs] : [])].map(name => `${dir} ${name}`);
  const printLoaded = `console.log(globalThis.loaded.join("\\n"));`;

  const everyCallSite = {
    entryPoints: ["/entry.ts"],
    files: {
      ...Object.assign({}, ...Object.entries(callSites).map(([dir, { code }]) => directory(dir, { "index.ts": code }))),
      "/entry.ts": `
        ${Object.keys(callSites)
          .map(dir => `import "./${dir}/index.ts";`)
          .join("\n")}
        ${printLoaded}`,
    },
  };
  const everyCallSiteLoaded = Object.entries(callSites)
    .flatMap(([dir, site]) => loadedBy(dir, site))
    .join("\n");
  for (const [kind, options] of Object.entries<Partial<BundlerTestInput>>({
    TargetBrowser: { target: "browser" },
    TargetBun: { target: "bun" },
    FormatCJS: { target: "node", format: "cjs" },
    FormatIIFE: { format: "iife" },
    Splitting: { splitting: true, outdir: "/out" },
    Minify: { minifyIdentifiers: true, minifySyntax: true, minifyWhitespace: true },
    NoTreeShaking: { treeShaking: false },
  })) {
    const bundled = { file: options.outdir && "/out/entry.js", stdout: everyCallSiteLoaded };
    itBundled(`import-meta-glob/EagerEntriesAreEvaluatedBeforeTheOtherImports${kind}`, {
      ...everyCallSite,
      ...options,
      // One of them also runs the files as they are.
      run: kind === "TargetBun" ? [{ file: "/entry.ts", stdout: everyCallSiteLoaded }, bundled] : bundled,
    });
  }

  itBundled("import-meta-glob/EagerEntriesAreEvaluatedBeforeTheOtherImportsOfAnEntryPoint", {
    backend: "cli",
    entryPoints: ["/app/index.ts"],
    files: directory("app", { "index.ts": `${callSites.between.code} ${printLoaded}` }),
    run: { stdout: loadedBy("app").join("\n") },
  });

  // The modules are in one chunk and the file's own imports in another.
  itBundled("import-meta-glob/EagerEntriesAreEvaluatedBeforeTheOtherImportsInAnotherChunk", {
    entryPoints: ["/app/index.ts", "/app/modules.ts", "/app/own.ts"],
    files: directory("app", {
      "index.ts": `${callSites.between.code} ${printLoaded}`,
      "modules.ts": `import "./modules/a.ts"; import "./modules/b.ts";`,
      "own.ts": `import "./first.ts"; import "./last.ts";`,
    }),
    outdir: "/out",
    splitting: true,
    run: { file: "/out/index.js", stdout: loadedBy("app").join("\n") },
  });

  // Under `bun run`, the CommonJS package is evaluated first, also when the imports are written by hand.
  itBundled("import-meta-glob/EagerEntriesAreEvaluatedBeforeACommonJSImport", {
    entryPoints: ["/app/index.ts"],
    files: {
      ...directory("app", { "index.ts": `import "dep"; ${eager}; import "./last.ts"; ${printLoaded}` }),
      "/node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }`,
      "/node_modules/dep/index.js": `${pushes("dep")} module.exports = {};`,
    },
    run: { stdout: ["app modules/a", "app modules/b", "dep", "app last"].join("\n") },
  });

  // The order of the imports is also the order of the rules in the stylesheet.
  const sheets = {
    "sheets/a.css": `.a { color: red; }`,
    "sheets/b.css": `.b { color: red; }`,
    "reset.css": `.reset { color: red; }`,
    "last.css": `.last { color: red; }`,
  };
  const ruleOrder = (css: string) => css.match(/\.(reset|last|a|b)\b/g);

  itBundled("import-meta-glob/EagerEntriesAreEvaluatedBeforeTheOtherImportsOfAnHTMLEntryPoint", {
    entryPoints: ["/index.html"],
    files: {
      "/index.html": `<script type="module" src="./app/index.ts"></script>`,
      ...directory("app", {
        ...sheets,
        "index.ts": `
          import "./reset.css";
          import "./first.ts";
          import.meta.glob(["./modules/*.ts", "./sheets/*.css"], { eager: true });
          import "./last.css";
          import "./last.ts";
          ${printLoaded}`,
      }),
    },
    outdir: "/out",
    entryNaming: "[name].[ext]",
    chunkNaming: "[name].[ext]",
    onAfterBundle(api) {
      expect(ruleOrder(api.readFile("/out/index.css"))).toEqual([".a", ".b", ".reset", ".last"]);
    },
    run: { file: "/out/index.js", stdout: loadedBy("app").join("\n") },
  });

  itBundled("import-meta-glob/EagerStylesheetsGoBeforeTheOtherImports", {
    entryPoints: ["/app/index.ts"],
    files: directory("app", {
      ...sheets,
      "index.ts": `
        import "./reset.css";
        import.meta.glob("./sheets/*.css", { eager: true });
        import "./last.css";`,
    }),
    outdir: "/out",
    target: "browser",
    onAfterBundle(api) {
      expect(ruleOrder(api.readFile("/out/index.css"))).toEqual([".a", ".b", ".reset", ".last"]);
    },
  });

  for (const splitting of [false, true]) {
    itBundled(
      `import-meta-glob/EagerEntriesAreEvaluatedFirstInAModuleThatIsLoadedLater${splitting ? "Splitting" : ""}`,
      {
        entryPoints: ["/entry.ts"],
        files: {
          ...directory("required", { "index.ts": callSites.between.code }),
          ...directory("imported", { "index.ts": callSites.between.code }),
          // The bundle keeps the import statements of a CommonJS module as require() calls.
          ...directory("commonjs", { "index.js": `${callSites.between.code} module.exports = {};` }),
          "/entry.ts": `
            require("./required/index.ts");
            await import("./imported/index.ts");
            require("./commonjs/index.js");
            ${printLoaded}`,
        },
        outdir: "/out",
        splitting,
        run: {
          file: "/out/entry.js",
          stdout: ["required", "imported", "commonjs"].flatMap(dir => loadedBy(dir)).join("\n"),
        },
      },
    );
  }

  // Where something else than the place of an import decides when a file runs, the glob in "glob" still gives the
  // order of the import statements that "written" has at the top of the file.
  const twins = (own: (dir: string) => string, files = (dir: string): Record<string, string> => ({})) => ({
    ...directory("glob", { "index.ts": `${own("glob")} ${eager};`, ...files("glob") }),
    ...directory("written", {
      "index.ts": `import "./modules/a.ts"; import "./modules/b.ts"; ${own("written")}`,
      ...files("written"),
    }),
  });
  const globIsAsWritten = (names: string[]) => ({
    validate({ stdout }: { stdout: string }) {
      const orderIn = (dir: string) =>
        stdout
          .split("\n")
          .filter(line => line.startsWith(dir + " "))
          .map(line => line.slice(dir.length + 1));
      expect(orderIn("glob")).toEqual(orderIn("written"));
      expect(orderIn("written").toSorted()).toEqual(names.toSorted());
    },
  });
  const ownImports = () => `import "./first.ts"; import "./last.ts";`;
  const everyName = ["first", "last", "modules/a", "modules/b"];

  // The wrapper of a module that is loaded later calls the require_a() of a CommonJS file behind every init_b().
  itBundled("import-meta-glob/EagerCommonJSEntryIsEvaluatedAsWritten", {
    entryPoints: ["/entry.ts"],
    files: {
      ...twins(ownImports, dir => ({ "modules/a.ts": `${pushes(`${dir} modules/a`)} module.exports = {};` })),
      "/entry.ts": `require("./glob/index.ts"); require("./written/index.ts"); ${printLoaded}`,
    },
    run: globIsAsWritten(everyName),
  });

  // That wrapper awaits a file with top-level await behind every init_b().
  itBundled("import-meta-glob/EagerAsyncEntryIsEvaluatedAsWritten", {
    entryPoints: ["/entry.ts"],
    files: {
      ...twins(ownImports, dir => ({ "modules/a.ts": `${pushes(`${dir} modules/a`)} await 0; export {};` })),
      "/entry.ts": `await import("./glob/index.ts"); await import("./written/index.ts"); ${printLoaded}`,
    },
    run: globIsAsWritten(everyName),
  });

  // An ES module output keeps the import statement of an external package, and every import statement runs first.
  itBundled("import-meta-glob/EagerEntriesAreEvaluatedAsWrittenBehindAnExternalImport", {
    entryPoints: ["/entry.ts"],
    files: {
      ...twins(dir => `import "external-${dir}"; import "./last.ts";`),
      "/node_modules/external-glob/index.js": pushes("glob external"),
      "/node_modules/external-written/index.js": pushes("written external"),
      "/entry.ts": `import "./glob/index.ts"; import "./written/index.ts"; ${printLoaded}`,
    },
    external: ["external-glob", "external-written"],
    run: globIsAsWritten(["external", "last", "modules/a", "modules/b"]),
  });

  // first.ts is in a chunk that another entry point shares, and a chunk runs as a whole.
  itBundled("import-meta-glob/EagerEntriesAreEvaluatedAsWrittenBehindAnImportInASharedChunk", {
    entryPoints: ["/entry.ts", "/other-glob.ts", "/other-written.ts"],
    files: {
      ...twins(ownImports),
      "/entry.ts": `import "./glob/index.ts"; import "./written/index.ts"; ${printLoaded}`,
      "/other-glob.ts": `import "./glob/first.ts";`,
      "/other-written.ts": `import "./written/first.ts";`,
    },
    outdir: "/out",
    splitting: true,
    run: { file: "/out/entry.js", ...globIsAsWritten(everyName) },
  });

  // A require() of "react" becomes an import statement.
  const requireThatBecomesAnImport = {
    entryPoints: ["/entry.ts"],
    files: {
      ...directory("app", {
        "index.ts": `
          import "./first.ts";
          const React = require("react");
          ${eager};
          import "./last.ts";
          globalThis.loaded.push("app requires " + React.name);`,
      }),
      "/node_modules/react/package.json": `{ "name": "react", "version": "1.0.0", "main": "index.js" }`,
      "/node_modules/react/index.js": `${pushes("react")} module.exports = { name: "react" };`,
      "/entry.ts": `import "./app/index.ts"; ${printLoaded}`,
    },
  };
  const requireThatBecomesAnImportLoaded = [...loadedBy("app"), "react", "app requires react"].join("\n");
  itBundled("import-meta-glob/EagerEntriesAreEvaluatedBeforeARequireThatBecomesAnImport", {
    ...requireThatBecomesAnImport,
    run: [
      { file: "/entry.ts", stdout: requireThatBecomesAnImportLoaded },
      { stdout: requireThatBecomesAnImportLoaded },
    ],
  });
  itBundled("import-meta-glob/EagerEntriesAreEvaluatedBeforeARequireThatBecomesAnImportNoTreeShaking", {
    ...requireThatBecomesAnImport,
    backend: "api",
    treeShaking: false,
    run: {
      // Where the file is one part (no tree shaking, or a lowered `using`), "react" is evaluated ahead of the file's
      // own imports, with or without a glob. Only the place of the glob's files is pinned.
      validate({ stdout }) {
        const loaded = stdout.trim().split("\n");
        expect({ first: loaded.slice(0, 2), all: loaded.toSorted() }).toEqual({
          first: loadedBy("app").slice(0, 2),
          all: requireThatBecomesAnImportLoaded.split("\n").toSorted(),
        });
      },
    },
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
