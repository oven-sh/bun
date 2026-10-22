import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmod, copyFile, link, lstat, readdir, rename, rm, stat, symlink, unlink } from "fs/promises";
import {
  bunEnv,
  bunExe,
  DirectoryTree,
  githubTarball,
  isLinux,
  isRoot,
  isWindows,
  normalizeBunSnapshot as normalizeBunSnapshot_,
  runBunInstall,
  tempDir,
} from "harness";
import { join } from "path";
import { TestRegistry } from "registry";
import { pathToFileURL } from "url";

const normalizeBunSnapshot = (str: string) => {
  str = normalizeBunSnapshot_(str);
  str = str.replace(/.*Resolved, downloaded and extracted.*\n?/g, "");
  return str.trim();
};

// Each test spawns two to seven debug builds of bun, and up to 20 tests run at once.
setDefaultTimeout(60 * 1000);

// Every install in this file resolves against this registry, so no test reaches the public npm
// registry. `is-even`, `is-odd` and `@zackradisic/hls-dl` are stand-ins for the npm packages of the
// same name and version: is-even@1.0.0 depends on is-odd@^0.1.2, and is-odd has a 3.0.1 too.
const registry = new TestRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

type Env = Record<string, string | undefined>;

/**
 * The env for bun processes in a project: resolve from the local registry and install through a
 * cache inside the project. CI exports one BUN_INSTALL_CACHE_DIR for the whole file, so the env has
 * to set it for concurrent projects to have separate caches.
 */
function projectEnv(dir: string): Env {
  return { ...bunEnv, NPM_CONFIG_REGISTRY: registry.registryUrl(), BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") };
}

/** For `git` in a test, and for a `bun install` that runs it. */
const gitVars = {
  // Set on the asan lanes, where it makes `bun install` kill its own git clones (#33982).
  BUN_FEATURE_FLAG_NO_ORPHANS: undefined,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

/** A temp dir with `files`, plus the env that points bun processes in it at the registry. */
function createProject(prefix: string, files: DirectoryTree) {
  const dir = tempDir(prefix, files);
  return {
    dir: String(dir),
    env: projectEnv(String(dir)),
    [Symbol.asyncDispose]: () => dir[Symbol.asyncDispose](),
  };
}

async function runBun(cwd: string, env: Env, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The lines `bun install` and `bun patch --commit` print on stderr while they work. Anything else
// on stderr is a warning or an error.
const installProgress = /^(Resolving dependencies|Resolved, downloaded and extracted \[\d+\]|Saved lockfile)\r?\n/gm;

/** Runs bun, asserts that it succeeded with nothing but install progress on stderr, and returns its stdout. */
async function bunOk(cwd: string, env: Env, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runBun(cwd, env, ...args);
  expect(stderr.replace(installProgress, "")).toBe("");
  expect(exitCode, stderr).toBe(0);
  return stdout;
}

const file = (dir: string, ...path: string[]) => Bun.file(join(dir, ...path));

/**
 * What the hoisted linker writes after the `.` of `_bunPatchHash`: the first 8 bytes of the integrity that bun.lock
 * pins, as a number in hex.
 */
const pinnedDigits = (integrity: string) =>
  Buffer.from(integrity.slice(integrity.indexOf("-") + 1), "base64")
    .readBigUInt64BE(0)
    .toString(16);

/** `_bunPatchHash` of the hoisted copy of the registry package `name` that holds the patch with `patchHash`. */
async function patchKeyOf(dir: string, name: string, patchHash: string) {
  const row: unknown[] = (Bun.JSONC.parse(await file(dir, "bun.lock").text()) as any).packages[name];
  const integrity = row.find((value): value is string => typeof value === "string" && /^sha\d+-/.test(value));
  return `${patchHash}.${integrity ? pinnedDigits(integrity) : "0"}`;
}

/** The `patchedDependencies` of the project's package.json, and the same entries in bun.lock. */
async function expectPatchedDependencies(dir: string, expected: Record<string, string>) {
  expect((await file(dir, "package.json").json()).patchedDependencies).toEqual(expected);
  const lockfile = await file(dir, "bun.lock").text();
  for (const [key, path] of Object.entries(expected)) {
    expect(lockfile).toContain(`"${key}": "${path}"`);
  }
}

/** What `bun patch` prints once it has prepared `folder` for editing. */
function patchMessage(name: string, folder: string) {
  return `To patch ${name}, edit the following folder:\n\n  ${folder}\n\nOnce you're done with your changes, run:\n\n  bun patch --commit '${folder}'`;
}

/** Makes the stand-in's exported function log `message` right before it returns. */
async function addLogStatement(indexJs: string, message: string) {
  const source = await Bun.file(indexJs).text();
  expect(source).toContain("\n  return ");
  await Bun.write(indexJs, source.replace("\n  return ", `\n  console.log(${JSON.stringify(message)});\n  return `));
}

describe.concurrent("patch", () => {
  // Patches against the stand-ins. is-even@1.0.0/index.js is
  //
  //   'use strict';
  //
  //   var isOdd = require('is-odd');
  //
  //   module.exports = function isEven(i) {
  //     if (typeof i !== 'number') {
  //       throw new TypeError('is-even expects a number.');
  //     }
  //     return !isOdd(i);
  //   };
  //
  // and is-odd@0.1.2/index.js is the same shape without the require, so `isOdd` opens on line 3.
  const isEvenPatch = (message: string) => /* patch */ `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -5,3 +5,4 @@
 module.exports = function isEven(i) {
+  console.log("${message}");
   if (typeof i !== 'number') {
     throw new TypeError('is-even expects a number.');
`;
  const isOddPatch = (message: string) => /* patch */ `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -3,3 +3,4 @@
 module.exports = function isOdd(i) {
+  console.log("${message}");
   if (typeof i !== 'number') {
     throw new TypeError('is-odd expects a number.');
`;

  const packageJson = (dependencies: Record<string, string>, patchedDependencies?: Record<string, string>) =>
    JSON.stringify({ name: "bun-patch-test", module: "index.ts", type: "module", dependencies, patchedDependencies });

  // Calls is-even, which calls the is-odd@0.1.2 nested under it, so a patch on either prints first.
  const indexTs = /* ts */ `import isEven from 'is-even'; isEven(2); console.log('done')`;

  test("should patch a dependency when its dependencies are not hoisted", async () => {
    // is-even depends on is-odd@^0.1.2, and the root's is-odd@3.0.1 is the one that gets hoisted.
    await using project = createProject("patch-not-hoisted", {
      "package.json": packageJson(
        { "is-even": "1.0.0", "is-odd": "3.0.1" },
        { "is-even@1.0.0": "patches/is-even@1.0.0.patch" },
      ),
      patches: { "is-even@1.0.0.patch": isEvenPatch("is-even patched") },
      "index.ts": indexTs,
    });
    const { dir, env } = project;

    const { stdout, stderr, exitCode } = await runBun(dir, env, "install");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "Resolving dependencies
      Saved lockfile"
    `);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + is-even@1.0.0
      + is-odd@3.0.1

      3 packages installed"
    `);
    expect(exitCode).toBe(0);

    expect({
      hoisted: (await file(dir, "node_modules", "is-odd", "package.json").json()).version,
      nested: (await file(dir, "node_modules", "is-even", "node_modules", "is-odd", "package.json").json()).version,
    }).toEqual({ hoisted: "3.0.1", nested: "0.1.2" });
    expect(await file(dir, "node_modules", "is-even", "index.js").text()).toContain('console.log("is-even patched");');
    await expectPatchedDependencies(dir, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" });
    expect(await bunOk(dir, env, "run", "index.ts")).toBe("is-even patched\ndone\n");
  });

  test("should patch a non-hoisted dependency", async () => {
    await using project = createProject("patch-nested", {
      "package.json": packageJson(
        { "is-even": "1.0.0", "is-odd": "3.0.1" },
        { "is-odd@0.1.2": "patches/is-odd@0.1.2.patch" },
      ),
      patches: { "is-odd@0.1.2.patch": isOddPatch("is-odd patched") },
      "index.ts": indexTs,
    });
    const { dir, env } = project;
    await bunOk(dir, env, "install");

    // Only the nested 0.1.2 is patched, the hoisted 3.0.1 is not.
    expect(await file(dir, "node_modules", "is-even", "node_modules", "is-odd", "index.js").text()).toContain(
      'console.log("is-odd patched");',
    );
    expect(await file(dir, "node_modules", "is-odd", "index.js").text()).not.toContain("console.log");
    await expectPatchedDependencies(dir, { "is-odd@0.1.2": "patches/is-odd@0.1.2.patch" });
    expect(await bunOk(dir, env, "run", "index.ts")).toBe("is-odd patched\ndone\n");
  });

  test("should patch a dependency", async () => {
    await using project = createProject("patch-dep", {
      "package.json": packageJson({ "is-even": "1.0.0" }, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" }),
      patches: { "is-even@1.0.0.patch": isEvenPatch("is-even patched") },
      "index.ts": indexTs,
    });
    const { dir, env } = project;
    await bunOk(dir, env, "install");

    expect(await file(dir, "node_modules", "is-even", "index.js").text()).toMatchInlineSnapshot(`
      "'use strict';

      var isOdd = require('is-odd');

      module.exports = function isEven(i) {
        console.log("is-even patched");
        if (typeof i !== 'number') {
          throw new TypeError('is-even expects a number.');
        }
        return !isOdd(i);
      };
      "
    `);
    await expectPatchedDependencies(dir, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" });
    expect(await bunOk(dir, env, "run", "index.ts")).toBe("is-even patched\ndone\n");
  });

  test("should patch a transitive dependency", async () => {
    await using project = createProject("patch-transitive", {
      "package.json": packageJson({ "is-even": "1.0.0" }, { "is-odd@0.1.2": "patches/is-odd@0.1.2.patch" }),
      patches: { "is-odd@0.1.2.patch": isOddPatch("is-odd patched") },
      "index.ts": indexTs,
    });
    const { dir, env } = project;
    await bunOk(dir, env, "install");

    expect(await file(dir, "node_modules", "is-odd", "index.js").text()).toMatchInlineSnapshot(`
      "'use strict';

      module.exports = function isOdd(i) {
        console.log("is-odd patched");
        if (typeof i !== 'number') {
          throw new TypeError('is-odd expects a number.');
        }
        return !!(~~i & 1);
      };
      "
    `);
    await expectPatchedDependencies(dir, { "is-odd@0.1.2": "patches/is-odd@0.1.2.patch" });
    expect(await bunOk(dir, env, "run", "index.ts")).toBe("is-odd patched\ndone\n");
  });

  test("should patch a dependency after it was already installed", async () => {
    await using project = createProject("patch-installed", {
      "package.json": packageJson({ "is-even": "1.0.0" }),
      patches: { "is-even@1.0.0.patch": isEvenPatch("is-even patched") },
      "index.ts": indexTs,
    });
    const { dir, env } = project;
    await bunOk(dir, env, "install");
    expect(await file(dir, "node_modules", "is-even", "index.js").text()).not.toContain("console.log");

    await Bun.write(
      join(dir, "package.json"),
      packageJson({ "is-even": "1.0.0" }, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" }),
    );
    const { stdout, stderr, exitCode } = await runBun(dir, env, "install");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "Resolving dependencies
      Saved lockfile"
    `);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + is-even@1.0.0

      1 package installed"
    `);
    expect(exitCode).toBe(0);

    expect(await file(dir, "node_modules", "is-even", "index.js").text()).toContain('console.log("is-even patched");');
    await expectPatchedDependencies(dir, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" });
    expect(await bunOk(dir, env, "run", "index.ts")).toBe("is-even patched\ndone\n");
  });

  test("should patch a transitive dependency after it was already installed", async () => {
    await using project = createProject("patch-transitive-installed", {
      "package.json": packageJson({ "is-even": "1.0.0" }),
      patches: { "is-odd@0.1.2.patch": isOddPatch("is-odd patched") },
      "index.ts": indexTs,
    });
    const { dir, env } = project;
    await bunOk(dir, env, "install");
    expect(await file(dir, "node_modules", "is-odd", "index.js").text()).not.toContain("console.log");

    await Bun.write(
      join(dir, "package.json"),
      packageJson({ "is-even": "1.0.0" }, { "is-odd@0.1.2": "patches/is-odd@0.1.2.patch" }),
    );
    await bunOk(dir, env, "install");

    expect(await file(dir, "node_modules", "is-odd", "index.js").text()).toContain('console.log("is-odd patched");');
    await expectPatchedDependencies(dir, { "is-odd@0.1.2": "patches/is-odd@0.1.2.patch" });
    expect(await bunOk(dir, env, "run", "index.ts")).toBe("is-odd patched\ndone\n");
  });

  test("should update a dependency when the patchfile changes", async () => {
    await using project = createProject("patch-changed", {
      "package.json": packageJson({ "is-even": "1.0.0" }, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" }),
      patches: { "is-even@1.0.0.patch": isEvenPatch("is-even patched") },
      "index.ts": indexTs,
    });
    const { dir, env } = project;
    await bunOk(dir, env, "install");
    expect(await bunOk(dir, env, "run", "index.ts")).toBe("is-even patched\ndone\n");

    // The patch path in package.json is unchanged, only the file's contents are.
    await Bun.write(join(dir, "patches", "is-even@1.0.0.patch"), isEvenPatch("is-even patched again"));
    const { stdout, stderr, exitCode } = await runBun(dir, env, "install");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`"Resolving dependencies"`);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + is-even@1.0.0

      1 package installed"
    `);
    expect(exitCode).toBe(0);

    expect(await file(dir, "node_modules", "is-even", "index.js").text()).toContain(
      'console.log("is-even patched again");',
    );
    expect(await bunOk(dir, env, "run", "index.ts")).toBe("is-even patched again\ndone\n");
  });

  test("should work when patches are removed", async () => {
    await using project = createProject("patch-removed", {
      "package.json": packageJson({ "is-even": "1.0.0" }, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" }),
      patches: { "is-even@1.0.0.patch": isEvenPatch("is-even patched") },
      "index.ts": indexTs,
    });
    const { dir, env } = project;
    await bunOk(dir, env, "install");
    expect(await bunOk(dir, env, "run", "index.ts")).toBe("is-even patched\ndone\n");

    // Drop the is-even patch and patch is-odd instead.
    await Bun.write(
      join(dir, "package.json"),
      packageJson({ "is-even": "1.0.0" }, { "is-odd@0.1.2": "patches/is-odd@0.1.2.patch" }),
    );
    await Bun.write(join(dir, "patches", "is-odd@0.1.2.patch"), isOddPatch("is-odd patched"));
    await bunOk(dir, env, "install");

    expect(await file(dir, "node_modules", "is-even", "index.js").text()).not.toContain("console.log");
    expect(await file(dir, "node_modules", "is-odd", "index.js").text()).toContain('console.log("is-odd patched");');
    await expectPatchedDependencies(dir, { "is-odd@0.1.2": "patches/is-odd@0.1.2.patch" });
    expect(await file(dir, "bun.lock").text()).not.toContain("is-even@1.0.0.patch");
    expect(await bunOk(dir, env, "run", "index.ts")).toBe("is-odd patched\ndone\n");
  });

  test("should update a transitive dependency when the patchfile changes", async () => {
    await using project = createProject("patch-transitive-changed", {
      "package.json": packageJson({ "is-even": "1.0.0" }, { "is-odd@0.1.2": "patches/is-odd@0.1.2.patch" }),
      patches: { "is-odd@0.1.2.patch": isOddPatch("is-odd patched") },
      "index.ts": indexTs,
    });
    const { dir, env } = project;
    await bunOk(dir, env, "install");
    expect(await bunOk(dir, env, "run", "index.ts")).toBe("is-odd patched\ndone\n");

    await Bun.write(join(dir, "patches", "is-odd@0.1.2.patch"), isOddPatch("is-odd patched again"));
    await bunOk(dir, env, "install");

    expect(await file(dir, "node_modules", "is-odd", "index.js").text()).toContain(
      'console.log("is-odd patched again");',
    );
    expect(await bunOk(dir, env, "run", "index.ts")).toBe("is-odd patched again\ndone\n");
  });

  test("should update a scoped package", async () => {
    // Adds index.js and points `main` at it. The second hunk's context is lines 2 to 5 of the
    // stand-in's package.json.
    const patchfile = /* patch */ `diff --git a/index.js b/index.js
new file mode 100644
--- /dev/null
+++ b/index.js
@@ -0,0 +1,3 @@
+module.exports = () => {
+  return 'PATCHED!';
+};
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -2,4 +2,4 @@
   "name": "@zackradisic/hls-dl",
   "version": "0.0.1",
   "description": "",
-  "main": "dist/hls-dl.commonjs2.js"
+  "main": "./index.js"
`;

    await using project = createProject("patch-scoped", {
      "package.json": packageJson(
        { "@zackradisic/hls-dl": "0.0.1" },
        { "@zackradisic/hls-dl@0.0.1": "patches/thepatch.patch" },
      ),
      patches: { "thepatch.patch": patchfile },
      "index.ts": /* ts */ `import hlsDl from '@zackradisic/hls-dl'; console.log(hlsDl())`,
    });
    const { dir, env } = project;
    await bunOk(dir, env, "install");

    const installed = join(dir, "node_modules", "@zackradisic", "hls-dl");
    expect({
      main: (await file(installed, "package.json").json()).main,
      index: await file(installed, "index.js").text(),
    }).toEqual({ main: "./index.js", index: "module.exports = () => {\n  return 'PATCHED!';\n};\n" });
    await expectPatchedDependencies(dir, { "@zackradisic/hls-dl@0.0.1": "patches/thepatch.patch" });
    expect(await bunOk(dir, env, "run", "index.ts")).toBe("PATCHED!\n");
  });

  test("shouldn't infinite loop on failure to apply patch", async () => {
    // The patch targets a path that does not exist inside the package.
    const badPatch = /* patch */ `diff --git a/index.js b/node_modules/is-even/index.js
--- a/index.js
+++ b/node_modules/is-even/index.js
@@ -5,3 +5,4 @@
 module.exports = function isEven(i) {
+  console.log('hi')
   if (typeof i !== 'number') {
     throw new TypeError('is-even expects a number.');
`;

    await using project = createProject("patch-bad", {
      "package.json": packageJson({ "is-even": "1.0.0" }),
      patches: { "is-even@1.0.0.patch": badPatch },
      "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven())`,
    });
    const { dir, env } = project;
    {
      const { stdout, stderr, exitCode } = await runBun(dir, env, "install", "--linker=hoisted");
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
        "Resolving dependencies
        Saved lockfile"
      `);
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
        "bun install <version> (<revision>)

        + is-even@1.0.0

        2 packages installed"
      `);
      expect(exitCode).toBe(0);
    }
    {
      await Bun.write(
        join(dir, "package.json"),
        packageJson({ "is-even": "1.0.0" }, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" }),
      );
      const { stdout, stderr, exitCode } = await runBun(dir, env, "install", "--linker=hoisted");
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
        "Resolving dependencies
        error: failed applying patch file: ENOENT: node_modules/is-even/index.js: No such file or directory (open())
        error: failed to apply patchfile (patches/is-even@1.0.0.patch)"
      `);
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
      expect(exitCode).toBe(1);
    }
  });

  // https://github.com/oven-sh/bun/issues/33571
  // The new directories used to get the file's mode (0644), which only root can enter
  // (CAP_DAC_OVERRIDE), so as root the install runs without that capability.
  const setpriv = isRoot ? Bun.which("setpriv") : null;
  test.skipIf(isWindows || (isRoot && !setpriv))(
    "should apply a patch that adds a file in a directory the package does not have",
    async () => {
      await using project = createProject("patch-new-dir", {
        "package.json": packageJson({ "is-odd": "3.0.1" }, { "is-odd@3.0.1": "patches/is-odd@3.0.1.patch" }),
        patches: {
          "is-odd@3.0.1.patch": /* patch */ `diff --git a/android/build/x/results.bin b/android/build/x/results.bin
new file mode 100644
--- /dev/null
+++ b/android/build/x/results.bin
@@ -0,0 +1 @@
+hi
`,
        },
      });
      const { dir, env } = project;

      const unprivileged = setpriv ? [setpriv, "--bounding-set", "-dac_override,-dac_read_search"] : [];
      await using proc = Bun.spawn({
        cmd: [...unprivileged, bunExe(), "install"],
        cwd: dir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr.replace(installProgress, "")).toBe("");
      expect(await file(dir, "node_modules", "is-odd", "android", "build", "x", "results.bin").text()).toBe("hi\n");
      expect(exitCode).toBe(0);
    },
  );

  test("a hunk whose - side matches nothing fails the install", async () => {
    await using project = createProject("patch-stale-hunk", {
      "package.json": packageJson({ "is-even": "1.0.0" }, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" }),
      patches: {
        "is-even@1.0.0.patch": /* patch */ `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1 +1 @@
-a line that exists in no version of this package
+module.exports = "STALE-HUNK-APPLIED";
`,
      },
    });
    const { dir, env } = project;

    const { stderr, exitCode } = await runBun(dir, env, "install");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "Resolving dependencies
      error: failed applying patch file: hunk #1 does not apply to index.js (expected at line 1)
      error: failed to apply patchfile (patches/is-even@1.0.0.patch)"
    `);
    const index = file(dir, "node_modules", "is-even", "index.js");
    expect((await index.exists()) && (await index.text()).includes("STALE-HUNK-APPLIED")).toBe(false);
    expect(exitCode).toBe(1);
  });

  // The package is installed already, so the linker is what meets the patch. The isolated linker
  // used to carry on, and saved package.json and bun.lock.
  test.each(["hoisted", "isolated"] as const)(
    "bun add writes nothing when the patch of an installed package does not apply (%s linker)",
    async linker => {
      await using project = createProject("patch-stale-hunk-add", {
        "package.json": packageJson({ "is-even": "1.0.0" }),
        "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
        patches: { "is-even@1.0.0.patch": "--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-no such line\n+patched\n" },
      });
      const { dir, env } = project;
      await bunOk(dir, env, "install");
      await Bun.write(
        join(dir, "package.json"),
        packageJson({ "is-even": "1.0.0" }, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" }),
      );
      const written = async () => [await file(dir, "package.json").text(), await file(dir, "bun.lock").text()];
      const before = await written();

      const { stderr, exitCode } = await runBun(dir, env, "add", "no-deps@1.0.0");
      expect(stderr).toContain("error: failed applying patch file: hunk #1 does not apply to index.js");
      expect(await written()).toEqual(before);
      expect(exitCode).toBe(1);
    },
  );

  // Older versions of bun, and other tools, wrote these into patch files that install: a binary
  // change without its content, a copy or colors because of the user's git config. They did
  // nothing then, without a word. isEvenPatch() has 8 lines.
  const binary = "binary file, content not in patch";
  const nothing = "no applicable changes";

  /** What is printed about line `line` of `patch`: the line, a caret, the message and the place. */
  const diagnostic = (kind: "warn" | "error", patch: string, line: number, message: string) =>
    `${line} | ${patch.split("\n")[line - 1].replaceAll("\x1b", "\\x1b")}\n` +
    `${Buffer.alloc(`${line} | `.length, " ")}^\n` +
    `${kind}: ${message}\n` +
    `${Buffer.alloc(kind.length - 1, " ")}at patches/is-even@1.0.0.patch:${line}:1`;

  describe.each(["hoisted", "isolated"])(
    "a patch that the install can't apply is skipped with a warning (%s linker)",
    linker => {
      test.each([
        [
          "a changed binary file",
          isEvenPatch("is-even patched") +
            "diff --git a/img.bin b/img.bin\nindex 1111111..2222222 100644\nBinary files a/img.bin and b/img.bin differ\n",
          9,
          `skipping img.bin: ${binary}`,
        ],
        [
          "a new binary file",
          isEvenPatch("is-even patched") +
            "diff --git a/img.bin b/img.bin\nnew file mode 100644\nindex 0000000..2222222\nBinary files /dev/null and b/img.bin differ\n",
          9,
          `skipping img.bin: ${binary}`,
        ],
        [
          "a copy",
          isEvenPatch("is-even patched") +
            "diff --git a/index.js b/copy.js\nsimilarity index 100%\ncopy from index.js\ncopy to copy.js\n",
          9,
          `skipping copy.js: ${nothing}`,
        ],
        [
          "a header alone",
          isEvenPatch("is-even patched") + "diff --git a/other.js b/other.js\nindex 1111111..2222222 100644\n",
          9,
          `skipping other.js: ${nothing}`,
        ],
        [
          "text after the last hunk",
          isEvenPatch("is-even patched") + "Only in b: new.js\n",
          9,
          `skipping non-patch text: ${nothing}`,
        ],
        [
          "a patch with colors",
          isEvenPatch("is-even in colors").replace(/^.+$/gm, line => `\x1b[1m${line}\x1b[m`),
          1,
          `skipping non-patch text: ${nothing}`,
        ],
      ])("%s", async (_name, patch, line, message) => {
        await using project = createProject("patch-left-out", {
          "package.json": packageJson({ "is-even": "1.0.0" }, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" }),
          patches: { "is-even@1.0.0.patch": patch },
        });
        const { dir, env } = project;

        const { stderr, exitCode } = await runBun(dir, env, "install", `--linker=${linker}`);
        expect(stderr).toContain(
          diagnostic("warn", patch, line, message) +
            "\n\nnote: recreate the patch with bun patch, or delete these lines\n",
        );
        expect(stderr.match(/^(warn|error): /gm)).toEqual(["warn: "]);
        // The rest of the patch is applied.
        expect((await file(dir, "node_modules", "is-even", "index.js").text()).includes("is-even patched")).toBe(
          line > 1,
        );
        expect(await file(dir, "node_modules", "is-even", "img.bin").exists()).toBe(false);
        expect(exitCode).toBe(0);
      });
    },
  );

  // None of bun, patch-package, pnpm and yarn writes these, and each holds a change that would be lost.
  test.each([
    [
      "a binary patch",
      isEvenPatch("is-even patched") +
        "diff --git a/img.bin b/img.bin\nindex 1111111..2222222 100644\nGIT binary patch\nliteral 3\nKcmZQzWC8#H2LJ>B\n\nliteral 3\nKcmZQzWCj2L2ml2D\n\n",
      11,
      "git_binary_patch_not_supported",
    ],
    ["a hunk of no file", "some text\n@@ -1 +1 @@\n-a\n+b\n", 2, "no_path_given_for_hunk"],
    [
      "a hunk with fewer lines than its header says",
      "diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n@@ -1,3 +1,3 @@\n-a\n+b\n",
      4,
      "hunk_header_integrity_check_failed",
    ],
    ["a quoted path", isEvenPatch("is-even patched") + 'diff --git "a/a b.js" "b/a b.js"\n', 9, "bad_diff_line"],
  ])("%s fails the install, and the error shows the line", async (_name, patch, line, error) => {
    await using project = createProject("patch-parse-error", {
      "package.json": packageJson({ "is-even": "1.0.0" }, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" }),
      patches: { "is-even@1.0.0.patch": patch },
    });
    const { dir, env } = project;

    const { stderr, exitCode } = await runBun(dir, env, "install", "--linker=hoisted");
    expect(normalizeBunSnapshot(stderr)).toBe(
      "Resolving dependencies\n" +
        diagnostic("error", patch, line, `failed to parse patchfile: ${error}`) +
        "\nerror: failed to apply patchfile (patches/is-even@1.0.0.patch)",
    );
    expect(exitCode).toBe(1);
  });

  test("a hunk with a stale + start is placed by its context", async () => {
    await using project = createProject("patch-stale-start", {
      "package.json": packageJson({ "is-even": "1.0.0" }, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" }),
      patches: {
        // Hunk 1 adds two lines, so hunk 2's correct `+` start is 10. The header says 8, as
        // `yarn patch-commit` emits.
        "is-even@1.0.0.patch": /* patch */ `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1,2 +1,4 @@
 'use strict';
+// FIRST-A
+// FIRST-B

@@ -8,2 +8,3 @@
   }
+  // SECOND-MARKER
   return !isOdd(i);
`,
      },
    });
    const { dir, env } = project;
    await bunOk(dir, env, "install");

    expect(await file(dir, "node_modules", "is-even", "index.js").text()).toMatchInlineSnapshot(`
      "'use strict';
      // FIRST-A
      // FIRST-B

      var isOdd = require('is-odd');

      module.exports = function isEven(i) {
        if (typeof i !== 'number') {
          throw new TypeError('is-even expects a number.');
        }
        // SECOND-MARKER
        return !isOdd(i);
      };
      "
    `);
  });

  describe("bun patch with --linker=isolated", () => {
    test("should create patch for package and commit it", async () => {
      await using project = createProject("patch-isolated", {
        "package.json": JSON.stringify({
          name: "bun-patch-isolated-test",
          module: "index.ts",
          type: "module",
          dependencies: { "is-even": "1.0.0" },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(2));`,
      });
      const { dir, env } = project;
      await bunOk(dir, env, "install", "--linker=isolated");

      const folder = "node_modules/is-even";
      const { stdout, stderr, exitCode } = await runBun(dir, env, "patch", "is-even");
      expect(stderr).toBe("");
      expect(stdout).toContain(patchMessage("is-even", folder));
      expect(exitCode).toBe(0);

      // The copy to edit is in the store entry, behind the project's link, so it finds is-odd.
      const isLink = async () => (await lstat(join(dir, folder))).isSymbolicLink();
      expect(await isLink()).toBe(true);
      await addLogStatement(join(dir, folder, "index.js"), "PATCHED with isolated linker!");
      expect(await bunOk(dir, env, "run", "index.ts")).toBe("PATCHED with isolated linker!\ntrue\n");

      // `bun patch --commit` writes the patch file, records it in package.json and bun.lock, and
      // reinstalls with it applied.
      await bunOk(dir, env, "patch", "--commit", folder);
      expect(await isLink()).toBe(true);

      expect(await file(dir, "patches", "is-even@1.0.0.patch").text()).toMatchInlineSnapshot(`
        "diff --git a/index.js b/index.js
        index ee70c77f2b65f68afaf722c170ed909ccd3a679e..97b2d355ea9d33b726d01857a29b97951c6f38d7 100644
        --- a/index.js
        +++ b/index.js
        @@ -6,5 +6,6 @@ module.exports = function isEven(i) {
           if (typeof i !== 'number') {
             throw new TypeError('is-even expects a number.');
           }
        +  console.log("PATCHED with isolated linker!");
           return !isOdd(i);
         };
        "
      `);
      await expectPatchedDependencies(dir, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" });
      expect(await bunOk(dir, env, "run", "index.ts")).toBe("PATCHED with isolated linker!\ntrue\n");
    });

    test("should patch transitive dependency with isolated linker", async () => {
      await using project = createProject("patch-isolated-transitive", {
        "package.json": JSON.stringify({
          name: "bun-patch-isolated-transitive-test",
          module: "index.ts",
          type: "module",
          dependencies: { "is-even": "1.0.0" },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(3));`,
      });
      const { dir, env } = project;
      await bunOk(dir, env, "install", "--linker=isolated");

      // By name, and again by name and version: both find the only is-odd in the tree. The root does
      // not link it, so its only folder is the one in the store.
      const folder = "node_modules/.bun/is-odd@0.1.2/node_modules/is-odd";
      expect(await bunOk(dir, env, "patch", "is-odd")).toContain(patchMessage("is-odd", folder));
      expect(await bunOk(dir, env, "patch", "is-odd@0.1.2")).toContain(patchMessage("is-odd", folder));

      // is-even loads the folder that is being edited.
      await addLogStatement(join(dir, folder, "index.js"), "Transitive patch with isolated!");
      expect(await bunOk(dir, env, "run", "index.ts")).toBe("Transitive patch with isolated!\nfalse\n");

      await bunOk(dir, env, "patch", "--commit", folder);
      await expectPatchedDependencies(dir, { "is-odd@0.1.2": "patches/is-odd@0.1.2.patch" });

      // `bun patch` ran without `--linker`. It kept the layout, and didn't leave anything for the root to resolve.
      expect((await readdir(join(dir, "node_modules"))).sort()).toEqual([".bun", "is-even"]);
      expect(await bunOk(dir, env, "install", "--linker", "isolated")).toContain("(no changes)");
      expect(await file(dir, folder, "index.js").text()).toContain('console.log("Transitive patch with isolated!");');
      expect(await bunOk(dir, env, "run", "index.ts")).toBe("Transitive patch with isolated!\nfalse\n");
    });

    test("should handle scoped packages with isolated linker", async () => {
      await using project = createProject("patch-isolated-scoped", {
        "package.json": JSON.stringify({
          name: "bun-patch-isolated-scoped-test",
          module: "index.ts",
          type: "module",
          dependencies: { "@zackradisic/hls-dl": "0.0.1" },
        }),
        "index.ts": /* ts */ `import hlsDl from '@zackradisic/hls-dl'; console.log(hlsDl());`,
      });
      const { dir, env } = project;
      await bunOk(dir, env, "install", "--linker=isolated");
      expect(await bunOk(dir, env, "run", "index.ts")).toBe("not patched\n");

      const folder = "node_modules/@zackradisic/hls-dl";
      expect(await bunOk(dir, env, "patch", "@zackradisic/hls-dl")).toContain(
        patchMessage("@zackradisic/hls-dl", folder),
      );

      // Add an index.js and point `main` at it.
      await Bun.write(join(dir, folder, "index.js"), `module.exports = () => 'SCOPED PACKAGE PATCHED with isolated!';`);
      const pkgJsonPath = join(dir, folder, "package.json");
      const pkgJson = await Bun.file(pkgJsonPath).json();
      pkgJson.main = "./index.js";
      await Bun.write(pkgJsonPath, JSON.stringify(pkgJson, null, 2));
      await bunOk(dir, env, "patch", "--commit", folder);

      const patchPath = "patches/@zackradisic%2Fhls-dl@0.0.1.patch";
      await expectPatchedDependencies(dir, { "@zackradisic/hls-dl@0.0.1": patchPath });

      expect(await file(dir, patchPath).text()).toMatchInlineSnapshot(`
        "diff --git a/index.js b/index.js
        new file mode 100644
        index 0000000000000000000000000000000000000000..da9666e70d80cbc1ae062154779e278852484c7e
        --- /dev/null
        +++ b/index.js
        @@ -0,0 +1 @@
        +module.exports = () => 'SCOPED PACKAGE PATCHED with isolated!';
        \\ No newline at end of file
        diff --git a/package.json b/package.json
        index 1829f35024e638a4c2ba4e894d73f7000a2ab090..18c5d9a79a5ebbc96b745e579d0789c145ee9988 100644
        --- a/package.json
        +++ b/package.json
        @@ -2,5 +2,5 @@
           "name": "@zackradisic/hls-dl",
           "version": "0.0.1",
           "description": "",
        -  "main": "dist/hls-dl.commonjs2.js"
        +  "main": "./index.js"
         }
        \\ No newline at end of file
        "
      `);

      expect(await bunOk(dir, env, "run", "index.ts")).toBe("SCOPED PACKAGE PATCHED with isolated!\n");
    });

    test("should work with workspaces and isolated linker", async () => {
      await using project = createProject("patch-isolated-workspace", {
        "package.json": JSON.stringify({ name: "workspace-root", workspaces: ["packages/*"] }),
        packages: {
          app: {
            "package.json": JSON.stringify({ name: "app", dependencies: { "is-even": "1.0.0" } }),
            "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(4));`,
          },
        },
      });
      const { dir, env } = project;
      await bunOk(dir, env, "install", "--linker=isolated");

      // Patch from the workspace root, which does not link is-even itself.
      const folder = "node_modules/.bun/is-even@1.0.0/node_modules/is-even";
      expect(await bunOk(dir, env, "patch", "is-even")).toContain(patchMessage("is-even", folder));
      await addLogStatement(join(dir, folder, "index.js"), "WORKSPACE PATCH with isolated!");
      await bunOk(dir, env, "patch", "--commit", folder);

      // The root package.json records the patch, and the member resolves the patched package.
      await expectPatchedDependencies(dir, { "is-even@1.0.0": "patches/is-even@1.0.0.patch" });
      expect((await file(dir, "packages", "app", "package.json").json()).patchedDependencies).toBeUndefined();
      expect(await bunOk(join(dir, "packages", "app"), env, "run", "index.ts")).toBe(
        "WORKSPACE PATCH with isolated!\ntrue\n",
      );
    });

    test("should preserve patch after reinstall with isolated linker", async () => {
      await using project = createProject("patch-isolated-reinstall", {
        "package.json": JSON.stringify({
          name: "bun-patch-isolated-reinstall-test",
          module: "index.ts",
          type: "module",
          dependencies: { "is-even": "1.0.0" },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(6));`,
      });
      const { dir, env } = project;
      await bunOk(dir, env, "install", "--linker=isolated");

      const folder = "node_modules/is-even";
      expect(await bunOk(dir, env, "patch", "is-even")).toContain(patchMessage("is-even", folder));
      await addLogStatement(join(dir, folder, "index.js"), "REINSTALL TEST with isolated!");
      await bunOk(dir, env, "patch", "--commit", folder);

      // Delete node_modules and reinstall from the lockfile.
      await rm(join(dir, "node_modules"), { recursive: true, force: true });
      expect(normalizeBunSnapshot(await bunOk(dir, env, "install", "--linker=isolated"))).toMatchInlineSnapshot(`
        "bun install <version> (<revision>)

        + is-even@1.0.0

        2 packages installed"
      `);

      expect(await file(dir, "node_modules", "is-even", "index.js").text()).toContain(
        'console.log("REINSTALL TEST with isolated!");',
      );
      expect(await bunOk(dir, env, "run", "index.ts")).toBe("REINSTALL TEST with isolated!\ntrue\n");
    });

    test("should handle multiple patches with isolated linker", async () => {
      await using project = createProject("patch-isolated-multiple", {
        "package.json": JSON.stringify({
          name: "bun-patch-isolated-multiple-test",
          module: "index.ts",
          type: "module",
          dependencies: { "is-even": "1.0.0", "is-odd": "3.0.1" },
        }),
        "index.ts": /* ts */ `
          import isEven from 'is-even';
          import isOdd from 'is-odd';
          console.log(isEven(8));
          console.log(isOdd(9));
        `,
      });
      const { dir, env } = project;
      await bunOk(dir, env, "install", "--linker=isolated");

      // First is-even, then the root's is-odd@3.0.1 (is-even's own is-odd is 0.1.2).
      expect(await bunOk(dir, env, "patch", "is-even")).toContain(patchMessage("is-even", "node_modules/is-even"));
      await addLogStatement(join(dir, "node_modules", "is-even", "index.js"), "is-even PATCHED with isolated!");
      await bunOk(dir, env, "patch", "--commit", "node_modules/is-even");

      expect(await bunOk(dir, env, "patch", "is-odd@3.0.1")).toContain(patchMessage("is-odd", "node_modules/is-odd"));
      await addLogStatement(join(dir, "node_modules", "is-odd", "index.js"), "is-odd PATCHED with isolated!");
      await bunOk(dir, env, "patch", "--commit", "node_modules/is-odd");

      await expectPatchedDependencies(dir, {
        "is-even@1.0.0": "patches/is-even@1.0.0.patch",
        "is-odd@3.0.1": "patches/is-odd@3.0.1.patch",
      });
      expect(await bunOk(dir, env, "run", "index.ts")).toBe(
        "is-even PATCHED with isolated!\ntrue\nis-odd PATCHED with isolated!\ntrue\n",
      );
    });
  });
});

describe.concurrent("removing a patched dependency", () => {
  // A patch that only adds a new file applies cleanly to any package contents.
  const isOddNewFilePatch = `diff --git a/bun-patch-test.txt b/bun-patch-test.txt
new file mode 100644
index 0000000000000000000000000000000000000000..2f9a147b6e5d17254f1bfce0d4e109a24a42dcab
--- /dev/null
+++ b/bun-patch-test.txt
@@ -0,0 +1 @@
+patched
`;

  test("install with an empty cache downloads the package unpatched", async () => {
    await using project = createProject("patch-remove", {
      "package.json": JSON.stringify({
        name: "remove-patch-test",
        dependencies: { "is-odd": "3.0.1" },
        patchedDependencies: { "is-odd@3.0.1": "patches/is-odd@3.0.1.patch" },
      }),
      patches: { "is-odd@3.0.1.patch": isOddNewFilePatch },
    });
    const { dir } = project;

    // First install: bun.lock records the patched dependency and the patch is applied.
    const envWithPatch = { ...project.env, BUN_INSTALL_CACHE_DIR: join(dir, "cache-with-patch") };
    expect(normalizeBunSnapshot(await bunOk(dir, envWithPatch, "install"))).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + is-odd@3.0.1

      1 package installed"
    `);
    expect(await file(dir, "node_modules", "is-odd", "bun-patch-test.txt").text()).toBe("patched\n");
    await expectPatchedDependencies(dir, { "is-odd@3.0.1": "patches/is-odd@3.0.1.patch" });

    // Remove the patch from package.json (bun.lock still references it) and
    // install again with an empty cache so the package has to be downloaded.
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ name: "remove-patch-test", dependencies: { "is-odd": "3.0.1" } }),
    );

    // This used to panic with `called Option::unwrap() on a None value` while
    // creating the download task: the patch entry had already been moved out of
    // `lockfile.patched_dependencies` into the to-remove list.
    const envEmptyCache = { ...project.env, BUN_INSTALL_CACHE_DIR: join(dir, "cache-empty") };
    expect(normalizeBunSnapshot(await bunOk(dir, envEmptyCache, "install"))).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + is-odd@3.0.1

      1 package installed"
    `);

    // The package is reinstalled without the patch.
    expect({
      installed: await file(dir, "node_modules", "is-odd", "package.json").json(),
      patched: await file(dir, "node_modules", "is-odd", "bun-patch-test.txt").exists(),
      lockfileHasPatches: (await file(dir, "bun.lock").text()).includes("patchedDependencies"),
    }).toEqual({
      installed: { name: "is-odd", version: "3.0.1", main: "index.js" },
      patched: false,
      lockfileHasPatches: false,
    });
  });
});

// A checkout can take package.json and bun.lock back to a commit without the patch in one step (a
// branch switch, a pulled revert, `git stash`), and a frozen install applies a patch that bun.lock
// never gets. Neither file names the patch then, so the installed copy has to.
// https://github.com/oven-sh/bun/issues/25932
describe.concurrent("a patch that package.json and bun.lock lose in one step", () => {
  const commands = ["install", "install --frozen-lockfile", "ci"];

  const patchPath = "patches/no-deps@1.0.0.patch";
  // index.js of no-deps@1.0.0 exports the package's package.json. The patch adds `patched` to the
  // exports, and a file to the package.
  const noDepsPatch = /* patch */ `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -5,3 +5,4 @@
     module.exports[key][dep] = require(dep);
   }
 }
+module.exports.patched = true;
diff --git a/patched.txt b/patched.txt
new file mode 100644
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;

  /** package.json of the commit with the patch, or of the one without it. */
  const manifest = (patched: boolean) =>
    JSON.stringify({
      name: "app",
      dependencies: { "no-deps": "1.0.0" },
      patchedDependencies: patched ? { "no-deps@1.0.0": patchPath } : undefined,
    });

  /** A project at the commit without the patch, with nothing installed. */
  const unpatchedProject = (prefix: string, linker: "hoisted" | "isolated" = "hoisted") =>
    createProject(prefix, {
      "package.json": manifest(false),
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
    });

  /** What a checkout does to package.json and to the patch file. bun.lock is left to the caller. */
  async function checkout(dir: string, patched: boolean) {
    await Bun.write(join(dir, "package.json"), manifest(patched));
    if (patched) await Bun.write(join(dir, patchPath), noDepsPatch);
    else await rm(join(dir, "patches"), { recursive: true, force: true });
  }

  /**
   * What the project has of no-deps: the files of the copy that `require("no-deps")` loads, and
   * what that copy exports when the project runs it.
   */
  async function installed(dir: string, env: Env) {
    return {
      files: (await readdir(join(dir, "node_modules", "no-deps"))).sort(),
      exports: JSON.parse(await bunOk(dir, env, "-e", `console.log(JSON.stringify(require("no-deps")))`)),
    };
  }
  const asPublished = {
    files: ["index.js", "package.json"],
    exports: { name: "no-deps", version: "1.0.0" },
  };
  // A patched copy also has the marker of its patch, `.bun-tag-<hash of the patch file>`.
  const asPatched = {
    files: [expect.stringMatching(/^\.bun-tag-[0-9a-f]{1,16}$/), "index.js", "package.json", "patched.txt"],
    exports: expect.objectContaining({ name: "no-deps", version: "1.0.0", patched: true }),
  };

  /** Runs `command` once more: the install has nothing left to do. */
  async function expectNoChanges(dir: string, env: Env, command: string) {
    const { stdout, stderr, exitCode } = await runBun(dir, env, ...command.split(" "));
    expect(stdout).toContain("(no changes)");
    expect(stderr.replace(installProgress, "")).toBe("");
    expect(exitCode).toBe(0);
  }

  describe.each(["hoisted", "isolated"] as const)("%s linker", linker => {
    // The isolated linker prints `(no changes)` and keeps the patched copy (https://github.com/oven-sh/bun/issues/25932).
    // Only the hoisted linker has the fix so far.
    const fixed = test.failingIf(linker === "isolated");

    fixed.each(commands)("bun %s installs the package as published after a checkout of both files", async command => {
      await using project = unpatchedProject("patch-lost-checkout", linker);
      const { dir, env } = project;
      // bun.lock of the commit without the patch. The first install is at the commit with the patch.
      await bunOk(dir, env, "install", "--lockfile-only");
      const unpatchedLock = await file(dir, "bun.lock").text();

      await checkout(dir, true);
      await bunOk(dir, env, "install");
      await expectPatchedDependencies(dir, { "no-deps@1.0.0": patchPath });
      expect(await installed(dir, env)).toEqual(asPatched);

      // package.json and bun.lock lose the patch in one step.
      await checkout(dir, false);
      await Bun.write(join(dir, "bun.lock"), unpatchedLock);
      await bunOk(dir, env, ...command.split(" "));
      expect(await installed(dir, env)).toEqual(asPublished);
      expect(await file(dir, "bun.lock").text()).toBe(unpatchedLock);
      await expectNoChanges(dir, env, command);
    });

    fixed.each(commands)(
      "bun %s installs the package as published after a frozen install applied a patch that bun.lock never got",
      async command => {
        await using project = unpatchedProject("patch-lost-frozen", linker);
        const { dir, env } = project;
        await bunOk(dir, env, "install");
        const unpatchedLock = await file(dir, "bun.lock").text();
        expect(await installed(dir, env)).toEqual(asPublished);

        // package.json gets the patch, and the frozen form of the command applies it without writing bun.lock.
        await checkout(dir, true);
        await bunOk(dir, env, ...(command === "ci" ? ["ci"] : ["install", "--frozen-lockfile"]));
        expect(await installed(dir, env)).toEqual(asPatched);
        expect(await file(dir, "bun.lock").text()).toBe(unpatchedLock);

        // package.json loses the patch again.
        await checkout(dir, false);
        await bunOk(dir, env, ...command.split(" "));
        expect(await installed(dir, env)).toEqual(asPublished);
        expect(await file(dir, "bun.lock").text()).toBe(unpatchedLock);
        await expectNoChanges(dir, env, command);
      },
    );
  });

  describe("hoisted linker", () => {
    /** A project with the patch installed, and what the checkout of both files puts back. */
    async function patchedThenLost(prefix: string) {
      const project = unpatchedProject(prefix);
      const { dir, env } = project;
      await bunOk(dir, env, "install", "--lockfile-only");
      const unpatchedLock = await file(dir, "bun.lock").text();
      await checkout(dir, true);
      await bunOk(dir, env, "install");
      expect(await installed(dir, env)).toEqual(asPatched);
      await checkout(dir, false);
      await Bun.write(join(dir, "bun.lock"), unpatchedLock);
      return project;
    }

    // The published files are in the cache, so the package comes back without the network.
    test("bun install --offline installs the package as published from the cache", async () => {
      await using project = await patchedThenLost("patch-lost-offline");
      const { dir, env } = project;
      await bunOk(dir, env, "install", "--offline");
      expect(await installed(dir, env)).toEqual(asPublished);
    });

    // Without the cache there is nothing to install the package from, and the copy is not the package of bun.lock.
    test("bun install --offline fails when the cache is gone, and leaves the files of the copy", async () => {
      await using project = await patchedThenLost("patch-lost-offline-no-cache");
      const { dir, env } = project;
      const copy = join(dir, "node_modules", "no-deps");
      const files = await readdir(copy);
      await rm(join(dir, ".bun-cache"), { recursive: true });

      const { stdout, stderr, exitCode } = await runBun(dir, env, "install", "--offline");
      expect(stderr).toContain(`--offline: "no-deps" is not in the cache`);
      expect(stdout).not.toContain("(no changes)");
      expect(exitCode).toBe(1);
      expect(await readdir(copy)).toEqual(files);
      expect(await file(copy, "patched.txt").text()).toBe("hello world\n");
    });

    // Adds a file, so it applies to any package.
    const anyPackagePatch = /* patch */ `diff --git a/patched.txt b/patched.txt
new file mode 100644
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;
    type Variant = {
      /** package.json of the root without `patchedDependencies`, and the other files of the project. */
      manifest: Record<string, unknown>;
      files?: DirectoryTree;
      /** The key of the patch, and the folder of the copy that it applies to. */
      key: string;
      copy: string;
      bunfig?: string;
    };
    const variants: Record<string, Variant> = {
      // is-even@1.0.0 depends on is-odd@^0.1.2, which cannot be at the root next to is-odd@3.0.1.
      "a nested tree": {
        manifest: { dependencies: { "is-even": "1.0.0", "is-odd": "3.0.1" } },
        key: "is-odd@0.1.2",
        copy: "node_modules/is-even/node_modules/is-odd",
      },
      "the tree of a workspace": {
        manifest: { workspaces: ["packages/*"], dependencies: { "no-deps": "2.0.0" } },
        files: {
          "packages/a/package.json": JSON.stringify({
            name: "a",
            version: "1.0.0",
            dependencies: { "no-deps": "1.0.0" },
          }),
        },
        key: "no-deps@1.0.0",
        copy: "packages/a/node_modules/no-deps",
      },
      "a scoped package": {
        manifest: { dependencies: { "@scoped/no-deps": "1.0.0" } },
        key: "@scoped/no-deps@1.0.0",
        copy: "node_modules/@scoped/no-deps",
      },
      "an alias": {
        manifest: { dependencies: { aliased: "npm:no-deps@1.0.0" } },
        key: "no-deps@1.0.0",
        copy: "node_modules/aliased",
      },
      "a project with bun.lockb": {
        manifest: { dependencies: { "no-deps": "1.0.0" } },
        key: "no-deps@1.0.0",
        copy: "node_modules/no-deps",
        bunfig: `saveTextLockfile = false\n`,
      },
    };

    test.each(Object.keys(variants))("the patched package is in %s", async name => {
      const variant = variants[name];
      const lockfile = variant.bunfig ? "bun.lockb" : "bun.lock";
      const manifest = (patched: boolean) =>
        JSON.stringify({
          name: "app",
          ...variant.manifest,
          patchedDependencies: patched ? { [variant.key]: "patches/any.patch" } : undefined,
        });
      await using project = createProject("patch-lost-variant", {
        "package.json": manifest(false),
        "bunfig.toml": `[install]\nlinker = "hoisted"\n${variant.bunfig ?? ""}`,
        ...variant.files,
      });
      const { dir, env } = project;
      const copy = join(dir, variant.copy);
      /** The files of the copy without the marker of the patch, and what names the patch. */
      const state = async () => ({
        files: (await readdir(copy)).filter(name => !name.startsWith(".bun-tag-")).sort(),
        markers: (await readdir(copy)).filter(name => name.startsWith(".bun-tag-")).length,
        key: (await file(copy, "package.json").json())._bunPatchHash,
      });
      await bunOk(dir, env, "install");
      const unpatchedLock = await file(dir, lockfile).bytes();
      const published = await state();
      expect(published).toMatchObject({ markers: 0, key: undefined });

      await Bun.write(join(dir, "patches", "any.patch"), anyPackagePatch);
      await Bun.write(join(dir, "package.json"), manifest(true));
      await bunOk(dir, env, "install");
      expect(await state()).toEqual({
        files: [...published.files, "patched.txt"].sort(),
        markers: 1,
        key: expect.stringMatching(/^[0-9a-f]{1,16}\.[0-9a-f]{1,16}$/),
      });
      await expectNoChanges(dir, env, "install");

      await Bun.write(join(dir, "package.json"), manifest(false));
      await Bun.write(join(dir, lockfile), unpatchedLock);
      await rm(join(dir, "patches"), { recursive: true });
      expect(await bunOk(dir, env, "install")).toContain("1 package installed");
      expect(await state()).toEqual(published);
      await expectNoChanges(dir, env, "install");
    });
  });

  /** A registry that has only `name`@1.0.0, with `packageJson` as its package.json. It counts the tarball requests. */
  async function registryOf(name: string, packageJson: string, hasIntegrity: boolean) {
    const tarball = await new Bun.Archive(
      { "package/package.json": packageJson, "package/index.js": "module.exports = 1;\n" },
      { compress: "gzip" },
    ).bytes();
    const integrity = `sha512-${new Bun.CryptoHasher("sha512").update(tarball).digest("base64")}`;
    const counts = { tarballRequests: 0 };
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.url.endsWith(".tgz")) {
          counts.tarballRequests++;
          return new Response(tarball);
        }
        const dist = {
          tarball: `${server.url}${name}/-/${name}-1.0.0.tgz`,
          integrity: hasIntegrity ? integrity : undefined,
        };
        return Response.json({
          name,
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { name, version: "1.0.0", dist } },
        });
      },
    });
    return { url: server.url.href, integrity, counts, [Symbol.dispose]: () => void server.stop(true) };
  }

  // Someone can publish a package from a patched copy. Its own package.json then starts with the key that names the
  // patch of a hoisted copy. The key that bun writes ends with the first bytes of the integrity that bun.lock pins,
  // and no tarball holds its own integrity. So bun tells the package from a copy that holds a patch, without the cache.
  describe("a package that is published with the patch hash key", () => {
    const published = `{"_bunPatchHash":"0123456789abcdef.fedcba9876543210","name":"ships-key","version":"1.0.0"}`;

    /** A project that depends on ships-key@1.0.0, and a registry that has only that package. */
    async function shipsKey() {
      const server = await registryOf("ships-key", published, true);
      const project = createProject("patch-published-with-key", {
        "package.json": JSON.stringify({ name: "app", dependencies: { "ships-key": "1.0.0" } }),
        "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
      });
      const { dir } = project;
      const folder = join(dir, "node_modules", "ships-key");
      return {
        dir,
        env: { ...project.env, NPM_CONFIG_REGISTRY: server.url },
        folder,
        cache: join(dir, ".bun-cache"),
        /** The key of a copy that bun patched: the patch hash, and what bun.lock pins. */
        patchedKey: `fedcba9876543210.${pinnedDigits(server.integrity)}`,
        /** The copy in node_modules, and the tarball requests. */
        state: async () => ({
          packageJson: await file(folder, "package.json").text(),
          files: (await readdir(folder)).sort(),
          tarballRequests: server.counts.tarballRequests,
        }),
        async [Symbol.asyncDispose]() {
          server[Symbol.dispose]();
          await project[Symbol.asyncDispose]();
        },
      };
    }
    const asShipped = { packageJson: published, files: ["index.js", "package.json"], tarballRequests: 1 };

    test("the package is installed once, its patched copy again", async () => {
      await using app = await shipsKey();
      const { dir, env, folder, cache, state } = app;
      await bunOk(dir, env, "install");
      expect(await state()).toEqual(asShipped);
      const cached = (await readdir(cache)).filter(name => name.startsWith("ships-key@1.0.0@@"));
      expect(await Promise.all(cached.map(name => file(cache, name, "package.json").text()))).toEqual([published]);

      // No patch is wanted and the copy has a key: the one that the package is published with.
      await expectNoChanges(dir, env, "install");
      expect(await state()).toEqual(asShipped);

      // A patched copy has the key of bun in front of the key of the package. The file is a new one: the
      // installed file can be a hard link to the file of the cache, which keeps the key of the package.
      const patchedPackageJson = `{"_bunPatchHash":"${app.patchedKey}",${published.slice(1)}`;
      await rm(join(folder, "package.json"));
      await Bun.write(join(folder, "package.json"), patchedPackageJson);
      await Bun.write(join(folder, "patched.txt"), "hello world\n");

      // No patch is wanted, so the copy is installed again, from the cache.
      expect(normalizeBunSnapshot(await bunOk(dir, env, "install"))).toMatchInlineSnapshot(`
        "bun install <version> (<revision>)

        + ships-key@1.0.0

        1 package installed"
      `);
      expect(await state()).toEqual(asShipped);
      await expectNoChanges(dir, env, "install");
    });

    // A CI job restores node_modules and has no cache.
    test("the package is not installed again when the cache is gone", async () => {
      await using app = await shipsKey();
      const { dir, env, cache, state } = app;
      await bunOk(dir, env, "install");
      expect(await state()).toEqual(asShipped);

      for (const command of ["install", "install --frozen-lockfile", "ci", "install --offline"]) {
        await rm(cache, { recursive: true, force: true });
        await expectNoChanges(dir, env, command);
        expect(await state()).toEqual(asShipped);
      }
    });
  });

  // A registry can give neither `integrity` nor `shasum`. Without an integrity in bun.lock, a key in the package
  // cannot be told from the name of a patch. So the copy gets no name, and the marker alone shows the patch, as before.
  test("a registry package whose integrity bun.lock does not pin gets no name", async () => {
    const published = JSON.stringify({ name: "no-pin", version: "1.0.0" });
    using server = await registryOf("no-pin", published, false);
    await using project = createProject("patch-no-integrity", {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { "no-pin": "1.0.0" },
        patchedDependencies: { "no-pin@1.0.0": "patches/no-pin.patch" },
      }),
      "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
      patches: {
        "no-pin.patch": `diff --git a/patched.txt b/patched.txt
new file mode 100644
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`,
      },
    });
    const { dir } = project;
    const env = { ...project.env, NPM_CONFIG_REGISTRY: server.url };
    const folder = join(dir, "node_modules", "no-pin");

    await bunOk(dir, env, "install");
    expect(await file(dir, "bun.lock").text()).not.toMatch(/sha\d+-/);
    const state = async () => ({
      packageJson: await file(folder, "package.json").text(),
      files: (await readdir(folder)).sort(),
    });
    const patched = {
      packageJson: published,
      files: [expect.stringMatching(/^\.bun-tag-[0-9a-f]{1,16}$/), "index.js", "package.json", "patched.txt"],
    };
    expect(await state()).toEqual(patched);
    await expectNoChanges(dir, env, "install");
    expect(await state()).toEqual(patched);
  });
});

// The checkout that takes the patch out of package.json and bun.lock, for a git, github or tarball package.
// The hoisted linker takes such a package for installed by its `.bun-tag`, not by its package.json: line 1 is
// the commit or the integrity that bun.lock has, and a patched copy names its patch on line 2.
// https://github.com/oven-sh/bun/issues/25932
describe.concurrent("a patch of a git, github or tarball package that package.json and bun.lock lose", () => {
  const original = `module.exports = "original";\n`;
  const patched = `module.exports = "patched";\n`;
  const dep = { "package.json": JSON.stringify({ name: "dep", version: "1.0.0" }), "index.js": original };
  const patch = /* patch */ `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1 +1 @@
-module.exports = "original";
+module.exports = "patched";
`;
  // The digits in the name of the marker and of the patched cache folder: the first 8 bytes of the SHA-1 of the
  // patch file as a little-endian integer.
  const patchHash = new Bun.CryptoHasher("sha1").update(patch).digest().readBigUInt64LE(0).toString(16);
  const marker = `.bun-tag-${patchHash}`;

  // The host of the remote tarball, which is the GitHub API too. That one names the root folder of its tarball
  // `<owner>-<repo>-<commit>`, and bun.lock and `.bun-tag` have that name for the commit.
  let tarball: Uint8Array;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    tarball = await githubTarball("package", dep);
    const repository = await githubTarball("testowner-testrepo-aaaaaaa", dep);
    server = Bun.serve({
      port: 0,
      fetch: req => new Response(new URL(req.url).pathname === "/dep-1.0.0.tgz" ? tarball : repository),
    });
  });

  afterAll(() => server?.stop(true));

  // What package.json says `dep` is.
  const specs = {
    "git": (dir: string) => `git+${pathToFileURL(join(dir, "repo"))}`,
    "github": () => "github:testowner/testrepo#aaaaaaa",
    "local tarball": () => "./dep-1.0.0.tgz",
    "remote tarball": () => `${server.url}dep-1.0.0.tgz`,
  };
  type Kind = keyof typeof specs;

  /** A project at the commit without the patch, with `dep` installed. */
  async function project(kind: Kind, linker: "hoisted" | "isolated" = "hoisted") {
    const created = createProject("patch-lost-bun-tag", {
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
      "gitconfig": "[core]\n\tautocrlf = false\n",
      "dep-1.0.0.tgz": Buffer.from(tarball),
      repo: dep,
    });
    const { dir } = created;
    const env = {
      ...created.env,
      ...gitVars,
      // Not the config of the machine: its `core.autocrlf` changes the line endings of a checkout on Windows.
      GIT_CONFIG_GLOBAL: join(dir, "gitconfig"),
      GITHUB_API_URL: server.url.origin,
    };
    if (kind === "git") {
      await $`git init -q && git add -A && git commit -q -m init --no-gpg-sign`.cwd(join(dir, "repo")).env(env).quiet();
    }
    const manifest = (patchedDependencies?: Record<string, string>) =>
      JSON.stringify({ name: "app", dependencies: { dep: specs[kind](dir) }, patchedDependencies });
    await Bun.write(join(dir, "package.json"), manifest());
    await bunOk(dir, env, "install");
    const lockfile = await file(dir, "bun.lock").text();
    // `["dep@<resolution>", {}, "<the commit, or the integrity of the tarball>", ...]`
    const [key, , pinned]: string[] = (Bun.JSONC.parse(lockfile) as any).packages.dep;
    return {
      ...created,
      env,
      /** What bun.lock pins `dep` to, and line 1 of `.bun-tag`: the commit, or the integrity of the tarball. */
      pinned,
      /** What a checkout of the commit with the patch does, but for bun.lock: the next install writes it. */
      async addPatch() {
        await Bun.write(join(dir, "patches", "dep.patch"), patch);
        await Bun.write(join(dir, "package.json"), manifest({ [key]: "patches/dep.patch" }));
      },
      /** What a checkout of the commit without the patch does. */
      async checkout() {
        await Bun.write(join(dir, "package.json"), manifest());
        await Bun.write(join(dir, "bun.lock"), lockfile);
        await rm(join(dir, "patches"), { recursive: true });
      },
    };
  }

  /** What `require("dep")` loads, and what says which package that is. */
  async function installed(dir: string) {
    const folder = join(dir, "node_modules", "dep");
    return {
      index: await file(folder, "index.js").text(),
      markers: (await readdir(folder)).filter(name => name.startsWith(".bun-tag-")),
      bunTag: await file(folder, ".bun-tag").text(),
    };
  }

  const commands = ["install", "install --frozen-lockfile", "ci"];

  /** After a checkout of both files, the command installs `dep` as bun.lock has it. */
  const restoresAfterCheckout = (kind: Kind, linker: "hoisted" | "isolated") => async (command: string) => {
    await using app = await project(kind, linker);
    const { dir, env } = app;
    const unpatched = await installed(dir);

    await app.addPatch();
    await bunOk(dir, env, "install");
    expect(await installed(dir)).toMatchObject({ index: patched, markers: [marker] });

    await app.checkout();
    await bunOk(dir, env, ...command.split(" "));
    expect(await installed(dir)).toEqual(unpatched);

    // The patched copy is gone, so the command has nothing left to do.
    expect(await bunOk(dir, env, ...command.split(" "))).toContain("(no changes)");
    expect(await installed(dir)).toEqual(unpatched);
  };

  // The isolated linker prints `(no changes)` and keeps the patched copy (https://github.com/oven-sh/bun/issues/25932).
  // Only the hoisted linker has the fix so far.
  describe("isolated linker", () => {
    describe.each(Object.keys(specs) as Kind[])("%s", kind => {
      test.todoIf(true).each(commands)(
        "bun %s installs the package as bun.lock has it after a checkout of both files",
        restoresAfterCheckout(kind, "isolated"),
      );
    });
  });

  describe("hoisted linker", () => {
    describe.each(Object.keys(specs) as Kind[])("%s", kind => {
      test("the installed copy names the patch, and is not installed again", async () => {
        await using app = await project(kind);
        const { dir, env, pinned } = app;
        expect(await installed(dir)).toEqual({ index: original, markers: [], bunTag: pinned });

        await app.addPatch();
        await bunOk(dir, env, "install");
        const named = await installed(dir);
        // Line 1 is what it was: the copy is still the package that bun.lock has.
        expect(named).toEqual({ index: patched, markers: [marker], bunTag: `${pinned}\n${patchHash}` });

        expect(await bunOk(dir, env, "install")).toContain("(no changes)");
        expect(await installed(dir)).toEqual(named);
      });

      test.each(commands)(
        "bun %s installs the package as bun.lock has it after a checkout of both files",
        restoresAfterCheckout(kind, "hoisted"),
      );
    });

    // `--no-verify` does not check a download against the integrity in bun.lock, so `.bun-tag` claims none.
    test("line 1 of .bun-tag stays empty for a remote tarball that --no-verify did not check", async () => {
      await using app = await project("remote tarball");
      const { dir, env } = app;
      // Without the cache, the patched package is made from a download.
      await rm(join(dir, ".bun-cache"), { recursive: true });

      await app.addPatch();
      await bunOk(dir, env, "install", "--no-verify");
      const named = { index: patched, markers: [marker], bunTag: `\n${patchHash}` };
      expect(await installed(dir)).toEqual(named);
      expect(await bunOk(dir, env, "install", "--no-verify")).toContain("(no changes)");
      expect(await installed(dir)).toEqual(named);

      await app.checkout();
      await bunOk(dir, env, "install", "--no-verify");
      const unpatched = { index: original, markers: [], bunTag: "" };
      expect(await installed(dir)).toEqual(unpatched);
      expect(await bunOk(dir, env, "install", "--no-verify")).toContain("(no changes)");
      expect(await installed(dir)).toEqual(unpatched);
    });

    // `bun prune` compares `.bun-tag` of a git package with the commit in bun.lock, and looks into the package
    // only when they agree.
    test("bun prune takes a git copy that names its patch for the package that bun.lock has", async () => {
      await using app = await project("git");
      const { dir, env, pinned } = app;
      await app.addPatch();
      await bunOk(dir, env, "install");
      expect((await installed(dir)).bunTag).toBe(`${pinned}\n${patchHash}`);

      const dryRun = async () => {
        const { stdout, stderr, exitCode } = await runBun(dir, env, "prune", "--dry-run");
        return { stdout: stdout.replaceAll("\\", "/"), stderr, exitCode };
      };
      expect(await dryRun()).toEqual({
        stdout: expect.stringContaining("(nothing to prune)"),
        stderr: "",
        exitCode: 0,
      });

      // A package that nothing depends on, inside the patched one.
      const junk = join(dir, "node_modules", "dep", "node_modules", "junk", "package.json");
      await Bun.write(junk, JSON.stringify({ name: "junk", version: "1.0.0" }));
      expect(await dryRun()).toEqual({
        stdout: expect.stringContaining("- junk@1.0.0 (node_modules/dep/node_modules)\n1 package can be removed"),
        stderr: "",
        exitCode: 0,
      });
    });
  });
});

// What a version of bun that does not name the patch in an installed copy leaves of a patched
// package: the patched files, and the empty marker `.bun-tag-<patch hash>` next to them. Its hoisted
// linker keeps package.json and `.bun-tag` as published. While the patch is wanted, an install keeps
// such a copy and names the patch in it: nothing is fetched, and the package is not installed again.
describe.concurrent("a patched package that an earlier version of bun installed", () => {
  type Files = Record<string, string>;

  // index.js of is-odd@0.1.2 in the registry.
  const isOddIndex = `'use strict';

module.exports = function isOdd(i) {
  if (typeof i !== 'number') {
    throw new TypeError('is-odd expects a number.');
  }
  return !!(~~i & 1);
};
`;
  const isOddPatch = (message: string) => /* patch */ `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -3,3 +3,4 @@
 module.exports = function isOdd(i) {
+  console.log("${message}");
   if (typeof i !== 'number') {
     throw new TypeError('is-odd expects a number.');
`;
  /** What `isOddPatch(message)` makes of index.js. */
  const patchedIndex = (message: string) =>
    isOddIndex.replace("function isOdd(i) {\n", `function isOdd(i) {\n  console.log("${message}");\n`);

  // The hash of a patch is the first 8 bytes of the SHA-1 of the patch file, as a little-endian
  // number. The marker and the patched cache folder (`_patch_hash=`) have it in their names, in hex.
  const patchHash = (patch: string) =>
    new Bun.CryptoHasher("sha1").update(patch).digest().readBigUInt64LE(0).toString(16);

  // The patch that the project asks for, and what is-odd logs with it.
  const logged = "is-odd patched";
  const patchFile = "patches/is-odd.patch";
  const patch = isOddPatch(logged);
  const hash = patchHash(patch);

  type Source = {
    dependencies(dir: string, registryUrl: string): Record<string, string> | Promise<Record<string, string>>;
    /** Calls is-odd from every package that depends on it, and prints "done". */
    indexTs: string;
    /** What index.ts prints while is-odd is patched. */
    patched: string;
    env?: Env;
  };
  const callsIsOdd = `import isOdd from "is-odd";\nisOdd(1);\nconsole.log("done");\n`;
  // Where is-odd comes from. The hoisted linker names the patch of a registry package in its
  // package.json, and the patch of a git or tarball package in its `.bun-tag`.
  const sources = {
    // is-even depends on is-odd@^0.1.2: the one copy of is-odd@0.1.2 is for is-even and for the
    // project, and index.ts calls it from both.
    registry: {
      dependencies: () => ({ "is-even": "1.0.0", "is-odd": "0.1.2" }),
      indexTs: `import isEven from "is-even";\nisEven(2);\n${callsIsOdd}`,
      patched: `${logged}\n${logged}\ndone\n`,
    },
    git: {
      async dependencies(dir) {
        const repo = join(dir, "repo");
        await Bun.write(
          join(repo, "package.json"),
          JSON.stringify({ name: "is-odd", version: "0.1.2", main: "index.js" }),
        );
        await Bun.write(join(repo, "index.js"), isOddIndex);
        // The checkout has the line ends of the commit, whatever git is configured to do.
        await Bun.write(join(repo, ".gitattributes"), "* -text\n");
        await $`git init -q && git add -A && git commit -q -m init --no-gpg-sign`
          .cwd(repo)
          .env({ ...bunEnv, ...gitVars })
          .quiet();
        return { "is-odd": `git+${pathToFileURL(repo)}` };
      },
      indexTs: callsIsOdd,
      patched: `${logged}\ndone\n`,
      env: gitVars,
    },
    tarball: {
      dependencies: (_dir, registryUrl) => ({ "is-odd": `${registryUrl}is-odd/-/is-odd-0.1.2.tgz` }),
      indexTs: callsIsOdd,
      patched: `${logged}\ndone\n`,
    },
  } satisfies Record<string, Source>;

  /** The files in `dir` and their text. */
  async function files(dir: string): Promise<Files> {
    const names = (await readdir(dir)).sort();
    return Object.fromEntries(
      await Promise.all(names.map(async name => [name, await Bun.file(join(dir, name)).text()] as const)),
    );
  }

  /** A project at the commit without the patch, with is-odd installed as published. */
  async function project(source: Source, registryUrl: string) {
    const created = createProject("patch-left", {
      "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
      "index.ts": source.indexTs,
    });
    const { dir } = created;
    const cache = join(dir, ".bun-cache");
    const env: Env = {
      ...created.env,
      ...source.env,
      NPM_CONFIG_REGISTRY: registryUrl,
      BUN_INSTALL_CACHE_DIR: cache,
    };
    const manifest = { name: "app", dependencies: await source.dependencies(dir, registryUrl) };
    await Bun.write(join(dir, "package.json"), JSON.stringify(manifest));
    await bunOk(dir, env, "install");

    const lockfile = await file(dir, "bun.lock").text();
    // A package is patched under the id of its row in bun.lock.
    const key = /^    "is-odd": \["([^"]+)"/m.exec(lockfile)![1];
    /** What `require("is-odd")` loads in the project. */
    const copy = join(dir, "node_modules", "is-odd");
    const published = await files(copy);
    expect(published["index.js"]).toBe(isOddIndex);
    return {
      dir,
      env,
      cache,
      source,
      copy,
      /** The files of is-odd as published. */
      published,
      /** The commit with the patch. */
      async addPatch() {
        await Bun.write(join(dir, patchFile), patch);
        await Bun.write(
          join(dir, "package.json"),
          JSON.stringify({ ...manifest, patchedDependencies: { [key]: patchFile } }),
        );
      },
      /** What `git checkout` does to the tracked files on the way back to the commit without the patch. */
      async checkoutMain() {
        await Bun.write(join(dir, "package.json"), JSON.stringify(manifest));
        await Bun.write(join(dir, "bun.lock"), lockfile);
        await rm(join(dir, "patches"), { recursive: true, force: true });
      },
      [Symbol.asyncDispose]: created[Symbol.asyncDispose],
    };
  }
  type Project = Awaited<ReturnType<typeof project>>;

  /**
   * Makes of a copy of the published is-odd what an earlier version left after it installed with
   * `isOddPatch(message)`: the patched index.js, and the marker of that patch. index.js is a new
   * file, because the installed one can be the file in the cache.
   */
  async function patchAsEarlierVersion(copy: string, message: string) {
    await rm(join(copy, "index.js"));
    await Bun.write(join(copy, "index.js"), patchedIndex(message));
    await Bun.write(join(copy, `.bun-tag-${patchHash(isOddPatch(message))}`), "");
  }

  /**
   * Turns the project into what an earlier version left after `bun install` at the commit with the
   * patch: package.json and bun.lock ask for the patch, and the copy of is-odd is the patched one.
   * The cache is gone, so a package that is installed again has to be fetched again. Returns the
   * files of the copy.
   */
  async function leftByEarlierVersion(p: Project) {
    await p.addPatch();
    // Writes the patch into bun.lock, and nothing into node_modules.
    await bunOk(p.dir, p.env, "install", "--lockfile-only");
    expect(await file(p.dir, "bun.lock").text()).toContain(patchFile);
    await patchAsEarlierVersion(p.copy, logged);
    // Only this copy has the file: a package that is installed again loses it.
    await Bun.write(join(p.copy, "only-in-this-copy.txt"), "");
    await rm(p.cache, { recursive: true, force: true });
    return files(p.copy);
  }

  /** A registry of its own for a test that counts requests: the other tests send theirs to `registry`. */
  const countingRegistry = () => new TestRegistry({ recordRequests: true }).start();
  const requests = (counting: TestRegistry) => counting.requests.map(request => `${request.method} ${request.path}`);

  /**
   * The copy that an install kept runs the patched code, and the next install keeps it too. After a
   * checkout of the commit without the patch, the package is installed as published.
   */
  async function keptUntilThePatchIsGone(p: Project, counting: TestRegistry) {
    expect(await bunOk(p.dir, p.env, "run", "index.ts")).toBe(p.source.patched);
    expect(await bunOk(p.dir, p.env, "install")).toContain("(no changes)");
    expect(requests(counting)).toEqual([]);

    await p.checkoutMain();
    await bunOk(p.dir, p.env, "install");
    expect(await files(p.copy)).toEqual(p.published);
    expect(await bunOk(p.dir, p.env, "run", "index.ts")).toBe("done\n");
  }

  test("hoisted linker: a registry package gets the patch hash as the first key of its package.json", async () => {
    using counting = countingRegistry();
    await using p = await project(sources.registry, counting.registryUrl());
    const left = await leftByEarlierVersion(p);
    counting.requests.length = 0;

    await bunOk(p.dir, p.env, "install");
    expect(requests(counting)).toEqual([]);
    const copy = await files(p.copy);
    expect(Object.entries(JSON.parse(copy["package.json"]))).toEqual([
      ["_bunPatchHash", await patchKeyOf(p.dir, "is-odd", hash)],
      ...Object.entries(JSON.parse(left["package.json"])),
    ]);
    // Every other file is the one that was there: the package was not installed again.
    expect<Files>({ ...copy, "package.json": left["package.json"] }).toEqual(left);

    await keptUntilThePatchIsGone(p, counting);
  });

  test.each(["git", "tarball"] as const)(
    "hoisted linker: a %s package gets the patch hash as line 2 of its .bun-tag",
    async name => {
      using counting = countingRegistry();
      await using p = await project(sources[name], counting.registryUrl());
      const left = await leftByEarlierVersion(p);
      counting.requests.length = 0;

      await bunOk(p.dir, p.env, "install");
      expect(requests(counting)).toEqual([]);
      // Line 1 is what it was: the commit, or the integrity of the tarball.
      expect(await files(p.copy)).toEqual({ ...left, ".bun-tag": `${left[".bun-tag"]}\n${hash}` });

      await keptUntilThePatchIsGone(p, counting);
    },
  );

  /** is-odd was installed again with the patch: the copy is a new one, which names the patch. */
  async function expectInstalledAgain(p: Project) {
    const copy = await files(p.copy);
    expect(Object.keys(copy)).toEqual([`.bun-tag-${hash}`, ...Object.keys(p.published)].sort());
    expect(copy["index.js"]).toBe(patchedIndex(logged));
    expect(JSON.parse(copy["package.json"])._bunPatchHash).toBe(await patchKeyOf(p.dir, "is-odd", hash));
    expect(await bunOk(p.dir, p.env, "install")).toContain("(no changes)");
    expect(await bunOk(p.dir, p.env, "run", "index.ts")).toBe(p.source.patched);
  }

  // A link that cannot move the old copy away puts the files of one patch next to the marker of another
  // (https://github.com/oven-sh/bun/issues/45184). The marker of the wanted patch does not show whose files they are.
  test("hoisted linker: a copy that has the marker of another patch too is installed again", async () => {
    await using p = await project(sources.registry, registry.registryUrl());
    await leftByEarlierVersion(p);
    await patchAsEarlierVersion(p.copy, "another patch");
    expect((await readdir(p.copy)).filter(name => name.startsWith(".bun-tag-"))).toHaveLength(2);

    await bunOk(p.dir, p.env, "install");
    await expectInstalledAgain(p);
  });

  // `bun patch --commit` of an earlier version wrote the marker of the patch before into the patch file, as a new
  // file. A copy of such a patch has two markers from the start, and so has the patched folder of the cache.
  test("hoisted linker: a copy with a marker that the patch file adds is kept, with the cache and without it", async () => {
    using counting = countingRegistry();
    await using p = await project(sources.registry, counting.registryUrl());
    await p.addPatch();
    const earlier = ".bun-tag-1234abcd";
    const withMarker = `diff --git a/${earlier} b/${earlier}
new file mode 100644
index 0000000000000000000000000000000000000000..e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
${patch}`;
    await Bun.write(join(p.dir, patchFile), withMarker);
    await bunOk(p.dir, p.env, "install");
    const linked = await files(p.copy);
    expect(Object.keys(linked).filter(name => name.startsWith(".bun-tag-"))).toEqual(
      [earlier, `.bun-tag-${patchHash(withMarker)}`].sort(),
    );
    expect(JSON.parse(linked["package.json"])._bunPatchHash).toBe(
      await patchKeyOf(p.dir, "is-odd", patchHash(withMarker)),
    );
    expect(await bunOk(p.dir, p.env, "install")).toContain("(no changes)");

    /** What an earlier version left of that copy: package.json as published. */
    const unname = async () => {
      await rm(join(p.copy, "package.json"));
      await Bun.write(join(p.copy, "package.json"), p.published["package.json"]);
      await Bun.write(join(p.copy, "only-in-this-copy.txt"), "");
    };
    await unname();
    counting.requests.length = 0;
    expect(await bunOk(p.dir, p.env, "install")).toContain("(no changes)");
    expect(await files(p.copy)).toEqual({ ...linked, "only-in-this-copy.txt": "" });
    expect(requests(counting)).toEqual([]);

    // The patch file shows where the second marker is from. That needs no cache and no registry.
    await unname();
    await rm(p.cache, { recursive: true, force: true });
    expect(await bunOk(p.dir, p.env, "install", "--offline")).toContain("(no changes)");
    expect(await files(p.copy)).toEqual({ ...linked, "only-in-this-copy.txt": "" });
    expect(requests(counting)).toEqual([]);
  });

  // The marker is all that shows the patch in a copy of an earlier version. It is taken at its word, as before:
  // no file of the copy is compared with the cache, which can be gone.
  test("hoisted linker: a copy with the marker is named whatever its files are", async () => {
    using counting = countingRegistry();
    await using p = await project(sources.registry, counting.registryUrl());
    await p.addPatch();
    await bunOk(p.dir, p.env, "install", "--lockfile-only");
    // The published files, and the marker of the patch.
    await Bun.write(join(p.copy, `.bun-tag-${hash}`), "");
    await rm(p.cache, { recursive: true, force: true });
    counting.requests.length = 0;

    expect(await bunOk(p.dir, p.env, "install")).toContain("(no changes)");
    expect(requests(counting)).toEqual([]);
    const copy = await files(p.copy);
    expect(copy["index.js"]).toBe(isOddIndex);
    expect(JSON.parse(copy["package.json"])._bunPatchHash).toBe(await patchKeyOf(p.dir, "is-odd", hash));
  });

  // The name cannot be written into a folder that the install cannot write. The copy stays installed, as it
  // is for the version that linked it. As root the install runs without the capability that ignores file modes.
  const setpriv = isRoot ? Bun.which("setpriv") : null;
  test.skipIf(isWindows || (isRoot && !setpriv))(
    "hoisted linker: a copy in a folder that cannot be written is kept without a name",
    async () => {
      await using p = await project(sources.registry, registry.registryUrl());
      const left = await leftByEarlierVersion(p);
      await chmod(p.copy, 0o555);
      try {
        const unprivileged = setpriv ? [setpriv, "--bounding-set", "-dac_override,-dac_read_search"] : [];
        const run = async (...command: string[]) => {
          await using proc = Bun.spawn({
            cmd: [...unprivileged, bunExe(), ...command],
            cwd: p.dir,
            env: p.env,
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          return { stdout, stderr: stderr.replace(installProgress, ""), exitCode };
        };
        for (const command of [["install"], ["install", "--frozen-lockfile"]]) {
          expect(await run(...command)).toEqual({
            stdout: expect.stringContaining("(no changes)"),
            stderr: "",
            exitCode: 0,
          });
          expect(await files(p.copy)).toEqual(left);
        }
        // The write was tried: `--verbose` says why the copy has no name.
        expect(await run("install", "--verbose")).toEqual({
          stdout: expect.stringContaining("(no changes)"),
          stderr: expect.stringContaining("failed to write the patch hash into"),
          exitCode: 0,
        });
        expect(await files(p.copy)).toEqual(left);
      } finally {
        await chmod(p.copy, 0o755);
      }
    },
  );

  // The name of the patch is written into the copy. Behind a link there is a folder that is not the copy.
  test("hoisted linker: a link to a patched folder is replaced, and the folder stays as it is", async () => {
    await using p = await project(sources.registry, registry.registryUrl());
    const left = await leftByEarlierVersion(p);
    const elsewhere = join(p.dir, "elsewhere");
    await rename(p.copy, elsewhere);
    await symlink(elsewhere, p.copy, "junction");

    await bunOk(p.dir, p.env, "install");
    expect((await lstat(p.copy)).isSymbolicLink()).toBe(false);
    expect(await files(elsewhere)).toEqual(left);
    await expectInstalledAgain(p);
  });

  // Only a git or tarball package has `.bun-tag`. A folder with one, under the name and version of a registry
  // package, is a copy of something else.
  test("hoisted linker: a folder with .bun-tag is no copy of a registry package", async () => {
    await using p = await project(sources.registry, registry.registryUrl());
    await leftByEarlierVersion(p);
    await Bun.write(join(p.copy, ".bun-tag"), "sha512-AAAA");

    await bunOk(p.dir, p.env, "install");
    await expectInstalledAgain(p);
  });
});

describe.concurrent("patchedDependencies contents_hash", () => {
  // A patch that creates node_modules/is-odd/m.js; `hunk` is the @@ line.
  const patchHeader = (hunk: string) =>
    "diff --git a/m.js b/m.js\n" +
    "new file mode 100644\n" +
    "index 0000000..1111111\n" +
    "--- /dev/null\n" +
    "+++ b/m.js\n" +
    `${hunk}\n`;

  const mkProject = (name: string, patch: string) =>
    tempDir(`patch-hash-${name}`, {
      "package.json": JSON.stringify({
        name,
        patchedDependencies: { "is-odd@3.0.1": "patches/p.patch" },
        dependencies: { "is-odd": "3.0.1" },
      }),
      patches: { "p.patch": patch },
    });

  // The projects of one test share `cacheDir`, so a patched package's cache entry is keyed by the
  // hash of the patch contents alone.
  const install = async (cwd: string, cacheDir: string) => {
    const stdout = await bunOk(cwd, { ...projectEnv(cwd), BUN_INSTALL_CACHE_DIR: cacheDir }, "install");
    expect(stdout).toContain("1 package installed");
  };

  const installedMjs = (dir: string) => Bun.file(join(dir, "node_modules", "is-odd", "m.js")).text();

  test("two distinct patches that collided under the old wyhash contents_hash do not share a cache entry", async () => {
    // https://github.com/oven-sh/bun/issues/32741
    // Under Wyhash11(seed=0) both patches hash to 0x429d7ca64c60f3d1, so
    // before this change projB reused projA's cached patched package (and
    // observed AAAAAAAA) instead of applying its own patch.
    const header = patchHeader("@@ -0,0 +1 @@");
    const patchA = header + `+module.exports="xxx07QaaaaaU18fmtAHABCDEFGHIJKLMNOPAAAAAAAAgMsUw5DUklmnopqrstuvwxyz";\n`;
    const patchB = header + `+module.exports="xxx07QaaaaaU18fmtAHABCDEFGHIJKLMNOPBBBBBBBBgMsUw5DUklmnopqrstuvwxyz";\n`;
    // Regenerating this pair at runtime would require the internal Wyhash11
    // (not exposed to JS), so the colliding pair is fixed. Both patches are
    // the same length and differ only in the 8-byte payload.
    expect(patchA.length).toBe(patchB.length);
    expect(patchA).not.toBe(patchB);

    using sharedCache = tempDir("patch-hash-cache", {});
    using projA = mkProject("proj-a", patchA);
    using projB = mkProject("proj-b", patchB);
    const cache = String(sharedCache);

    await install(String(projA), cache);
    expect(await installedMjs(String(projA))).toBe(
      `module.exports="xxx07QaaaaaU18fmtAHABCDEFGHIJKLMNOPAAAAAAAAgMsUw5DUklmnopqrstuvwxyz";\n`,
    );

    await install(String(projB), cache);
    expect(await installedMjs(String(projB))).toBe(
      `module.exports="xxx07QaaaaaU18fmtAHABCDEFGHIJKLMNOPBBBBBBBBgMsUw5DUklmnopqrstuvwxyz";\n`,
    );

    // A non-colliding control patch (different size, different content) has
    // always gone to its own cache entry.
    using projC = mkProject("proj-ctl", header + `+module.exports="control payload";\n`);
    await install(String(projC), cache);
    expect(await installedMjs(String(projC))).toBe(`module.exports="control payload";\n`);
  });

  test("patches that differ only after the first 64 KiB get distinct cache entries", async () => {
    // The content hash used to be computed by repeatedly reading from file
    // offset 0, so any two patches with an identical leading chunk hashed the
    // same no matter what followed. Both patches here share a >64 KiB prefix
    // (a long comment line) and differ only in the final exported payload.
    const padding = "+// " + Buffer.alloc(80 * 1024, "p").toString() + "\n";
    const header = patchHeader("@@ -0,0 +1,2 @@");
    const patchA = header + padding + `+module.exports="TAIL_AAAA";\n`;
    const patchB = header + padding + `+module.exports="TAIL_BBBB";\n`;
    expect(patchA.length).toBe(patchB.length);
    expect(patchA).not.toBe(patchB);

    using sharedCache = tempDir("patch-tail-cache", {});
    using projA = mkProject("proj-a", patchA);
    using projB = mkProject("proj-b", patchB);
    const cache = String(sharedCache);

    await install(String(projA), cache);
    expect(await installedMjs(String(projA))).toEndWith(`\nmodule.exports="TAIL_AAAA";\n`);

    await install(String(projB), cache);
    const mB = await installedMjs(String(projB));
    // Compare just the tail so a failure doesn't dump the 80 KiB padding.
    expect({ hasB: mB.includes("TAIL_BBBB"), hasA: mB.includes("TAIL_AAAA") }).toEqual({ hasB: true, hasA: false });
  });

  // Changes index.js and adds m.js. The hash has 15 hex digits, so the names show it is not padded.
  const pinnedPatch =
    "diff --git a/index.js b/index.js\n" +
    "--- a/index.js\n" +
    "+++ b/index.js\n" +
    "@@ -8,2 +8,3 @@\n" +
    "   return (n % 2) === 1;\n" +
    " };\n" +
    "+module.exports.patched = true;\n" +
    "diff --git a/m.js b/m.js\n" +
    "new file mode 100644\n" +
    "--- /dev/null\n" +
    "+++ b/m.js\n" +
    "@@ -0,0 +1 @@\n" +
    "+module.exports = 3;\n";
  const pinnedHash = "3759d8a451c30fd";

  /** Every file of `folder` by name. latin1 is one character per byte, so equal strings are equal bytes. */
  const filesOf = async (folder: string) =>
    Object.fromEntries(
      await Promise.all(
        (await readdir(folder)).map(
          async name => [name, Buffer.from(await file(folder, name).bytes()).toString("latin1")] as const,
        ),
      ),
    );

  // Pins what the released versions do, so it passes with them on purpose. The cache is shared
  // with the other versions of bun on a machine: under another name each version would build its
  // own copy of a patched package, and changed bytes would be linked by the other versions too.
  test.each(["hoisted", "isolated"] as const)(
    "the cache folder is named by the patch hash and holds the package, the patch and an empty marker (%s linker)",
    async linker => {
      const sha1 = new Bun.CryptoHasher("sha1").update(pinnedPatch).digest();
      expect(sha1.readBigUInt64LE(0).toString(16)).toBe(pinnedHash);

      using project = mkProject(`pinned-${linker}`, pinnedPatch);
      const dir = String(project);
      const cache = join(dir, ".bun-cache");
      await bunOk(dir, projectEnv(dir), "install", `--linker=${linker}`);

      // The name of the unpatched folder depends on the registry. The patched one adds the hash to it.
      const entries = await readdir(cache);
      const [unpatched] = entries.filter(name => name.startsWith("is-odd@3.0.1@@") && !name.includes("_patch_hash="));
      const patched = `${unpatched}_patch_hash=${pinnedHash}`;
      expect(entries.filter(name => name.includes("_patch_hash="))).toEqual([patched]);

      const marker = `.bun-tag-${pinnedHash}`;
      const published = await filesOf(join(cache, unpatched));
      expect(Object.keys(published).sort()).toEqual(["index.js", "package.json"]);
      const cached = await filesOf(join(cache, patched));
      expect(cached).toEqual({
        ...published,
        "index.js": published["index.js"] + "module.exports.patched = true;\n",
        "m.js": "module.exports = 3;\n",
        [marker]: "",
      });
      // `_bunPatchHash` names the patch in the package.json of an installed copy, never in the cached one.
      expect(cached["package.json"]).not.toContain("_bunPatchHash");
      expect(await readdir(join(dir, "node_modules", "is-odd"))).toContain(marker);
    },
  );
});

// The hoisted linker names the patch of a copy in one file of the copy: the first key of package.json, or line 2 of
// `.bun-tag` for a git or tarball package. With the hardlink and symlink backends that file is the one in the cache
// folder, which other projects and other versions of bun link from too. So the linker puts a new file in its place,
// and the cache folder stays what it was made from: the published package, the patch and the marker.
describe.concurrent("a hoisted copy names its patch in a file of its own", () => {
  // Adds a file, so it applies to any package, and the cache folder has every other file as published.
  const newFilePatch = `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;

  type Source = {
    /** The file of the package in which a copy names its patch. */
    file: "package.json" | ".bun-tag";
    /** What package.json says `no-deps` is. The package is patched as `no-deps@<that>`. */
    spec(dir: string): string | Promise<string>;
    env?: Env;
  };
  const sources: Record<string, Source> = {
    npm: { file: "package.json", spec: () => "1.0.0" },
    tarball: { file: ".bun-tag", spec: () => `${registry.registryUrl()}no-deps/-/no-deps-1.0.0.tgz` },
    git: {
      file: ".bun-tag",
      env: gitVars,
      async spec(dir) {
        const repo = join(dir, "repo");
        await Bun.write(join(repo, "package.json"), JSON.stringify({ name: "no-deps", version: "1.0.0" }));
        await Bun.write(join(repo, "index.js"), "module.exports = 1;\n");
        const env = { ...bunEnv, ...gitVars };
        await $`git init -q && git add -A && git commit -q -m init --no-gpg-sign`.cwd(repo).env(env).quiet();
        const commit = (await $`git rev-parse HEAD`.cwd(repo).env(env).text()).trim();
        // With the commit, what package.json says is also what bun.lock resolves it to.
        return `git+${pathToFileURL(repo)}#${commit}`;
      },
    },
  };

  /**
   * Every file of `folder` by name: which file it is, its permission bits and its text. A symlink counts as the
   * file it leads to.
   */
  async function filesOf(folder: string) {
    const names = (await readdir(folder)).sort();
    return Object.fromEntries(
      await Promise.all(
        names.map(async name => {
          // bigint: the id of a file on NTFS does not fit a double.
          const { ino, mode } = await stat(join(folder, name), { bigint: true });
          return [name, { ino, mode: Number(mode & 0o777n), text: await file(folder, name).text() }] as const;
        }),
      ),
    );
  }

  type Backend = "hardlink" | "symlink" | "copyfile";

  async function namesPatchInOwnFile(kind: string, backend: Backend, trusted = false) {
    const source = sources[kind];
    await using project = createProject("patch-own-file", {
      "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
      patches: { "no-deps.patch": newFilePatch },
    });
    const { dir } = project;
    const env = { ...project.env, ...source.env };
    const spec = await source.spec(dir);
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "app",
        // Two packages that only lack their files are linked by the threads of a pool, but not on Windows.
        dependencies: { "no-deps": spec, "is-odd": "3.0.1" },
        trustedDependencies: trusted ? ["no-deps"] : undefined,
        patchedDependencies: { [`no-deps@${spec}`]: "patches/no-deps.patch" },
      }),
    );
    const cache = join(dir, ".bun-cache");
    const copy = join(dir, "node_modules", "no-deps");
    const install = () => bunOk(dir, env, "install", `--backend=${backend}`);

    // The first install makes the patched folder of the cache, and links the copy from it.
    await install();
    const patched = (await readdir(cache)).filter(name => name.includes("_patch_hash="));
    expect(patched).toEqual([expect.stringMatching(/_patch_hash=[0-9a-f]{1,16}$/)]);
    const [unpatched, hash] = patched[0].split("_patch_hash=");
    const folder = join(cache, patched[0]);
    let cached = await filesOf(folder);
    // The cache folder does not name the patch: the file in it is as the unpatched folder has it.
    expect(cached[source.file].text).toBe(await file(cache, unpatched, source.file).text());

    /** The copy: the file that names the patch, and which of its files are the ones in the cache folder. */
    const installed = async () => {
      const files = await filesOf(copy);
      const others = Object.keys(files).filter(name => name !== source.file);
      return {
        files: Object.keys(files),
        text: files[source.file].text,
        mode: files[source.file].mode,
        isSymlink: (await lstat(join(copy, source.file))).isSymbolicLink(),
        isFileOfCache: files[source.file].ino === cached[source.file].ino,
        othersAreFilesOfCache: others.every(name => files[name].ino === cached[name]?.ino),
      };
    };
    const patchKey = source.file === "package.json" ? await patchKeyOf(dir, "no-deps", hash) : undefined;
    /**
     * A copy that names the patch in a file of its own. Every other file is the one in the cache folder, but for
     * the copyfile backend, which copies each file.
     */
    const named = () => ({
      files: Object.keys(cached),
      text:
        source.file === "package.json"
          ? cached[source.file].text.replace("{", `{"_bunPatchHash":"${patchKey}",`)
          : `${cached[source.file].text}\n${hash}`,
      mode: cached[source.file].mode,
      isSymlink: false,
      isFileOfCache: false,
      othersAreFilesOfCache: backend !== "copyfile",
    });
    const isOddCache = join(
      cache,
      (await readdir(cache)).find(name => name.startsWith("is-odd@3.0.1@@"))!,
    );
    /** is-odd has no patch. Its copy is never written, and the install leaves no staging folder behind. */
    const expectUnpatchedPackageUntouched = async () => {
      const [copied, isOddCached] = await Promise.all([
        filesOf(join(dir, "node_modules", "is-odd")),
        filesOf(isOddCache),
      ]);
      if (backend === "copyfile") for (const name in copied) copied[name].ino = isOddCached[name]?.ino;
      expect(copied).toEqual(isOddCached);
      expect((await readdir(join(dir, "node_modules"))).filter(name => name.startsWith(".bun-tmp"))).toEqual([]);
    };
    expect(await installed()).toEqual(named());
    await expectUnpatchedPackageUntouched();

    // The new file gets the permission bits of the file it replaces. 0o775 shows that: a new file is not
    // executable, and under the usual umask the group cannot write it. On Windows a file has no such bits.
    if (!isWindows) {
      await chmod(join(folder, source.file), 0o775);
      cached = await filesOf(folder);
    }

    // The second install links from the cache folder that is there.
    await rm(join(dir, "node_modules"), { recursive: true, force: true });
    await install();
    expect(await installed()).toEqual(named());
    await expectUnpatchedPackageUntouched();
    // No file of the cache folder was written or replaced.
    expect(await filesOf(folder)).toEqual(cached);

    // What an earlier version of bun left: the file of the copy is the one in the cache folder, and only the
    // marker shows the patch. An install names the patch in such a copy too, in a new file again.
    await rm(join(copy, source.file));
    const linkAs = { hardlink: link, symlink, copyfile: copyFile }[backend];
    await linkAs(join(folder, source.file), join(copy, source.file));
    // The copy is named where it is, and not installed again.
    expect(await install()).toContain("(no changes)");
    expect(await installed()).toEqual(named());
    await expectUnpatchedPackageUntouched();
    expect(await filesOf(folder)).toEqual(cached);
  }

  // bun has no symlink backend on Windows.
  const backends: Backend[] = isWindows ? ["hardlink", "copyfile"] : ["hardlink", "symlink", "copyfile"];
  describe.each(backends)("%s backend", backend => {
    test.each(Object.keys(sources))("%s package", kind => namesPatchInOwnFile(kind, backend));
  });

  // The main thread links a trusted package itself. The threads of the pool get the patch hash another way.
  test("hardlink backend, trusted npm package", () => namesPatchInOwnFile("npm", "hardlink", true));

  // The digits in the name of the marker: the first 8 bytes of the SHA-1 of the patch file, as a little-endian
  // number.
  const newFilePatchHash = new Bun.CryptoHasher("sha1").update(newFilePatch).digest().readBigUInt64LE(0).toString(16);

  // The threads of the pool link the packages of one node_modules at the same time. Each of them writes the name
  // of its own copy.
  test("each of many patched packages gets its name", async () => {
    const registryNames = Array.from({ length: 16 }, (_, i) => `many-${i}`);
    const tarballNames = ["many-tarball-a", "many-tarball-b"];
    // 24 files in a package, so that the links of the packages overlap.
    const tarballs = new Map<string, { bytes: Uint8Array; integrity: string }>();
    for (const name of [...registryNames, ...tarballNames]) {
      const files: Record<string, string> = { "package/package.json": JSON.stringify({ name, version: "1.0.0" }) };
      for (let i = 0; i < 24; i++) files[`package/lib/${i}.js`] = `module.exports = ${i};\n`;
      const bytes = await new Bun.Archive(files, { compress: "gzip" }).bytes();
      const integrity = `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`;
      tarballs.set(name, { bytes, integrity });
    }
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        const [, name, , tarball] = new URL(request.url).pathname.split("/");
        const found = tarballs.get(name);
        if (!found) return new Response("not found", { status: 404 });
        if (tarball) return new Response(found.bytes);
        const dist = { tarball: `${server.url}${name}/-/${name}-1.0.0.tgz`, integrity: found.integrity };
        return Response.json({
          name,
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { name, version: "1.0.0", dist } },
        });
      },
    });
    const tarballSpec = (name: string) => `${server.url}${name}/-/${name}-1.0.0.tgz`;
    await using project = createProject("patch-many", {
      "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
      patches: { "any.patch": newFilePatch },
      "package.json": JSON.stringify({
        name: "app",
        dependencies: {
          ...Object.fromEntries(registryNames.map(name => [name, "1.0.0"])),
          ...Object.fromEntries(tarballNames.map(name => [name, tarballSpec(name)])),
        },
        patchedDependencies: {
          ...Object.fromEntries(registryNames.map(name => [`${name}@1.0.0`, "patches/any.patch"])),
          ...Object.fromEntries(tarballNames.map(name => [`${name}@${tarballSpec(name)}`, "patches/any.patch"])),
        },
      }),
    });
    const { dir } = project;
    const env = { ...project.env, NPM_CONFIG_REGISTRY: server.url.href };
    const copy = (name: string) => join(dir, "node_modules", name);

    /** What names the patch in each copy, and the entries of each copy that the package and the patch do not have. */
    const state = async () => ({
      names: Object.fromEntries(
        await Promise.all([
          ...registryNames.map(async name => [name, (await file(copy(name), "package.json").json())._bunPatchHash]),
          ...tarballNames.map(async name => [name, (await file(copy(name), ".bun-tag").text()).split("\n")[1]]),
        ]),
      ),
      strays: (
        await Promise.all(
          [...registryNames, ...tarballNames].map(async name =>
            (await readdir(copy(name)))
              .filter(
                entry =>
                  ![".bun-tag", `.bun-tag-${newFilePatchHash}`, "lib", "package.json", "patched.txt"].includes(entry),
              )
              .map(entry => `${name}/${entry}`),
          ),
        )
      ).flat(),
      stagingFolders: (await readdir(join(dir, "node_modules"))).filter(name => name.startsWith(".bun-tmp")),
    });
    await bunOk(dir, env, "install");
    const named = {
      names: {
        ...Object.fromEntries(
          await Promise.all(registryNames.map(async name => [name, await patchKeyOf(dir, name, newFilePatchHash)])),
        ),
        ...Object.fromEntries(tarballNames.map(name => [name, newFilePatchHash])),
      },
      strays: [],
      stagingFolders: [],
    };
    expect(await state()).toEqual(named);

    // From the cache, the packages only lack their files, and the pool links them.
    for (let round = 0; round < 4; round++) {
      await rm(join(dir, "node_modules"), { recursive: true, force: true });
      await bunOk(dir, env, "install");
      expect(await state()).toEqual(named);
    }
    expect(await bunOk(dir, env, "install")).toContain("(no changes)");
  });

  // index.js of no-deps@1.0.0 exports the package's package.json. The patch adds `patched` to the exports, and a
  // file to the package.
  const noDepsPatch = /* patch */ `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -5,3 +5,4 @@
     module.exports[key][dep] = require(dep);
   }
 }
+module.exports.patched = true;
diff --git a/patched.txt b/patched.txt
new file mode 100644
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;
  const noDepsManifest = (patched: boolean) =>
    JSON.stringify({
      name: "app",
      dependencies: { "no-deps": "1.0.0" },
      patchedDependencies: patched ? { "no-deps@1.0.0": "patches/no-deps.patch" } : undefined,
    });
  /** What the project has of no-deps: what names the patch, the markers, and whether the patched code runs. */
  async function noDepsState(dir: string, env: Env, copy = join(dir, "node_modules", "no-deps")) {
    return {
      key: (await file(copy, "package.json").json())._bunPatchHash,
      markers: (await readdir(copy)).filter(name => name.startsWith(".bun-tag-")),
      patched: JSON.parse(await bunOk(dir, env, "-e", `console.log(JSON.stringify(require("no-deps")))`)).patched,
    };
  }

  // A package folder that cannot be moved away is linked in place, on top of the old files. Here node_modules
  // cannot be written, and the package folder can. As root the install runs without the capability that ignores
  // file modes.
  const setpriv = isRoot ? Bun.which("setpriv") : null;
  test.skipIf(isWindows || (isRoot && !setpriv))(
    "a package that is linked in place gets its name, loses it with the patch, and gets it back",
    async () => {
      await using project = createProject("patch-in-place", {
        "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
        "package.json": noDepsManifest(false),
      });
      const { dir, env } = project;
      await bunOk(dir, env, "install");
      const unpatchedLock = await file(dir, "bun.lock").text();
      const published = await file(dir, "node_modules", "no-deps", "package.json").text();
      const hash = new Bun.CryptoHasher("sha1").update(noDepsPatch).digest().readBigUInt64LE(0).toString(16);
      const key = await patchKeyOf(dir, "no-deps", hash);

      const unprivileged = setpriv ? [setpriv, "--bounding-set", "-dac_override,-dac_read_search"] : [];
      /** An install that can write into the package folder, and not into node_modules. */
      const installInPlace = async () => {
        await using proc = Bun.spawn({
          // With clonefile, the default on macOS, an install into this node_modules fails before it links in place.
          cmd: [...unprivileged, bunExe(), "install", "--backend=hardlink"],
          cwd: dir,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stderr: stderr.replace(installProgress, ""), exitCode }).toEqual({ stderr: "", exitCode: 0 });
        return stdout;
      };
      const checkout = async (patched: boolean) => {
        await Bun.write(join(dir, "package.json"), noDepsManifest(patched));
        if (patched) await Bun.write(join(dir, "patches", "no-deps.patch"), noDepsPatch);
        else await Bun.write(join(dir, "bun.lock"), unpatchedLock);
      };
      const asPatched = { key, markers: [`.bun-tag-${hash}`], patched: true };

      await chmod(join(dir, "node_modules"), 0o555);
      try {
        await checkout(true);
        expect(await installInPlace()).toContain("1 package installed");
        expect(await noDepsState(dir, env)).toEqual(asPatched);
        expect(await installInPlace()).toContain("(no changes)");

        // package.json and bun.lock lose the patch in one step. The link in place leaves no marker of the patch.
        await checkout(false);
        expect(await installInPlace()).toContain("1 package installed");
        expect(await noDepsState(dir, env)).toEqual({ key: undefined, markers: [], patched: undefined });
        expect(await file(dir, "node_modules", "no-deps", "package.json").text()).toBe(published);
        // A link in place puts the files of the package over the old ones. The file that the patch added stays,
        // as it does for every link in place.
        expect((await readdir(join(dir, "node_modules", "no-deps"))).sort()).toEqual([
          "index.js",
          "package.json",
          "patched.txt",
        ]);
        expect(await installInPlace()).toContain("(no changes)");

        // Back at the commit with the patch, the patch is applied again.
        await checkout(true);
        expect(await installInPlace()).toContain("1 package installed");
        expect(await noDepsState(dir, env)).toEqual(asPatched);
        expect(await installInPlace()).toContain("(no changes)");
      } finally {
        await chmod(join(dir, "node_modules"), 0o755);
      }
    },
  );

  // A link in the place of a package leads to a folder that is not the copy of this project: here, the patched
  // copy of another project. The install that finds the link writes nothing behind it.
  test.skipIf(isWindows || (isRoot && !setpriv))(
    "a link in the place of a package: the folder behind it keeps its marker",
    async () => {
      await using other = patchedNoDeps("patch-link-target");
      await bunOk(other.dir, other.env, "install");
      const target = join(other.dir, "node_modules", "no-deps");
      const before = (await readdir(target)).sort();
      expect(before).toContain(`.bun-tag-${newFilePatchHash}`);

      await using project = createProject("patch-link-source", {
        "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
        "package.json": noDepsManifest(false),
        "node_modules/.keep": "",
      });
      const { dir, env } = project;
      await symlink(target, join(dir, "node_modules", "no-deps"));
      await chmod(join(dir, "node_modules"), 0o555);
      try {
        const unprivileged = setpriv ? [setpriv, "--bounding-set", "-dac_override,-dac_read_search"] : [];
        await using proc = Bun.spawn({
          cmd: [...unprivileged, bunExe(), "install", "--backend=hardlink"],
          cwd: dir,
          env,
          stdout: "ignore",
          stderr: "ignore",
        });
        // The link cannot be replaced in this node_modules. Whatever the install makes of that, the folder stays.
        await proc.exited;
      } finally {
        await chmod(join(dir, "node_modules"), 0o755);
      }
      expect((await readdir(target)).sort()).toEqual(before);
      expect(await bunOk(other.dir, other.env, "install")).toContain("(no changes)");
    },
  );

  // Mounting needs a private user and mount namespace. Skipped where those are turned off, as in most containers.
  const canMount =
    isLinux &&
    Bun.which("unshare") !== null &&
    Bun.spawnSync({ cmd: ["unshare", "-Urm", "true"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

  // docker-compose can mount a volume at the folder of one package. Nothing can be renamed into a mount point or
  // out of it, so the package is linked in place. The bind mount of `vol` keeps what the install leaves in it.
  test.skipIf(!canMount)("a package whose folder is a mount point gets its name", async () => {
    await using project = createProject("patch-mount-point", {
      "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
      "package.json": noDepsManifest(true),
      patches: { "no-deps.patch": noDepsPatch },
      "node_modules/no-deps/.keep": "",
      "vol/.keep": "",
    });
    const { dir, env } = project;
    await using proc = Bun.spawn({
      cmd: [
        "unshare",
        "-Urm",
        "/bin/sh",
        "-c",
        `set -e
mount -o bind vol node_modules/no-deps
"$BUN" install
"$BUN" install`,
      ],
      cwd: dir,
      env: { ...env, BUN: bunExe() },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr.replace(installProgress, "")).toBe("");
    expect(stdout).toContain("1 package installed");
    expect(stdout).toContain("(no changes)");
    const vol = join(dir, "vol");
    const hash = new Bun.CryptoHasher("sha1").update(noDepsPatch).digest().readBigUInt64LE(0).toString(16);
    expect({
      key: (await file(vol, "package.json").json())._bunPatchHash,
      files: (await readdir(vol)).sort(),
    }).toEqual({
      key: await patchKeyOf(dir, "no-deps", hash),
      files: [`.bun-tag-${hash}`, ".keep", "index.js", "package.json", "patched.txt"],
    });
    expect(exitCode).toBe(0);
  });

  // A package that two names of a workspace reach is walked once for each name. The second walk finds the copy
  // of the first one at the final path, and links in place.
  test.each(["registry", "tarball"] as const)(
    "a %s package below a workspace with two names is named once, and loses the patch with its name",
    async kind => {
      const depTarball = await new Bun.Archive(
        {
          "package/package.json": JSON.stringify({ name: "no-deps", version: "1.0.0" }),
          "package/index.js": "module.exports = 1;\n",
        },
        { compress: "gzip" },
      ).bytes();
      const spec = kind === "registry" ? "1.0.0" : "file:../../no-deps-1.0.0.tgz";
      const manifest = (patchKey?: string) =>
        JSON.stringify({
          name: "app",
          workspaces: ["packages/*"],
          // The root's own no-deps keeps inner's no-deps from being hoisted out of inner.
          dependencies: { "no-deps": "2.0.0" },
          patchedDependencies: patchKey ? { [patchKey]: "patches/any.patch" } : undefined,
        });
      await using project = createProject("patch-two-names", {
        "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
        "package.json": manifest(),
        "no-deps-1.0.0.tgz": Buffer.from(depTarball),
        "packages/inner/package.json": JSON.stringify({
          name: "inner",
          version: "1.0.0",
          dependencies: { "no-deps": spec },
        }),
        "packages/second/package.json": JSON.stringify({
          name: "second",
          version: "1.0.0",
          dependencies: { "inner-alias": "workspace:inner@*" },
        }),
      });
      const { dir, env } = project;
      const copy = join(dir, "packages", "inner", "node_modules", "no-deps");
      const state = async () => ({
        files: (await readdir(copy)).filter(name => !name.startsWith(".bun-tag")).sort(),
        markers: (await readdir(copy)).filter(name => name.startsWith(".bun-tag-")),
        named:
          kind === "registry"
            ? (await file(copy, "package.json").json())._bunPatchHash
            : (await file(copy, ".bun-tag").text()).split("\n")[1],
      });
      await bunOk(dir, env, "install");
      const unpatchedLock = await file(dir, "bun.lock").text();
      const published = await state();
      expect(published).toMatchObject({ markers: [], named: undefined });
      // `"no-deps@<what bun.lock resolves it to>"` is the key of the patch.
      const patchKey = /^    "inner\/no-deps": \["([^"]+)"/m.exec(unpatchedLock)![1];

      await Bun.write(join(dir, "patches", "any.patch"), newFilePatch);
      await Bun.write(join(dir, "package.json"), manifest(patchKey));
      await bunOk(dir, env, "install");
      expect(await state()).toEqual({
        files: [...published.files, "patched.txt"].sort(),
        markers: [`.bun-tag-${newFilePatchHash}`],
        named: kind === "registry" ? await patchKeyOf(dir, "inner/no-deps", newFilePatchHash) : newFilePatchHash,
      });
      expect(await bunOk(dir, env, "install")).toContain("(no changes)");

      // Into a new node_modules, the second walk finds the named copy of the first one and links in place.
      const named = await state();
      await rm(join(dir, "node_modules"), { recursive: true, force: true });
      await rm(join(dir, "packages", "inner", "node_modules"), { recursive: true, force: true });
      await bunOk(dir, env, "install");
      expect(await state()).toEqual(named);
      expect(await bunOk(dir, env, "install")).toContain("(no changes)");

      await Bun.write(join(dir, "package.json"), manifest());
      await Bun.write(join(dir, "bun.lock"), unpatchedLock);
      await rm(join(dir, "patches"), { recursive: true });
      await bunOk(dir, env, "install");
      expect(await state()).toEqual(published);
      expect(await bunOk(dir, env, "install")).toContain("(no changes)");
    },
  );

  // The package.json of a folder dependency is the file of the folder itself: the hoisted linker hard links it, so
  // that an edit shows in node_modules. bun patches no folder, and writes no name into one.
  test("a folder dependency that patchedDependencies lists keeps its own package.json", async () => {
    const folderManifest = JSON.stringify({ name: "dep", version: "1.0.0" });
    await using project = createProject("patch-folder-dependency", {
      "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { dep: "file:./dep" },
        patchedDependencies: { "dep@dep": "patches/dep.patch" },
      }),
      patches: { "dep.patch": newFilePatch },
      dep: { "package.json": folderManifest, "index.js": "module.exports = 1;\n" },
    });
    const { dir, env } = project;
    const { exitCode } = await runBun(dir, env, "install");
    expect(exitCode).toBe(0);
    const [own, linked] = await Promise.all([
      stat(join(dir, "dep", "package.json"), { bigint: true }),
      stat(join(dir, "node_modules", "dep", "package.json"), { bigint: true }),
    ]);
    expect({
      text: await file(dir, "node_modules", "dep", "package.json").text(),
      isOwnFile: linked.ino === own.ino,
    }).toEqual({
      text: folderManifest,
      isOwnFile: true,
    });
  });

  /** A registry that has only `name`@1.0.0 with `files`, and a project that lists a patch for it. */
  async function oddPackage(name: string, files: Record<string, string>, patch: string) {
    const bytes = await new Bun.Archive(
      Object.fromEntries(Object.entries(files).map(([path, text]) => [`package/${path}`, text])),
      { compress: "gzip" },
    ).bytes();
    const integrity = `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`;
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.url.endsWith(".tgz")) return new Response(bytes);
        const dist = { tarball: `${server.url}${name}/-/${name}-1.0.0.tgz`, integrity };
        return Response.json({
          name,
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { name, version: "1.0.0", dist } },
        });
      },
    });
    const project = createProject("patch-odd-package", {
      "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { [name]: "1.0.0" },
        patchedDependencies: { [`${name}@1.0.0`]: "patches/odd.patch" },
      }),
      patches: { "odd.patch": patch },
    });
    return {
      dir: project.dir,
      env: { ...project.env, NPM_CONFIG_REGISTRY: server.url.href },
      copy: join(project.dir, "node_modules", name),
      async [Symbol.asyncDispose]() {
        await server.stop(true);
        await project[Symbol.asyncDispose]();
      },
    };
  }

  // There is no file to write the name into. The install is not about the name: it succeeds, as before.
  test("a package whose patch deletes package.json is installed without a name", async () => {
    const manifest = `{"name":"drops-manifest","version":"1.0.0"}\n`;
    await using app = await oddPackage(
      "drops-manifest",
      { "package.json": manifest, "index.js": "module.exports = 1;\n" },
      `diff --git a/package.json b/package.json
deleted file mode 100644
--- a/package.json
+++ /dev/null
@@ -1 +0,0 @@
-${manifest}`,
    );
    const { dir, env, copy } = app;
    for (let run = 0; run < 2; run++) {
      await bunOk(dir, env, "install");
      expect((await readdir(copy)).sort()).toEqual([expect.stringMatching(/^\.bun-tag-[0-9a-f]{1,16}$/), "index.js"]);
    }
  });

  // The name is found by a scan of the file, which stops at what is no JSON.
  test("a package whose package.json has a bracket that does not match is installed", async () => {
    await using app = await oddPackage(
      "odd-bracket",
      { "package.json": `{"files":[1},"name":"odd-bracket","version":"1.0.0"}`, "index.js": "module.exports = 1;\n" },
      newFilePatch,
    );
    const { dir, env, copy } = app;
    for (let run = 0; run < 2; run++) {
      await bunOk(dir, env, "install");
      expect(await file(copy, "patched.txt").text()).toBe("hello world\n");
    }
  });

  // Someone can publish a package from a patched copy. It has the marker of that patch as a file of its own, and
  // so has the patched folder of the cache. A copy that an earlier version of bun linked keeps its place.
  test("a package that is published with a marker is named like any other", async () => {
    const manifest = JSON.stringify({ name: "ships-marker", version: "1.0.0" });
    await using app = await oddPackage(
      "ships-marker",
      { "package.json": manifest, "index.js": "module.exports = 1;\n", ".bun-tag-1234abcd": "" },
      newFilePatch,
    );
    const { dir, env, copy } = app;
    await bunOk(dir, env, "install");
    const named = await file(copy, "package.json").text();
    expect(named).toBe(
      manifest.replace("{", `{"_bunPatchHash":"${await patchKeyOf(dir, "ships-marker", newFilePatchHash)}",`),
    );
    expect((await readdir(copy)).sort()).toEqual([
      ".bun-tag-1234abcd",
      `.bun-tag-${newFilePatchHash}`,
      "index.js",
      "package.json",
      "patched.txt",
    ]);

    // What an earlier version of bun left: no name.
    await rm(join(copy, "package.json"));
    await Bun.write(join(copy, "package.json"), manifest);
    await Bun.write(join(copy, "only-in-this-copy.txt"), "");
    expect(await bunOk(dir, env, "install")).toContain("(no changes)");
    expect(await file(copy, "package.json").text()).toBe(named);
    expect(await file(copy, "only-in-this-copy.txt").exists()).toBe(true);
  });

  // On Windows the install of such a package fails before it links: `exists_at` is false for a folder, so the cache entry counts as missing.
  test.skipIf(isWindows)("a package whose package.json is a folder is installed without a name", async () => {
    await using app = await oddPackage(
      "manifest-folder",
      { "package.json/inside.txt": "", "index.js": "module.exports = 1;\n" },
      newFilePatch,
    );
    const { dir, env, copy } = app;
    for (let run = 0; run < 2; run++) {
      await bunOk(dir, env, "install");
      expect((await readdir(copy)).sort()).toEqual([
        expect.stringMatching(/^\.bun-tag-[0-9a-f]{1,16}$/),
        "index.js",
        "package.json",
        "patched.txt",
      ]);
      expect(await readdir(join(copy, "package.json"))).toEqual(["inside.txt"]);
    }
  });

  /** A project whose no-deps@1.0.0 is patched, for the hoisted linker. Not installed yet. */
  const patchedNoDeps = (prefix: string) =>
    createProject(prefix, {
      "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
      patches: { "no-deps.patch": newFilePatch },
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { "no-deps": "1.0.0" },
        patchedDependencies: { "no-deps@1.0.0": "patches/no-deps.patch" },
      }),
    });

  // The name of the patch is one more thing that a copy needs. The marker is still the other one: a copy without it
  // is installed again, as before.
  test("a copy that names its patch and lost its marker is installed again", async () => {
    await using project = patchedNoDeps("patch-own-file-no-marker");
    const { dir, env } = project;
    const copy = join(dir, "node_modules", "no-deps");
    await bunOk(dir, env, "install");
    const files = (await readdir(copy)).sort();
    const markers = files.filter(name => name.startsWith(".bun-tag-"));
    expect(markers).toEqual([expect.stringMatching(/^\.bun-tag-[0-9a-f]{1,16}$/)]);
    const named = await file(copy, "package.json").text();
    const patchKey = await patchKeyOf(dir, "no-deps", markers[0].slice(".bun-tag-".length));
    expect(named).toStartWith(`{"_bunPatchHash":"${patchKey}",`);

    await unlink(join(copy, markers[0]));
    await Bun.write(join(copy, "only-in-this-copy.txt"), "");
    expect(await bunOk(dir, env, "install")).toContain("1 package installed");
    expect((await readdir(copy)).sort()).toEqual(files);
    expect(await file(copy, "package.json").text()).toBe(named);
    expect(await bunOk(dir, env, "install")).toContain("(no changes)");
  });

  // The name says which patch the files are of. The marker of another patch says nothing: a link that could not
  // move the old copy away leaves it, and so does a patch file that adds it.
  test("a copy that names another patch is installed again, whatever markers it has", async () => {
    await using project = patchedNoDeps("patch-own-file-other-name");
    const { dir, env } = project;
    const copy = join(dir, "node_modules", "no-deps");
    await bunOk(dir, env, "install");
    const files = (await readdir(copy)).sort();
    const named = await file(copy, "package.json").text();

    // The copy of another patch, with the marker of the wanted one beside its own. The files are new ones: the
    // installed ones can be the files of the cache.
    await rm(join(copy, "package.json"));
    await Bun.write(join(copy, "package.json"), named.replace(/"_bunPatchHash":"[0-9a-f]+\./, `"_bunPatchHash":"abc.`));
    await Bun.write(join(copy, ".bun-tag-abc"), "");
    await rm(join(copy, "patched.txt"));
    await Bun.write(join(copy, "patched.txt"), "of the other patch\n");
    expect(await bunOk(dir, env, "install")).toContain("1 package installed");
    expect((await readdir(copy)).sort()).toEqual(files);
    expect(await file(copy, "package.json").text()).toBe(named);
    expect(await file(copy, "patched.txt").text()).toBe("hello world\n");
    expect(await bunOk(dir, env, "install")).toContain("(no changes)");
  });

  // The digits behind the `.` say which tarball the copy is of. With other digits there, bun.lock pins another
  // tarball now, and the copy is linked again.
  test("a copy that names its patch for another integrity is installed again", async () => {
    await using project = patchedNoDeps("patch-own-file-other-integrity");
    const { dir, env } = project;
    const copy = join(dir, "node_modules", "no-deps");
    await bunOk(dir, env, "install");
    const files = (await readdir(copy)).sort();
    const named = await file(copy, "package.json").text();

    await rm(join(copy, "package.json"));
    await Bun.write(join(copy, "package.json"), named.replace(/("_bunPatchHash":"[0-9a-f]+\.)[0-9a-f]+/, "$11234"));
    await Bun.write(join(copy, "only-in-this-copy.txt"), "");
    expect(await bunOk(dir, env, "install")).toContain("1 package installed");
    expect((await readdir(copy)).sort()).toEqual(files);
    expect(await file(copy, "package.json").text()).toBe(named);
    expect(await bunOk(dir, env, "install")).toContain("(no changes)");
  });

  // With the symlink backend the file that names the patch is the only file of the copy itself. Every other one, the
  // marker too, is a link into the cache folder, so a copy whose cache folder is gone has the name of its patch and
  // nothing else.
  test.skipIf(isWindows)("symlink backend: a copy whose cache folder is gone is installed again", async () => {
    await using project = patchedNoDeps("patch-own-file-cache-gone");
    const { dir, env } = project;
    const copy = join(dir, "node_modules", "no-deps");
    const install = () => bunOk(dir, env, "install", "--backend=symlink");
    await install();
    const named = await file(copy, "package.json").text();
    expect(named).toStartWith(`{"_bunPatchHash":"`);
    expect((await lstat(join(copy, "package.json"))).isSymbolicLink()).toBe(false);
    expect((await lstat(join(copy, "patched.txt"))).isSymbolicLink()).toBe(true);
    expect(await install()).toContain("(no changes)");

    await rm(join(dir, ".bun-cache"), { recursive: true });
    expect(await file(copy, "patched.txt").exists()).toBe(false);
    expect(await file(copy, "package.json").text()).toBe(named);
    expect(await install()).toContain("1 package installed");
    expect(await file(copy, "patched.txt").text()).toBe("hello world\n");
    expect(await file(copy, "package.json").text()).toBe(named);
    expect(await install()).toContain("(no changes)");
  });
});

// `patchedDependencies` is only read from the root package.json. The entries a
// dependency's own package.json declared (a `file:` folder, a tarball, a
// workspace member) used to be merged into the consumer's lockfile without a
// patch hash. If the patched package was already resolved, the installer
// panicked with `called Option::unwrap() on a None value`. Otherwise the
// install failed with "Couldn't find patch file" because the dependency's patch
// path was resolved against the consumer's root (#13531).
describe("patchedDependencies declared by a dependency", () => {
  // Adds a file, so it applies to any version of the package.
  const noDepsPatch = `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;

  // A package that patches its own `no-deps` dependency. Pretty-printed so that the `patchedDependencies` key is on
  // line 7. `rest` comes after it and does not move it.
  const patchingDepPackageJson = (rest: Record<string, unknown> = {}) =>
    JSON.stringify(
      {
        name: "patching-dep",
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0" },
        patchedDependencies: { "no-deps@1.0.0": "patches/no-deps@1.0.0.patch" },
        ...rest,
      },
      null,
      2,
    );
  const patchingDep = {
    "package.json": patchingDepPackageJson(),
    patches: { "no-deps@1.0.0.patch": noDepsPatch },
  };

  // Returns where each "patchedDependencies is ignored" warning points, relative to the workspace root.
  const ignoredWarnings = (err: string) =>
    [
      ...err.matchAll(
        /^warn: ignoring "patchedDependencies" in workspace package, move it to the root package\.json\r?\n\s+at .*?[\\/](packages[\\/][^\r\n]*)/gm,
      ),
    ].map(match => match[1].replaceAll("\\", "/"));

  // A consumer that installs the same `no-deps` that `patching-dep` patches.
  const consumerPackageJson = (dependencies: Record<string, string>, rest: Record<string, unknown> = {}) =>
    JSON.stringify({ name: "consumer", dependencies: { "no-deps": "1.0.0", ...dependencies }, ...rest });

  const gitEnv = { ...bunEnv, ...gitVars };

  // CI exports BUN_INSTALL_CACHE_DIR, which overrides the per-directory cache
  // in bunfig.toml. The tests below run concurrently, and two cold installs of
  // the same package into one cache replace each other's cache directory.
  type InstallOptions = Parameters<typeof runBunInstall>[2];

  const install = (packageDir: string, env = bunEnv, options?: InstallOptions) =>
    runBunInstall({ ...env, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") }, packageDir, options);

  const lockfile = (packageDir: string) => Bun.file(join(packageDir, "bun.lock")).text();

  const lockfileHasPatches = async (packageDir: string) => (await lockfile(packageDir)).includes("patchedDependencies");

  const noDepsFile = (packageDir: string, name: string) => Bun.file(join(packageDir, "node_modules", "no-deps", name));

  // Returns stderr.
  async function installUnpatched(packageDir: string, env = bunEnv, options?: InstallOptions) {
    const { err } = await install(packageDir, env, options);
    expect({
      noDeps: await noDepsFile(packageDir, "package.json").json(),
      patched: await noDepsFile(packageDir, "patched.txt").exists(),
      lockfileHasPatches: await lockfileHasPatches(packageDir),
    }).toEqual({
      noDeps: { name: "no-deps", version: "1.0.0" },
      patched: false,
      lockfileHasPatches: false,
    });
    return err;
  }

  test.concurrent("apply when the declaring package is the install root", async () => {
    const { packageDir } = await registry.createTestDir({ files: patchingDep });
    await install(packageDir);
    expect({
      patched: await noDepsFile(packageDir, "patched.txt").text(),
      lockfileHasPatches: await lockfileHasPatches(packageDir),
    }).toEqual({ patched: "hello world\n", lockfileHasPatches: true });
  });

  describe.each(["hoisted", "isolated"] as const)("are ignored by the consumer (%s linker)", linker => {
    // A consumer with `no-deps` installed, plus `dep/` that is not a dependency yet.
    async function installedConsumer() {
      const dir = await registry.createTestDir({
        bunfigOpts: { linker },
        files: { "package.json": consumerPackageJson({}), dep: patchingDep },
      });
      await install(dir.packageDir);
      return dir;
    }

    test.concurrent("file: dependency added to an existing install", async () => {
      const { packageDir, packageJson } = await installedConsumer();

      await Bun.write(packageJson, consumerPackageJson({ "patching-dep": "file:./dep" }));
      await installUnpatched(packageDir);
    });

    // A tarball or a git checkout is extracted after `no-deps` was taken from
    // the lockfile, so the entry it used to add reached the installer without a
    // patch hash. These are the installs that panicked.
    test.concurrent("tarball dependency added to an existing install", async () => {
      const { packageDir, packageJson } = await installedConsumer();

      await using pack = Bun.spawn({
        cmd: [bunExe(), "pm", "pack", "--quiet"],
        cwd: join(packageDir, "dep"),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([pack.stdout.text(), pack.stderr.text(), pack.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "patching-dep-1.0.0.tgz\n", stderr: "", exitCode: 0 });

      await Bun.write(packageJson, consumerPackageJson({ "patching-dep": "./dep/patching-dep-1.0.0.tgz" }));
      await installUnpatched(packageDir);
    });

    test.concurrent("git dependency added to an existing install", async () => {
      const { packageDir, packageJson } = await installedConsumer();

      const repo = join(packageDir, "dep");
      await $`git init -q && git add -A && git commit -q -m init --no-gpg-sign`.cwd(repo).env(gitEnv).quiet();

      await Bun.write(packageJson, consumerPackageJson({ "patching-dep": `git+${pathToFileURL(repo)}` }));
      await installUnpatched(packageDir, gitEnv);
    });

    // https://github.com/oven-sh/bun/issues/13531
    test.concurrent("file: dependency on a fresh install", async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker },
        files: { "package.json": consumerPackageJson({ "patching-dep": "file:./dep" }), dep: patchingDep },
      });
      await installUnpatched(packageDir);
    });

    // The one manifest of the project itself that is not the root. The cases above get no warning
    // (`runBunInstall` fails on any).
    test.concurrent("workspace member is warned about once per install", async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker },
        files: {
          "package.json": consumerPackageJson({}, { workspaces: ["packages/*"] }),
          packages: { dep: patchingDep },
        },
      });
      const warned = ["packages/dep/package.json:7:3"];

      // Fresh install: the member is parsed when the workspace dependency resolves.
      expect(ignoredWarnings(await installUnpatched(packageDir, bunEnv, { allowWarnings: true }))).toEqual(warned);

      // Nothing changed, but the lockfile differ parses the workspace again.
      expect(
        ignoredWarnings(await installUnpatched(packageDir, bunEnv, { allowWarnings: true, savesLockfile: false })),
      ).toEqual(warned);

      // The member's dependencies changed: the differ parses it, and it is parsed once more when it is re-resolved.
      await Bun.write(
        join(packageDir, "packages", "dep", "package.json"),
        patchingDepPackageJson({ devDependencies: { "a-dep": "1.0.1" } }),
      );
      expect(ignoredWarnings(await installUnpatched(packageDir, bunEnv, { allowWarnings: true }))).toEqual(warned);
      expect(await lockfile(packageDir)).toContain("a-dep");
    });
  });
});

describe("patchedDependencies path longer than the path buffer", () => {
  // Hashing a patch joins its path onto the project directory in a path buffer
  // (4096 bytes on Linux, 1024 on macOS, ~96 KiB on Windows). The join used to
  // write past the buffer for a path that did not fit, aborting the install.
  const longName = Buffer.alloc(100_000, "p").toString();

  test("install reports the path instead of crashing", async () => {
    using dir = tempDir("patch-path-too-long", {
      "package.json": JSON.stringify({
        name: "patch-path-too-long",
        patchedDependencies: { "is-odd@3.0.1": `patches/${longName}.patch` },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The path is handed to the OS as is. POSIX rejects anything longer than
    // PATH_MAX with ENAMETOOLONG; Windows may report it as missing instead.
    if (!isWindows) {
      expect(stderr).toContain("error: failed to read patch file: ENAMETOOLONG: ");
    }
    expect(stderr).toContain(`${longName}.patch`);
    expect(exitCode).toBe(1);
  });
});
