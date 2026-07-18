import { describe, test, expect } from "bun:test";
import { ESBUILD, itBundled } from "./expectBundled";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

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
  // assetNaming `[dir]` must be relative to the configured root even when
  // the root directory and the asset's source path spell the same on-disk
  // location differently. Bun canonicalizes `root` via the file descriptor
  // (`GetFinalPathNameByHandle` on Windows, /proc/self/fd on Linux) but
  // `Bun.build({ files })` source paths are the literal map keys; previously
  // the uncanonicalized source path was relativized against the canonical
  // root, so no common prefix was found and `[dir]` expanded to a long
  // `_.._/_.._/...` traversal back into the source tree. On Windows this
  // surfaced whenever the cwd contained an 8.3 short path component such as
  // `C:\Users\RUNNER~1\...` (the default TEMP directory in CI).
  test("naming/AssetNamingDirCanonicalRoot", async () => {
    using base = tempDir("asset-naming-dir-canon", {
      "real/src/lib/first/.keep": "",
      "real/src/lib/second/.keep": "",
    });
    const real = join(String(base), "real");
    const link = join(String(base), "project-link");
    // A junction needs no elevation on Windows; on POSIX this is a plain
    // directory symlink. Either way `root` below canonicalizes to `real/src`
    // while the `files` map keys keep the `project-link` spelling.
    symlinkSync(real, link, isWindows ? "junction" : "dir");

    const entry = join(link, "src/lib/first/file.js").replaceAll("\\", "/");
    const asset = join(link, "src/lib/second/data.file").replaceAll("\\", "/");
    const root = join(link, "src");

    const script = `
      const result = await Bun.build({
        entrypoints: [${JSON.stringify(entry)}],
        files: {
          ${JSON.stringify(entry)}: 'import f from "../second/data.file"; console.log(f);',
          ${JSON.stringify(asset)}: "this is a file",
        },
        root: ${JSON.stringify(root)},
        naming: { entry: "hello.[ext]", asset: "[dir]/test.[ext]" },
        loader: { ".file": "file" },
      });
      if (!result.success) {
        for (const m of result.logs) console.error(String(m));
        process.exit(1);
      }
      for (const out of result.outputs) console.log(out.kind + " " + out.path);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      cwd: String(base),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const assetLine = stdout.split("\n").find(l => l.startsWith("asset "));
    expect(assetLine).toBe("asset ./lib/second/test.file");
    expect(stdout).not.toContain("_.._");
    expect(exitCode).toBe(0);
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
});
