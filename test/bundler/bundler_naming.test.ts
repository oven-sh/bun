import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
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

  // The `sources` of a source map are relative to the directory of the map
  // file, which is below the outdir when the naming template has a directory.
  // `snapshotSourceMap` also reads every source from the map's directory.
  itBundled("naming/SourceMapSourcesEntryPointsInDirectories", {
    files: {
      "/a/deep/first.ts": `import { shared } from "../../shared"; console.log(shared, 1);`,
      "/b/second.ts": `import { shared } from "../shared"; console.log(shared, 2);`,
      "/shared.ts": `export const shared = "shared";`,
    },
    entryPointsRaw: ["./a/deep/first.ts", "./b/second.ts"],
    outdir: "/out",
    sourceMap: "external",
    snapshotSourceMap: {
      "first.js.map": { files: ["../../../shared.ts", "../../../a/deep/first.ts"] },
      "second.js.map": { files: ["../../shared.ts", "../../b/second.ts"] },
    },
  });
  itBundled("naming/SourceMapSourcesEntryNamingDirectory", {
    files: {
      "/entry.ts": `import { dep } from "./dep"; console.log(dep);`,
      "/dep.ts": `export const dep = 1;`,
    },
    outdir: "/out",
    entryNaming: "js/[name].[ext]",
    sourceMap: "external",
    snapshotSourceMap: {
      "entry.js.map": { files: ["../../dep.ts", "../../entry.ts"] },
    },
  });
  // The map is written before the hash is known. A hash is one path segment.
  itBundled("naming/SourceMapSourcesHashDirectory", {
    files: {
      "/entry.ts": `import { dep } from "./dep"; console.log(dep);`,
      "/dep.ts": `export const dep = 1;`,
    },
    outdir: "/out",
    entryNaming: "[hash]/[name].[ext]",
    sourceMap: "external",
    snapshotSourceMap: {
      "entry.js.map": { files: ["../../dep.ts", "../../entry.ts"] },
    },
  });
  itBundled("naming/SourceMapSourcesChunkNamingDirectory", {
    files: {
      "/one.ts": `import("./lazy").then(m => console.log(m.lazy, 1));`,
      "/two.ts": `import("./lazy").then(m => console.log(m.lazy, 2));`,
      "/lazy.ts": `export const lazy = "lazy";`,
    },
    entryPointsRaw: ["./one.ts", "./two.ts"],
    outdir: "/out",
    splitting: true,
    chunkNaming: "chunks/[name]-[hash].[ext]",
    sourceMap: "external",
    onAfterBundle(api) {
      const sources = readdirSync(api.outdir + "/chunks")
        .filter(name => name.endsWith(".map"))
        .flatMap(name => JSON.parse(api.readFile("/out/chunks/" + name)).sources);
      expect(sources).toEqual(["../../lazy.ts"]);
    },
  });
  itBundled("naming/SourceMapSourcesEntryPointOutsideRoot", {
    files: {
      "/proj/inside.ts": `console.log("inside");`,
      "/elsewhere/outside.ts": `console.log("outside");`,
    },
    root: "/proj",
    entryPointsRaw: ["./proj/inside.ts", "./elsewhere/outside.ts"],
    outdir: "/out",
    sourceMap: "external",
    snapshotSourceMap: {
      "inside.js.map": { files: ["../proj/inside.ts"] },
      "outside.js.map": { files: ["../../../elsewhere/outside.ts"] },
    },
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
