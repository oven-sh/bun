import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmod, link, lstat, readdir, readlink, realpath, rename, rm, stat, symlink, unlink } from "fs/promises";
import {
  bunEnv,
  bunExe,
  DirectoryTree,
  githubTarball,
  isRoot,
  isWindows,
  normalizeBunSnapshot as normalizeBunSnapshot_,
  runBunInstall,
  tempDir,
} from "harness";
import { basename, dirname, join, sep } from "path";
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
      // The store entry of a patched package is named after the patch too: `is-odd@0.1.2+<16 hex digits>`.
      const store = await readdir(join(dir, "node_modules", ".bun"));
      const entries = store.filter(entry => entry.startsWith("is-odd@0.1.2+"));
      expect(entries).toEqual([expect.stringMatching(/^is-odd@0\.1\.2\+[0-9a-f]{16}$/)]);
      const patched = `node_modules/.bun/${entries[0]}/node_modules/is-odd`;
      expect(await file(dir, patched, "index.js").text()).toContain('console.log("Transitive patch with isolated!");');
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
  type Placed = "node_modules" | "project store" | "global store";
  type Layout = {
    linker: "hoisted" | "isolated";
    globalStore?: boolean;
    trusted?: string[];
    /** Where `node_modules/<name>` leads, with the patch and without it. */
    placed: { "no-deps": Placed; "a-dep": Placed };
  };
  const layouts: [string, Layout][] = [
    ["hoisted linker", { linker: "hoisted", placed: { "no-deps": "node_modules", "a-dep": "node_modules" } }],
    ["isolated linker", { linker: "isolated", placed: { "no-deps": "project store", "a-dep": "project store" } }],
    [
      "isolated linker, entry in the project under globalStore",
      {
        linker: "isolated",
        globalStore: true,
        // A trusted package is never linked from the global store. a-dep shows that the store is in use.
        trusted: ["no-deps"],
        placed: { "no-deps": "project store", "a-dep": "global store" },
      },
    ],
  ];
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
  const manifest = (layout: Layout, patched: boolean) =>
    JSON.stringify({
      name: "app",
      dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.1" },
      trustedDependencies: layout.trusted,
      patchedDependencies: patched ? { "no-deps@1.0.0": patchPath } : undefined,
    });

  /** A project at the commit without the patch, with nothing installed. */
  const unpatchedProject = (prefix: string, layout: Layout) =>
    createProject(prefix, {
      "package.json": manifest(layout, false),
      "bunfig.toml": `[install]\nlinker = "${layout.linker}"\n${layout.globalStore ? "globalStore = true\n" : ""}`,
    });

  /** What a checkout does to package.json and to the patch file. bun.lock is left to the caller. */
  async function checkout(dir: string, layout: Layout, patched: boolean) {
    await Bun.write(join(dir, "package.json"), manifest(layout, patched));
    if (patched) await Bun.write(join(dir, patchPath), noDepsPatch);
    else await rm(join(dir, "patches"), { recursive: true, force: true });
  }

  /** Where `node_modules/<name>` leads: the folder itself, an entry of the project's store, or the global store. */
  async function placed(dir: string, name: string): Promise<Placed> {
    const path = join(dir, "node_modules", name);
    if (!(await lstat(path)).isSymbolicLink()) return "node_modules";
    const nodeModules = await realpath(join(dir, "node_modules"));
    return (await realpath(path)).startsWith(nodeModules + sep) ? "project store" : "global store";
  }

  /**
   * What the project has of no-deps: the files of the copy that `require("no-deps")` loads, what
   * that copy exports when the project runs it, and where the packages are.
   */
  async function installed(dir: string, env: Env) {
    return {
      files: (await readdir(join(dir, "node_modules", "no-deps"))).sort(),
      exports: JSON.parse(await bunOk(dir, env, "-e", `console.log(JSON.stringify(require("no-deps")))`)),
      placed: { "no-deps": await placed(dir, "no-deps"), "a-dep": await placed(dir, "a-dep") },
    };
  }
  const asPublished = (layout: Layout) => ({
    files: ["index.js", "package.json"],
    exports: { name: "no-deps", version: "1.0.0" },
    placed: layout.placed,
  });
  // A patched copy also has the marker of its patch, `.bun-tag-<hash of the patch file>`.
  const asPatched = (layout: Layout) => ({
    files: [expect.stringMatching(/^\.bun-tag-[0-9a-f]{1,16}$/), "index.js", "package.json", "patched.txt"],
    exports: expect.objectContaining({ name: "no-deps", version: "1.0.0", patched: true }),
    placed: layout.placed,
  });

  /** Runs `command` once more: the install has nothing left to do. */
  async function expectNoChanges(dir: string, env: Env, command: string) {
    const { stdout, stderr, exitCode } = await runBun(dir, env, ...command.split(" "));
    expect(stdout).toContain("(no changes)");
    expect(stderr.replace(installProgress, "")).toBe("");
    expect(exitCode).toBe(0);
  }

  describe.each(layouts)("%s", (_name, layout) => {
    test.each(commands)("bun %s installs the package as published after a checkout of both files", async command => {
      await using project = unpatchedProject("patch-lost-checkout", layout);
      const { dir, env } = project;
      // bun.lock of the commit without the patch. The first install is at the commit with the patch.
      await bunOk(dir, env, "install", "--lockfile-only");
      const unpatchedLock = await file(dir, "bun.lock").text();

      await checkout(dir, layout, true);
      await bunOk(dir, env, "install");
      await expectPatchedDependencies(dir, { "no-deps@1.0.0": patchPath });
      expect(await installed(dir, env)).toEqual(asPatched(layout));

      // package.json and bun.lock lose the patch in one step.
      await checkout(dir, layout, false);
      await Bun.write(join(dir, "bun.lock"), unpatchedLock);
      await bunOk(dir, env, ...command.split(" "));
      expect(await installed(dir, env)).toEqual(asPublished(layout));
      expect(await file(dir, "bun.lock").text()).toBe(unpatchedLock);
      await expectNoChanges(dir, env, command);
    });

    test.each(commands)(
      "bun %s installs the package as published after a frozen install applied a patch that bun.lock never got",
      async command => {
        await using project = unpatchedProject("patch-lost-frozen", layout);
        const { dir, env } = project;
        await bunOk(dir, env, "install");
        const unpatchedLock = await file(dir, "bun.lock").text();
        expect(await installed(dir, env)).toEqual(asPublished(layout));

        // package.json gets the patch, and the frozen form of the command applies it without writing bun.lock.
        await checkout(dir, layout, true);
        await bunOk(dir, env, ...(command === "ci" ? ["ci"] : ["install", "--frozen-lockfile"]));
        expect(await installed(dir, env)).toEqual(asPatched(layout));
        expect(await file(dir, "bun.lock").text()).toBe(unpatchedLock);

        // package.json loses the patch again.
        await checkout(dir, layout, false);
        await bunOk(dir, env, ...command.split(" "));
        expect(await installed(dir, env)).toEqual(asPublished(layout));
        expect(await file(dir, "bun.lock").text()).toBe(unpatchedLock);
        await expectNoChanges(dir, env, command);
      },
    );
  });

  // Someone can publish a package from a patched copy. Its own package.json then starts with the key that names the
  // patch of a hoisted copy, and so does the one in the unpatched folder of the cache. That is how bun tells the
  // package from a copy that holds a patch.
  test("a package that is published with the patch hash key is installed once, its patched copy again", async () => {
    const published = `{"_bunPatchHash":"0123456789abcdef","name":"ships-key","version":"1.0.0"}`;
    const tarball = await new Bun.Archive(
      { "package/package.json": published, "package/index.js": "module.exports = 1;\n" },
      { compress: "gzip" },
    ).bytes();
    let tarballRequests = 0;
    // A registry that has only ships-key@1.0.0.
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.url.endsWith(".tgz")) {
          tarballRequests++;
          return new Response(tarball);
        }
        const dist = { tarball: `${server.url}ships-key/-/ships-key-1.0.0.tgz` };
        return Response.json({
          name: "ships-key",
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { name: "ships-key", version: "1.0.0", dist } },
        });
      },
    });
    await using project = createProject("patch-published-with-key", {
      "package.json": JSON.stringify({ name: "app", dependencies: { "ships-key": "1.0.0" } }),
      "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
    });
    const { dir } = project;
    const env = { ...project.env, NPM_CONFIG_REGISTRY: server.url.href };
    const folder = join(dir, "node_modules", "ships-key");
    const cache = join(dir, ".bun-cache");
    /** The copy in node_modules, package.json in each folder the cache has of the package, and the tarball requests. */
    const state = async () => ({
      packageJson: await file(folder, "package.json").text(),
      files: (await readdir(folder)).sort(),
      cached: await Promise.all(
        (await readdir(cache))
          .filter(name => name.startsWith("ships-key@1.0.0@@"))
          .map(name => file(cache, name, "package.json").text()),
      ),
      tarballRequests,
    });
    const asShipped = {
      packageJson: published,
      files: ["index.js", "package.json"],
      cached: [published],
      tarballRequests: 1,
    };

    await bunOk(dir, env, "install");
    expect(await state()).toEqual(asShipped);

    // No patch is wanted and the copy has the key. The cache has the package with the same key, so the copy is the
    // package, and bun does not ask the registry for it again.
    await expectNoChanges(dir, env, "install");
    expect(await state()).toEqual(asShipped);

    // A patched copy has the hash of its patch in front of the key of the package. The file is a new one: the
    // installed file can be a hard link to the file of the cache, which keeps the key of the package.
    const patchedPackageJson = `{"_bunPatchHash":"fedcba9876543210",${published.slice(1)}`;
    await rm(join(folder, "package.json"));
    await Bun.write(join(folder, "package.json"), patchedPackageJson);
    await Bun.write(join(folder, "patched.txt"), "hello world\n");
    expect(await state()).toEqual({
      ...asShipped,
      packageJson: patchedPackageJson,
      files: ["index.js", "package.json", "patched.txt"],
    });

    // No folder of the cache has the package with that key, so the copy is installed again.
    expect(normalizeBunSnapshot(await bunOk(dir, env, "install"))).toMatchInlineSnapshot(`
      "bun install <version> (<revision>)

      + ships-key@1.0.0

      1 package installed"
    `);
    expect(await state()).toEqual(asShipped);
    await expectNoChanges(dir, env, "install");
  });
});

// The checkout that takes the patch out of package.json and bun.lock, for a git, github or tarball package.
// The hoisted linker takes such a package for installed by its `.bun-tag`, not by its package.json: line 1 is
// the commit or the integrity that bun.lock has, and a patched copy names its patch on line 2. The isolated
// linker names the patch in the store entry, as it does for a package of the registry.
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
  async function project(kind: Kind, linker: "hoisted" | "isolated") {
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

  /** What `require("dep")` loads, and what says which package that is. `entry` is the store entry behind a link. */
  async function installed(dir: string) {
    const folder = join(dir, "node_modules", "dep");
    return {
      index: await file(folder, "index.js").text(),
      markers: (await readdir(folder)).filter(name => name.startsWith(".bun-tag-")),
      bunTag: await file(folder, ".bun-tag").text(),
      entry: (await lstat(folder)).isSymbolicLink() ? basename(dirname(dirname(await readlink(folder)))) : null,
    };
  }

  describe.each(["hoisted", "isolated"] as const)("%s linker", linker => {
    describe.each(Object.keys(specs) as Kind[])("%s", kind => {
      test("the installed copy names the patch, and is not installed again", async () => {
        await using app = await project(kind, linker);
        const { dir, env, pinned } = app;
        const unpatched = await installed(dir);
        expect(unpatched).toEqual({
          index: original,
          markers: [],
          bunTag: pinned,
          entry: linker === "hoisted" ? null : expect.any(String),
        });

        await app.addPatch();
        await bunOk(dir, env, "install");
        const named = await installed(dir);
        if (linker === "hoisted") {
          // Line 1 is what it was: the copy is still the package that bun.lock has.
          expect(named).toEqual({ index: patched, markers: [marker], bunTag: `${pinned}\n${patchHash}`, entry: null });
        } else {
          // The entry of a patched package is `dep@<resolution>+<16 hex digits>`. That of an unpatched tarball has
          // such digits too, for its integrity, and the patch changes them.
          const entry = unpatched.entry!;
          const key = kind.endsWith("tarball") ? entry.replace(/\+[0-9a-f]{16}$/, "") : entry;
          expect(named).toEqual({
            index: patched,
            markers: [marker],
            bunTag: pinned,
            entry: expect.stringMatching(new RegExp(`^${RegExp.escape(key)}\\+[0-9a-f]{16}$`)),
          });
          expect(named.entry).not.toBe(entry);
        }

        expect(await bunOk(dir, env, "install")).toContain("(no changes)");
        expect(await installed(dir)).toEqual(named);
      });

      test.each(["install", "install --frozen-lockfile", "ci"])(
        "bun %s installs the package as bun.lock has it after a checkout of both files",
        async command => {
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
        },
      );
    });
  });

  describe("hoisted linker", () => {
    // `--no-verify` does not check a download against the integrity in bun.lock, so `.bun-tag` claims none.
    test("line 1 of .bun-tag stays empty for a remote tarball that --no-verify did not check", async () => {
      await using app = await project("remote tarball", "hoisted");
      const { dir, env } = app;
      // Without the cache, the patched package is made from a download.
      await rm(join(dir, ".bun-cache"), { recursive: true });

      await app.addPatch();
      await bunOk(dir, env, "install", "--no-verify");
      const named = { index: patched, markers: [marker], bunTag: `\n${patchHash}`, entry: null };
      expect(await installed(dir)).toEqual(named);
      expect(await bunOk(dir, env, "install", "--no-verify")).toContain("(no changes)");
      expect(await installed(dir)).toEqual(named);

      await app.checkout();
      await bunOk(dir, env, "install", "--no-verify");
      const unpatched = { index: original, markers: [], bunTag: "", entry: null };
      expect(await installed(dir)).toEqual(unpatched);
      expect(await bunOk(dir, env, "install", "--no-verify")).toContain("(no changes)");
      expect(await installed(dir)).toEqual(unpatched);
    });

    // `bun prune` compares `.bun-tag` of a git package with the commit in bun.lock, and looks into the package
    // only when they agree.
    test("bun prune takes a git copy that names its patch for the package that bun.lock has", async () => {
      await using app = await project("git", "hoisted");
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

// `bun prune`, `bun pm licenses`, `bun pm untrusted` and `bun pm trust` read the isolated store without an install. An
// install names the entry of a patched package `<name>@<version>+<hash>`, and the hash depends on the patch file.
describe.concurrent("a patched package in the isolated store", () => {
  // Adds a file, so it applies to any package.
  const newFilePatch = `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;
  const isolated = `[install]\nlinker = "isolated"\n`;

  const manifest = (dependencies: Record<string, string>, patched?: string) =>
    JSON.stringify({
      name: "app",
      dependencies,
      patchedDependencies: patched && { [patched]: `patches/${patched}.patch` },
    });

  /** A project that patches `key`, before its first install. */
  const patchedProject = (
    prefix: string,
    dependencies: Record<string, string> = { "no-deps": "1.0.0" },
    key = "no-deps@1.0.0",
  ) =>
    createProject(prefix, {
      "package.json": manifest(dependencies, key),
      "bunfig.toml": isolated,
      patches: { [`${key}.patch`]: newFilePatch },
    });

  const store = (dir: string, ...path: string[]) => join(dir, "node_modules", ".bun", ...path);

  /** The entries of the store that match `pattern`. */
  const entries = (dir: string, pattern = "*@*") =>
    [...new Bun.Glob(pattern).scanSync({ cwd: store(dir), onlyFiles: false })].sort();

  /**
   * The entry of the package `key`, a `name@version`. Earlier versions of bun put a patched package in `<key>`, the
   * entry of the published one.
   */
  function patchedEntry(dir: string, key: string) {
    const named = entries(dir, `${key}+*`);
    expect({ named, others: entries(dir, `${key}*`).filter(entry => !named.includes(entry)) }).toEqual({
      named: [expect.any(String)],
      others: [],
    });
    return named[0];
  }

  async function pruneFindsNothing(dir: string, env: Env, ...args: string[]) {
    expect(await runBun(dir, env, "prune", ...args)).toEqual({
      stdout: expect.stringContaining("(nothing to prune)"),
      stderr: "",
      exitCode: 0,
    });
  }

  test("bun prune and bun prune --dry-run keep its entry", async () => {
    await using project = patchedProject("patch-prune");
    const { dir, env } = project;
    await bunOk(dir, env, "install");
    const entry = patchedEntry(dir, "no-deps@1.0.0");

    for (const args of [["--dry-run"], []]) {
      await pruneFindsNothing(dir, env, ...args);
      expect(entries(dir)).toEqual([entry]);
    }
    expect(await file(dir, "node_modules", "no-deps", "patched.txt").text()).toBe("hello world\n");
    expect(await bunOk(dir, env, "install")).toContain("(no changes)");
  });

  // An install applies the patches of package.json, and a frozen one does not write them to bun.lock, which is
  // what `bun prune` loads.
  test("bun prune keeps its entry while bun.lock does not name the patch", async () => {
    await using project = createProject("patch-prune-frozen", {
      "package.json": manifest({ "no-deps": "1.0.0" }),
      "bunfig.toml": isolated,
      patches: { "no-deps@1.0.0.patch": newFilePatch },
    });
    const { dir, env } = project;
    await bunOk(dir, env, "install", "--lockfile-only");
    const lockfile = await file(dir, "bun.lock").text();
    expect(lockfile).not.toContain("patchedDependencies");

    await Bun.write(join(dir, "package.json"), manifest({ "no-deps": "1.0.0" }, "no-deps@1.0.0"));
    await bunOk(dir, env, "install", "--frozen-lockfile");
    expect(await file(dir, "bun.lock").text()).toBe(lockfile);
    const entry = patchedEntry(dir, "no-deps@1.0.0");

    await pruneFindsNothing(dir, env);
    expect(entries(dir)).toEqual([entry]);
    expect(await file(dir, "node_modules", "no-deps", "patched.txt").text()).toBe("hello world\n");
  });

  // Without the patch file nothing says which entry the install made, and the package in it can be the only copy
  // of the changes.
  test("bun prune keeps every entry of its name and version while the patch file is missing", async () => {
    await using project = patchedProject("patch-prune-no-file");
    const { dir, env } = project;
    await bunOk(dir, env, "install");
    const entry = patchedEntry(dir, "no-deps@1.0.0");
    // What an install leaves when the patch file changes: the entry named after the contents it had.
    const other = "no-deps@1.0.0+0123456789abcdef";
    await Bun.write(
      store(dir, other, "node_modules", "no-deps", "package.json"),
      JSON.stringify({ name: "no-deps", version: "1.0.0" }),
    );
    const both = [other, entry].sort();
    expect(entries(dir)).toEqual(both);

    const patchFile = join(dir, "patches", "no-deps@1.0.0.patch");
    await rm(patchFile);
    await pruneFindsNothing(dir, env);
    expect(entries(dir)).toEqual(both);

    // With the file, the entry of the package is known again.
    await Bun.write(patchFile, newFilePatch);
    expect(await runBun(dir, env, "prune")).toEqual({
      stdout: expect.stringContaining(`- ${other}\n`),
      stderr: "",
      exitCode: 0,
    });
    expect(entries(dir)).toEqual([entry]);
  });

  // Earlier versions of bun put a patched package in the entry of the published one, where a `.bun-tag-<hash>`
  // file is all that shows the patch. An install renames that entry instead of installing the package again.
  test("bun prune keeps it in the entry of the published package, and the next install renames that entry", async () => {
    await using project = patchedProject("patch-prune-adopt");
    const { dir, env } = project;
    await bunOk(dir, env, "install");
    const entry = patchedEntry(dir, "no-deps@1.0.0");

    // Put the patched package where those versions did.
    const published = "no-deps@1.0.0";
    const link = join(dir, "node_modules", "no-deps");
    await rename(store(dir, entry), store(dir, published));
    for (const path of [link, store(dir, "node_modules", "no-deps")]) {
      const target = await readlink(path);
      await unlink(path);
      await symlink(target.replace(entry, published), path, "junction");
    }
    expect(entries(dir)).toEqual([published]);
    expect([...new Bun.Glob(".bun-tag-*").scanSync({ cwd: link, dot: true })]).toHaveLength(1);
    // An install of the package does not bring this file.
    await Bun.write(join(link, "kept.txt"), "kept");

    await pruneFindsNothing(dir, env);
    expect(entries(dir)).toEqual([published]);

    await bunOk(dir, env, "install");
    expect(entries(dir)).toEqual([entry]);
    expect({
      kept: await file(link, "kept.txt").text(),
      patched: await file(link, "patched.txt").text(),
    }).toEqual({ kept: "kept", patched: "hello world\n" });
  });

  test("bun pm licenses lists it from its entry", async () => {
    // `no-deps` is a dependency of `one-fixed-dep`: the project does not link it, so only the store leads to it.
    await using project = patchedProject("patch-licenses", { "one-fixed-dep": "1.0.0" });
    const { dir, env } = project;
    await bunOk(dir, env, "install");
    const entry = patchedEntry(dir, "no-deps@1.0.0");

    const listing: Record<string, { name: string; paths: string[] }[]> = JSON.parse(
      await bunOk(dir, env, "pm", "licenses", "--json"),
    );
    expect(
      Object.values(listing)
        .flat()
        .map(({ name, paths }) => ({ name, paths })),
    ).toEqual([
      { name: "no-deps", paths: [store(dir, entry, "node_modules", "no-deps")] },
      { name: "one-fixed-dep", paths: [store(dir, "one-fixed-dep@1.0.0", "node_modules", "one-fixed-dep")] },
    ]);
  });

  test("bun pm untrusted and bun pm trust find its lifecycle scripts", async () => {
    const key = "lifecycle-postinstall@1.0.0";
    await using project = patchedProject("patch-trust", { "lifecycle-postinstall": "1.0.0" }, key);
    const { dir, env } = project;
    await bunOk(dir, env, "install");
    const entry = patchedEntry(dir, key);
    // The script writes this file. The install did not run it: the package is not trusted.
    const written = () => file(store(dir, entry, "node_modules", "lifecycle-postinstall"), "postinstall.txt");
    expect(await written().exists()).toBe(false);

    const untrusted = await runBun(dir, env, "pm", "untrusted");
    expect({ ...untrusted, stdout: untrusted.stdout.replaceAll("\\", "/") }).toEqual({
      stdout: expect.stringContaining(
        `./node_modules/.bun/${entry}/node_modules/lifecycle-postinstall @1.0.0\n » [postinstall]: bun postinstall.js\n`,
      ),
      stderr: expect.stringContaining("bun pm untrusted"),
      exitCode: 0,
    });

    expect(await runBun(dir, env, "pm", "trust", "lifecycle-postinstall")).toEqual({
      stdout: expect.stringContaining("1 script ran across 1 package"),
      stderr: expect.stringContaining("bun pm trust"),
      exitCode: 0,
    });
    expect(await written().text()).toBe("postinstall!");
    expect((await file(dir, "package.json").json()).trustedDependencies).toEqual(["lifecycle-postinstall"]);
    await expectPatchedDependencies(dir, { [key]: `patches/${key}.patch` });
  });
});

// What a version of bun that does not name the patch in an installed copy leaves of a patched
// package: the patched files, and the empty marker `.bun-tag-<patch hash>` next to them. Its hoisted
// linker keeps package.json and `.bun-tag` as published, and its isolated linker links the patched
// package into the store entry of the published one. While the patch is wanted, an install keeps
// such a copy and names the patch in it: nothing is fetched, and the package is not installed again.
describe.concurrent("a patched package that an earlier version of bun installed", () => {
  type Linker = "hoisted" | "isolated";
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
  // The isolated linker names the store entry of a patched package after its patch too.
  const patchedEntry = /^is-odd@0\.1\.2\+[0-9a-f]{16}$/;

  type Source = {
    dependencies(dir: string, registryUrl: string): Record<string, string> | Promise<Record<string, string>>;
    /** Calls is-odd through every link that an install makes to it, and prints "done". */
    indexTs: string;
    /** What index.ts prints while is-odd is patched. */
    patched: string;
    env?: Env;
  };
  const callsIsOdd = `import isOdd from "is-odd";\nisOdd(1);\nconsole.log("done");\n`;
  // Where is-odd comes from. The hoisted linker names the patch of a registry package in its
  // package.json, and the patch of a git or tarball package in its `.bun-tag`.
  const sources = {
    // is-even depends on is-odd@^0.1.2: the isolated linker links is-odd@0.1.2 for is-even and for
    // the project, and index.ts calls it through both links.
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
  async function project(linker: Linker, source: Source, registryUrl = registry.registryUrl()) {
    const created = createProject("patch-left", {
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
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
      /** The names of the store entries of is-odd. The isolated linker has them. */
      entries: async () =>
        (await readdir(join(dir, "node_modules", ".bun"))).filter(name => name.startsWith("is-odd@")).sort(),
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
    await using p = await project("hoisted", sources.registry, counting.registryUrl());
    const left = await leftByEarlierVersion(p);
    counting.requests.length = 0;

    await bunOk(p.dir, p.env, "install");
    expect(requests(counting)).toEqual([]);
    const copy = await files(p.copy);
    expect(Object.entries(JSON.parse(copy["package.json"]))).toEqual([
      ["_bunPatchHash", hash],
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
      await using p = await project("hoisted", sources[name], counting.registryUrl());
      const left = await leftByEarlierVersion(p);
      counting.requests.length = 0;

      await bunOk(p.dir, p.env, "install");
      expect(requests(counting)).toEqual([]);
      // Line 1 is what it was: the commit, or the integrity of the tarball.
      expect(await files(p.copy)).toEqual({ ...left, ".bun-tag": `${left[".bun-tag"]}\n${hash}` });

      await keptUntilThePatchIsGone(p, counting);
    },
  );

  test("isolated linker: the store entry gets the name of the patched package", async () => {
    using counting = countingRegistry();
    await using p = await project("isolated", sources.registry, counting.registryUrl());
    const left = await leftByEarlierVersion(p);
    expect(await p.entries()).toEqual(["is-odd@0.1.2"]);
    counting.requests.length = 0;

    await bunOk(p.dir, p.env, "install");
    expect(requests(counting)).toEqual([]);
    // The entry was renamed: none has the name of the published package, and the files are the
    // ones that were there.
    expect(await p.entries()).toEqual([expect.stringMatching(patchedEntry)]);
    expect(await files(p.copy)).toEqual(left);

    await keptUntilThePatchIsGone(p, counting);
  });

  // The patch file changed after an earlier version installed with it. The entry under the name of
  // the published package holds the package with that other patch, and its marker.
  test("isolated linker: a store entry with the marker of another patch is deleted", async () => {
    await using p = await project("isolated", sources.registry);
    await patchAsEarlierVersion(p.copy, "patched by another patch");
    await p.addPatch();
    await bunOk(p.dir, p.env, "install", "--lockfile-only");

    await bunOk(p.dir, p.env, "install");
    expect(await p.entries()).toEqual([expect.stringMatching(patchedEntry)]);
    expect(await file(p.copy, "index.js").text()).toBe(patchedIndex(logged));
    expect(await bunOk(p.dir, p.env, "run", "index.ts")).toBe(p.source.patched);
    expect(await bunOk(p.dir, p.env, "install")).toContain("(no changes)");
  });

  // An entry without a marker holds the published package, which an install without the patch links.
  test("isolated linker: a store entry without a marker stays", async () => {
    await using p = await project("isolated", sources.registry);
    const unpatched = join(p.dir, "node_modules", ".bun", "is-odd@0.1.2", "node_modules", "is-odd");

    await p.addPatch();
    await bunOk(p.dir, p.env, "install");
    expect(await p.entries()).toEqual(["is-odd@0.1.2", expect.stringMatching(patchedEntry)]);
    expect(await files(unpatched)).toEqual(p.published);
    expect(await bunOk(p.dir, p.env, "run", "index.ts")).toBe(p.source.patched);

    expect(await bunOk(p.dir, p.env, "install")).toContain("(no changes)");
    expect(await p.entries()).toEqual(["is-odd@0.1.2", expect.stringMatching(patchedEntry)]);
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

  async function namesPatchInOwnFile(kind: string, backend: "hardlink" | "symlink", trusted = false) {
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
    /** A copy that names the patch in a file of its own. Every other file is the one in the cache folder. */
    const named = () => ({
      files: Object.keys(cached),
      text:
        source.file === "package.json"
          ? cached[source.file].text.replace("{", `{"_bunPatchHash":"${hash}",`)
          : `${cached[source.file].text}\n${hash}`,
      mode: cached[source.file].mode,
      isSymlink: false,
      isFileOfCache: false,
      othersAreFilesOfCache: true,
    });
    expect(await installed()).toEqual(named());

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
    // No file of the cache folder was written or replaced.
    expect(await filesOf(folder)).toEqual(cached);

    // What an earlier version of bun left: the file of the copy is the one in the cache folder, and only the
    // marker shows the patch. An install names the patch in such a copy too, in a new file again.
    await rm(join(copy, source.file));
    await (backend === "symlink" ? symlink : link)(join(folder, source.file), join(copy, source.file));
    await install();
    expect(await installed()).toEqual(named());
    expect(await filesOf(folder)).toEqual(cached);
  }

  // bun has no symlink backend on Windows.
  const backends: ("hardlink" | "symlink")[] = isWindows ? ["hardlink"] : ["hardlink", "symlink"];
  describe.each(backends)("%s backend", backend => {
    test.each(Object.keys(sources))("%s package", kind => namesPatchInOwnFile(kind, backend));
  });

  // The main thread links a trusted package itself. The threads of the pool get the patch hash another way.
  test("hardlink backend, trusted npm package", () => namesPatchInOwnFile("npm", "hardlink", true));

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

  // The marker does not say that a copy is patched, the file that names the patch does: `bun patch --commit` moves
  // the marker out of the copy while git runs, and a commit that is killed there does not put it back.
  test("a copy that names its patch and has no marker is not installed again", async () => {
    await using project = patchedNoDeps("patch-own-file-no-marker");
    const { dir, env } = project;
    const copy = join(dir, "node_modules", "no-deps");
    await bunOk(dir, env, "install");
    const markers = (await readdir(copy)).filter(name => name.startsWith(".bun-tag-"));
    expect(markers).toEqual([expect.stringMatching(/^\.bun-tag-[0-9a-f]{1,16}$/)]);
    const named = await file(copy, "package.json").text();
    expect(named).toStartWith(`{"_bunPatchHash":"${markers[0].slice(".bun-tag-".length)}",`);

    await unlink(join(copy, markers[0]));
    const files = (await readdir(copy)).sort();
    expect(await bunOk(dir, env, "install")).toContain("(no changes)");
    expect((await readdir(copy)).sort()).toEqual(files);
    expect(await file(copy, "patched.txt").text()).toBe("hello world\n");
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
