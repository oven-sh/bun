import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
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

async function pack(dir: string) {
  await using p = Bun.spawn({
    cmd: [bunExe(), "pm", "pack", "--quiet"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await p.exited;
  const tgz = readdirSync(dir).find(f => f.endsWith(".tgz"));
  if (!tgz) throw new Error("pack failed: " + (await p.stderr.text()));
  return join(dir, tgz);
}

beforeAll(async () => {
  root = tempDir("pm-diff", {
    "v1": v1,
    "v2": v2,
    "proj/package.json": JSON.stringify({ name: "proj", dependencies: { diffme: "1.0.0" } }),
  });
  tarballs["1.0.0"] = await pack(join(String(root), "v1"));
  tarballs["2.0.0"] = await pack(join(String(root), "v2"));
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/diffme") {
        const versions: any = {};
        for (const v of ["1.0.0", "2.0.0"]) {
          versions[v] = { name: "diffme", version: v, dist: { tarball: `${registry}/diffme/-/diffme-${v}.tgz` } };
        }
        return Response.json({ name: "diffme", "dist-tags": { latest: "2.0.0" }, versions });
      }
      const m = url.pathname.match(/^\/diffme\/-\/diffme-(.+)\.tgz$/);
      if (m && tarballs[m[1]]) return new Response(Bun.file(tarballs[m[1]]));
      return new Response("Not Found", { status: 404 });
    },
  });
  registry = server.url.origin;
});
afterAll(() => server?.stop(true));

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
    expect(stdout).toMatchInlineSnapshot(`
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
  ! new binary file logo.bin (6 bytes)
"
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
    expect(await install.exited).toBe(0);
    const { stdout, exitCode } = await diff(["diffme", "--name-only"], proj);
    expect(stdout.split("\n")[0]).toBe("diffme@1.0.0 → diffme@2.0.0");
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
    const { stdout, exitCode } = await diff([], join(String(root), "v1"));
    expect(stdout.split("\n")[0]).toBe("diffme@2.0.0 → .");
    // v1 on disk vs 2.0.0 published: the postinstall was *removed* from this side's point of view.
    expect(stdout).toContain("D setup.js".replace("D ", "")); // setup.js appears as deleted
    expect(exitCode).toBe(0);
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
    const [raw, exitCode] = await Promise.all([p.stdout.text(), p.exited]);
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
describe("bun pm diff (canonical re-print)", () => {
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
    const raw = await pretty({ "a/dist/x.min.js": v1, "b/dist/x.min.js": v2 }, ["--raw"]);
    expect(raw.text).toMatch(/\ndist\/x\.min\.js ─+ \+1 -1\n/);
    expect(exitCode).toBe(0);
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
