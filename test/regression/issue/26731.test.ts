import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/26731
// Bun incorrectly resolves jsnext:main field for CommonJS require() calls.
// When a CommonJS module requires a package that has jsnext:main but no explicit main,
// Bun should fall back to index.js (like Node.js does), not use the ESM entry point.
test("require() should not resolve jsnext:main field", async () => {
  using dir = tempDir("issue-26731", {
    "package.json": JSON.stringify({ name: "test", type: "module" }),
    // Main entry point (ESM) that imports a CJS package
    "index.js": `
      import cjsPackage from './cjs-package/index.cjs';
      console.log(cjsPackage);
    `,
    // CJS package that requires a dependency with jsnext:main
    "cjs-package/index.cjs": `
      const dep = require('../jsnext-dep');
      module.exports = dep();
    `,
    // Dependency with jsnext:main but no explicit main field
    // This simulates packages like code-point that have only jsnext:main
    "jsnext-dep/package.json": JSON.stringify({
      name: "jsnext-dep",
      "jsnext:main": "esm.js",
      // Note: no "main" field, so it should default to index.js
    }),
    // ESM entry (should NOT be used for require())
    "jsnext-dep/esm.js": `
      export default function() { return 'esm'; }
    `,
    // CJS entry (should be used for require())
    "jsnext-dep/index.js": `
      module.exports = function() { return 'cjs'; }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should print "cjs" because require() should use index.js, not jsnext:main
  expect(stdout.trim()).toBe("cjs");
  expect(exitCode).toBe(0);
});

test("import should still resolve jsnext:main field", async () => {
  using dir = tempDir("issue-26731-import", {
    "package.json": JSON.stringify({ name: "test", type: "module" }),
    // ESM import should use jsnext:main
    "index.js": `
      import dep from './jsnext-dep';
      console.log(dep());
    `,
    // Dependency with jsnext:main
    "jsnext-dep/package.json": JSON.stringify({
      name: "jsnext-dep",
      "jsnext:main": "esm.js",
    }),
    // ESM entry (should be used for import)
    "jsnext-dep/esm.js": `
      export default function() { return 'esm'; }
    `,
    // CJS entry
    "jsnext-dep/index.js": `
      module.exports = function() { return 'cjs'; }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should print "esm" because import should use jsnext:main
  expect(stdout.trim()).toBe("esm");
  expect(exitCode).toBe(0);
});
