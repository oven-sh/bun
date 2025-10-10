// Test for https://github.com/oven-sh/bun/issues/14911
// require.resolve with relative paths in the `paths` option should not panic
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("require.resolve with relative path in paths option should not panic", async () => {
  using dir = tempDir("issue-14911", {
    "libs/node_modules/barcode-svg/package.json": JSON.stringify({
      name: "barcode-svg",
      main: "index.js",
    }),
    "libs/node_modules/barcode-svg/index.js": "module.exports = { test: true };",
    "test.js": `
      try {
        // When using relative paths in the 'paths' option, Node.js treats them
        // as starting directories and searches for node_modules from there.
        // This was causing a panic on Windows: "cannot resolve DirInfo for non-absolute path"
        const resolved = require.resolve('barcode-svg', { paths: ['libs'] });
        console.log('RESOLVED:', resolved);

        // Verify it resolved successfully
        if (!resolved.includes('barcode-svg')) {
          console.log('ERROR: Did not resolve barcode-svg');
          process.exit(1);
        }

        console.log('SUCCESS');
      } catch (err) {
        console.log('ERROR:', err.message);
        process.exit(1);
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not panic with "cannot resolve DirInfo for non-absolute path"
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("cannot resolve DirInfo for non-absolute path");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
});

test("require.resolve with multiple relative paths in paths option", async () => {
  using dir = tempDir("issue-14911-multiple", {
    "dir1/node_modules/pkg1/package.json": JSON.stringify({
      name: "pkg1",
      main: "index.js",
    }),
    "dir1/node_modules/pkg1/index.js": "module.exports = { pkg1: true };",
    "dir2/node_modules/pkg2/package.json": JSON.stringify({
      name: "pkg2",
      main: "index.js",
    }),
    "dir2/node_modules/pkg2/index.js": "module.exports = { pkg2: true };",
    "test.js": `
      try {
        // Test with multiple relative paths - they should all be converted to absolute
        const resolved1 = require.resolve('pkg1', { paths: ['dir1', 'dir2'] });
        console.log('RESOLVED1:', resolved1);

        const resolved2 = require.resolve('pkg2', { paths: ['dir1', 'dir2'] });
        console.log('RESOLVED2:', resolved2);

        if (!resolved1.includes('pkg1') || !resolved2.includes('pkg2')) {
          console.log('ERROR: Paths did not resolve correctly');
          process.exit(1);
        }

        console.log('SUCCESS');
      } catch (err) {
        console.log('ERROR:', err.message);
        process.exit(1);
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("panic");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
});
