import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "fs/promises";
import {
  bunEnv,
  bunExe,
  DirectoryTree,
  normalizeBunSnapshot as normalizeBunSnapshot_,
  runBunInstall,
  tempDir,
  VerdaccioRegistry,
} from "harness";
import { join } from "path";
import { pathToFileURL } from "url";

const normalizeBunSnapshot = (str: string) => {
  str = normalizeBunSnapshot_(str);
  str = str.replace(/.*Resolved, downloaded and extracted.*\n?/g, "");
  str = str.replaceAll("fstatat()", "stat()");
  return str.trim();
};

// Each test spawns two to seven debug builds of bun, and up to 20 tests run at once.
setDefaultTimeout(60 * 1000);

// Every install in this file resolves against this registry, so no test reaches the public npm
// registry. `is-even`, `is-odd` and `@zackradisic/hls-dl` are stand-ins for the npm packages of the
// same name and version: is-even@1.0.0 depends on is-odd@^0.1.2, and is-odd has a 3.0.1 too.
const registry = new VerdaccioRegistry();

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
        error: failed applying patch file: ENOENT: No such file or directory (stat())
        error: failed to apply patchfile (patches/is-even@1.0.0.patch)"
      `);
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
      expect(exitCode).toBe(1);
    }
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

      // `bun patch --commit` writes the patch file, records it in package.json and bun.lock, and
      // reinstalls with it applied.
      await addLogStatement(join(dir, folder, "index.js"), "PATCHED with isolated linker!");
      await bunOk(dir, env, "patch", "--commit", folder);

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

      // By name, and again by name and version: both find the only is-odd in the tree.
      const folder = "node_modules/is-odd";
      expect(await bunOk(dir, env, "patch", "is-odd")).toContain(patchMessage("is-odd", folder));
      expect(await bunOk(dir, env, "patch", "is-odd@0.1.2")).toContain(patchMessage("is-odd", folder));

      await addLogStatement(join(dir, folder, "index.js"), "Transitive patch with isolated!");
      await bunOk(dir, env, "patch", "--commit", folder);
      await expectPatchedDependencies(dir, { "is-odd@0.1.2": "patches/is-odd@0.1.2.patch" });

      // The next install puts the patched package in the store, where is-even resolves it from.
      expect(normalizeBunSnapshot(await bunOk(dir, env, "install", "--linker", "isolated"))).toMatchInlineSnapshot(`
        "bun install <version> (<revision>)

        1 package installed"
      `);
      expect(
        await file(dir, "node_modules", ".bun", "is-odd@0.1.2", "node_modules", "is-odd", "index.js").text(),
      ).toContain('console.log("Transitive patch with isolated!");');
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

      // For an added file, the a/ path is the folder bun diffed rather than a path in the package.
      const [firstLine, ...rest] = (await file(dir, patchPath).text()).split("\n");
      expect(firstLine).toMatch(/^diff --git a\/.* b\/index\.js$/);
      expect(rest.join("\n")).toMatchInlineSnapshot(`
        "new file mode 100644
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

      // Patch from the workspace root.
      const folder = "node_modules/is-even";
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

  // A package that patches its own `no-deps` dependency.
  const patchingDep = {
    "package.json": JSON.stringify({
      name: "patching-dep",
      version: "1.0.0",
      dependencies: { "no-deps": "1.0.0" },
      patchedDependencies: { "no-deps@1.0.0": "patches/no-deps@1.0.0.patch" },
    }),
    patches: { "no-deps@1.0.0.patch": noDepsPatch },
  };

  // A consumer that installs the same `no-deps` that `patching-dep` patches.
  const consumerPackageJson = (dependencies: Record<string, string>, rest: Record<string, unknown> = {}) =>
    JSON.stringify({ name: "consumer", dependencies: { "no-deps": "1.0.0", ...dependencies }, ...rest });

  const gitEnv = {
    ...bunEnv,
    // Set on the asan lanes, where it makes `bun install` kill its own git clones (#33982).
    BUN_FEATURE_FLAG_NO_ORPHANS: undefined,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };

  // CI exports BUN_INSTALL_CACHE_DIR, which overrides the per-directory cache
  // in bunfig.toml. The tests below run concurrently, and two cold installs of
  // the same package into one cache replace each other's cache directory.
  const install = (packageDir: string, env = bunEnv) =>
    runBunInstall({ ...env, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") }, packageDir);

  const lockfileHasPatches = async (packageDir: string) =>
    (await Bun.file(join(packageDir, "bun.lock")).text()).includes("patchedDependencies");

  const noDepsFile = (packageDir: string, name: string) => Bun.file(join(packageDir, "node_modules", "no-deps", name));

  async function installUnpatched(packageDir: string, env = bunEnv) {
    await install(packageDir, env);
    expect({
      noDeps: await noDepsFile(packageDir, "package.json").json(),
      patched: await noDepsFile(packageDir, "patched.txt").exists(),
      lockfileHasPatches: await lockfileHasPatches(packageDir),
    }).toEqual({
      noDeps: { name: "no-deps", version: "1.0.0" },
      patched: false,
      lockfileHasPatches: false,
    });
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

    test.concurrent("workspace member", async () => {
      const { packageDir } = await registry.createTestDir({
        bunfigOpts: { linker },
        files: {
          "package.json": consumerPackageJson({}, { workspaces: ["packages/*"] }),
          packages: { dep: patchingDep },
        },
      });
      await installUnpatched(packageDir);
    });
  });
});
