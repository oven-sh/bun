// https://github.com/oven-sh/bun/issues/15734
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
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

  // A disk resolves an empty part, "." and ".." of a path one by one. The executable looks a path up as written,
  // and then without those parts, as path.resolve() writes it.
  test(
    'a path with an empty part, "." or ".." names what path.resolve() of it names',
    async () => {
      using dir = tempDir("bunfs-spelled", {
        "app/index.ts": /* ts */ `
          import fs from "node:fs";
          import path from "node:path";
          import note from "../outside/note.txt" with { type: "file" };

          const outcome = async (run: () => unknown) => {
            try { return JSON.stringify(await run()) ?? "undefined"; } catch (e: any) { return "throws " + e.code; }
          };
          const apis: Record<string, (p: string) => unknown> = {
            existsSync: p => fs.existsSync(p),
            statSync: p => { const stats = fs.statSync(p); return [stats.isDirectory(), stats.size]; },
            lstatSync: p => fs.lstatSync(p).isFile(),
            accessSync: p => fs.accessSync(p),
            readFileSync: p => fs.readFileSync(p, "utf8"),
            readdirSync: p => fs.readdirSync(p).sort(),
            readlinkSync: p => fs.readlinkSync(p),
            writeFileSync: p => fs.writeFileSync(p, "x"),
            mkdirSync: p => fs.mkdirSync(p),
            unlinkSync: p => fs.unlinkSync(p),
            "promises.stat": async p => (await fs.promises.stat(p)).size,
            "promises.access": p => fs.promises.access(p),
            "promises.readFile": p => fs.promises.readFile(p, "utf8"),
            "promises.readdir": async p => (await fs.promises.readdir(p)).sort(),
            "Bun.file().text": p => Bun.file(p).text(),
            "Bun.file().size": p => Bun.file(p).size,
            "Bun.file().exists": p => Bun.file(p).exists(),
            "Bun.Glob": p => [...new Bun.Glob("*").scanSync(p)].sort(),
          };
          const client = path.join(import.meta.dir, "client");
          const spelled = [
            [client, ".", "index.html"],
            [client, "", "index.html"],
            [client, "sub", "..", "index.html"],
            [client, "sub", ".", "", "app.css"],
            [import.meta.dir, "..", path.basename(import.meta.dir), "client", "index.html"],
            [client, "."],
            [client, "sub", ".."],
            [client, ".", "sub"],
            [client, "", "sub", ""],
            // The executable has no folder that the build left out, so ".." removes a name that it does not hold.
            [client, "none", "..", "index.html"],
            [client, "none", ".."],
          ].map(parts => parts.join(path.sep));
          // Windows takes "/" too.
          spelled.push(client + "/./sub/../index.html");

          const differing: string[] = [];
          for (const name in apis) {
            for (const p of spelled) {
              const [asSpelled, asResolved] = [await outcome(() => apis[name](p)), await outcome(() => apis[name](path.resolve(p)))];
              if (asSpelled !== asResolved) differing.push(name + "(" + p + "): " + asSpelled + ", resolved: " + asResolved);
            }
          }

          const mod = [import.meta.dir, ".", "mod.js"].join(path.sep);
          const modules = {
            import: (await import(mod)).default,
            require: require([import.meta.dir, "client", "..", "mod.js"].join(path.sep)).default,
            resolveSync:
              Bun.resolveSync([import.meta.dir, "", "mod.js"].join(path.sep), import.meta.dir) ===
              Bun.resolveSync(path.join(import.meta.dir, "mod.js"), import.meta.dir),
            worker: await new Promise(resolve => {
              const worker = new Worker(mod);
              worker.onmessage = event => { resolve(event.data); worker.terminate(); };
              worker.onerror = event => resolve("error: " + event.message);
            }),
            // Every spelling names one module.
            loads: (globalThis as any).loads,
          };

          const executable = process.execPath.slice(path.parse(process.execPath).root.length - 1);
          console.log(JSON.stringify({
            differing,
            compared: Object.keys(apis).length * spelled.length,
            content: fs.readFileSync(spelled[0], "utf8"),
            entries: fs.readdirSync(spelled[5]).sort(),
            modules,
            // A key that holds ".." itself is found as written.
            keyWithParent: { holdsParent: note.includes(".."), exists: fs.existsSync(note), text: await Bun.file(note).text() },
            // ".." does not lead out of the root of the executable to a file on disk.
            outsideTheRoot: fs.existsSync([import.meta.dir, "..", ".."].join(path.sep) + executable),
          }));
        `,
        "app/mod.ts": /* ts */ `
          (globalThis as any).loads = ((globalThis as any).loads ?? 0) + 1;
          export default "mod";
          if (!Bun.isMainThread) postMessage("mod in a worker");
        `,
        "app/client/index.html": "<h1>hi</h1>",
        "app/client/sub/app.css": "body{}",
        "outside/note.txt": "a note",
      });
      const app = join(String(dir), "app");

      await compile(app, ["./mod.ts", "--asset", "./client", "--asset-naming", "[dir]/[name].[ext]"]);
      const { stdout, stderr, code } = await run(app);
      expect({ result: JSON.parse(stdout.trim() || "null"), stderr: stderr.trim(), code }).toEqual({
        result: {
          differing: [],
          compared: 18 * 12,
          content: "<h1>hi</h1>",
          entries: ["index.html", "sub"],
          modules: { import: "mod", require: "mod", resolveSync: true, worker: "mod in a worker", loads: 1 },
          keyWithParent: { holdsParent: true, exists: true, text: "a note" },
          outsideTheRoot: false,
        },
        stderr: "",
        code: 0,
      });
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

  // macOS and Windows reject these file names.
  test.skipIf(!isLinux)(
    "embeds assets whose file names aren't valid UTF-8",
    async () => {
      using dir = tempDir("bunfs-invalid-utf8", {
        "index.ts": `for (const file of Bun.embeddedFiles) console.log(await Bun.file("/$bunfs/root/" + file.name).text());`,
        "a/.keep": "",
        "b/.keep": "",
      });
      const write = (folder: string, name: Buffer) =>
        writeFileSync(Buffer.concat([Buffer.from(join(String(dir), folder) + sep), name, Buffer.from(".png")]), folder);
      write("a", Buffer.alloc(100, 0xe9));
      write("b", Buffer.from([0xe8]));
      write("b", Buffer.from([0xe9]));

      await using proc = Bun.spawn({
        cmd: ["sh", "-c", `"$0" build --compile ./index.ts ./a/*.png --outfile app`, bunExe()],
        cwd: String(dir),
        env: bunEnv,
        stdout: "ignore",
        stderr: "inherit",
      });
      expect(await proc.exited).toBe(0);
      expect(await run(String(dir))).toEqual({ stdout: "a\n", stderr: "", code: 0 });

      // Both names are stored as U+FFFD.
      // expect().rejects would wait in a nested event loop tick, which can drop the concurrent tests' pipe events.
      const error = await compile(String(dir), ["--asset", "./b"]).catch(error => error);
      expect(error?.message).toContain("collides");
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
