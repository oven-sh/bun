import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
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

// `[hash]` is a hash of what an output contains, so two builds never write two
// contents to one path. A debug ID names a chunk and its source map the same way.
describe("bundler", () => {
  const hashed = { entry: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" };
  const page = `<!doctype html><html><body><script type="module" src="./entry.js"></script></body></html>`;

  // The text of each output, by path.
  async function build(config: Bun.BuildConfig) {
    const { outputs } = await Bun.build(config);
    const texts: Record<string, string> = {};
    for (const output of outputs) texts[output.path] = await output.text();
    return texts;
  }

  // The paths that both builds wrote, with different contents.
  function pathsWithTwoContents(first: Record<string, string>, second: Record<string, string>) {
    return Object.keys(first).filter(path => path in second && first[path] !== second[path]);
  }

  // The debug ID of a build with one JavaScript chunk. The chunk prints it, and so does the source map of the chunk.
  function debugId(texts: Record<string, string>) {
    const code = Object.values(texts).find(text => text.includes("//# debugId="))!;
    const id = code.match(/^\/\/# debugId=([0-9A-F]{32})$/m)![1];
    const inline = code.match(/sourceMappingURL=data:application\/json;base64,([\w+/=]+)/)?.[1];
    const map = inline
      ? Buffer.from(inline, "base64").toString()
      : Object.entries(texts).find(([path]) => path.endsWith(".map"))![1];
    expect(JSON.parse(map).debugId).toBe(id);
    return id;
  }

  test.concurrent(
    "naming/ChunkHashCoversChunkPath (a new entry point moves the [dir] of an imported one)",
    async () => {
      using dir = tempDir("naming-chunk-hash-dir", {
        "src/router.js": `export const open = () => import("./pages/a.js");`,
        "src/pages/a.js": `import { open } from "../router.js";\nexport const a = open;`,
        "src/pages/b.js": `import { open } from "../router.js";\nexport const b = open;`,
        "src/index.js": `console.log("index");`,
      });
      // [dir] is relative to the root, and the default root is the directory that all entry points share.
      const withEntrypoints = (...entrypoints: string[]) =>
        build({ entrypoints: entrypoints.map(file => join(String(dir), file)), splitting: true });
      const first = await withEntrypoints("src/pages/a.js", "src/pages/b.js");
      const second = await withEntrypoints("src/pages/a.js", "src/pages/b.js", "src/index.js");

      // Both builds put router.js in a chunk with the default name, chunk-[hash].js.
      expect(Object.values(first).join("\n")).toContain(`import("./a.js")`);
      expect(Object.values(second).join("\n")).toContain(`import("./pages/a.js")`);
      expect(pathsWithTwoContents(first, second)).toEqual([]);
    },
  );

  test.concurrent(
    "naming/ChunkHashCoversChunkPath (a plugin gives an imported entry point another [name])",
    async () => {
      using dir = tempDir("naming-chunk-hash-name", {
        "entry.js": `import("./lazy.js").then(lazy => console.log(lazy.value));`,
        "lazy.js": `export const value = 1;`,
      });
      const withName = (name: string) =>
        build({
          entrypoints: [join(String(dir), "entry.js"), name],
          splitting: true,
          naming: hashed,
          plugins: [
            {
              name: "virtual",
              setup(builder) {
                builder.onResolve({ filter: /^virtual-/ }, () => ({ path: join(String(dir), "lazy.js") }));
              },
            },
          ],
        });
      const first = await withName("virtual-a");
      const second = await withName("virtual-b");

      expect(Object.values(first).join("\n")).toMatch(/import\("\.\/virtual-a-\w+\.js"\)/);
      expect(Object.values(second).join("\n")).toMatch(/import\("\.\/virtual-b-\w+\.js"\)/);
      expect(pathsWithTwoContents(first, second)).toEqual([]);
    },
  );

  test.concurrent("naming/ChunkHashCoversChunkPath (the [dir] of the chunk itself moves)", async () => {
    using dir = tempDir("naming-chunk-hash-own-dir", {
      "src/shared.js": `export const shared = "shared";`,
      "src/pages/a.js": `import { shared } from "../shared.js";\nconsole.log("a", shared);`,
      "src/pages/b.js": `import { shared } from "../shared.js";\nconsole.log("b", shared);`,
    });
    // The chunk of a.js imports the shared chunk by a path that is relative to its own directory.
    const withRoot = async (root: string) => {
      const { outputs } = await Bun.build({
        entrypoints: [join(String(dir), "src/pages/a.js"), join(String(dir), "src/pages/b.js")],
        root: join(String(dir), root),
        splitting: true,
        naming: { entry: "[dir]/[name]-[hash].[ext]" },
      });
      const a = outputs.find(output => basename(output.path).startsWith("a-"))!;
      return { hash: a.hash, sharedChunkIn: (await a.text()).match(/from "(.+)chunk-\w+\.js"/)![1] };
    };
    const first = await withRoot("src/pages");
    const second = await withRoot("src");

    expect([first.sharedChunkIn, second.sharedChunkIn]).toEqual(["./", "../"]);
    expect(second.hash).not.toBe(first.hash);
  });

  test.concurrent("naming/ChunkHashCoversChunkPath (an import() gets a chunk that another import() has)", async () => {
    using dir = tempDir("naming-chunk-hash-retarget", {
      "router.js": "",
      "pages/a.js": `import { first, second, third } from "../router.js";\nexport const a = [first, second, third];`,
      "pages/b.js": `import { first, second, third } from "../router.js";\nexport const b = [third, second, first];`,
      "x.js": `export const name = "x";`,
      "y.js": `export const name = "y";`,
    });
    const withSecond = async (target: "x" | "y") => {
      writeFileSync(
        join(String(dir), "router.js"),
        `export const first = () => import("./x.js");
         export const second = () => import("./${target}.js");
         export const third = () => import("./y.js");`,
      );
      // The chunks of router.js, x.js and y.js keep the default name, chunk-[hash].js.
      const texts = await build({
        entrypoints: [join(String(dir), "pages/a.js"), join(String(dir), "pages/b.js")],
        splitting: true,
        naming: { entry: "[name]-[hash].[ext]" },
      });
      // Which of x.js and y.js each import() loads, in the order that the chunk of router.js prints them.
      const loads = Array.from(
        Object.values(texts)
          .join("\n")
          .matchAll(/import\("(.+?)"\)/g),
        ([, path]) => texts[path].match(/"(x|y)"/)![1],
      );
      return { texts, loads };
    };
    const first = await withSecond("y");
    const second = await withSecond("x");

    expect([first.loads, second.loads]).toEqual([
      ["x", "y", "y"],
      ["x", "x", "y"],
    ]);
    expect(pathsWithTwoContents(first.texts, second.texts)).toEqual([]);
  });

  for (const sourcemap of ["external", "linked", "inline"] as const) {
    for (const to of ["memory", "disk", "standalone HTML"] as const) {
      test.concurrent(`naming/ChunkHashCoversSourceMap (sourcemap: ${sourcemap}, to ${to})`, async () => {
        using dir = tempDir("naming-chunk-hash-sourcemap", { "index.html": page, "entry.js": "" });
        // Only the comment differs, so only the source map differs.
        const withComment = (comment: string) => {
          writeFileSync(join(String(dir), "entry.js"), `// ${comment}\nconsole.log("x");\n`);
          return build({
            naming: hashed,
            sourcemap,
            ...(to === "standalone HTML"
              ? { entrypoints: [join(String(dir), "index.html")], compile: true, target: "browser" }
              : {
                  entrypoints: [join(String(dir), "entry.js")],
                  outdir: to === "disk" ? join(String(dir), "out") : undefined,
                }),
          });
        };
        const first = await withComment("first comment");
        const second = await withComment("second, longer comment");

        expect(pathsWithTwoContents(first, second)).toEqual([]);
        expect(debugId(second)).not.toBe(debugId(first));
      });
    }
  }

  test.concurrent("naming/ChunkHashCoversSourceMap (without a source map, a comment changes no output)", async () => {
    using dir = tempDir("naming-chunk-hash-comment", { "entry.js": "" });
    const withComment = (comment: string) => {
      writeFileSync(join(String(dir), "entry.js"), `// ${comment}\nconsole.log("x");\n`);
      return build({ entrypoints: [join(String(dir), "entry.js")], naming: hashed });
    };
    const first = await withComment("first comment");
    const second = await withComment("second, longer comment");

    expect(second).toEqual(first);
  });

  test.concurrent("naming/ChunkHashCoversSourceMap (a stylesheet has no source map)", async () => {
    using dir = tempDir("naming-chunk-hash-css", { "style.css": `body { color: red; }` });
    const withSourcemap = (sourcemap: "none" | "linked") =>
      build({ entrypoints: [join(String(dir), "style.css")], naming: hashed, sourcemap });

    expect(await withSourcemap("linked")).toEqual(await withSourcemap("none"));
  });

  for (const sourcemap of ["external", "linked", "inline"] as const) {
    test.concurrent(`naming/DebugIdCoversPrintedPaths (sourcemap: ${sourcemap})`, async () => {
      using dir = tempDir("naming-debug-id", {
        "entry.js": `import logo from "./logo.png";\nconsole.log(logo);`,
        "logo.png": "",
      });
      // The chunk prints the path of the asset, and that path has the hash of the asset.
      const withLogo = async (bytes: string) => {
        writeFileSync(join(String(dir), "logo.png"), bytes);
        const texts = await build({ entrypoints: [join(String(dir), "entry.js")], naming: hashed, sourcemap });
        return { logo: Object.keys(texts).find(path => path.endsWith(".png")), debugId: debugId(texts) };
      };
      const first = await withLogo("A");
      const second = await withLogo("B");

      expect(second.logo).not.toBe(first.logo);
      expect(second.debugId).not.toBe(first.debugId);
    });
  }

  test.concurrent("naming/ChunkHashCoversInlinedAsset (standalone HTML)", async () => {
    using dir = tempDir("naming-chunk-hash-standalone", {
      "index.html": page,
      "entry.js": `import logo from "./logo.png";\nconsole.log(logo);`,
      "logo.png": "",
    });
    // Without a [hash] in the asset name, the asset has one path for any contents.
    const withLogo = async (bytes: string) => {
      writeFileSync(join(String(dir), "logo.png"), bytes);
      const texts = await build({
        entrypoints: [join(String(dir), "index.html")],
        compile: true,
        target: "browser",
        naming: { entry: "[name]-[hash].[ext]", asset: "[name].[ext]" },
      });
      expect(Object.values(texts).join("\n")).toContain(
        `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
      );
      return texts;
    };
    const first = await withLogo("A");
    const second = await withLogo("B");

    expect(pathsWithTwoContents(first, second)).toEqual([]);
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
