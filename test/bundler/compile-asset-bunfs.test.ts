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
  if (code !== 0) throw new Error(`compile failed\n${stdout}\n${stderr}`);
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
  test(
    "existsSync/statSync/readdirSync on embedded-file parent directories",
    async () => {
      using dir = tempDir("bunfs-dirsem", {
        "index.ts": /* ts */ `
        import asset from "./data.txt" with { type: "file" };
        import fs from "node:fs";
        import path from "node:path";

        const dir = path.dirname(asset);
        const results = {
          assetExists: fs.existsSync(asset),
          dirExists: fs.existsSync(dir),
          dirExistsTrailingSlash: fs.existsSync(dir + "/"),
          dirStatIsDir: fs.statSync(dir).isDirectory(),
          dirLstatIsDir: fs.lstatSync(dir).isDirectory(),
          accessOk: (() => { try { fs.accessSync(dir); return true; } catch { return false; } })(),
          accessWriteErr: (() => { try { fs.accessSync(asset, fs.constants.W_OK); return ""; } catch (e: any) { return e.code; } })(),
          readdir: fs.readdirSync(dir).sort(),
          readdirHasAsset: fs.readdirSync(dir).includes(path.basename(asset)),
        };
        console.log(JSON.stringify(results));
      `,
        "data.txt": "hello",
      });

      await compile(String(dir));
      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      const r = JSON.parse(stdout.trim());
      expect(r.assetExists).toBe(true);
      expect(r.dirExists).toBe(true);
      expect(r.dirExistsTrailingSlash).toBe(true);
      expect(r.dirStatIsDir).toBe(true);
      expect(r.dirLstatIsDir).toBe(true);
      expect(r.accessOk).toBe(true);
      expect(r.accessWriteErr).toBe("EACCES");
      expect(r.readdirHasAsset).toBe(true);
      expect(r.readdir.length).toBeGreaterThan(0);
      expect(code).toBe(0);
    },
    TIMEOUT,
  );

  test(
    "--asset embeds a directory tree with original paths, enumerable via fs and readable via Bun.file",
    async () => {
      using dir = tempDir("bunfs-asset-flag", {
        "index.ts": /* ts */ `
        import fs from "node:fs";
        import path from "node:path";

        // This mirrors what svelte-adapter-bun does: walk a directory relative
        // to the bundled entry, stat each entry, serve via Bun.file().
        const root = path.join(import.meta.dir, "client");
        if (!fs.existsSync(root)) throw new Error("client dir missing: " + root);

        const entries = fs.readdirSync(root, { withFileTypes: true });
        const byName: Record<string, { isDir: boolean; isFile: boolean }> = {};
        for (const e of entries) {
          byName[e.name] = { isDir: e.isDirectory(), isFile: e.isFile() };
        }

        const indexHtml = path.join(root, "index.html");
        const nestedCss = path.join(root, "_app", "immutable", "app.css");

        const recursive = fs.readdirSync(root, { recursive: true }).map(String).sort();
        const recursiveAsync = (await fs.promises.readdir(root, { recursive: true })).map(String).sort();

        const out = {
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
          readFileDirErr: (() => { try { fs.readFileSync(root); return ""; } catch (e: any) { return e.code; } })(),
          recursive,
          recursiveAsync,
          embeddedFileCount: Bun.embeddedFiles.length,
        };
        console.log(JSON.stringify(out));
      `,
        "client/index.html": "<!doctype html><h1>hi</h1>",
        "client/favicon.svg": "<svg/>",
        "client/_app/immutable/app.css": "body{margin:0}",
        "client/_app/immutable/chunks/entry.js": "export default 1;",
      });

      await compile(String(dir), ["--asset", "./client"]);
      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      const r = JSON.parse(stdout.trim());

      // import.meta.dir is /$bunfs/root (or B:/~BUN/root on Windows); client lives directly under it.
      expect(r.root.replace(/\\/g, "/")).toMatch(/\/root\/client$/);

      expect(r.entries).toEqual(["_app", "favicon.svg", "index.html"]);
      expect(r.byName["index.html"]).toEqual({ isDir: false, isFile: true });
      expect(r.byName["favicon.svg"]).toEqual({ isDir: false, isFile: true });
      expect(r.byName["_app"]).toEqual({ isDir: true, isFile: false });

      expect(r.indexHtmlExists).toBe(true);
      expect(r.indexHtmlSize).toBe("<!doctype html><h1>hi</h1>".length);
      expect(r.indexHtmlContent).toBe("<!doctype html><h1>hi</h1>");
      expect(r.nestedCssExists).toBe(true);
      expect(r.nestedCssContent).toBe("body{margin:0}");
      expect(r.nestedCssViaReadFile).toBe("body{margin:0}");
      expect(r.nestedDirIsDir).toBe(true);
      expect(r.readFileDirErr).toBe("EISDIR");

      // recursive must include both files and intermediate directories, with
      // the platform path separator (same as Node's real-fs recursive readdir).
      const rec: string[] = r.recursive;
      expect(rec).toContain("_app");
      expect(rec).toContain(join("_app", "immutable"));
      expect(rec).toContain(join("_app", "immutable", "app.css"));
      expect(rec).toContain(join("_app", "immutable", "chunks"));
      expect(rec).toContain(join("_app", "immutable", "chunks", "entry.js"));
      expect(rec).toContain("favicon.svg");
      expect(rec).toContain("index.html");
      expect(r.recursive.join("\n")).not.toContain(sep === "/" ? "\\" : "/");
      expect(r.recursiveAsync).toEqual(r.recursive);

      expect(r.embeddedFileCount).toBeGreaterThanOrEqual(4);
      expect(code).toBe(0);
    },
    TIMEOUT,
  );

  test(
    "readdirSync on a non-existent /$bunfs/ path throws ENOENT",
    async () => {
      using dir = tempDir("bunfs-enoent", {
        "index.ts": /* ts */ `
        import fs from "node:fs";
        import path from "node:path";
        const p = path.join(import.meta.dir, "does-not-exist");
        try {
          fs.readdirSync(p);
          console.log("FAIL: no throw");
        } catch (e: any) {
          console.log(JSON.stringify({ code: e.code, exists: fs.existsSync(p) }));
        }
      `,
      });
      await compile(String(dir));
      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      const r = JSON.parse(stdout.trim());
      expect(r.code).toBe("ENOENT");
      expect(r.exists).toBe(false);
      expect(code).toBe(0);
    },
    TIMEOUT,
  );

  test(
    "--asset on a single file",
    async () => {
      using dir = tempDir("bunfs-asset-file", {
        "index.ts": /* ts */ `
        import fs from "node:fs";
        import path from "node:path";
        const p = path.join(import.meta.dir, "config.json");
        let readdirCode = "";
        try { fs.readdirSync(p); } catch (e: any) { readdirCode = e.code; }
        console.log(JSON.stringify({
          exists: fs.existsSync(p),
          content: fs.readFileSync(p, "utf8"),
          readdirCode,
        }));
      `,
        "config.json": `{"ok":true}`,
      });
      await compile(String(dir), ["--asset", "./config.json"]);
      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      const r = JSON.parse(stdout.trim());
      expect(r.exists).toBe(true);
      expect(r.content).toBe(`{"ok":true}`);
      expect(r.readdirCode).toBe("ENOTDIR");
      expect(code).toBe(0);
    },
    TIMEOUT,
  );

  test(
    "Bun.build({compile: {assets}}) embeds a directory tree",
    async () => {
      using dir = tempDir("bunfs-asset-jsapi", {
        "index.ts": /* ts */ `
          import fs from "node:fs";
          import path from "node:path";
          const root = path.join(import.meta.dir, "public");
          console.log(JSON.stringify({
            entries: fs.readdirSync(root).sort(),
            content: fs.readFileSync(path.join(root, "index.html"), "utf8"),
          }));
        `,
        "public/index.html": "<h1>js-api</h1>",
        "public/sub/a.css": "body{}",
      });

      const result = await Bun.build({
        entrypoints: [join(String(dir), "index.ts")],
        compile: {
          outfile: join(String(dir), "app"),
          assets: [join(String(dir), "public")],
        },
      });
      expect(result.success).toBe(true);

      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      const r = JSON.parse(stdout.trim());
      expect(r.entries).toEqual(["index.html", "sub"]);
      expect(r.content).toBe("<h1>js-api</h1>");
      expect(code).toBe(0);
    },
    TIMEOUT,
  );

  test(
    "Bun.build({compile: {assets}}) keys the entry point at basename(outfile) so an index.js asset does not collide",
    async () => {
      using dir = tempDir("bunfs-asset-jsapi-entry", {
        "index.ts": /* ts */ `
          import fs from "node:fs";
          import path from "node:path";
          console.log(fs.readFileSync(path.join(import.meta.dir, "index.js"), "utf8"));
        `,
        "cfg/index.js": `ASSET_CONTENT`,
      });
      const result = await Bun.build({
        entrypoints: [join(String(dir), "index.ts")],
        compile: {
          outfile: join(String(dir), "app"),
          assets: [join(String(dir), "cfg", "index.js")],
        },
      });
      expect(result.success).toBe(true);
      const { stdout, stderr, code } = await run(String(dir));
      expect(stderr.trim()).toBe("");
      expect(stdout.trim()).toBe("ASSET_CONTENT");
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
