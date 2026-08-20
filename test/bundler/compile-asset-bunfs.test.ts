// https://github.com/oven-sh/bun/issues/15734
import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { tmpdir } from "os";
import { basename, join } from "path";

// `bun build --compile` copies + rewrites the whole bun binary (~1GB under
// debug+ASAN), which blows the 5s default.
const TIMEOUT = 60_000;
const exe = isWindows ? ".exe" : "";

// Inside a compiled executable, import.meta.dir/path use the platform form of
// the virtual root while file-loader asset paths use its forward-slash form.
const root = isWindows ? "B:\\~BUN\\root" : "/$bunfs/root";
const publicRoot = isWindows ? "B:/~BUN/root" : "/$bunfs/root";

// One program + asset layout is compiled once through the CLI and once through
// Bun.build(); both executables must print exactly expectedOutput(). It covers
// a file-loader asset and its parent directory, an asset directory tree walked
// the way svelte-adapter-bun does (readdir, stat, Bun.file()), a single-file
// asset, an asset named like the entry point's source file (the entry is keyed
// at basename(outfile), so it must not collide), and the ENOENT / ENOTDIR /
// EISDIR / EACCES error paths of the virtual filesystem.
const assetArgs = ["./client", "./config.json", "./cfg/index.js"];
const files = {
  "index.ts": /* ts */ `
    import asset from "./data.txt" with { type: "file" };
    import fs from "node:fs";
    import path from "node:path";

    const code = (fn: () => unknown) => {
      try {
        fn();
        return null;
      } catch (e: any) {
        return e.code;
      }
    };
    const dir = import.meta.dir;
    const assetDir = path.dirname(asset);
    const client = path.join(dir, "client");
    const config = path.join(dir, "config.json");
    const missing = path.join(dir, "does-not-exist");

    console.log(
      JSON.stringify({
        dir,
        entry: import.meta.path,
        rootEntries: fs.readdirSync(dir).sort(),
        embeddedFiles: Bun.embeddedFiles.map(f => f.name).sort(),
        asset,
        assetContent: fs.readFileSync(asset, "utf8"),
        assetWritable: code(() => fs.accessSync(asset, fs.constants.W_OK)),
        assetDir: {
          path: assetDir,
          exists: fs.existsSync(assetDir),
          existsWithTrailingSlash: fs.existsSync(assetDir + "/"),
          statIsDirectory: fs.statSync(assetDir).isDirectory(),
          lstatIsDirectory: fs.lstatSync(assetDir).isDirectory(),
          access: code(() => fs.accessSync(assetDir)),
          entries: fs.readdirSync(assetDir).sort(),
        },
        client: {
          entries: fs
            .readdirSync(client, { withFileTypes: true })
            .map(e => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }))
            .sort((a, b) => (a.name < b.name ? -1 : 1)),
          indexHtmlSize: fs.statSync(path.join(client, "index.html")).size,
          indexHtml: await Bun.file(path.join(client, "index.html")).text(),
          nestedCss: await Bun.file(path.join(client, "_app", "immutable", "app.css")).text(),
          nestedCssViaReadFile: fs.readFileSync(path.join(client, "_app", "immutable", "app.css"), "utf8"),
          nestedDirIsDirectory: fs.statSync(path.join(client, "_app", "immutable")).isDirectory(),
          readFileOnDirectory: code(() => fs.readFileSync(client)),
          recursive: fs.readdirSync(client, { recursive: true }).map(String).sort(),
          recursiveAsync: (await fs.promises.readdir(client, { recursive: true })).map(String).sort(),
        },
        singleFile: {
          exists: fs.existsSync(config),
          content: fs.readFileSync(config, "utf8"),
          readdir: code(() => fs.readdirSync(config)),
        },
        entryNamedAsset: fs.readFileSync(path.join(dir, "index.js"), "utf8"),
        missing: {
          exists: fs.existsSync(missing),
          stat: code(() => fs.statSync(missing)),
          readdir: code(() => fs.readdirSync(missing)),
        },
      }),
    );
  `,
  "data.txt": "hello",
  "client/index.html": "<!doctype html><h1>hi</h1>",
  "client/favicon.svg": "<svg/>",
  "client/_app/immutable/app.css": "body{margin:0}",
  "client/_app/immutable/chunks/entry.js": "export default 1;",
  "config.json": `{"ok":true}`,
  "cfg/index.js": "ASSET_CONTENT",
};

function expectedOutput(assetName: string) {
  const rootEntries = ["app", "client", "config.json", assetName, "index.js"].sort();
  // recursive readdir joins with the platform separator, like it does on a real directory
  const clientTree = [
    "_app",
    join("_app", "immutable"),
    join("_app", "immutable", "app.css"),
    join("_app", "immutable", "chunks"),
    join("_app", "immutable", "chunks", "entry.js"),
    "favicon.svg",
    "index.html",
  ].sort();
  return {
    dir: root,
    entry: join(root, "app"),
    rootEntries,
    embeddedFiles: [
      "client/_app/immutable/app.css",
      "client/_app/immutable/chunks/entry.js",
      "client/favicon.svg",
      "client/index.html",
      "config.json",
      assetName,
      "index.js",
    ].sort(),
    asset: `${publicRoot}/${assetName}`,
    assetContent: "hello",
    assetWritable: "EACCES",
    assetDir: {
      path: publicRoot,
      exists: true,
      existsWithTrailingSlash: true,
      statIsDirectory: true,
      lstatIsDirectory: true,
      access: null,
      entries: rootEntries,
    },
    client: {
      entries: [
        { name: "_app", isDirectory: true, isFile: false },
        { name: "favicon.svg", isDirectory: false, isFile: true },
        { name: "index.html", isDirectory: false, isFile: true },
      ],
      indexHtmlSize: files["client/index.html"].length,
      indexHtml: files["client/index.html"],
      nestedCss: files["client/_app/immutable/app.css"],
      nestedCssViaReadFile: files["client/_app/immutable/app.css"],
      nestedDirIsDirectory: true,
      readFileOnDirectory: "EISDIR",
      recursive: clientTree,
      recursiveAsync: clientTree,
    },
    singleFile: { exists: true, content: files["config.json"], readdir: "ENOTDIR" },
    entryNamedAsset: files["cfg/index.js"],
    missing: { exists: false, stat: "ENOENT", readdir: "ENOENT" },
  };
}

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function expectAppOutput({ stdout, stderr, exitCode }: Awaited<ReturnType<typeof run>>) {
  expect(stderr).toBe("");
  const output = JSON.parse(stdout);
  // The file loader hashes the asset's name; everything else is exact.
  const assetName = basename(output.asset);
  expect(assetName).toMatch(/^data-[a-z0-9]+\.txt$/);
  expect(output).toEqual(expectedOutput(assetName));
  expect(exitCode).toBe(0);
}

describe.concurrent("compile --asset and /$bunfs/ directory semantics", () => {
  test(
    "bun build --compile --asset",
    async () => {
      using dir = tempDir("bunfs-cli", files);
      const assetFlags = assetArgs.flatMap(asset => ["--asset", asset]);
      const build = await run(
        [bunExe(), "build", "--compile", "./index.ts", "--outfile", "app", ...assetFlags],
        String(dir),
      );
      expect(build.stderr).toBe("");
      expect(build.exitCode).toBe(0);

      // Run from a cwd outside the build directory so the executable cannot find the real files on disk.
      expectAppOutput(await run([join(String(dir), "app" + exe)], tmpdir()));
    },
    TIMEOUT,
  );

  // Bun.build() writes the executable on the calling thread, and on Windows
  // spawning a freshly written executable blocks the caller until the antivirus
  // has scanned it. Doing both in a child process keeps this test from stalling
  // the rest of the file and lets its scan overlap with the CLI test's.
  test(
    "Bun.build({ compile: { assets } })",
    async () => {
      using dir = tempDir("bunfs-jsapi", {
        ...files,
        "build.ts": /* ts */ `
          import { tmpdir } from "node:os";
          import { join } from "node:path";

          await Bun.build({
            entrypoints: ["./index.ts"],
            compile: { outfile: "app", assets: ${JSON.stringify(assetArgs)} },
          });
          // Run from a cwd outside the build directory so the executable cannot find the real files on disk.
          const app = Bun.spawnSync({
            cmd: [join(import.meta.dir, "app${exe}")],
            cwd: tmpdir(),
            stdout: "inherit",
            stderr: "inherit",
          });
          process.exit(app.exitCode);
        `,
      });

      expectAppOutput(await run([bunExe(), "build.ts"], String(dir)));
    },
    TIMEOUT,
  );

  // Both front ends reject bad asset sets before the executable is written,
  // so none of the cases below copies the bun binary.
  const rejectFiles = {
    "index.ts": `console.log("unreachable");`,
    "index.html": `<!doctype html>`,
    "a/config.json": `1`,
    "b/config.json": `2`,
    "client/index.html": `x`,
    "public/a.txt": `a`,
  };
  const rejectEntries = ["a", "b", "client", "index.html", "index.ts", "public"];

  test.each([
    {
      name: "two assets embedding at the same path",
      outfile: "app",
      assets: ["a/config.json", "b/config.json"],
      error: `asset "<dir>/b/config.json" collides with another embedded file at "config.json"`,
    },
    {
      name: "an asset named like the outfile",
      outfile: "dist/client",
      assets: ["client"],
      error: `asset "<dir>/client" would embed at the same path as the entry point; use a different outfile`,
    },
  ])(
    "Bun.build({ compile: { assets } }) rejects $name",
    async ({ outfile, assets, error }) => {
      using dir = tempDir("bunfs-jsapi-reject", rejectFiles);
      const result = await Bun.build({
        entrypoints: [join(String(dir), "index.ts")],
        throw: false,
        compile: {
          outfile: join(String(dir), outfile),
          assets: assets.map(asset => join(String(dir), asset)),
        },
      });
      expect(result.logs.map(log => `${log.level}: ${normalizeBunSnapshot(log.message, String(dir))}`)).toEqual([
        `error: ${error}`,
      ]);
      expect(result.outputs).toEqual([]);
      expect(result.success).toBe(false);
      expect(readdirSync(String(dir)).sort()).toEqual(rejectEntries);
    },
    TIMEOUT,
  );

  test.each([
    {
      name: "two assets embedding at the same path",
      args: ["--compile", "./index.ts", "--outfile", "app", "--asset", "./a/config.json", "--asset", "./b/config.json"],
      error: `asset "./b/config.json" collides with another embedded file at "config.json"`,
    },
    {
      name: "an asset named like the outfile",
      args: ["--compile", "./index.ts", "--outfile", "./dist/client", "--asset", "./client"],
      error: `asset "./client" would embed at the same path as the entry point; use a different outfile`,
    },
    {
      name: "--asset without --compile",
      args: ["./index.ts", "--asset", "./public"],
      error: "--asset requires --compile",
    },
    {
      name: "--asset with --target=browser",
      args: ["--compile", "--target=browser", "./index.html", "--asset", "./public"],
      error: "cannot use --compile --target browser with --asset",
    },
    {
      name: "an asset that does not exist",
      args: ["--compile", "./index.ts", "--outfile", "app", "--asset", "./does-not-exist"],
      error: `failed to read asset "./does-not-exist": ENOENT: ./does-not-exist: No such file or directory (stat())`,
    },
    ...(isWindows
      ? []
      : [
          {
            name: "an asset that is neither a file nor a directory",
            args: ["--compile", "./index.ts", "--outfile", "app", "--asset", "/dev/null"],
            error: `asset "/dev/null" is not a regular file or directory`,
          },
        ]),
  ])(
    "bun build rejects $name",
    async ({ args, error }) => {
      using dir = tempDir("bunfs-cli-reject", rejectFiles);
      const { stdout, stderr, exitCode } = await run([bunExe(), "build", ...args], String(dir));
      expect(stdout).toBe("");
      expect(stderr).toBe(`error: ${error}\n`);
      expect(exitCode).toBe(1);
      expect(readdirSync(String(dir)).sort()).toEqual(rejectEntries);
    },
    TIMEOUT,
  );
});
