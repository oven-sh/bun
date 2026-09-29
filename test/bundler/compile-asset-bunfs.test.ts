// https://github.com/oven-sh/bun/issues/15734
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, sep } from "path";

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
        import os from "node:os";
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
        const recursiveDirents = fs.readdirSync(root, { withFileTypes: true, recursive: true });
        const appCss = recursiveDirents.find(e => e.name === "app.css");
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
          // parentPath is the caller's string verbatim (no platform normalization)
          parentPaths: [...new Set(entries.map(e => e.parentPath))],
          nestedParentPath: appCss?.parentPath,
          emptyFile: fs.readFileSync(path.join(root, "empty.txt"), "utf8"),
          emptyFileBuffer: fs.readFileSync(path.join(root, "empty.txt")).length,
          embeddedFileCount: Bun.embeddedFiles.length,
        };

        // readdir on a non-existent /$bunfs/ path
        const missing = path.join(import.meta.dir, "does-not-exist");
        const enoent = {
          code: errcode(() => fs.readdirSync(missing)),
          path: (() => { try { fs.readdirSync(missing); } catch (e: any) { return e.path; } })(),
          exists: fs.existsSync(missing),
        };

        // --asset single file
        const cfg = path.join(import.meta.dir, "config.json");
        const singleFile = {
          exists: fs.existsSync(cfg),
          content: fs.readFileSync(cfg, "utf8"),
          readdirCode: errcode(() => fs.readdirSync(cfg)),
        };

        // Bun.Glob over the embedded tree (issue #40932)
        const realDir = fs.mkdtempSync(path.join(os.tmpdir(), "bunfs-glob-real-"));
        fs.writeFileSync(path.join(realDir, "real.txt"), "x");
        const realDirPosix = realDir.split(path.sep).join("/");
        const rootPosix = root.split(path.sep).join("/");
        const glob = {
          scanSync: [...new Bun.Glob("*").scanSync(root)].sort(),
          scanAsync: (await Array.fromAsync(new Bun.Glob("*").scan(root))).sort(),
          recursive: [...new Bun.Glob("**/*").scanSync(root)].sort(),
          onlyFilesFalse: [...new Bun.Glob("*").scanSync({ cwd: root, onlyFiles: false })].sort(),
          nestedWildcard: [...new Bun.Glob("_app/immutable/*.css").scanSync(root)].sort(),
          literalFile: [...new Bun.Glob("_app/immutable/app.css").scanSync(root)].sort(),
          absoluteOpt: [...new Bun.Glob("*").scanSync({ cwd: root, absolute: true })].sort(),
          absolutePattern: [...new Bun.Glob(rootPosix + "/*").scanSync({})].sort(),
          // A bunfs cwd with an absolute real-fs pattern walks the real filesystem
          // (an absolute pattern ignores the cwd).
          mixedRealAbsolute: [...new Bun.Glob(realDirPosix + "/*").scanSync({ cwd: import.meta.dir })],
          // A real-fs cwd inside a compiled executable still walks the real filesystem.
          realCwdRelative: [...new Bun.Glob("*").scanSync(realDir)],
          // Pins the current walker behavior for a fully-literal absolute pattern:
          // the match is dropped ([]), on the real filesystem and in the embedded
          // graph alike. If a walker fix changes this, both must change together.
          absoluteLiteralFile: [...new Bun.Glob(rootPosix + "/index.html").scanSync({})],
          enoentCode: errcode(() => [...new Bun.Glob("*").scanSync(missing)]),
          enotdirCode: errcode(() => [...new Bun.Glob("*").scanSync(indexHtml)]),
        };
        fs.rmSync(realDir, { recursive: true, force: true });

        console.log(JSON.stringify({ fileLoader, client, enoent, missing, singleFile, glob, realDirPosix }));
      `,
        "data.txt": "hello",
        "client/index.html": "<!doctype html><h1>hi</h1>",
        "client/empty.txt": "",
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
        "empty.txt",
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
          entries: ["_app", "empty.txt", "favicon.svg", "index.html"],
          byName: {
            _app: { isDir: true, isFile: false },
            "empty.txt": { isDir: false, isFile: true },
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
          parentPaths: [r.client.root],
          nestedParentPath: join(r.client.root, "_app", "immutable"),
          emptyFile: "",
          emptyFileBuffer: 0,
          embeddedFileCount: expect.any(Number),
        },
        enoent: { code: "ENOENT", path: r.missing, exists: false },
        missing: expect.stringMatching(/[/\\]root[/\\]does-not-exist$/),
        singleFile: { exists: true, content: `{"ok":true}`, readdirCode: "ENOTDIR" },
        glob: {
          scanSync: ["empty.txt", "favicon.svg", "index.html"],
          scanAsync: ["empty.txt", "favicon.svg", "index.html"],
          recursive: [
            join("_app", "immutable", "app.css"),
            join("_app", "immutable", "chunks", "entry.js"),
            "empty.txt",
            "favicon.svg",
            "index.html",
          ].sort(),
          onlyFilesFalse: ["_app", "empty.txt", "favicon.svg", "index.html"],
          nestedWildcard: [join("_app", "immutable", "app.css")],
          literalFile: [join("_app", "immutable", "app.css")],
          absoluteOpt: ["empty.txt", "favicon.svg", "index.html"].map(n => join(r.client.root, n)).sort(),
          // An absolute pattern keeps its literal prefix verbatim, including its separator style.
          absolutePattern: ["empty.txt", "favicon.svg", "index.html"]
            .map(n => r.client.root.replaceAll(sep, "/") + "/" + n)
            .sort(),
          mixedRealAbsolute: [r.realDirPosix + "/real.txt"],
          realCwdRelative: ["real.txt"],
          absoluteLiteralFile: [],
          enoentCode: "ENOENT",
          enotdirCode: "ENOTDIR",
        },
        realDirPosix: expect.any(String),
      });
      // recursive uses the platform path separator (same as Node's real-fs recursive readdir)
      expect(r.client.recursive.join("\n")).not.toContain(sep === "/" ? "\\" : "/");
      // data.txt + config.json + 5 under client/
      expect(r.client.embeddedFileCount).toBeGreaterThanOrEqual(7);
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

// https://github.com/oven-sh/bun/issues/44063
//
// dlopen() cannot read /$bunfs/, so an embedded shared library is written to a
// temp path first. A library's own dependencies resolve relative to that path
// ($ORIGIN on Linux, @loader_path on macOS), so every embedded shared library
// has to land in one directory that keeps the embedded layout. Needs a C
// compiler; Windows has no toolchain on CI for a .dll fixture.
const cc = isWindows ? null : (Bun.which("clang") ?? Bun.which("cc") ?? Bun.which("gcc"));

describe.concurrent.skipIf(!cc)("compile --asset: embedded shared libraries keep their layout", () => {
  const soExt = isMacOS ? "dylib" : "so";
  const FOO_C = "int foo(void) { return 42; }\n";
  const DECOY_C = "int foo(void) { return 1337; }\n";
  // N-API addon with no headers: the symbols resolve from the bun executable at dlopen time.
  const ADDON_C = /* c */ `
    typedef struct napi_env__* napi_env; typedef struct napi_value__* napi_value;
    int napi_create_int32(napi_env, int, napi_value*);
    int napi_set_named_property(napi_env, napi_value, const char*, napi_value);
    int foo(void);
    napi_value napi_register_module_v1(napi_env env, napi_value exports) {
      napi_value v; napi_create_int32(env, foo(), &v);
      napi_set_named_property(env, exports, "answer", v); return exports;
    }
  `;
  const BAR_C = "int foo(void); int bar(void) { return foo() + 1; }\n";

  async function run_cc(cwd: string, args: string[]) {
    await using proc = Bun.spawn({ cmd: [cc!, ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (code !== 0) throw new Error(`cc failed (exit ${code})\n${stdout}\n${stderr}`);
  }

  // lib/libfoo.<so>, then `out` in lib/ that links it and searches `rpaths`
  // (default: next to itself) for it, in that order.
  async function buildLibs(dir: string, sources: Record<string, string>, rpaths?: string[]) {
    const origin = isMacOS ? "@loader_path" : "$ORIGIN";
    const foo = isMacOS
      ? ["-dynamiclib", "foo.c", "-o", `lib/libfoo.dylib`, "-install_name", "@rpath/libfoo.dylib"]
      : ["-shared", "-fPIC", "foo.c", "-o", "lib/libfoo.so"];
    await run_cc(dir, foo);
    for (const [out, src] of Object.entries(sources)) {
      const link = ["-Llib", "-lfoo", ...(rpaths ?? [origin]).map(r => "-Wl,-rpath," + r)];
      const args = isMacOS
        ? [out.endsWith(".node") ? "-bundle" : "-dynamiclib", src, "-o", out, "-undefined", "dynamic_lookup", ...link]
        : ["-shared", "-fPIC", src, "-o", out, ...link];
      await run_cc(dir, args);
    }
  }

  // The compiled binary runs from another cwd with its own temp dir, so the
  // only place the libraries can come from is the executable itself.
  async function runIsolated(dir: string, extractDir: string) {
    await using proc = Bun.spawn({
      cmd: [join(dir, "app" + exe)],
      cwd: extractDir,
      env: { ...bunEnv, BUN_TMPDIR: extractDir, TMPDIR: extractDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, code };
  }

  function extracted(extractDir: string, suffix: string): string[] {
    return (readdirSync(extractDir, { recursive: true }) as string[])
      .filter(f => f.endsWith(suffix))
      .map(f => f.split(sep).join("/"));
  }

  test(
    "a required .node addon finds the --asset library next to it",
    async () => {
      using dir = tempDir("bunfs-addon-sibling", {
        "foo.c": FOO_C,
        "addon.c": ADDON_C,
        "lib/.keep": "",
        "index.ts": /* ts */ `
          const addon = require("./lib/addon.node");
          const direct = { exports: {} as any };
          process.dlopen(direct, "/$bunfs/root/lib/addon.node");
          const url = { exports: {} as any };
          process.dlopen(url, "file:///$bunfs/root/lib/addon.node");
          console.log(JSON.stringify([addon.answer, direct.exports.answer, url.exports.answer]));
        `,
      });
      await buildLibs(String(dir), { "lib/addon.node": "addon.c" });
      await compile(String(dir), ["--asset", "lib"]);

      using extractRoot = tempDir("bunfs-addon-sibling-extract", {});
      const extractDir = String(extractRoot);
      const first = await runIsolated(String(dir), extractDir);
      expect(first.stderr).not.toContain("ERR_DLOPEN_FAILED");
      expect(first.stdout.trim()).toBe("[42,42,42]");
      expect(first.code).toBe(0);

      // One addon file, next to the one library file: the hoisted
      // `addon-[hash].node` copy resolves to its `lib/addon.node` twin.
      const addons = extracted(extractDir, ".node");
      const libs = extracted(extractDir, "libfoo." + soExt);
      expect(addons).toHaveLength(1);
      expect(libs).toHaveLength(1);
      expect(dirname(addons[0])).toBe(dirname(libs[0]));
      expect(addons[0].endsWith("/lib/addon.node")).toBe(true);

      // A second run reuses the extracted directory.
      const second = await runIsolated(String(dir), extractDir);
      expect(second.stdout.trim()).toBe("[42,42,42]");
      expect(second.code).toBe(0);
      expect(extracted(extractDir, ".node")).toEqual(addons);
      expect(extracted(extractDir, "libfoo." + soExt)).toEqual(libs);

      // A temp sweeper that removes one file, not the tree: the next run puts
      // the set back and leaves no scratch directory behind.
      rmSync(join(extractDir, libs[0]));
      const third = await runIsolated(String(dir), extractDir);
      expect(third.stderr).not.toContain("ERR_DLOPEN_FAILED");
      expect(third.stdout.trim()).toBe("[42,42,42]");
      expect(third.code).toBe(0);
      expect(extracted(extractDir, ".node")).toEqual(addons);
      expect(extracted(extractDir, "libfoo." + soExt)).toEqual(libs);
      expect(readdirSync(extractDir)).toHaveLength(1);
    },
    TIMEOUT,
  );

  // A search path that climbs out of the embedded tree used to land in the
  // shared temp directory, where any local user can create an entry. The build
  // records the climb and the runtime nests the mirror that deep, so the
  // lookup ends inside the 0700 directory the user owns.
  test(
    "a search path that climbs out of the embedded tree stays inside Bun's own directory",
    async () => {
      const origin = isMacOS ? "@loader_path" : "$ORIGIN";
      using dir = tempDir("bunfs-addon-climb", {
        "foo.c": FOO_C,
        "decoy.c": DECOY_C,
        "addon.c": ADDON_C,
        "lib/.keep": "",
        "index.ts": `console.log(require("./lib/addon.node").answer);`,
      });
      // The first entry climbs two levels and looks in `lib` there, which is
      // the extraction directory itself when the mirror is not nested.
      await buildLibs(String(dir), { "lib/addon.node": "addon.c" }, [`${origin}/../../lib`, origin]);
      await compile(String(dir), ["--asset", "lib"]);

      using extractRoot = tempDir("bunfs-addon-climb-extract", {});
      const extractDir = String(extractRoot);
      const decoy = isMacOS
        ? ["-dynamiclib", "decoy.c", "-o", join(extractDir, "lib", "libfoo.dylib"), "-install_name", "@rpath/libfoo.dylib"]
        : ["-shared", "-fPIC", "decoy.c", "-o", join(extractDir, "lib", "libfoo.so"), "-Wl,-soname,libfoo.so"];
      mkdirSync(join(extractDir, "lib"), { recursive: true });
      await run_cc(String(dir), decoy);

      const result = await runIsolated(String(dir), extractDir);
      expect(result.stderr).not.toContain("ERR_DLOPEN_FAILED");
      // 1337 is the library beside the extraction directory.
      expect(result.stdout.trim()).toBe("42");
      expect(result.code).toBe(0);

      // The mirror sits one directory deeper than the embedded root, so the
      // climb ends in the `.bun-` directory instead of the extraction one.
      const addon = extracted(extractDir, "/lib/addon.node")[0];
      expect(addon).toMatch(/^\.bun-[^/]+\/[^/]+\/lib\/addon\.node$/);
      expect(extracted(extractDir, "libfoo." + soExt).filter(f => f.startsWith(".bun-"))).toHaveLength(1);
    },
    // Four `cc` runs and a `--compile` of its own, on top of the block's load.
    2 * TIMEOUT,
  );

  // One `dlopen` writes the library it asked for and the embedded libraries
  // that one needs. An unrelated embedded library is never written.
  test(
    "an unrelated embedded library is not written",
    async () => {
      using dir = tempDir("bunfs-addon-closure", {
        "foo.c": FOO_C,
        "unused.c": "int unused(void) { return 7; }\n",
        "addon.c": ADDON_C,
        "lib/.keep": "",
        "other/.keep": "",
        "index.ts": `console.log(require("./lib/addon.node").answer);`,
      });
      await buildLibs(String(dir), { "lib/addon.node": "addon.c" });
      await run_cc(
        String(dir),
        isMacOS
          ? ["-dynamiclib", "unused.c", "-o", `other/libunused.dylib`]
          : ["-shared", "-fPIC", "unused.c", "-o", "other/libunused.so"],
      );
      await compile(String(dir), ["--asset", "lib", "--asset", "other"]);

      using extractRoot = tempDir("bunfs-addon-closure-extract", {});
      const extractDir = String(extractRoot);
      const result = await runIsolated(String(dir), extractDir);
      expect(result.stderr).not.toContain("ERR_DLOPEN_FAILED");
      expect(result.stdout.trim()).toBe("42");
      expect(result.code).toBe(0);

      expect(extracted(extractDir, ".node")).toHaveLength(1);
      expect(extracted(extractDir, "libfoo." + soExt)).toHaveLength(1);
      expect(extracted(extractDir, "libunused." + soExt)).toHaveLength(0);
    },
    2 * TIMEOUT,
  );

  test(
    "bun:ffi dlopen of an embedded library finds its --asset dependency",
    async () => {
      using dir = tempDir("bunfs-ffi-sibling", {
        "foo.c": FOO_C,
        "bar.c": BAR_C,
        "lib/.keep": "",
        "index.ts": /* ts */ `
          import { dlopen } from "bun:ffi";
          import hoisted from "./lib/libbar.${soExt}" with { type: "file" };
          const symbols = { bar: { args: [], returns: "int" } } as const;
          const a = dlopen(hoisted, symbols).symbols.bar();
          const b = dlopen("/$bunfs/root/lib/libbar.${soExt}", symbols).symbols.bar();
          console.log(JSON.stringify([a, b]));
        `,
      });
      await buildLibs(String(dir), { [`lib/libbar.${soExt}`]: "bar.c" });
      await compile(String(dir), ["--asset", "lib"]);

      using extractRoot = tempDir("bunfs-ffi-sibling-extract", {});
      const result = await runIsolated(String(dir), String(extractRoot));
      expect(result.stderr).not.toContain("ERR_DLOPEN_FAILED");
      expect(result.stdout.trim()).toBe("[43,43]");
      expect(result.code).toBe(0);
    },
    TIMEOUT,
  );
});
