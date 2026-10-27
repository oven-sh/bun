import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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

// A chunk prints the output path of each asset that it holds, and that path has
// the hash of the asset's bytes. When those bytes change, the chunk needs a new
// [hash] too.
describe("naming/ChunkHashCoversAssetPath", () => {
  const fixture = {
    "entry.js": `import logo from "./logo.png";\nconsole.log(logo);`,
    "a.js": `import { logo } from "./shared.js";\nconsole.log("a", logo);`,
    "b.js": `import { logo } from "./shared.js";\nconsole.log("b", logo);`,
    "shared.js": `import logo from "./logo.png";\nexport { logo };`,
    "no-asset.js": `console.log("no asset");`,
    "style.css": `body { background: url("./logo.png"); }`,
    "index.html": `<link rel="stylesheet" href="./style.css"><img src="./logo.png">`,
  };
  const hashed = "[name]-[hash].[ext]";
  const withoutHash = (name: string) => name.replace(/-[a-z0-9]+(?=\.\w+$)/, "");

  // `first` and `second` are the outputs of two builds that differ only in the bytes of logo.png.
  // `unchanged` are the outputs that do not hold the asset. Only they keep their names.
  function expectNewNames(
    first: Record<string, string>,
    second: Record<string, string>,
    outputs: string[],
    unchanged: string[],
  ) {
    expect(Object.keys(first).map(withoutHash).sort()).toEqual(outputs);
    expect(Object.keys(second).map(withoutHash).sort()).toEqual(outputs);
    const kept = Object.keys(first).filter(name => name in second);
    expect(kept.filter(name => first[name] !== second[name])).toEqual([]);
    expect(kept.map(withoutHash).sort()).toEqual(unchanged);
  }

  const onLoadFile = (bytes: Buffer): Bun.BunPlugin => ({
    name: "onLoad file",
    setup(builder) {
      builder.onLoad({ filter: /\.png$/ }, () => ({ contents: bytes, loader: "file" }));
    },
  });
  const onResolvePath = (): Bun.BunPlugin => ({
    name: "onResolve path",
    setup(builder) {
      builder.onResolve({ filter: /\.png$/ }, args => ({ path: join(dirname(args.importer), args.path) }));
    },
  });
  const onResolveNothing = (): Bun.BunPlugin => ({
    name: "onResolve nothing",
    setup(builder) {
      builder.onResolve({ filter: /\.png$/ }, () => undefined);
    },
  });

  // A stylesheet inlines an asset under 128 KB as a data URL. Above that it prints the path.
  const cases: {
    asset: string;
    entrypoints: string[];
    plugin?: (bytes: Buffer) => Bun.BunPlugin;
    splitting?: boolean;
    kilobytes?: number;
    outputs: string[];
    unchanged?: string[];
  }[] = [
    { asset: "imported", entrypoints: ["entry.js"], outputs: ["entry.js", "logo.png"] },
    {
      asset: "the result of an onLoad plugin",
      entrypoints: ["entry.js"],
      plugin: onLoadFile,
      outputs: ["entry.js", "logo.png"],
    },
    {
      asset: "resolved by an onResolve plugin",
      entrypoints: ["entry.js"],
      plugin: onResolvePath,
      outputs: ["entry.js", "logo.png"],
    },
    {
      asset: "left to the resolver by an onResolve plugin",
      entrypoints: ["entry.js"],
      plugin: onResolveNothing,
      outputs: ["entry.js", "logo.png"],
    },
    {
      asset: "an entry point",
      entrypoints: ["logo.png", "entry.js", "no-asset.js"],
      outputs: ["entry.js", "logo.js", "logo.png", "no-asset.js"],
      unchanged: ["no-asset.js"],
    },
    {
      asset: "an entry point, and a path in a stylesheet",
      entrypoints: ["logo.png", "style.css"],
      kilobytes: 200,
      outputs: ["logo.js", "logo.png", "style.css"],
    },
    {
      asset: "an entry point, and a data URL in a stylesheet",
      entrypoints: ["logo.png", "style.css"],
      kilobytes: 1,
      outputs: ["logo.js", "logo.png", "style.css"],
    },
    {
      asset: "an entry point, and the src of an HTML page",
      entrypoints: ["logo.png", "index.html"],
      kilobytes: 200,
      outputs: ["chunk.css", "chunk.js", "index.html", "logo.js", "logo.png"],
    },
    {
      asset: "an entry point, and in a chunk that two entry points share",
      entrypoints: ["logo.png", "a.js", "b.js", "no-asset.js"],
      splitting: true,
      outputs: ["a.js", "b.js", "chunk.js", "logo.js", "logo.png", "no-asset.js"],
      unchanged: ["no-asset.js"],
    },
  ];

  for (const { asset, entrypoints, plugin, splitting = false, kilobytes = 1, outputs, unchanged = [] } of cases) {
    test.concurrent(`the asset is ${asset}`, async () => {
      using dir = tempDir("naming-chunk-hash-asset", fixture);
      const build = async (fill: string) => {
        const bytes = Buffer.alloc(kilobytes * 1024, fill);
        writeFileSync(join(String(dir), "logo.png"), bytes);
        const result = await Bun.build({
          entrypoints: entrypoints.map(file => join(String(dir), file)),
          naming: { entry: hashed, chunk: "chunk-[hash].[ext]", asset: hashed },
          splitting,
          plugins: plugin ? [plugin(bytes)] : [],
        });
        const files: Record<string, string> = {};
        for (const output of result.outputs) files[basename(output.path)] = await output.text();
        return files;
      };
      expectNewNames(await build("A"), await build("B"), outputs, unchanged);
    });
  }

  test.concurrent("the asset is an entry point of `bun build`", async () => {
    using dir = tempDir("naming-chunk-hash-asset-cli", fixture);
    const build = async (fill: string) => {
      writeFileSync(join(String(dir), "logo.png"), Buffer.alloc(1024, fill));
      const outdir = join(String(dir), "out-" + fill);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "./entry.js", "./logo.png", "--outdir", outdir, "--entry-naming", hashed],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const files: Record<string, string> = {};
      for (const name of readdirSync(outdir)) files[name] = readFileSync(join(outdir, name), "latin1");
      return files;
    };
    expectNewNames(await build("A"), await build("B"), ["entry.js", "logo.js", "logo.png"], []);
  });
});
