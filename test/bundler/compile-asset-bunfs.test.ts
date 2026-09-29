// https://github.com/oven-sh/bun/issues/15734
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isGlibc, isMacOS, isWindows, tempDir } from "harness";
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "path";

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

  // lib/libfoo.<so>, then `out` in lib/ that links it and looks for it next to itself.
  async function buildLibs(dir: string, sources: Record<string, string>) {
    const foo = isMacOS
      ? ["-dynamiclib", "foo.c", "-o", `lib/libfoo.dylib`, "-install_name", "@rpath/libfoo.dylib"]
      : ["-shared", "-fPIC", "foo.c", "-o", "lib/libfoo.so"];
    await run_cc(dir, foo);
    for (const [out, src] of Object.entries(sources)) {
      const link = ["-Llib", "-lfoo", "-Wl,-rpath," + (isMacOS ? "@loader_path" : "$ORIGIN")];
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

  // A library's search path can climb above the library: `$ORIGIN/../../lib`.
  // The extracted directory sits in the temp directory, where another user of
  // the machine can put files, so the layout has to sit as many levels below
  // the extracted directory as the search paths of its libraries climb. The
  // `planted` libraries below stand for that user's files: none may be loaded.
  const answers = (name: string, value: number) => `int ${name}(void) { return ${value}; }\n`;
  const addonOf = (expression: string, functions: string[]) => /* c */ `
    typedef struct napi_env__* napi_env; typedef struct napi_value__* napi_value;
    int napi_create_int32(napi_env, int, napi_value*);
    int napi_set_named_property(napi_env, napi_value, const char*, napi_value);
    ${functions.map(name => `int ${name}(void);`).join(" ")}
    napi_value napi_register_module_v1(napi_env env, napi_value exports) {
      napi_value v; napi_create_int32(env, ${expression}, &v);
      napi_set_named_property(env, exports, "answer", v); return exports;
    }
  `;
  const libraryFile = (name: string) => `lib${name}.${soExt}`;

  // `out` from `source`. It links the libraries `needs` (paths) and looks for
  // them in `searches`, in order, where `$ORIGIN` is the directory of `out`.
  async function link(
    dir: string,
    out: string,
    source: string,
    options: { needs?: string[]; searches?: string[]; flags?: string[] } = {},
  ) {
    const { needs = [], searches = [], flags = [] } = options;
    const kind = isMacOS
      ? out.endsWith("." + soExt)
        ? ["-dynamiclib", "-install_name", "@rpath/" + basename(out)]
        : ["-bundle"]
      : ["-shared", "-fPIC"];
    const lookup = isMacOS ? ["-undefined", "dynamic_lookup"] : [];
    const libraries = needs.flatMap(path => ["-L" + dirname(path), "-l" + basename(path).slice(3, -soExt.length - 1)]);
    const paths = isMacOS
      ? searches.map(path => "-Wl,-rpath," + path.replace("$ORIGIN", "@loader_path"))
      : searches.length > 0
        ? ["-Wl,-rpath," + searches.join(":")]
        : [];
    await run_cc(dir, [...kind, source, "-o", out, ...lookup, ...libraries, ...paths, ...flags]);
  }

  function plant(from: string, to: string) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }

  test(
    "a search path that climbs above the library stays in the extracted directory",
    async () => {
      // The shape of sharp's addon: five entries, the last climbs five levels
      // from a library four directories deep.
      const sharpShaped = [
        "$ORIGIN/../../y/lib",
        "$ORIGIN/../../../y/1.2.4/lib",
        "$ORIGIN/../../node_modules/@img/y/lib",
        "$ORIGIN/../../../node_modules/@img/y/lib",
        "$ORIGIN/../../../../../@img-y-npm-1.2.4-105fd6d44d/node_modules/@img/y/lib",
      ];
      using dir = tempDir("bunfs-search-climb", {
        "foo.c": answers("foo", 42),
        "y.c": answers("y", 40),
        "dep.c": answers("dep", 2),
        "planted-foo.c": answers("foo", 666),
        "planted-dep.c": answers("dep", 666),
        "addon.c": addonOf("foo()", ["foo"]),
        "scoped.c": addonOf("y() + dep()", ["y", "dep"]),
        "alone.c": addonOf("7", []),
        "lib/.keep": "",
        "node_modules/@img/x/lib/.keep": "",
        "node_modules/@img/y/lib/.keep": "",
        "real/.keep": "",
        "planted/.keep": "",
        "index.ts": /* ts */ `
          import tooDeep from "./too-deep.bin" with { type: "file" };
          const result = {
            addon: require("./lib/addon.node").answer,
            scoped: require("./node_modules/@img/x/lib/addon.node").answer,
            tooDeep: "loaded",
          };
          try {
            process.dlopen({ exports: {} }, tooDeep);
          } catch (e: any) {
            result.tooDeep = e.code;
          }
          console.log(JSON.stringify(result));
        `,
      });
      const root = String(dir);
      const foo = join("lib", libraryFile("foo"));
      const y = join("node_modules/@img/y/lib", libraryFile("y"));
      const dep = join("real", libraryFile("dep"));
      await Promise.all([
        link(root, foo, "foo.c"),
        link(root, y, "y.c"),
        link(root, dep, "dep.c"),
        link(root, join("planted", libraryFile("foo")), "planted-foo.c"),
        link(root, join("planted", libraryFile("dep")), "planted-dep.c"),
        // More levels than a path has room for (two bytes each).
        link(root, "too-deep.bin", "alone.c", {
          searches: ["$ORIGIN/" + Buffer.alloc(3 * (isMacOS ? 600 : 2100), "../").toString() + "lib"],
        }),
      ]);
      await Promise.all([
        link(root, "lib/addon.node", "addon.c", { needs: [foo], searches: ["$ORIGIN/../../lib", "$ORIGIN"] }),
        link(root, "node_modules/@img/x/lib/addon.node", "scoped.c", {
          needs: [y, dep],
          searches: [...sharpShaped, join(root, "real")],
          flags: isMacOS ? [] : ["-Wl,--disable-new-dtags"],
        }),
      ]);
      await compile(root, ["--asset", "lib", "--asset", "node_modules"]);

      using extractRoot = tempDir("bunfs-search-climb-extract", {});
      const extractDir = String(extractRoot);
      plant(join(root, "planted", libraryFile("foo")), join(extractDir, "lib", libraryFile("foo")));
      plant(
        join(root, "planted", libraryFile("dep")),
        join(extractDir, "@img-y-npm-1.2.4-105fd6d44d/node_modules/@img/y/lib", libraryFile("dep")),
      );

      const result = await runIsolated(root, extractDir);
      expect(result.stdout.trim()).toBe(JSON.stringify({ addon: 42, scoped: 42, tooDeep: "ERR_DLOPEN_FAILED" }));
      expect(result.code).toBe(0);

      // Both addons one level down in one directory, and nothing of the
      // library that has no room.
      const [mirror] = readdirSync(extractDir).filter(name => name.startsWith(".bun-"));
      expect({
        addons: extracted(extractDir, ".node").sort(),
        tooDeep: extracted(extractDir, ".bin"),
      }).toEqual({
        addons: [`${mirror}/_/lib/addon.node`, `${mirror}/_/node_modules/@img/x/lib/addon.node`],
        tooDeep: [],
      });

      if (isGlibc) {
        // The loader names every file it tries. Each one for an extracted
        // library is inside the extracted directory.
        await using proc = Bun.spawn({
          cmd: [join(root, "app" + exe)],
          cwd: extractDir,
          env: { ...bunEnv, BUN_TMPDIR: extractDir, TMPDIR: extractDir, LD_DEBUG: "libs" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const tried = stderr
          .split("\n")
          .map(line => line.split("trying file=")[1])
          .filter(path => path !== undefined)
          .map(path => resolve(path))
          .filter(path => path.startsWith(extractDir + sep));
        expect(tried.filter(path => !path.startsWith(join(extractDir, mirror) + sep))).toEqual([]);
        // `$ORIGIN/../../lib` of the addon in `_/lib`.
        expect(tried.some(path => path.startsWith(join(extractDir, mirror, "lib") + sep))).toBe(true);
        expect(stdout.trim()).toBe(JSON.stringify({ addon: 42, scoped: 42, tooDeep: "ERR_DLOPEN_FAILED" }));
        expect(code).toBe(0);
      }
    },
    TIMEOUT,
  );

  // A hoisted addon, and a library the bundler does not take for one, so each
  // is extracted on its own.
  test(
    "a library that another user put in the temp directory is not loaded",
    async () => {
      using dir = tempDir("bunfs-search-climb-hoisted", {
        "nine.c": answers("nine", 42),
        "eff.c": answers("eff", 42),
        "planted-nine.c": answers("nine", 666),
        "planted-eff.c": answers("eff", 666),
        "addon.c": addonOf("nine()", ["nine"]),
        "bar.c": "int eff(void); int bar(void) { return eff() + 1; }\n",
        "real/.keep": "",
        "planted/.keep": "",
        "index.ts": /* ts */ `
          import { dlopen } from "bun:ffi";
          import library from "./libbar.bin" with { type: "file" };
          const addon = require("./addon.node").answer;
          const ffi = dlopen(library, { bar: { args: [], returns: "int" } }).symbols.bar();
          console.log(JSON.stringify({ addon, ffi }));
        `,
      });
      const root = String(dir);
      const nine = join("real", libraryFile("nine"));
      const eff = join("real", libraryFile("eff"));
      await Promise.all([
        link(root, nine, "nine.c"),
        link(root, eff, "eff.c"),
        link(root, join("planted", libraryFile("nine")), "planted-nine.c"),
        link(root, join("planted", libraryFile("eff")), "planted-eff.c"),
      ]);
      await Promise.all([
        link(root, "addon.node", "addon.c", {
          needs: [nine],
          searches: ["$ORIGIN", "$ORIGIN/deps", "$ORIGIN/../../../../../../../../../lib", join(root, "real")],
        }),
        link(root, "libbar.bin", "bar.c", {
          needs: [eff],
          searches: ["$ORIGIN", "$ORIGIN/../lib", join(root, "real")],
        }),
      ]);
      await compile(root);

      // One planted library where each search path has pointed: the temp
      // directory, a directory in it, and nine levels up from a library at the
      // root of the extracted directory, which is eight above the temp directory.
      using extractRoot = tempDir("bunfs-search-climb-hoisted-extract", {});
      const extractDir = join(String(extractRoot), "1/2/3/4/5/6/7/8");
      for (const to of [extractDir, join(extractDir, "deps"), join(String(extractRoot), "lib")]) {
        plant(join(root, "planted", libraryFile("nine")), join(to, libraryFile("nine")));
      }
      for (const to of [extractDir, join(extractDir, "lib")]) {
        plant(join(root, "planted", libraryFile("eff")), join(to, libraryFile("eff")));
      }

      const result = await runIsolated(root, extractDir);
      expect(result.stdout.trim()).toBe(JSON.stringify({ addon: 42, ffi: 43 }));
      expect(result.code).toBe(0);
      expect({
        addon: extracted(extractDir, ".node").map(path => path.split("/").slice(1, -1)),
        ffi: extracted(extractDir, ".bin").map(path => path.split("/").slice(1, -1)),
      }).toEqual({
        addon: [Array(9).fill("_")],
        ffi: [["_"]],
      });
    },
    TIMEOUT,
  );

  // `$ORIGIN` in the name of a needed library, and in the name of an auxiliary
  // filter, which glibc loads in front of the library that names it.
  test.skipIf(!isGlibc)(
    "a library name with $ORIGIN that climbs above the library stays in the extracted directory",
    async () => {
      using dir = tempDir("bunfs-search-climb-names", {
        "dep.c": answers("dep", 1),
        "planted-dep.c": answers("dep", 666),
        "planted-foo.c": answers("foo", 666),
        "needed.c": addonOf("dep()", ["dep"]),
        "auxiliary.c": answers("foo", 42) + addonOf("foo()", ["foo"]),
        "lib/.keep": "",
        "real/.keep": "",
        "planted/.keep": "",
        "index.ts": /* ts */ `
          const result = { needed: "loaded", auxiliary: require("./lib/auxiliary.node").answer };
          try {
            result.needed = require("./lib/needed.node").answer;
          } catch (e: any) {
            result.needed = e.code;
          }
          console.log(JSON.stringify(result));
        `,
      });
      const root = String(dir);
      const dep = join("real", libraryFile("dep"));
      await Promise.all([
        link(root, dep, "dep.c", { flags: ["-Wl,-soname,$ORIGIN/../../lib/" + libraryFile("dep")] }),
        link(root, join("planted", libraryFile("dep")), "planted-dep.c"),
        link(root, join("planted", libraryFile("aux")), "planted-foo.c"),
        link(root, "lib/auxiliary.node", "auxiliary.c", {
          flags: ["-Wl,--auxiliary=$ORIGIN/../../lib/" + libraryFile("aux")],
        }),
      ]);
      await link(root, "lib/needed.node", "needed.c", { needs: [dep] });
      await compile(root, ["--asset", "lib"]);

      using extractRoot = tempDir("bunfs-search-climb-names-extract", {});
      const extractDir = String(extractRoot);
      for (const name of ["dep", "aux"]) {
        plant(join(root, "planted", libraryFile(name)), join(extractDir, "lib", libraryFile(name)));
      }

      const result = await runIsolated(root, extractDir);
      expect(result.stdout.trim()).toBe(JSON.stringify({ needed: "ERR_DLOPEN_FAILED", auxiliary: 42 }));
      expect(result.code).toBe(0);
    },
    TIMEOUT,
  );
});
