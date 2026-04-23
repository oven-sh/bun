import { patchInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "node:path";

const { makeDiff, apply } = patchInternals;

// Regression test for https://github.com/oven-sh/bun/issues/21338
// bun patch --commit crashes with segfault in gitDiffPostprocess when
// processing diffs with many files in deeply nested directories.
// The bug was that gitDiffPostprocess modified its buffer via replaceRange()
// while iterating over it with std.mem.splitScalar, causing the iterator to
// read past the valid buffer in release builds.

test("patch --commit does not crash with many files in nested directories", async () => {
  // Create files in deeply nested directory structures to trigger many
  // replaceRange calls in gitDiffPostprocess. Each diff line containing
  // the folder path causes a replaceRange that shrinks the buffer.
  const aFiles: Record<string, string | Record<string, never>> = {};
  const bFiles: Record<string, string | Record<string, never>> = {};

  // Generate enough files to accumulate significant buffer shrinkage
  for (let i = 0; i < 30; i++) {
    const content = `module.exports = ${i};\n`;
    const modified = `module.exports = ${i};\n// patched\n`;
    aFiles[`a/android/src/main/java/com/example/file${i}.js`] = content;
    bFiles[`b/android/src/main/java/com/example/file${i}.js`] = modified;
  }

  const dir = tempDirWithFiles("patch-21338", { ...aFiles, ...bFiles });

  const afolder = join(dir, "a");
  const bfolder = join(dir, "b");

  // This would segfault before the fix due to buffer corruption in gitDiffPostprocess
  const patchfile = await makeDiff(afolder, bfolder, dir);

  expect(patchfile).toBeDefined();
  expect(patchfile.length).toBeGreaterThan(0);

  // Verify the patch can be applied correctly
  await apply(patchfile, afolder);

  for (let i = 0; i < 30; i++) {
    const result = await Bun.file(join(afolder, `android/src/main/java/com/example/file${i}.js`)).text();
    expect(result).toBe(`module.exports = ${i};\n// patched\n`);
  }
});

test("patch --commit handles scoped package paths correctly", async () => {
  // Simulate the exact scenario from the issue: a scoped package with
  // deeply nested Android paths
  const aFiles: Record<string, string> = {
    "a/package.json": '{"name": "@scope/pkg", "version": "1.0.0"}',
    "a/android/src/main/AndroidManifest.xml": "<manifest/>",
    "a/index.js": "module.exports = 1;",
  };
  const bFiles: Record<string, string> = {
    "b/package.json": '{"name": "@scope/pkg", "version": "1.0.0"}',
    "b/android/src/main/AndroidManifest.xml": '<manifest xmlns:android="http://schemas.android.com/apk/res/android"/>',
    "b/index.js": "module.exports = 1;",
  };

  const dir = tempDirWithFiles("patch-21338-scoped", { ...aFiles, ...bFiles });

  const afolder = join(dir, "a");
  const bfolder = join(dir, "b");

  const patchfile = await makeDiff(afolder, bfolder, dir);

  expect(patchfile).toBeDefined();
  expect(patchfile.length).toBeGreaterThan(0);

  // The patch should not contain the full folder paths
  expect(patchfile).not.toContain(afolder);
  expect(patchfile).not.toContain(bfolder);

  // Verify application
  await apply(patchfile, afolder);
  const result = await Bun.file(join(afolder, "android/src/main/AndroidManifest.xml")).text();
  expect(result).toBe('<manifest xmlns:android="http://schemas.android.com/apk/res/android"/>');
});
