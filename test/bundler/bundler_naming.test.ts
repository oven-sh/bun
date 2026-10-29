import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { ESBUILD, itBundled } from "./expectBundled";
import { generateGraph } from "./splitting-fuzz";

describe("bundler", () => {
  itBundled("naming/EntryNamingCollission", {
    files: {
      "/a/entry.js": /* js */ `
        console.log(1);
      `,
      "/b/entry.js": /* js */ `
        console.log(2);
      `,
    },
    entryNaming: "[name].[ext]",
    entryPointsRaw: ["./a/entry.js", "./b/entry.js"],
    bundleErrors: {
      // expectBundled does not support newlines.
      "<bun>": [`Multiple files share the same output path`],
    },
  });
  itBundled("naming/ImplicitOutbase1", {
    files: {
      "/a/entry.js": /* js */ `
        console.log(1);
      `,
      "/b/entry.js": /* js */ `
        console.log(2);
      `,
    },
    entryPointsRaw: ["./a/entry.js", "./b/entry.js"],
    run: [
      {
        file: "/out/a/entry.js",
        stdout: "1",
      },
      {
        file: "/out/b/entry.js",
        stdout: "2",
      },
    ],
  });
  itBundled("naming/ImplicitOutbase2", {
    files: {
      "/a/hello/entry.js": /* js */ `
        import data from '../dependency'
        console.log(data);
      `,
      "/a/dependency.js": /* js */ `
        export default 1;
      `,
      "/a/hello/world/entry.js": /* js */ `
        console.log(2);
      `,
      "/a/hello/world/a/a/a/a/a/a/a/entry.js": /* js */ `
        console.log(3);
      `,
    },
    entryPointsRaw: ["./a/hello/entry.js", "./a/hello/world/entry.js", "./a/hello/world/a/a/a/a/a/a/a/entry.js"],
    run: [
      {
        file: "/out/entry.js",
        stdout: "1",
      },
      {
        file: "/out/world/entry.js",
        stdout: "2",
      },
      {
        file: "/out/world/a/a/a/a/a/a/a/entry.js",
        stdout: "3",
      },
    ],
  });
  itBundled("naming/EntryNamingTemplate1", {
    files: {
      "/a/hello/entry.js": /* js */ `
        import data from '../dependency'
        console.log(data);
      `,
      "/a/dependency.js": /* js */ `
        export default 1;
      `,
      "/a/hello/world/entry.js": /* js */ `
        console.log(2);
      `,
      "/a/hello/world/a/a/a/a/a/a/a/entry.js": /* js */ `
        console.log(3);
      `,
    },
    entryNaming: "files/[dir]/file.[ext]",
    entryPointsRaw: ["./a/hello/entry.js", "./a/hello/world/entry.js", "./a/hello/world/a/a/a/a/a/a/a/entry.js"],
    run: [
      {
        file: "/out/files/file.js",
        stdout: "1",
      },
      {
        file: "/out/files/world/file.js",
        stdout: "2",
      },
      {
        file: "/out/files/world/a/a/a/a/a/a/a/file.js",
        stdout: "3",
      },
    ],
  });
  itBundled("naming/EntryNamingTemplate2", {
    todo: true,
    files: {
      "/src/first.js": /* js */ `
        console.log(1);
      `,
      "/src/second/third.js": /* js */ `
        console.log(2);
      `,
    },
    entryNaming: "[ext]/prefix[dir]suffix/file.[ext]",
    entryPointsRaw: ["./src/first.js", "./src/second/third.js"],
    run: [
      {
        file: "/out/js/prefix/secondsuffix/file.js",
        stdout: "2",
      },
      {
        file: "/out/js/prefix/suffix/file.js",
        stdout: "1",
      },
    ],
  });
  itBundled("naming/AssetNaming", {
    files: {
      "/src/lib/first/file.js": /* js */ `
        import file from "../second/data.file";
        console.log(file);
      `,
      "/src/lib/second/data.file": `
        this is a file
      `,
    },
    root: "/src",
    entryNaming: "hello.[ext]",
    assetNaming: "test.[ext]",
    entryPointsRaw: ["./src/lib/first/file.js"],
    run: {
      file: "/out/hello.js",
      stdout: "./test.file",
    },
  });
  itBundled("naming/AssetNamingMkdir", {
    files: {
      "/src/lib/first/file.js": /* js */ `
        import file from "../second/data.file";
        console.log(file);
      `,
      "/src/lib/second/data.file": `
        this is a file
      `,
    },
    root: "/src",
    entryNaming: "hello.[ext]",
    assetNaming: "subdir/test.[ext]",
    entryPointsRaw: ["./src/lib/first/file.js"],
    run: {
      file: "/out/hello.js",
      stdout: "./subdir/test.file",
    },
  });
  itBundled("naming/AssetNamingDir", {
    files: {
      "/src/lib/first/file.js": /* js */ `
        import file from "../second/data.file";
        console.log(file);
      `,
      "/src/lib/second/data.file": `
        this is a file
      `,
    },
    root: "/src",
    entryNaming: "hello.[ext]",
    assetNaming: "[dir]/test.[ext]",
    entryPointsRaw: ["./src/lib/first/file.js"],
    loader: ESBUILD
      ? {
          ".file": "file",
        }
      : undefined,
    run: [
      {
        file: "/out/hello.js",
        stdout: "./lib/second/test.file",
      },
    ],
  });
  itBundled("naming/EntryNamingTarget", {
    files: {
      "/src/entry.js": /* js */ `
        console.log(1);
      `,
    },
    root: "/src",
    target: "bun",
    entryNaming: "[target]/[name].[ext]",
    entryPointsRaw: ["./src/entry.js"],
    onAfterBundle(api) {
      expect(readdirSync(api.outdir)).toEqual(["bun"]);
    },
    run: {
      file: "/out/bun/entry.js",
      stdout: "1",
    },
  });
  itBundled("naming/AssetNamingTarget", {
    files: {
      "/src/entry.js": /* js */ `
        import file from "./data.file";
        console.log(file);
      `,
      "/src/data.file": `
        this is a file
      `,
    },
    root: "/src",
    target: "bun",
    assetNaming: "[target]/[name].[ext]",
    entryPointsRaw: ["./src/entry.js"],
    loader: {
      ".file": "file",
    },
    onAfterBundle(api) {
      expect(readdirSync(api.outdir).sort()).toEqual(["bun", "entry.js"]);
    },
    run: {
      file: "/out/entry.js",
      stdout: "./bun/data.file",
    },
  });
  itBundled("naming/AssetNoOverwrite", {
    todo: true,
    files: {
      "/src/entry.js": /* js */ `
        import asset1 from "./asset1.file";
        import asset2 from "./asset2.file";
        console.log(asset1, asset2);
      `,
      "/src/asset1.file": `
        file 1
      `,
      "/src/asset2.file": `
        file 2
      `,
    },
    root: "/src",
    assetNaming: "same-filename.txt",
    entryPointsRaw: ["./src/entry.js"],
    loader: {
      ".file": "file",
    },
    bundleErrors: {
      "<bun>": ['Multiple files share the same output path: "same-filename.txt"'],
    },
  });
  itBundled("naming/AssetFileLoaderPath1", {
    files: {
      "/src/entry.js": /* js */ `
        import asset1 from "./asset1.file";
        console.log(asset1);
      `,
      "/src/asset1.file": `
        file 1
      `,
      //
      "/out/hello/_": "",
    },
    root: "/src",
    entryNaming: "lib/entry.js",
    assetNaming: "hello/same-filename.txt",
    entryPointsRaw: ["./src/entry.js"],
    loader: {
      ".file": "file",
    },
  });
  itBundled("naming/NonexistantRoot", ({ root }) => ({
    backend: "cli",
    files: {
      "/src/entry.js": /* js */ `
        import asset1 from "./asset1.file";
        console.log(asset1);
      `,
      "/src/asset1.file": `
        file 1
      `,
    },
    root: "/lib",
    entryPointsRaw: ["./src/entry.js"],
    bundleErrors: {
      // "<bun>": [`FileNotFound: failed to open root directory: ${root}/lib`],
    },
  }));
  itBundled("naming/EntrypointOutsideOfRoot", {
    todo: true,
    files: {
      "/src/hello/entry.js": /* js */ `
        console.log(1);
      `,
      "/src/root/file.js": /* js */ `
        console.log(2);
      `,
    },
    root: "/src/root",
    entryPointsRaw: ["./src/hello/entry.js"],
    run: {
      file: "/out/_.._/hello/file.js",
    },
  });
  itBundled("naming/WithPathTraversal", {
    files: {
      "/a/hello/entry.js": /* js */ `
        import data from '../dependency'
        console.log(data);
      `,
      "/a/dependency.js": /* js */ `
        export default 1;
      `,
      "/a/hello/world/entry.js": /* js */ `
        console.log(2);
      `,
      "/a/hello/world/a/a/a/a/a/a/a/entry.js": /* js */ `
        console.log(3);
      `,
    },
    entryNaming: "foo/../bar/[dir]/file.[ext]",
    entryPointsRaw: ["./a/hello/entry.js", "./a/hello/world/entry.js", "./a/hello/world/a/a/a/a/a/a/a/entry.js"],
    run: [
      {
        file: "/out/bar/file.js",
        stdout: "1",
      },
      {
        file: "/out/bar/world/file.js",
        stdout: "2",
      },
      {
        file: "/out/bar/world/a/a/a/a/a/a/a/file.js",
        stdout: "3",
      },
    ],
  });
  // A non-ASCII ID_Continue basename char is preserved in the generated
  // CommonJS wrapper symbol, not replaced per-code-point (nor per-UTF-8-byte,
  // which once regressed to `require_caf__utils`).
  itBundled("naming/NonAsciiSourceFilenameSymbol", {
    files: {
      "/entry.js": /* js */ `
        const u = require("./café-utils.js");
        console.log(u.hi);
      `,
      "/café-utils.js": /* js */ `
        module.exports = { hi: 1 };
      `,
    },
    target: "bun",
    onAfterBundle(api) {
      // target: "bun" prints identifiers ASCII-only, so "é" is escaped.
      api.expectFile("/out.js").toContain("require_caf\\u{e9}_utils");
      api.expectFile("/out.js").not.toContain("require_caf__utils");
      api.expectFile("/out.js").not.toContain("require_caf_utils");
    },
    run: { stdout: "1" },
  });
  // Unterminated `[` used to panic path_template_print; CLI backend isolates the crash.
  for (const unterminated of ["[name", "[dir", "[ext", "[hash", "[target", "a[b.js", "[name]-[hash.js"]) {
    itBundled(`naming/UnterminatedPlaceholder/${unterminated}`, {
      backend: "cli",
      files: {
        "/src/entry.js": `console.log(1);`,
      },
      root: "/src",
      entryNaming: unterminated,
      entryPointsRaw: ["./src/entry.js"],
      bundleErrors: {
        "<bun>": [`--entry-naming: unterminated "[`],
      },
    });
  }
  for (const [opt, flag] of [
    ["chunkNaming", "--chunk-naming"],
    ["assetNaming", "--asset-naming"],
  ] as const) {
    itBundled(`naming/UnterminatedPlaceholder/${flag}`, {
      backend: "cli",
      files: {
        "/src/entry.js": `console.log(1);`,
      },
      root: "/src",
      [opt]: "[name]-[hash",
      entryPointsRaw: ["./src/entry.js"],
      bundleErrors: {
        "<bun>": [`${flag}: unterminated "[hash"`],
      },
    });
  }
  // An unknown `[placeholder]` is kept verbatim in the output path.
  itBundled("naming/UnknownPlaceholderIsLiteral", {
    backend: "cli",
    files: {
      "/src/entry.js": `console.log(1);`,
    },
    root: "/src",
    entryNaming: "[nonexistent]-[name].[ext]",
    entryPointsRaw: ["./src/entry.js"],
    onAfterBundle(api) {
      api.assertFileExists("/out/[nonexistent]-entry.js");
    },
    run: { file: "/out/[nonexistent]-entry.js", stdout: "1" },
  });
});

// Bun.build({ naming: "[name" }) used to SIGABRT; validation now rejects it.
describe("bundler", () => {
  for (const [naming, option] of [
    [`"[name"`, "naming"],
    [`{ entry: "[dir]/[name" }`, "naming.entry"],
    [`{ chunk: "[name]-[hash" }`, "naming.chunk"],
    [`{ asset: "pre[post" }`, "naming.asset"],
  ] as const) {
    test(`naming/UnterminatedPlaceholderAPI ${naming}`, async () => {
      using dir = tempDir("naming-unterminated", {
        "e.ts": `console.log("hi");`,
        "build.ts": `
          try {
            await Bun.build({ entrypoints: ["./e.ts"], outdir: "./out", throw: false, naming: ${naming} });
            console.log("SURVIVED no-error");
          } catch (e) {
            console.log("SURVIVED", String(e));
          }
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toContain(`${option}: unterminated "[`);
      expect(stdout).toContain(`(missing "]")`);
      expect(exitCode).toBe(0);
    });
  }
});

// A chunk without an entry point takes `[name]` and `[dir]` from its roots: the entry points of the
// `entrypoints` list whose chunks import it, also through other chunks. One root: `<name>-chunk`.
// Otherwise: `shared`. `[dir]` is the deepest directory that holds every root.
describe("bundler", () => {
  const withoutHash = (path: string) => path.replace(/-[a-z0-9]{8}\.js$/, "-[hash].js");
  const names = (outputs: Record<string, string>) => Object.keys(outputs).map(withoutHash).sort();
  const chunkWith = (outputs: Record<string, string>, marker: string) =>
    Object.keys(outputs)
      .filter(path => outputs[path].includes(marker))
      .map(withoutHash);
  const samePathOtherBytes = (a: Record<string, string>, b: Record<string, string>) =>
    Object.keys(a).filter(path => path in b && b[path] !== a[path]);

  // Path and text of each output of a build with code splitting.
  async function buildSplit(
    dir: string,
    entrypoints: string[],
    naming: string | { entry?: string; chunk: string },
    options: Partial<Bun.BuildConfig> = {},
  ) {
    const build = await Bun.build({
      entrypoints: entrypoints.map(entrypoint => join(dir, entrypoint)),
      root: dir,
      splitting: true,
      naming: typeof naming === "string" ? { chunk: naming } : naming,
      ...options,
    });
    const outputs: Record<string, string> = {};
    for (const output of build.outputs) outputs[output.path] = await output.text();
    return outputs;
  }

  test("naming/SplitChunkOfTwoEntryPoints", async () => {
    using dir = tempDir("naming-split-chunk-shared", {
      "main.js": `import { v } from "./sub/modname.js"; import("./lazy.js").then(m => console.log(v, m.z));`,
      "sub/modname.js": `export const v = "V";`,
      "lazy.js": `export const z = "Z";`,
    });
    const template = "chunks/[name]-[hash].[ext]";
    const mainFirst = await buildSplit(String(dir), ["main.js", "sub/modname.js"], template);
    const mainLast = await buildSplit(String(dir), ["sub/modname.js", "main.js"], template);
    expect(names(mainFirst)).toEqual([
      "./chunks/lazy-[hash].js",
      "./chunks/shared-[hash].js",
      "./main.js",
      "sub/modname.js",
    ]);
    expect(names(mainLast)).toEqual(names(mainFirst));
    expect(mainLast).toEqual(mainFirst);
  });

  test("naming/SplitChunkOfOneEntryPoint", async () => {
    using dir = tempDir("naming-split-chunk-one-entry", {
      "main.js": `import { h } from "./helper.js"; console.log("main", h); import("./lazy1.js"); import("./lazy2.js");`,
      "lazy1.js": `import { h } from "./helper.js"; import { t } from "./tool.js"; console.log("lazy1", h, t);`,
      "lazy2.js": `import { t } from "./tool.js"; console.log("lazy2", t);`,
      "helper.js": `export const h = "in-helper";`,
      "tool.js": `export const t = "in-tool";`,
    });
    const outputs = await buildSplit(String(dir), ["main.js"], "chunks/[name]-[hash].[ext]");
    expect(names(outputs)).toEqual([
      "./chunks/lazy1-[hash].js",
      "./chunks/lazy2-[hash].js",
      "./chunks/main-chunk-[hash].js",
      "./chunks/main-chunk-[hash].js",
      "./main.js",
    ]);
    // `main.js` imports the helper itself. Only the two `import()` targets import the tool.
    expect(chunkWith(outputs, `"in-helper"`)).toEqual(["./chunks/main-chunk-[hash].js"]);
    expect(chunkWith(outputs, `"in-tool"`)).toEqual(["./chunks/main-chunk-[hash].js"]);
  });

  test("naming/SplitChunkRoots", async () => {
    using dir = tempDir("naming-split-chunk-roots", {
      // Only `import()` targets of `a.js` import `only-a.js`: `a.js` is its one root.
      "a.js": `import { m } from "./m.js"; console.log("a", m); import("./a1.js"); import("./a2.js");`,
      "a1.js": `import { only } from "./only-a.js"; console.log("a1", only);`,
      "a2.js": `import { only } from "./only-a.js"; console.log("a2", only);`,
      "only-a.js": `export const only = "in-only-a";`,
      // `a.js` imports `m.js`, and so does an `import()` target of `b.js`: two roots.
      "b.js": `import("./lazy-b.js");`,
      "lazy-b.js": `import { m } from "./m.js"; console.log("lazy-b", m);`,
      "m.js": `export const m = "in-m";`,
    });
    const template = "[name]-[hash].[ext]";
    const aFirst = await buildSplit(String(dir), ["a.js", "b.js"], template, { target: "bun" });
    const bFirst = await buildSplit(String(dir), ["b.js", "a.js"], template, { target: "bun" });
    expect(names(aFirst)).toEqual([
      "./a-chunk-[hash].js",
      "./a.js",
      "./a1-[hash].js",
      "./a2-[hash].js",
      "./b.js",
      "./lazy-b-[hash].js",
      "./shared-[hash].js",
    ]);
    expect(chunkWith(aFirst, `"in-only-a"`)).toEqual(["./a-chunk-[hash].js"]);
    expect(chunkWith(aFirst, `"in-m"`)).toEqual(["./shared-[hash].js"]);
    expect(names(bFirst)).toEqual(names(aFirst));
    expect(bFirst).toEqual(aFirst);
  });

  // With `target: "bun"` a `require()` of an ES module is a chunk of its own.
  test("naming/SplitChunkOfSplitRequire", async () => {
    using dir = tempDir("naming-split-chunk-require", {
      "a.js": `console.log("a"); export function go() { return [require("./r1.js"), require("./r2.js")]; }`,
      "b.js": `console.log("b");`,
      "r1.js": `import { h } from "./h.js"; console.log("r1", h); export const r1 = 1;`,
      "r2.js": `import { h } from "./h.js"; console.log("r2", h); export const r2 = 2;`,
      "h.js": `export const h = "in-h";`,
    });
    const outputs = await buildSplit(String(dir), ["a.js", "b.js"], "[name]-[hash].[ext]", { target: "bun" });
    expect(names(outputs)).toEqual(["./a-chunk-[hash].js", "./a.js", "./b.js", "./r1-[hash].js", "./r2-[hash].js"]);
    expect(chunkWith(outputs, `"in-h"`)).toEqual(["./a-chunk-[hash].js"]);
  });

  // Only `import()` targets two levels below `main.js` import the helper, and they `import()` each other.
  test("naming/SplitChunkOfNestedImports", async () => {
    using dir = tempDir("naming-split-chunk-nested", {
      "main.js": `console.log("main"); import("./l1.js");`,
      "other.js": `console.log("other");`,
      "l1.js": `console.log("l1"); import("./l2a.js"); import("./l2b.js");`,
      "l2a.js": `import { h } from "./h.js"; console.log("l2a", h); import("./l2b.js");`,
      "l2b.js": `import { h } from "./h.js"; console.log("l2b", h); import("./l2a.js"); import("./l1.js");`,
      "h.js": `export const h = "in-h";`,
    });
    const outputs = await buildSplit(String(dir), ["other.js", "main.js"], "[name]-[hash].[ext]");
    expect(chunkWith(outputs, `"in-h"`)).toEqual(["./main-chunk-[hash].js"]);
  });

  // `a.js` loads the entry point `b.js` with `import()`, so both are roots of what `b.js` shares.
  test("naming/SplitChunkOfImportedEntryPoint", async () => {
    using dir = tempDir("naming-split-chunk-imported-entry", {
      "a.js": `console.log("a"); import("./b.js");`,
      "b.js": `import { h } from "./h.js"; console.log("b", h); import("./lazy.js");`,
      "lazy.js": `import { h } from "./h.js"; console.log("lazy", h);`,
      "h.js": `export const h = "in-h";`,
    });
    const outputs = await buildSplit(String(dir), ["a.js", "b.js"], "[name]-[hash].[ext]");
    expect(chunkWith(outputs, `"in-h"`)).toEqual(["./shared-[hash].js"]);
  });

  // Tree shaking removes the `import()` in `b.js`.
  test("naming/SplitChunkIgnoresDeadImport", async () => {
    using dir = tempDir("naming-split-chunk-dead-import", {
      "a.js": `console.log("a"); import("./l1.js"); import("./l2.js");`,
      "b.js": `function never() { return import("./l1.js"); } console.log("b");`,
      "l1.js": `import { h } from "./h.js"; console.log("l1", h);`,
      "l2.js": `import { h } from "./h.js"; console.log("l2", h);`,
      "h.js": `export const h = "in-h";`,
    });
    const outputs = await buildSplit(String(dir), ["a.js", "b.js"], "[name]-[hash].[ext]");
    expect(chunkWith(outputs, `"in-h"`)).toEqual(["./a-chunk-[hash].js"]);
  });

  // `minChunkSize` folds `loader.js` into the chunk that `b.js` imports too. That chunk then has the `import()`.
  test("naming/SplitChunkAfterMinChunkSizeFold", async () => {
    using dir = tempDir("naming-split-chunk-fold", {
      "a.js": `
        import { common } from "./common.js";
        import { load } from "./loader.js";
        console.log("a", common);
        import("./x.js");
        globalThis.loadFromA = load;
      `,
      "b.js": `import { common } from "./common.js"; console.log("b", common);`,
      "x.js": `import { common } from "./common.js"; import { load } from "./loader.js"; console.log("x", common, typeof load);`,
      "common.js": `console.log("common runs"); export const common = "in-common"; globalThis.pad = "${Buffer.alloc(40000, "x").toString()}";`,
      "loader.js": `export function load() { return Promise.all([import("./l1.js"), import("./l2.js")]); }`,
      "l1.js": `import { h } from "./h.js"; console.log("l1", h);`,
      "l2.js": `import { h } from "./h.js"; console.log("l2", h);`,
      "h.js": `console.log("h runs"); export const h = "in-h";`,
    });
    const template = "[name]-[hash].[ext]";
    const unfolded = await buildSplit(String(dir), ["a.js", "b.js"], template);
    const folded = await buildSplit(String(dir), ["a.js", "b.js"], template, { minChunkSize: 100000 });
    expect(chunkWith(unfolded, `"in-h"`)).toEqual(["./a-chunk-[hash].js"]);
    expect(chunkWith(folded, `"in-h"`)).toEqual(["./shared-[hash].js"]);
  });

  // Without tree shaking an `import()` target stays when the code that imports it is gone. It has no root.
  test("naming/SplitChunkOfNoEntryPoint", async () => {
    using dir = tempDir("naming-split-chunk-no-root", {
      "main.js": `import { x } from "./pkg/a.js"; import { y } from "./pkg/b.js"; console.log("main");`,
      "pkg/package.json": `{ "name": "pkg", "sideEffects": false }`,
      "pkg/a.js": `export const x = 1; export const load = () => import("./d1.js");`,
      "pkg/b.js": `export const y = 1; export const load = () => import("./d2.js");`,
      "pkg/d1.js": `import { h } from "./h.js"; console.log("d1", h);`,
      "pkg/d2.js": `import { h } from "./h.js"; console.log("d2", h);`,
      "pkg/h.js": `export const h = "in-h";`,
    });
    const outputs = await buildSplit(String(dir), ["main.js"], "[dir]/[name]-[hash].[ext]", { treeShaking: false });
    expect(names(outputs)).toEqual(["./main.js", "./pkg/d1-[hash].js", "./pkg/d2-[hash].js", "./shared-[hash].js"]);
    expect(chunkWith(outputs, `"in-h"`)).toEqual(["./shared-[hash].js"]);
  });

  test("naming/SplitChunkDir", async () => {
    using dir = tempDir("naming-split-chunk-dir", {
      "pages/a/entry.js": `console.log("a");`,
      "pages/b/entry.js": `
        import { h } from "../../lib/helper.js";
        import { own } from "../../lib/own.js";
        console.log("b", h, own);
        import("../../lazy/deep/file.js");
      `,
      "pages/c/entry.js": `import { h } from "../../lib/helper.js"; console.log("c", h);`,
      "lib/helper.js": `export const h = "in-helper";`,
      "lib/own.js": `export const own = "in-own";`,
      "lazy/deep/file.js": `import { own } from "../../lib/own.js"; console.log("lazy", own);`,
    });
    const template = "[dir]/[name]-[hash].[ext]";
    const entrypoints = ["pages/a/entry.js", "pages/b/entry.js", "pages/c/entry.js"];
    const forward = await buildSplit(String(dir), entrypoints, template);
    const reverse = await buildSplit(String(dir), entrypoints.toReversed(), template);
    expect(names(forward)).toEqual([
      "./lazy/deep/file-[hash].js",
      "./pages/b/entry-chunk-[hash].js",
      "./pages/shared-[hash].js",
      "pages/a/entry.js",
      "pages/b/entry.js",
      "pages/c/entry.js",
    ]);
    expect(chunkWith(forward, `"in-own"`)).toEqual(["./pages/b/entry-chunk-[hash].js"]);
    expect(chunkWith(forward, `"in-helper"`)).toEqual(["./pages/shared-[hash].js"]);
    expect(names(reverse)).toEqual(names(forward));
    expect(reverse).toEqual(forward);
  });

  // The template prints `[dir]` and not `[name]`. `y/b.js` becomes a second root of the helper's chunk.
  test("naming/SplitChunkDirWithoutName", async () => {
    using dir = tempDir("naming-split-chunk-dir-only", {
      "x/a.js": `import("./a1.js"); import("./a2.js");`,
      "x/a1.js": `import { h } from "../helper.js"; console.log("a1", h);`,
      "x/a2.js": `import { h } from "../helper.js"; console.log("a2", h);`,
      "x/c.js": `import("./a1.js");`,
      "y/b.js": `import("../x/a1.js");`,
      "helper.js": `export const h = "in-helper";`,
    });
    const naming = { entry: "[dir]/[name]-[hash].[ext]", chunk: "[dir]/chunk-[hash].[ext]" };
    const alone = await buildSplit(String(dir), ["x/a.js"], naming);
    const withC = await buildSplit(String(dir), ["x/c.js", "x/a.js"], naming);
    const withB = await buildSplit(String(dir), ["y/b.js", "x/a.js"], naming);
    expect(chunkWith(alone, `"in-helper"`)).toEqual(["./x/chunk-[hash].js"]);
    expect(chunkWith(withB, `"in-helper"`)).toEqual(["./chunk-[hash].js"]);
    expect(samePathOtherBytes(alone, withB)).toEqual([]);
    // A second root in the same directory changes nothing that the template prints.
    expect(Object.keys(withC).filter(path => withC[path].includes(`"in-helper"`))).toEqual(
      Object.keys(alone).filter(path => alone[path].includes(`"in-helper"`)),
    );
  });

  // The chunk does not take the path of its entry point, and it is in the same directory.
  test("naming/SplitChunkBesideItsEntryPoint", async () => {
    using dir = tempDir("naming-split-chunk-beside-entry", {
      "src/api/index.js": `import { shared } from "./shared.js"; console.log("index", shared); await import("./lazy.js");`,
      "src/api/shared.js": `import { local } from "./local.js"; export const shared = "shared " + local;`,
      "src/api/lazy.js": `import { shared } from "./shared.js"; console.log("lazy", shared);`,
      "out/api/local.js": `export const local = "local";`,
    });
    const build = await Bun.build({
      entrypoints: [join(String(dir), "src/api/index.js")],
      root: join(String(dir), "src"),
      outdir: join(String(dir), "out"),
      target: "bun",
      splitting: true,
      external: ["*local.js"],
      naming: { chunk: "[dir]/[name].[ext]" },
    });
    expect(build.outputs.map(output => output.path.slice(String(dir).length + 1).replaceAll("\\", "/")).sort()).toEqual(
      ["out/api/index-chunk.js", "out/api/index.js", "out/api/lazy.js"],
    );
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "out/api/index.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "index shared local\nlazy shared local\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Two entry points in one directory: their chunk is in that directory in both orders.
  test("naming/SplitChunkBesideItsEntryPoints", async () => {
    using dir = tempDir("naming-split-chunk-beside-entries", {
      "src/api/a.js": `import { shared } from "./shared.js"; console.log("a", shared);`,
      "src/api/b.js": `import { shared } from "./shared.js"; console.log("b", shared);`,
      "src/api/shared.js": `import { local } from "./local.js"; export const shared = "shared " + local;`,
      "src/top.js": `console.log("top");`,
      "out/api/local.js": `export const local = "local";`,
    });
    for (const entrypoints of [
      ["src/top.js", "src/api/a.js", "src/api/b.js"],
      ["src/api/b.js", "src/api/a.js", "src/top.js"],
    ]) {
      const build = await Bun.build({
        entrypoints: entrypoints.map(entrypoint => join(String(dir), entrypoint)),
        root: join(String(dir), "src"),
        outdir: join(String(dir), "out"),
        target: "bun",
        splitting: true,
        external: ["*local.js"],
        naming: { chunk: "[dir]/[name].[ext]" },
      });
      expect(
        build.outputs.map(output => output.path.slice(String(dir).length + 1).replaceAll("\\", "/")).sort(),
      ).toEqual(["out/api/a.js", "out/api/b.js", "out/api/shared.js", "out/top.js"]);
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "out/api/a.js")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "a shared local\n", stderr: "", exitCode: 0 });
    }
  });

  test("naming/SplitChunkNameWithoutHash", async () => {
    using dir = tempDir("naming-split-chunk-no-hash", {
      "a.js": `import { h } from "./helper.js"; console.log("a", h);`,
      "b.js": `import { h } from "./helper.js"; console.log("b", h);`,
      "helper.js": `export const h = "H";`,
    });
    const outputs = await buildSplit(String(dir), ["a.js", "b.js"], "[name].[ext]");
    expect(Object.keys(outputs).sort()).toEqual(["./a.js", "./b.js", "./shared.js"]);
  });

  test.each(["browser", "bun", "node"] as const)("naming/SplitChunkTarget %s", async target => {
    using dir = tempDir("naming-split-chunk-target", {
      "a.js": `import { h } from "./helper.js"; console.log("a", h);`,
      "b.js": `import { h } from "./helper.js"; console.log("b", h);`,
      "helper.js": `export const h = "H";`,
    });
    const outputs = await buildSplit(String(dir), ["a.js", "b.js"], "[target]/[name]-[hash].[ext]", { target });
    expect(names(outputs)).toEqual(["./a.js", "./b.js", `./${target}/shared-[hash].js`]);
  });

  // The default `--chunk-naming` of the CLI is `[name]-[hash].[ext]`.
  test("naming/SplitChunkNameCLI", async () => {
    using dir = tempDir("naming-split-chunk-cli", {
      "a.js": `import { h } from "./helper.js"; console.log("a", h);`,
      "b.js": `import { h } from "./helper.js"; console.log("b", h);`,
      "helper.js": `export const h = "H";`,
    });
    const outputs: Record<string, string>[] = [];
    for (const [outdir, entrypoints] of [
      ["a-first", ["a.js", "b.js"]],
      ["b-first", ["b.js", "a.js"]],
    ] as const) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", ...entrypoints, "--splitting", "--outdir", outdir],
        env: bunEnv,
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      const written: Record<string, string> = {};
      for (const file of readdirSync(join(String(dir), outdir))) {
        written[file] = await Bun.file(join(String(dir), outdir, file)).text();
      }
      outputs.push(written);
    }
    expect(names(outputs[0])).toEqual(["a.js", "b.js", "shared-[hash].js"]);
    expect(names(outputs[1])).toEqual(names(outputs[0]));
    expect(outputs[1]).toEqual(outputs[0]);
  });

  // In an executable `import.meta.path` of a module is the path of its chunk.
  itBundled("naming/SplitChunkNameCompile", {
    compile: true,
    splitting: true,
    chunkNaming: "[name]-[hash].[ext]",
    files: {
      "/entry.ts": /* js */ `
        import { chunkName } from "./shared";
        const lazy = await import("./lazy");
        console.log(chunkName, lazy.chunkName);
      `,
      "/shared.ts": /* js */ `
        export const nameOf = (path: string) => path.replace(/^.*[\\\\/]/, "").replace(/-[a-z0-9]+\\.js$/, "");
        export const chunkName = nameOf(import.meta.path);
      `,
      "/lazy.ts": /* js */ `
        import { nameOf } from "./shared";
        export const chunkName = nameOf(import.meta.path);
      `,
    },
    run: { stdout: "entry-chunk lazy" },
  });

  const page = (script: string) =>
    `<!DOCTYPE html><html><head><script type="module" src="./${script}"></script></head><body></body></html>`;

  itBundled("naming/SplitChunkOfTwoPages", {
    outdir: "out/",
    files: {
      "/in/page1.html": page("page1.js"),
      "/in/page2.html": page("page2.js"),
      "/in/page1.js": `import { both } from "./both.js"; console.log("page1", both);`,
      "/in/page2.js": `import { both } from "./both.js"; console.log("page2", both);`,
      "/in/both.js": `export const both = "in-both";`,
    },
    entryPoints: ["/in/page1.html", "/in/page2.html"],
    splitting: true,
    onAfterBundle(api) {
      const scripts = readdirSync(api.outdir).filter(file => file.endsWith(".js"));
      expect(scripts.map(withoutHash).sort()).toEqual(["page1-[hash].js", "page2-[hash].js", "shared-[hash].js"]);
    },
  });

  // The pages are the roots of the browser code, not the server that imports them.
  itBundled("naming/SplitChunkOfImportedPages", {
    outdir: "out/",
    target: "bun",
    splitting: true,
    chunkNaming: "[target]/[name]-[hash].[ext]",
    entryPoints: ["/server.js"],
    files: {
      "/server.js": `
        import home from "./home.html";
        import about from "./about.html";
        console.log(home.index, about.index);
      `,
      "/home.html": page("home.js"),
      "/about.html": page("about.js"),
      "/home.js": `import { both } from "./both.js"; console.log("home", both); import("./lazy1.js"); import("./lazy2.js");`,
      "/about.js": `import { both } from "./both.js"; console.log("about", both);`,
      "/lazy1.js": `import { tool } from "./tool.js"; console.log("lazy1", tool);`,
      "/lazy2.js": `import { tool } from "./tool.js"; console.log("lazy2", tool);`,
      "/both.js": `export const both = "in-both";`,
      "/tool.js": `export const tool = "in-tool";`,
    },
    onAfterBundle(api) {
      const outputs: Record<string, string> = {};
      for (const file of readdirSync(join(api.outdir, "browser"))) outputs[file] = api.readFile("out/browser/" + file);
      expect(names(outputs)).toEqual([
        "about-[hash].js",
        "home-[hash].js",
        "home-chunk-[hash].js",
        "lazy1-[hash].js",
        "lazy2-[hash].js",
        "shared-[hash].js",
      ]);
      expect(chunkWith(outputs, `"in-both"`)).toEqual(["shared-[hash].js"]);
      expect(chunkWith(outputs, `"in-tool"`)).toEqual(["home-chunk-[hash].js"]);
    },
  });

  test("naming/SplitChunkCollision", async () => {
    using dir = tempDir("naming-split-chunk-collision", {
      "a.js": `import { x } from "./x.js"; console.log("a", x);`,
      "b.js": `import { x } from "./x.js"; import { y } from "./y.js"; console.log("b", x, y);`,
      "c.js": `import { y } from "./y.js"; console.log("c", y);`,
      "x.js": `export const x = "X";`,
      "y.js": `export const y = "Y";`,
    });
    const build = await Bun.build({
      entrypoints: ["a.js", "b.js", "c.js"].map(entrypoint => join(String(dir), entrypoint)),
      root: String(dir),
      splitting: true,
      naming: { chunk: "chunks/[name].[ext]" },
      throw: false,
    });
    expect(build.logs[0].message.split("\n").slice(0, 2)).toEqual([
      "Multiple files share the same output path",
      "  ./chunks/shared.js:",
    ]);
    expect(build.success).toBe(false);
  });

  // `b.js` becomes a second root of the helper's chunk, so the chunk is `shared`. Its bytes do not
  // change, but the bytes of the chunks that import it do.
  test("naming/SplitChunkRenamesItsImporters", async () => {
    using dir = tempDir("naming-split-chunk-importers", {
      "a.js": `import("./a1.js"); import("./a2.js");`,
      "a1.js": `import { h } from "./helper.js"; console.log("a1", h);`,
      "a2.js": `import { h } from "./helper.js"; console.log("a2", h);`,
      "b.js": `import("./a1.js");`,
      "helper.js": `export const h = "in-helper";`,
    });
    const naming = { entry: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]" };
    const alone = await buildSplit(String(dir), ["a.js"], naming);
    const withB = await buildSplit(String(dir), ["b.js", "a.js"], naming);
    expect(chunkWith(alone, `"in-helper"`)).toEqual(["./a-chunk-[hash].js"]);
    expect(chunkWith(withB, `"in-helper"`)).toEqual(["./shared-[hash].js"]);
    expect(samePathOtherBytes(alone, withB)).toEqual([]);
  });

  // Random graphs (splitting-fuzz.ts). The metafile lists the chunks that each output imports.
  test.each([2, 3, 12, 57, 91])("naming/SplitChunkNameFollowsTheImports: graph %d", async seed => {
    const graph = generateGraph(seed);
    using dir = tempDir("naming-split-chunk-graph", graph.files);
    const build = await Bun.build({
      entrypoints: graph.entries.map(entry => join(String(dir), entry)),
      root: String(dir),
      splitting: true,
      target: "bun",
      naming: { chunk: "[name]-[hash].[ext]" },
      metafile: true,
    });
    const outputs = build.metafile!.outputs;
    const reachedFrom = (entryPoint: string) => {
      const reached = new Set([entryPoint]);
      for (const path of reached) {
        for (const { path: imported } of outputs[path].imports) if (imported in outputs) reached.add(imported);
      }
      return reached;
    };
    const roots = Object.keys(outputs)
      .filter(path => graph.entries.includes(basename(outputs[path].entryPoint ?? "")))
      .map(path => ({ name: basename(path, ".js"), reached: reachedFrom(path) }));
    const chunks = Object.keys(outputs).filter(path => outputs[path].entryPoint === undefined);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map(chunk => basename(withoutHash(chunk)))).toEqual(
      chunks.map(chunk => {
        const rootsOfChunk = roots.filter(root => root.reached.has(chunk));
        return `${rootsOfChunk.length === 1 ? rootsOfChunk[0].name + "-chunk" : "shared"}-[hash].js`;
      }),
    );
  });
});
