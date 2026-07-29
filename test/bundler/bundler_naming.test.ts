import { describe } from "bun:test";
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
  // https://github.com/oven-sh/bun/issues/10607
  // `--target node` emits ESM by default; Node loads `.js` as CommonJS unless
  // the nearest package.json says `"type": "module"`, so the default `[ext]`
  // for a JS chunk must be `mjs` to produce output that runs as-is.
  itBundled("naming/NodeTargetEsmEmitsMjs#10607", {
    files: {
      "/a/entry.ts": `console.log(1);`,
      "/b/entry.ts": `console.log(2);`,
    },
    target: "node",
    entryPointsRaw: ["./a/entry.ts", "./b/entry.ts"],
    run: [
      { file: "/out/a/entry.mjs", stdout: "1", runtime: "node" },
      { file: "/out/b/entry.mjs", stdout: "2", runtime: "node" },
    ],
    onAfterBundle(api) {
      api.assertFileExists("/out/a/entry.mjs");
      api.assertFileExists("/out/b/entry.mjs");
    },
  });
  itBundled("naming/NodeTargetEsmSplittingEmitsMjs#10607", {
    files: {
      "/shared.ts": `export const v = 42;`,
      "/a.ts": `import { v } from "./shared"; console.log("a", v);`,
      "/b.ts": `import { v } from "./shared"; console.log("b", v);`,
    },
    target: "node",
    splitting: true,
    entryPointsRaw: ["./a.ts", "./b.ts"],
    run: [
      { file: "/out/a.mjs", stdout: "a 42", runtime: "node" },
      { file: "/out/b.mjs", stdout: "b 42", runtime: "node" },
    ],
    onAfterBundle(api) {
      // The shared chunk is .mjs and the entries reference it by that name.
      api.expectFile("/out/a.mjs").toMatch(/from "\.\/[^"]+\.mjs"/);
      api.expectFile("/out/b.mjs").toMatch(/from "\.\/[^"]+\.mjs"/);
    },
  });
  itBundled("naming/NodeTargetCjsEmitsJs", {
    files: {
      "/a/entry.ts": `console.log(1);`,
      "/b/entry.ts": `console.log(2);`,
    },
    target: "node",
    format: "cjs",
    entryPointsRaw: ["./a/entry.ts", "./b/entry.ts"],
    run: [
      { file: "/out/a/entry.js", stdout: "1", runtime: "node" },
      { file: "/out/b/entry.js", stdout: "2", runtime: "node" },
    ],
  });
  itBundled("naming/BrowserTargetEsmEmitsJs", {
    files: {
      "/a/entry.ts": `console.log(1);`,
      "/b/entry.ts": `console.log(2);`,
    },
    target: "browser",
    entryPointsRaw: ["./a/entry.ts", "./b/entry.ts"],
    run: [
      { file: "/out/a/entry.js", stdout: "1" },
      { file: "/out/b/entry.js", stdout: "2" },
    ],
  });
  itBundled("naming/NodeTargetEntryNamingOverridesExt", {
    files: {
      "/a/entry.ts": `console.log(1);`,
      "/b/entry.ts": `console.log(2);`,
    },
    target: "node",
    entryNaming: "[dir]/[name].js",
    entryPointsRaw: ["./a/entry.ts", "./b/entry.ts"],
    onAfterBundle(api) {
      api.assertFileExists("/out/a/entry.js");
      api.assertFileExists("/out/b/entry.js");
    },
  });
  // A `--target node` build that imports HTML emits the server chunk as .mjs
  // but the browser-side chunk referenced from the HTML stays .js; the
  // extension follows the chunk's own target, not the global one.
  itBundled("naming/NodeTargetHtmlImportBrowserChunkStaysJs", {
    files: {
      "/server.ts": `import page from "./index.html"; console.log(JSON.stringify(page));`,
      "/index.html": `<!DOCTYPE html><script type="module" src="./client.ts"></script>`,
      "/client.ts": `console.log("client");`,
    },
    target: "node",
    outdir: "/out",
    outputPaths: ["/out/server.mjs"],
    entryPointsRaw: ["./server.ts"],
    onAfterBundle(api) {
      api.assertFileExists("/out/server.mjs");
      const html = api.readFile("/out/index.html");
      const m = html.match(/src="\.\/([^"]+)"/);
      if (!m) throw new Error("no script src in " + html);
      if (!m[1].endsWith(".js")) throw new Error("browser chunk should be .js, got " + m[1]);
      api.assertFileExists("/out/" + m[1]);
      api.expectFile("/out/server.mjs").toContain(m[1]);
    },
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
});
