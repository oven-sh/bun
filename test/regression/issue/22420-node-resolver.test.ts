import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir, normalizeBunSnapshot } from "harness";

test("issue #22420 - no segfault in BSSStringList when resolving modules in node mode", async () => {
  // This test simulates the conditions that trigger the crash:
  // 1. Create a complex node_modules structure
  // 2. Run bun in node mode (simulating npx behavior)
  // 3. Trigger module resolution that causes directory scanning
  
  using dir = tempDir("issue-22420-resolver", {
    "package.json": JSON.stringify({
      name: "test-22420",
      type: "module",
    }),
    // Create a script that will trigger extensive module resolution
    "index.js": `
      // Force module resolution through various paths
      const modules = [
        './node_modules/pkg1/index.js',
        './node_modules/pkg2/index.js',
        './node_modules/pkg3/nested/index.js',
      ];
      
      for (const mod of modules) {
        try {
          await import(mod);
        } catch (e) {
          // Expected - modules might not exist
        }
      }
      
      // Also try require resolution paths (when running as node)
      if (typeof require !== 'undefined') {
        try {
          require('pkg1');
          require('pkg2');
          require('pkg3/nested');
        } catch (e) {
          // Expected
        }
      }
      
      console.log('Resolution completed without crash');
    `,
    // Create a complex node_modules structure to stress the resolver
    "node_modules/pkg1/package.json": JSON.stringify({ name: "pkg1", main: "index.js" }),
    "node_modules/pkg1/index.js": `module.exports = 'pkg1';`,
    "node_modules/pkg2/package.json": JSON.stringify({ name: "pkg2", main: "index.js" }),
    "node_modules/pkg2/index.js": `module.exports = 'pkg2';`,
    "node_modules/pkg3/package.json": JSON.stringify({ name: "pkg3" }),
    "node_modules/pkg3/nested/index.js": `module.exports = 'nested';`,
    // Add more nested directories to trigger more directory reads
    "node_modules/.bin/dummy": `#!/usr/bin/env node\nconsole.log('dummy');`,
    "node_modules/@scope/pkg/package.json": JSON.stringify({ name: "@scope/pkg" }),
    "node_modules/@scope/pkg/index.js": `module.exports = 'scoped';`,
  });

  // Run the script with bun in regular mode first
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([
    proc1.stdout.text(),
    proc1.stderr.text(),
    proc1.exited,
  ]);

  expect(exitCode1).toBe(0);
  expect(normalizeBunSnapshot(stdout1, dir)).toMatchInlineSnapshot(`"Resolution completed without crash"`);

  // Now test with bun x (which uses node-like resolution)
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "x", "node", "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([
    proc2.stdout.text(),
    proc2.stderr.text(),
    proc2.exited,
  ]);

  // Should not crash
  expect(exitCode2).toBe(0);
  expect(normalizeBunSnapshot(stdout2, dir)).toMatchInlineSnapshot(`"Resolution completed without crash"`);
});