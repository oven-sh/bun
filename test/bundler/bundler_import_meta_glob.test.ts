import { describe, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { cases, tree, type Entry } from "../js/bun/resolve/import-meta-glob-cases";
import { itBundled } from "./expectBundled";

// The bundle is made in the project root, so nothing is above it, and the bundler resolves no path with a query.
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
        contents: `console.log(import.meta.glob("./modules/*.ts"));`,
      }));
    },
    bundleErrors: {
      "virtual:virtual:relative": [
        `Expected a glob pattern in a module that is not a file to start with "/", but got "./modules/*.ts"`,
      ],
    },
  });

  itBundled("import-meta-glob/Errors", {
    entryPoints: ["/entry.ts"],
    files: {
      ...modules,
      "/entry.ts": `
        import.meta.glob(pattern);
        import.meta.glob("./modules/*.ts", { eager });
        import.meta.glob("modules/*.ts");`,
    },
    bundleErrors: {
      "/entry.ts": [
        `Expected a glob pattern to be a string literal, but got identifier`,
        `Expected the "import.meta.glob" option "eager" to be a boolean literal, but got identifier`,
        `Expected a glob pattern to start with "/", "./", "../", "**" or a path alias, but got "modules/*.ts"`,
      ],
    },
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
