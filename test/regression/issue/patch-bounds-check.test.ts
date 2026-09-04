import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot as normalizeBunSnapshot_, tempDir, VerdaccioRegistry } from "harness";
import { join } from "path";

const normalizeBunSnapshot = (str: string) => {
  str = normalizeBunSnapshot_(str);
  str = str.replace(/.*Resolved, downloaded and extracted.*\n?/g, "");
  str = str.replaceAll("fstatat()", "stat()");
  return str;
};

let registry: VerdaccioRegistry;

beforeAll(async () => {
  registry = new VerdaccioRegistry();
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

// The local registry's basic-1@1.0.0 ships a one-line index.js:
//   console.log("basic-1 1.0.0");
// so any hunk below that claims more of the file than that is out of bounds.
function project(name: string, patch: string) {
  return tempDir(name, {
    "bunfig.toml": `[install]\ncache = false\nregistry = "${registry.registryUrl()}"\n`,
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "basic-1": "1.0.0",
      },
      patchedDependencies: {
        "basic-1@1.0.0": "patches/basic-1+1.0.0.patch",
      },
    }),
    "patches/basic-1+1.0.0.patch": patch,
  });
}

async function install(dir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout), stderr: normalizeBunSnapshot(stderr), exitCode };
}

test.concurrent("patch application should handle out-of-bounds line numbers gracefully", async () => {
  using dir = project(
    "patch-bounds-test",
    `--- a/index.js
+++ b/index.js
@@ -1000,3 +1000,4 @@
 console.log("basic-1 1.0.0");
 
 // This line doesn't exist but the patch says it does
+// Add this line way beyond the actual file bounds`,
  );

  const { stdout, stderr, exitCode } = await install(String(dir));

  // Should fail gracefully with proper error message, not crash
  expect(stderr).toMatchInlineSnapshot(`
    "Resolving dependencies
    error: failed applying patch file: EINVAL: Invalid argument (stat())
    error: failed to apply patchfile (patches/basic-1+1.0.0.patch)"
  `);
  expect(stdout).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
  expect(exitCode).toBe(1);
});

test.concurrent("patch application should handle deletion beyond file bounds", async () => {
  using dir = project(
    "patch-deletion-bounds-test",
    `--- a/index.js
+++ b/index.js
@@ -1,5 +1,3 @@
 console.log("basic-1 1.0.0");
-line 2
-line 3
-line 4
-line 5`,
  );

  const { stdout, stderr, exitCode } = await install(String(dir));

  // Should fail gracefully, not crash
  expect(stderr).toMatchInlineSnapshot(`
    "Resolving dependencies
    error: failed to parse patchfile: hunk_header_integrity_check_failed
    error: failed to apply patchfile (patches/basic-1+1.0.0.patch)"
  `);
  expect(stdout).toMatchInlineSnapshot(`"bun install <version> (<revision>)"`);
  expect(exitCode).toBe(1);
});

test.concurrent("patch application should work correctly with valid patches", async () => {
  using dir = project(
    "patch-valid-test",
    `--- a/index.js
+++ b/index.js
@@ -1 +1,2 @@
+// Valid patch comment
 console.log("basic-1 1.0.0");`,
  );

  const { stdout, stderr, exitCode } = await install(String(dir));

  expect(stderr).toMatchInlineSnapshot(`
    "Resolving dependencies
    Saved lockfile"
  `);
  expect(stdout).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    + basic-1@1.0.0

    1 package installed"
  `);
  expect(exitCode).toBe(0);

  // Verify the patch was applied
  const patchedFile = await Bun.file(join(String(dir), "node_modules", "basic-1", "index.js")).text();
  expect(patchedFile).toMatchInlineSnapshot(`
    "// Valid patch comment
    console.log("basic-1 1.0.0");
    "
  `);
});
