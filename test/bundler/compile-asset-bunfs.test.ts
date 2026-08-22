// https://github.com/oven-sh/bun/issues/15734
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join, sep } from "path";

// `bun build --compile` copies + rewrites the whole bun binary (~1GB under
// debug+ASAN), which blows the 5s default.
const TIMEOUT = 60_000;
const exe = process.platform === "win32" ? ".exe" : "";

async function compile(dir: string, extraArgs: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "./index.ts", "--outfile", "app", ...extraArgs],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (code !== 0) throw new Error(`compile failed (exit ${code})\n${stdout}\n${stderr}`);
}

async function run(dir: string) {
  // cwd outside the build dir so the binary cannot accidentally find real files on disk.
  await using proc = Bun.spawn({
    cmd: [join(dir, "app" + exe)],
    cwd: process.platform === "win32" ? process.env.TEMP || "C:\\Windows\\Temp" : "/tmp",
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, code };
}

describe.concurrent("compile --asset and /$bunfs/ directory semantics", () => {
  // One compiled binary exercises every CLI-side /$bunfs/ path we care about:
  // a file-loader asset's parent directory, an --asset directory tree, an
  // --asset single file, and the ENOENT/ENOTDIR/EISDIR/EACCES error paths.
  // These used to be four separate `bun build --compile` invocations.
  test(
    "CLI: file-loader asset, --asset dir + file, and /$bunfs/ fs semantics",
    async () => {
      using dir = tempDir("bunfs-cli", {
        "index.ts": /* ts */ `
        import asset from "./data.txt" with { type: "file" };
        import fs from "node:fs";
        import path from "node:path";

        function errcode(fn: () => unknown): string {
          try { fn(); return ""; } catch (e: any) { return e.code; }
        }

        // file-loader asset: parent-directory semantics
        const assetDir = path.dirname(asset);
        const fileLoader = {
          assetExists: fs.existsSync(asset),
          dirExists: fs.existsSync(assetDir),
          dirExistsTrailingSlash: fs.existsSync(assetDir + "/"),
          dirStatIsDir: fs.statSync(assetDir).isDirectory(),
          dirLstatIsDir: fs.lstatSync(assetDir).isDirectory(),
          accessOk: errcode(() => fs.accessSync(assetDir)) === "",
          accessWriteErr: errcode(() => fs.accessSync(asset, fs.constants.W_OK)),
          readdir: fs.readdirSync(assetDir).sort(),
          readdirHasAsset: fs.readdirSync(assetDir).includes(path.basename(asset)),
        };

        // --asset directory tree (mirrors svelte-adapter-bun: walk a directory
        // relative to the bundled entry, stat each entry, serve via Bun.file())
        const root = path.join(import.meta.dir, "client");
        if (!fs.existsSync(root)) throw new Error("client dir missing: " + root);
        const entries = fs.readdirSync(root, { withFileTypes: true });
        const byName: Record<string, { isDir: boolean; isFile: boolean }> = {};
        for (const e of entries) byName[e.name] = { isDir: e.isDirectory(), isFile: e.isFile() };
        const indexHtml = path.join(root, "index.html");
        const nestedCss = path.join(root, "_app", "immutable", "app.css");
        const client = {
          root,
          entries: Object.keys(byName).sort(),
          byName,
          indexHtmlExists: fs.existsSync(indexHtml),
          indexHtmlSize: fs.statSync(indexHtml).size,
          indexHtmlContent: await Bun.file(indexHtml).text(),
          nestedCssExists: fs.existsSync(nestedCss),
          nestedCssContent: await Bun.file(nestedCss).text(),
          nestedCssViaReadFile: fs.readFileSync(nestedCss, "utf8"),
          nestedDirIsDir: fs.statSync(path.join(root, "_app", "immutable")).isDirectory(),
          readFileDirErr: errcode(() => fs.readFileSync(root)),
          recursive: fs.readdirSync(root, { recursive: true }).map(String).sort(),
          recursiveAsync: (await fs.promises.readdir(root, { recursive: true })).map(String).sort(),
          embeddedFileCount: Bun.embeddedFiles.length,
        };

        // readdir on a non-existent /$bunfs/ path
        const missing = path.join(import.meta.dir, "does-not-exist");
        const enoent = {
          code: errcode(() => fs.readdirSync(missing)),
          exists: fs.existsSync(missing),
        };

        // --asset single file
        const cfg = path.join(import.meta.dir, "config.json");
        const singleFile = {
          exists: fs.existsSync(cfg),
          content: fs.readFileSync(cfg, "utf8"),
          readdirCode: errcode(() => fs.readdirSync(cfg)),
        };

        console.log(JSON.stringify({ fileLoader, client, enoent, singleFile }));
      `,
        "data.txt": "hello",
        "client/index.html": "<!doctype html><h1>hi</h1>",
        "client/favicon.svg": "<svg/>",
        "client/_app/immutable/app.css": "body{margin:0}",
        "client/_app/immutable/chunks/entry.js": "export default 1;",
        "config.json": `{"ok":true}`,
      });

      await compile(String(dir), ["--asset", "./client", "--asset", "./config.json"]);
      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      const r = JSON.parse(stdout.trim());

      const expectedRecursive = [
        "_app",
        join("_app", "immutable"),
        join("_app", "immutable", "app.css"),
        join("_app", "immutable", "chunks"),
        join("_app", "immutable", "chunks", "entry.js"),
        "favicon.svg",
        "index.html",
      ].sort();

      expect(r).toEqual({
        fileLoader: {
          assetExists: true,
          dirExists: true,
          dirExistsTrailingSlash: true,
          dirStatIsDir: true,
          dirLstatIsDir: true,
          accessOk: true,
          accessWriteErr: "EACCES",
          // the hashed file-loader name is covered by readdirHasAsset
          readdir: expect.arrayContaining(["client", "config.json"]),
          readdirHasAsset: true,
        },
        client: {
          root: expect.stringMatching(/[/\\]root[/\\]client$/),
          entries: ["_app", "favicon.svg", "index.html"],
          byName: {
            _app: { isDir: true, isFile: false },
            "favicon.svg": { isDir: false, isFile: true },
            "index.html": { isDir: false, isFile: true },
          },
          indexHtmlExists: true,
          indexHtmlSize: "<!doctype html><h1>hi</h1>".length,
          indexHtmlContent: "<!doctype html><h1>hi</h1>",
          nestedCssExists: true,
          nestedCssContent: "body{margin:0}",
          nestedCssViaReadFile: "body{margin:0}",
          nestedDirIsDir: true,
          readFileDirErr: "EISDIR",
          recursive: expectedRecursive,
          recursiveAsync: expectedRecursive,
          embeddedFileCount: expect.any(Number),
        },
        enoent: { code: "ENOENT", exists: false },
        singleFile: { exists: true, content: `{"ok":true}`, readdirCode: "ENOTDIR" },
      });
      // recursive uses the platform path separator (same as Node's real-fs recursive readdir)
      expect(r.client.recursive.join("\n")).not.toContain(sep === "/" ? "\\" : "/");
      // data.txt + config.json + 4 under client/
      expect(r.client.embeddedFileCount).toBeGreaterThanOrEqual(6);
      expect(code).toBe(0);
    },
    TIMEOUT,
  );

  // --asset embeds files under the same /$bunfs/root/ directory the entry
  // chunk lives in, so the usual CommonJS idiom for locating files shipped
  // next to the code has to see that directory as __dirname. The source tree
  // is deleted before the binary runs so a build-machine path cannot satisfy
  // the read.
  //
  // ESM output gets the value from import.meta (platform separators). With
  // --bytecode the output is CJS and the value comes from the module wrapper,
  // whose parameters are the standalone graph key: forward-slashed even on
  // Windows, where the wrapper used to split on backslash only and produce "".
  test.each([
    ["esm", [], isWindows ? "B:\\~BUN\\root" : "/$bunfs/root"],
    ["--bytecode (cjs wrapper)", ["--bytecode"], isWindows ? "B:/~BUN/root" : "/$bunfs/root"],
  ])(
    "--asset files are reachable through __dirname after the build tree is gone (%s)",
    async (_, extraArgs, expectedDirname) => {
      using dir = tempDir("bunfs-asset-dirname", {
        "index.ts": /* ts */ `
          const fs = require("node:fs");
          const path = require("node:path");
          console.log(JSON.stringify({
            dirname: __dirname,
            filename: __filename,
            dirnameIsImportMetaDir: __dirname === import.meta.dir,
            greeting: fs.readFileSync(path.join(__dirname, "data", "greeting.txt"), "utf8"),
          }));
        `,
        "data/greeting.txt": "hello from an embedded asset",
      });
      await compile(String(dir), ["--asset", "./data", ...extraArgs]);
      rmSync(join(String(dir), "data"), { recursive: true });

      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({
        dirname: expectedDirname,
        filename: expect.stringMatching(/^.*[/\\]root[/\\]app(\.exe)?$/),
        dirnameIsImportMetaDir: true,
        greeting: "hello from an embedded asset",
      });
      expect(code).toBe(0);
    },
    TIMEOUT,
  );

  // One Bun.build() covers both the directory-asset and the single-file-asset
  // JS-API paths, including the index.js-does-not-collide-with-entry case.
  // These used to be two separate Bun.build() calls (each writes a ~1GB binary).
  test(
    "Bun.build({compile: {assets}}): directory + file assets, entry keyed at basename(outfile)",
    async () => {
      using dir = tempDir("bunfs-jsapi", {
        "index.ts": /* ts */ `
          import fs from "node:fs";
          import path from "node:path";
          const root = path.join(import.meta.dir, "public");
          console.log(JSON.stringify({
            entries: fs.readdirSync(root).sort(),
            content: fs.readFileSync(path.join(root, "index.html"), "utf8"),
            subCss: fs.readFileSync(path.join(root, "sub", "a.css"), "utf8"),
            // entry is keyed at basename(outfile), so an index.js asset is readable as itself
            indexJs: fs.readFileSync(path.join(import.meta.dir, "index.js"), "utf8"),
          }));
        `,
        "public/index.html": "<h1>js-api</h1>",
        "public/sub/a.css": "body{}",
        "cfg/index.js": `ASSET_CONTENT`,
      });

      const result = await Bun.build({
        entrypoints: [join(String(dir), "index.ts")],
        compile: {
          outfile: join(String(dir), "app"),
          assets: [join(String(dir), "public"), join(String(dir), "cfg", "index.js")],
        },
      });
      expect(result.success).toBe(true);

      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({
        entries: ["index.html", "sub"],
        content: "<h1>js-api</h1>",
        subCss: "body{}",
        indexJs: "ASSET_CONTENT",
      });
      expect(code).toBe(0);
    },
    TIMEOUT,
  );

  test(
    "Bun.build({compile: {assets}}) rejects colliding paths",
    async () => {
      using dir = tempDir("bunfs-asset-jsapi-err", {
        "index.ts": `console.log("x");`,
        "a/data.json": `1`,
        "b/data.json": `2`,
      });
      const result = await Bun.build({
        entrypoints: [join(String(dir), "index.ts")],
        throw: false,
        compile: {
          outfile: join(String(dir), "app"),
          assets: [join(String(dir), "a", "data.json"), join(String(dir), "b", "data.json")],
        },
      });
      expect(result.success).toBe(false);
      const logs = result.logs.map(String).join("\n");
      expect(logs).toContain("collides");
      expect(logs).toContain("data.json");
    },
    TIMEOUT,
  );

  test(
    "--asset errors on colliding embedded paths",
    async () => {
      using dir = tempDir("bunfs-asset-collide", {
        "index.ts": `console.log("unreachable");`,
        "a/config.json": `1`,
        "b/config.json": `2`,
      });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--compile",
          "./index.ts",
          "--outfile",
          "app",
          "--asset",
          "./a/config.json",
          "--asset",
          "./b/config.json",
        ],
        cwd: String(dir),
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, code] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("collides");
      expect(stderr).toContain("config.json");
      expect(code).not.toBe(0);
    },
    TIMEOUT,
  );

  test(
    "--asset errors when its basename matches --outfile",
    async () => {
      using dir = tempDir("bunfs-asset-entry", {
        "index.ts": `console.log("unreachable");`,
        "client/index.html": `x`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "./index.ts", "--outfile", "./dist/client", "--asset", "./client"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, code] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("same path as the entry point");
      expect(code).not.toBe(0);
    },
    TIMEOUT,
  );

  test.each([
    [["build", "./index.ts", "--asset", "./public"], "--asset requires --compile"],
    [
      ["build", "--compile", "--target=browser", "./index.html", "--asset", "./public"],
      "--target browser with --asset",
    ],
    [["build", "--compile", "./index.ts", "--outfile", "app", "--asset", "./does-not-exist"], "failed to read asset"],
    ...(process.platform === "win32"
      ? []
      : [
          [
            ["build", "--compile", "./index.ts", "--outfile", "app", "--asset", "/dev/null"],
            "is not a regular file or directory",
          ] as const,
        ]),
  ])(
    "rejects %j",
    async (args, expected) => {
      using dir = tempDir("bunfs-asset-reject", {
        "index.ts": `console.log("x");`,
        "index.html": `<!doctype html>`,
        "public/a.txt": `a`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        cwd: String(dir),
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, code] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(expected);
      expect(code).not.toBe(0);
    },
    TIMEOUT,
  );
});
