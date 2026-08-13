// https://github.com/oven-sh/bun/issues/15734
import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
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

async function run(dir: string, env: Record<string, string> = {}) {
  // cwd outside the build dir so the binary cannot accidentally find real files on disk.
  await using proc = Bun.spawn({
    cmd: [join(dir, "app" + exe)],
    cwd: process.platform === "win32" ? process.env.TEMP || "C:\\Windows\\Temp" : "/tmp",
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, code };
}

describe.concurrent("compile --asset and /$bunfs/ directory semantics", () => {
  // One compiled binary exercises every CLI-side /$bunfs/ path we care about:
  // a file-loader asset's parent directory, an --asset directory tree, an
  // --asset single file, fs.open()/createReadStream()/FileHandle on embedded
  // files, and the ENOENT/ENOTDIR/EISDIR/EACCES/EROFS error paths.
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
          accessExecErr: errcode(() => fs.accessSync(asset, fs.constants.X_OK)),
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

        // fs.open() hands out a real, read-only descriptor for an embedded file;
        // each one has its own offset. createReadStream and FileHandle are built
        // on open + read + close.
        const buf = Buffer.alloc(64);
        const fd = fs.openSync(nestedCss, "r");
        const fd2 = fs.openSync(nestedCss, "r");
        const empty = fs.openSync(path.join(import.meta.dir, "empty.txt"), "r");
        const readAll = (d: number) => buf.subarray(0, fs.readSync(d, buf, 0, buf.length, null)).toString();
        // highWaterMark: 4 forces several sequential reads through each descriptor
        const streamAll = (p: string) => fs.createReadStream(p, { highWaterMark: 4 }).toArray();
        const open = {
          firstRead: readAll(fd),
          secondReadIsEof: fs.readSync(fd, buf, 0, buf.length, null),
          secondDescriptorStartsAtZero: readAll(fd2),
          pread: buf.subarray(0, fs.readSync(fd, buf, 0, 6, 5)).toString(),
          fstat: { isFile: fs.fstatSync(fd).isFile(), size: fs.fstatSync(fd).size },
          writeToFdCode: errcode(() => fs.writeSync(fd, "x")),
          contentAfterWriteAttempt: fs.readFileSync(nestedCss, "utf8"),
          preadAfterWriteAttempt: buf.subarray(0, fs.readSync(fd2, buf, 0, buf.length, 0)).toString(),
          emptyRead: fs.readSync(empty, buf, 0, buf.length, null),
          emptySize: fs.fstatSync(empty).size,
          // two streams of the same file at once must not share an offset
          streams: (await Promise.all([streamAll(indexHtml), streamAll(indexHtml)])).map(chunks =>
            Buffer.concat(chunks).toString(),
          ),
          streamRange: Buffer.concat(await fs.createReadStream(nestedCss, { start: 5, end: 10 }).toArray()).toString(),
          streamMissing: await new Promise<string>(resolve =>
            fs.createReadStream(missing).on("error", (e: any) => resolve(e.code)),
          ),
          fileHandle: await fs.promises.open(cfg, "r").then(async fh => {
            try {
              return { content: await fh.readFile("utf8"), size: (await fh.stat()).size };
            } finally {
              await fh.close();
            }
          }),
          writeCode: errcode(() => fs.openSync(nestedCss, "w")),
          readWriteCode: errcode(() => fs.openSync(nestedCss, "r+")),
          asyncWriteCode: await fs.promises.open(nestedCss, "w").then(() => "", (e: any) => e.code),
          dirCode: errcode(() => fs.openSync(root)),
          missingCode: errcode(() => fs.openSync(missing)),
        };
        fs.closeSync(fd);
        fs.closeSync(fd2);
        fs.closeSync(empty);

        console.log(JSON.stringify({ fileLoader, client, enoent, singleFile, open }));
      `,
        "data.txt": "hello",
        "client/index.html": "<!doctype html><h1>hi</h1>",
        "client/favicon.svg": "<svg/>",
        "client/_app/immutable/app.css": "body{margin:0}",
        "client/_app/immutable/chunks/entry.js": "export default 1;",
        "config.json": `{"ok":true}`,
        "empty.txt": "",
        "scratch-tmp/.keep": "",
      });

      await compile(String(dir), ["--asset", "./client", "--asset", "./config.json", "--asset", "./empty.txt"]);

      const expectedRecursive = [
        "_app",
        join("_app", "immutable"),
        join("_app", "immutable", "app.css"),
        join("_app", "immutable", "chunks"),
        join("_app", "immutable", "chunks", "entry.js"),
        "favicon.svg",
        "index.html",
      ].sort();

      // open() on an embedded file reopens a shared memfd on Linux and copies the
      // file into a temp file everywhere else (and on Linux without memfd), so the
      // Linux run is repeated with memfd disabled to cover both. The binary's temp
      // dir is pointed at scratch-tmp so the temp-file variant can be checked for leftovers.
      const scratch = join(String(dir), "scratch-tmp");
      const runs: Record<string, string>[] = [{}];
      if (process.platform === "linux") runs.push({ BUN_FEATURE_FLAG_DISABLE_MEMFD: "1" });
      for (const extraEnv of runs) {
        const { stdout, stderr, code } = await run(String(dir), {
          TMPDIR: scratch,
          TMP: scratch,
          TEMP: scratch,
          BUN_TMPDIR: scratch,
          ...extraEnv,
        });
        expect(stderr.trim()).toBe("");
        const r = JSON.parse(stdout.trim());

        expect(r).toEqual({
          fileLoader: {
            assetExists: true,
            dirExists: true,
            dirExistsTrailingSlash: true,
            dirStatIsDir: true,
            dirLstatIsDir: true,
            accessOk: true,
            // embedded files behave like 0644 files on a read-only filesystem
            accessWriteErr: "EROFS",
            accessExecErr: "EACCES",
            // the hashed file-loader name is covered by readdirHasAsset
            readdir: expect.arrayContaining(["client", "config.json", "empty.txt"]),
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
          open: {
            firstRead: "body{margin:0}",
            secondReadIsEof: 0,
            secondDescriptorStartsAtZero: "body{margin:0}",
            pread: "margin",
            fstat: { isFile: true, size: "body{margin:0}".length },
            writeToFdCode: "EBADF",
            contentAfterWriteAttempt: "body{margin:0}",
            preadAfterWriteAttempt: "body{margin:0}",
            emptyRead: 0,
            emptySize: 0,
            streams: ["<!doctype html><h1>hi</h1>", "<!doctype html><h1>hi</h1>"],
            streamRange: "margin",
            streamMissing: "ENOENT",
            fileHandle: { content: `{"ok":true}`, size: `{"ok":true}`.length },
            writeCode: "EROFS",
            readWriteCode: "EROFS",
            asyncWriteCode: "EROFS",
            dirCode: "EISDIR",
            missingCode: "ENOENT",
          },
        });
        // recursive uses the platform path separator (same as Node's real-fs recursive readdir)
        expect(r.client.recursive.join("\n")).not.toContain(sep === "/" ? "\\" : "/");
        // data.txt + config.json + empty.txt + 4 under client/
        expect(r.client.embeddedFileCount).toBeGreaterThanOrEqual(7);
        expect(code).toBe(0);
        // the temp file behind each open() was unlinked before its descriptor was handed out
        expect(readdirSync(scratch).filter(name => name.endsWith(".bunfs"))).toEqual([]);
      }
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
