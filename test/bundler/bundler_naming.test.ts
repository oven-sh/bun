import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ESBUILD, itBundled } from "./expectBundled";

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
  // Each note names the option that named the chunk. A page takes the entry template, also when only `import()`
  // reaches it. Its script and its stylesheet take the chunk template, as a shared chunk does. No option names the
  // entry point of an executable.
  describe.concurrent("naming/CollisionNote", () => {
    const page = `<!doctype html><html><head><link rel="stylesheet" href="./index.css"><script type="module" src="./index.js"></script></head></html>`;
    const files = {
      "a/index.html": page,
      "a/index.js": `console.log("a");`,
      "a/index.css": `body { color: red; }`,
      "b/index.html": page,
      "b/index.js": `console.log("b");`,
      "b/index.css": `body { color: blue; }`,
      "imports-pages.js": `import("./a/index.html"); import("./b/index.html");`,
      "one.js": `export const one = 1;`,
      "imports-one.js": `import { one } from "./one.js"; console.log(one);`,
      "server.ts": `console.log("server");`,
      "imports-lazy.ts": `import("./x/lazy.ts");`,
      "embeds-app-bin.ts": `import file from "./data/app.bin" with { type: "file" }; console.log(file);`,
      "data/app.bin": "the bytes",
      "same/a/index.html": `<!doctype html><html><head><link rel="stylesheet" href="./index.css"></head></html>`,
      "same/a/index.css": `body { color: red; }`,
      "same/b/index.html": `<!doctype html><html><head><link rel="stylesheet" href="./index.css"></head></html>`,
      "same/b/index.css": `body { color: red; }`,
      "x/lazy.ts": `export const x = 1;`,
      "y/lazy.ts": `export const y = 2;`,
      "serves-pages.ts": `import a from "./same/a/index.html"; import b from "./same/b/index.html"; console.log(a, b); import("./x/lazy.ts"); import("./y/lazy.ts");`,
    };
    const note = (option: string, template: string) =>
      `note: ${option} naming is '${template}', consider adding '[hash]' to make filenames unique`;
    const rows: [name: string, entrypoints: string[], options: Partial<Bun.BuildConfig>, notes: string[]][] = [
      [
        "PageChunks",
        ["a/index.html", "b/index.html"],
        { naming: { chunk: "js/[name].[ext]" } },
        [note("chunk", "./js/[name].[ext]")],
      ],
      [
        "PagesAndPageChunks",
        ["a/index.html", "b/index.html"],
        { naming: { entry: "[name].[ext]", chunk: "js/[name].[ext]" } },
        [note("entry", "./[name].[ext]"), note("chunk", "./js/[name].[ext]")],
      ],
      [
        "ImportedPages",
        ["imports-pages.js"],
        { splitting: true, naming: { entry: "[name].[ext]", chunk: "js/[name]-[hash].[ext]" } },
        [note("entry", "./[name].[ext]")],
      ],
      [
        "EntryPointAndSharedChunk",
        ["one.js", "imports-one.js"],
        { splitting: true, naming: { chunk: "[name].[ext]" } },
        [note("entry", "[dir]/[name].[ext]"), note("chunk", "./[name].[ext]")],
      ],
      [
        "ExecutableAndPageChunk",
        ["a/index.html", "server.ts"],
        { target: "bun", compile: { outfile: "app.js" }, naming: { chunk: "app.[ext]" } },
        [note("chunk", "./app.[ext]")],
      ],
      [
        "ExecutableAndImportedChunk",
        ["imports-lazy.ts"],
        { target: "bun", splitting: true, compile: { outfile: "app" }, naming: { chunk: "app" } },
        [note("chunk", "./app")],
      ],
      [
        "ExecutableAndAsset",
        ["embeds-app-bin.ts"],
        { compile: { outfile: "app.bin" }, naming: { asset: "[name].[ext]" } },
        [note("asset", "./[name].[ext]")],
      ],
      // An executable names the chunks of its pages `./chunk-[hash].[ext]`: the two stylesheets have the same bytes.
      [
        "TwoChunkTemplates",
        ["serves-pages.ts"],
        {
          target: "bun",
          splitting: true,
          minify: true,
          compile: { outfile: "app" },
          naming: { chunk: "js/[name].[ext]" },
        },
        [
          "note: chunk naming is './chunk-[hash].[ext]'; these inputs produce identical content",
          note("chunk", "./js/[name].[ext]"),
        ],
      ],
    ];
    for (const [name, entrypoints, options, notes] of rows) {
      test(name, async () => {
        using dir = tempDir("naming-collision-note", files);
        const { logs } = await Bun.build({
          ...options,
          entrypoints: entrypoints.map(entry => join(String(dir), entry)),
          root: String(dir),
          outdir: String(dir),
          throw: false,
        });
        expect(logs.map(log => `${log.level}: ${log.message.split("\n")[0]}`)).toEqual([
          "error: Multiple files share the same output path",
          ...notes,
        ]);
      });
    }
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
      // expectBundled does not support newlines.
      "<bun>": [`Multiple files share the same output path`],
    },
  });
  itBundled("naming/AssetNoOverwriteSameName", {
    files: {
      "/src/entry.js": /* js */ `
        import a from "./a/logo.file";
        import b from "./b/logo.file";
        console.log(a, b);
      `,
      "/src/a/logo.file": `the first logo`,
      "/src/b/logo.file": `the second logo`,
    },
    root: "/src",
    assetNaming: "[name].[ext]",
    entryPointsRaw: ["./src/entry.js"],
    bundleErrors: {
      "<bun>": [`Multiple files share the same output path`],
    },
  });
  // Two spellings of one path: the entry point renders as "sub/entry.js" and the asset as
  // "./sub/entry.js", and "assets/../entry.js" is "entry.js" in the output directory.
  for (const [name, entry, logo, assetNaming] of [
    ["", "entry.js", "./logo.file", "entry.js"],
    ["InSubdirectory", "sub/entry.js", "../logo.file", "sub/entry.js"],
    ["ThroughParentDirectory", "entry.js", "./logo.file", "assets/../entry.js"],
  ] as const) {
    itBundled(`naming/AssetNoOverwriteEntryPoint${name}`, {
      files: {
        [`/src/${entry}`]: /* js */ `
          import asset from "${logo}";
          console.log(asset);
        `,
        "/src/logo.file": `the logo`,
      },
      root: "/src",
      assetNaming,
      entryPointsRaw: [`./src/${entry}`],
      bundleErrors: {
        "<bun>": [`Multiple files share the same output path`],
      },
    });
  }
  itBundled("naming/AssetSameNameSameContent", {
    files: {
      "/src/entry.js": /* js */ `
        import a from "./a/logo.file";
        import b from "./b/logo.file";
        console.log(a, b, await Bun.file(import.meta.dir + "/" + a).text());
      `,
      "/src/a/logo.file": `the logo`,
      "/src/b/logo.file": `the logo`,
    },
    root: "/src",
    target: "bun",
    assetNaming: "[name].[ext]",
    entryPointsRaw: ["./src/entry.js"],
    onAfterBundle(api) {
      expect(readdirSync(api.outdir).sort()).toEqual(["entry.js", "logo.file"]);
    },
    run: {
      file: "/out/entry.js",
      stdout: "./logo.file ./logo.file the logo",
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
