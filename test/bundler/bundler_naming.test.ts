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

  // The outputs that have a hash in their name.
  function hashedOutputs(texts: Record<string, string>) {
    return Object.fromEntries(Object.entries(texts).filter(([path]) => /-[0-9a-z]{8}\./.test(path)));
  }

  // The debug ID of each JavaScript chunk, in output order. A chunk prints its ID, and so does its own source map.
  function debugIds(texts: Record<string, string>) {
    const maps = Object.keys(texts).filter(path => path.endsWith(".map"));
    return Object.entries(texts).flatMap(([path, code]) => {
      const id = code.match(/^\/\/# debugId=([0-9A-F]{32})$/m)?.[1];
      if (!id) return [];
      const inline = code.match(/sourceMappingURL=data:application\/json;base64,([\w+/=]+)/)?.[1];
      // A standalone HTML file holds its one chunk, and the map keeps the name of that chunk.
      const map = inline ? Buffer.from(inline, "base64").toString() : (texts[path + ".map"] ?? texts[maps[0]]);
      expect(JSON.parse(map).debugId).toBe(id);
      return [id];
    });
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

  test.concurrent(
    "naming/ChunkHashCoversChunkReference (an import() gets a chunk that another import() has)",
    async () => {
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
      // The chunks of x.js and y.js did not change, so they are the two outputs that keep their name.
      const kept = Object.keys(first.texts).filter(path => path in second.texts);
      expect(kept.map(path => first.texts[path].match(/"(x|y)"/)?.[1]).sort()).toEqual(["x", "y"]);
    },
  );

  for (const sourcemap of ["none", "external", "linked", "inline"] as const) {
    test.concurrent(`naming/ChunkHashIgnoresChunkOrder (sourcemap: ${sourcemap})`, async () => {
      const routes = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"];
      using dir = tempDir("naming-chunk-hash-order", {
        "main.js": `export const shared = "shared";
          export const routes = [${routes.map(route => `() => import("./${route}.js")`).join(", ")}];`,
        ...Object.fromEntries(
          routes.map(route => [
            `${route}.js`,
            `import { shared } from "./main.js";\nexport default "${route} " + shared;`,
          ]),
        ),
        "other.js": `console.log("other");`,
      });
      // main.js and its seven routes are eight entry points. The ninth puts the chunks in another order.
      const withEntrypoints = (...entrypoints: string[]) =>
        build({ entrypoints: entrypoints.map(file => join(String(dir), file)), splitting: true, sourcemap });
      const first = hashedOutputs(await withEntrypoints("main.js"));
      const second = await withEntrypoints("main.js", "other.js");

      // The chunk of each route, and the chunk that the routes import `shared` from.
      expect(Object.keys(first).filter(path => path.endsWith(".js"))).toHaveLength(8);
      expect(second).toMatchObject(first);
    });
  }

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
        expect(debugIds(first)).toHaveLength(1);
        expect(debugIds(second)).not.toEqual(debugIds(first));
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

  test.concurrent("naming/ChunkHashCoversSourceMapMode", async () => {
    using dir = tempDir("naming-chunk-hash-mode", { "entry.js": `console.log("x");` });
    // Each mode ends the chunk in its own way: nothing, a debug ID, a link to the map, or the map.
    const chunks: string[] = [];
    for (const sourcemap of ["none", "external", "linked", "inline"] as const) {
      const texts = await build({ entrypoints: [join(String(dir), "entry.js")], naming: hashed, sourcemap });
      chunks.push(...Object.keys(texts).filter(path => path.endsWith(".js")));
    }

    expect(new Set(chunks).size).toBe(4);
  });

  for (const sourcemap of ["external", "linked", "inline"] as const) {
    test.concurrent(`naming/DebugIdCoversAssetPath (sourcemap: ${sourcemap})`, async () => {
      using dir = tempDir("naming-debug-id", {
        "entry.js": `import logo from "./logo.png";\nconsole.log(logo);`,
        "logo.png": "",
      });
      // The chunk prints the path of the asset, and that path has the hash of the asset.
      const withLogo = async (bytes: string) => {
        writeFileSync(join(String(dir), "logo.png"), bytes);
        const texts = await build({ entrypoints: [join(String(dir), "entry.js")], naming: hashed, sourcemap });
        return { logo: Object.keys(texts).find(path => path.endsWith(".png")), debugIds: debugIds(texts) };
      };
      const first = await withLogo("A");
      const second = await withLogo("B");

      expect(second.logo).not.toBe(first.logo);
      expect(first.debugIds).toHaveLength(1);
      expect(second.debugIds).not.toEqual(first.debugIds);
    });

    for (const to of ["memory", "disk"] as const) {
      test.concurrent(`naming/DebugIdOfEachChunk (sourcemap: ${sourcemap}, to ${to})`, async () => {
        using dir = tempDir("naming-debug-id-chunks", {
          "shared.js": "",
          "a.js": `import { shared } from "./shared.js";\nconsole.log("a", shared);`,
          "b.js": `import { shared } from "./shared.js";\nconsole.log("b", shared);`,
        });
        // The chunks of a.js and b.js print the path of the chunk of shared.js, which has the hash of that chunk.
        const withShared = async (value: string) => {
          writeFileSync(join(String(dir), "shared.js"), `export const shared = "${value}";`);
          return debugIds(
            await build({
              entrypoints: [join(String(dir), "a.js"), join(String(dir), "b.js")],
              splitting: true,
              naming: hashed,
              sourcemap,
              outdir: to === "disk" ? join(String(dir), "out") : undefined,
            }),
          );
        };
        const first = await withShared("one");
        const second = await withShared("two");

        expect(new Set(first).size).toBe(3);
        expect(first.filter((id, chunk) => id === second[chunk])).toEqual([]);
      });
    }
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
