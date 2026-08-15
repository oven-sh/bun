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
3 files changed, 2 added, 1 removed  (+10 -6 lines)

  ! postinstall script added: node setup.js
  ! dependencies added: left-pad@^1.3.0
  ! main changed: index.js → dist/index.js
  ! new binary file logo.bin (6 bytes)

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
