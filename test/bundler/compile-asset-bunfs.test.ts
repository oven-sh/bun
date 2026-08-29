// https://github.com/oven-sh/bun/issues/15734
import { describe, expect, test } from "bun:test";
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

        console.log(JSON.stringify({ fileLoader, client, enoent, missing, singleFile }));
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

  // https://github.com/oven-sh/bun/issues/40778
  test(
    "Bun.serve() { dir } route serves an --asset directory",
    async () => {
      // Larger than a fresh socket's send buffer, so the body needs more than
      // one write and the onWritable continuation runs.
      const big = Buffer.alloc(4 * 1024 * 1024);
      for (let i = 0; i < big.length; i++) big[i] = i % 251;
      using dir = tempDir("bunfs-dir-route", {
        "index.ts": /* ts */ `
          const root = import.meta.dir + "/public";
          function errcode(fn: () => unknown): string {
            try { fn(); return ""; } catch (e: any) { return e.code; }
          }
          using server = Bun.serve({
            port: 0,
            routes: { "/static/*": { dir: root } },
            fetch() { return new Response("fallthrough", { status: 404 }); },
          });
          const base = "http://localhost:" + server.port;
          async function get(path: string, init: RequestInit = {}) {
            const res = await fetch(base + path, { redirect: "manual", ...init });
            const body = await res.text();
            const h = res.headers;
            return {
              status: res.status,
              type: h.get("content-type"),
              length: h.get("content-length"),
              etag: h.get("etag"),
              lastModified: h.get("last-modified"),
              acceptRanges: h.get("accept-ranges"),
              contentRange: h.get("content-range"),
              location: h.get("location"),
              body,
            };
          }
          const file = await get("/static/a.txt");
          const bigRes = await fetch(base + "/static/big.bin");
          const bigBody = Buffer.from(await bigRes.arrayBuffer());
          const bigExpected = Buffer.from(await Bun.file(root + "/big.bin").arrayBuffer());
          console.log(JSON.stringify({
            file,
            nested: await get("/static/sub/b.css"),
            percentDecoded: await get("/static/hello%20world.txt"),
            index: await get("/static/"),
            subIndex: await get("/static/sub/"),
            dirRedirect: await get("/static/sub"),
            fileTrailingSlash: await get("/static/a.txt/"),
            missing: await get("/static/nope.txt"),
            head: await get("/static/a.txt", { method: "HEAD" }),
            range: await get("/static/a.txt", { headers: { range: "bytes=6-10" } }),
            unsatisfiable: await get("/static/a.txt", { headers: { range: "bytes=100-200" } }),
            notModified: await get("/static/a.txt", { headers: { "if-none-match": file.etag! } }),
            staleEtag: (await get("/static/a.txt", { headers: { "if-none-match": '"0000000000000000"' } })).status,
            big: { status: bigRes.status, length: bigBody.length, matches: bigBody.equals(bigExpected) },
            missingDir: errcode(() => Bun.serve({ port: 0, routes: { "/x/*": { dir: import.meta.dir + "/nope" } } })),
            fileAsDir: errcode(() => Bun.serve({ port: 0, routes: { "/x/*": { dir: root + "/a.txt" } } })),
          }));
        `,
        "public/a.txt": "hello asset",
        "public/hello world.txt": "spaced",
        "public/index.html": "<h1>root</h1>",
        "public/sub/b.css": "body{margin:0}",
        "public/sub/index.html": "<h1>sub</h1>",
        "public/big.bin": big,
      });

      await compile(String(dir), ["--asset", "./public"]);
      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      const r = JSON.parse(stdout.trim());
      const ok = (body: string, type: string, extra: Record<string, unknown> = {}) => ({
        status: 200,
        type,
        length: String(body.length),
        etag: expect.stringMatching(/^"[0-9a-f]{16}"$/),
        lastModified: null,
        acceptRanges: "bytes",
        contentRange: null,
        location: null,
        body,
        ...extra,
      });
      const text = "text/plain;charset=utf-8";
      const html = "text/html;charset=utf-8";
      expect(r).toEqual({
        file: ok("hello asset", text),
        nested: ok("body{margin:0}", "text/css;charset=utf-8"),
        percentDecoded: ok("spaced", text),
        index: ok("<h1>root</h1>", html),
        subIndex: ok("<h1>sub</h1>", html),
        dirRedirect: expect.objectContaining({ status: 301, location: "/static/sub/", body: "" }),
        fileTrailingSlash: expect.objectContaining({ status: 404, body: "" }),
        missing: expect.objectContaining({ status: 404, body: "" }),
        head: ok("hello asset", text, { body: "" }),
        range: {
          ...ok("asset", text),
          contentRange: "bytes 6-10/11",
          status: 206,
        },
        unsatisfiable: expect.objectContaining({ status: 416, contentRange: "bytes */11", body: "" }),
        notModified: expect.objectContaining({ status: 304, etag: r.file.etag, body: "" }),
        staleEtag: 200,
        big: { status: 200, length: big.length, matches: true },
        missingDir: "ENOENT",
        fileAsDir: "ENOTDIR",
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
