// https://github.com/oven-sh/bun/issues/15734
// `bun build --compile` could not embed asset directories, and the `/$bunfs/`
// virtual filesystem had no directory semantics for `fs.readdirSync` /
// `fs.statSync` / `fs.existsSync`. SvelteKit's adapter (via sirv/totalist)
// enumerates `${import.meta.dir}/client` at startup, so every static asset 404'd.
import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// `bun build --compile` copies + rewrites the whole bun binary (~1GB under
// debug+ASAN), which blows the 5s default.
const TIMEOUT = 60_000;
const exe = process.platform === "win32" ? ".exe" : "";

async function compile(dir: string, extraArgs: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "./index.ts", "--outfile", "app", ...extraArgs],
    cwd: dir,
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

describe("compiled executable: /$bunfs/ directory semantics", () => {
  test("existsSync/statSync/readdirSync on embedded-file parent directories", async () => {
    const dir = tempDirWithFiles("bunfs-dirsem", {
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
          readdir: fs.readdirSync(dir).sort(),
          readdirHasAsset: fs.readdirSync(dir).includes(path.basename(asset)),
        };
        console.log(JSON.stringify(results));
      `,
      "data.txt": "hello",
    });

    await compile(dir);
    const { stdout, stderr, code } = await run(dir);
    expect(stderr.trim()).toBe("");
    const r = JSON.parse(stdout.trim());
    expect(r.assetExists).toBe(true);
    expect(r.dirExists).toBe(true);
    expect(r.dirExistsTrailingSlash).toBe(true);
    expect(r.dirStatIsDir).toBe(true);
    expect(r.dirLstatIsDir).toBe(true);
    expect(r.accessOk).toBe(true);
    expect(r.readdirHasAsset).toBe(true);
    expect(r.readdir.length).toBeGreaterThan(0);
    expect(code).toBe(0);
  }, TIMEOUT);

  test("--asset embeds a directory tree with original paths, enumerable via fs and readable via Bun.file", async () => {
    const dir = tempDirWithFiles("bunfs-asset-flag", {
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
          recursive,
          embeddedFileCount: Bun.embeddedFiles.length,
        };
        console.log(JSON.stringify(out));
      `,
      "client/index.html": "<!doctype html><h1>hi</h1>",
      "client/favicon.svg": "<svg/>",
      "client/_app/immutable/app.css": "body{margin:0}",
      "client/_app/immutable/chunks/entry.js": "export default 1;",
    });

    await compile(dir, ["--asset", "./client"]);
    const { stdout, stderr, code } = await run(dir);
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

    // recursive must include both files and intermediate directories.
    const rec = r.recursive.map((p: string) => p.replace(/\\/g, "/"));
    expect(rec).toContain("_app");
    expect(rec).toContain("_app/immutable");
    expect(rec).toContain("_app/immutable/app.css");
    expect(rec).toContain("_app/immutable/chunks");
    expect(rec).toContain("_app/immutable/chunks/entry.js");
    expect(rec).toContain("favicon.svg");
    expect(rec).toContain("index.html");

    expect(r.embeddedFileCount).toBeGreaterThanOrEqual(4);
    expect(code).toBe(0);
  }, TIMEOUT);

  test("readdirSync on a non-existent /$bunfs/ path throws ENOENT", async () => {
    const dir = tempDirWithFiles("bunfs-enoent", {
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
    await compile(dir);
    const { stdout, code } = await run(dir);
    const r = JSON.parse(stdout.trim());
    expect(r.code).toBe("ENOENT");
    expect(r.exists).toBe(false);
    expect(code).toBe(0);
  }, TIMEOUT);

  test("--asset on a single file", async () => {
    const dir = tempDirWithFiles("bunfs-asset-file", {
      "index.ts": /* ts */ `
        import fs from "node:fs";
        import path from "node:path";
        const p = path.join(import.meta.dir, "config.json");
        console.log(JSON.stringify({
          exists: fs.existsSync(p),
          content: fs.readFileSync(p, "utf8"),
        }));
      `,
      "config.json": `{"ok":true}`,
    });
    await compile(dir, ["--asset", "./config.json"]);
    const { stdout, stderr, code } = await run(dir);
    expect(stderr.trim()).toBe("");
    const r = JSON.parse(stdout.trim());
    expect(r.exists).toBe(true);
    expect(r.content).toBe(`{"ok":true}`);
    expect(code).toBe(0);
  }, TIMEOUT);
});
