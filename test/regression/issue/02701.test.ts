import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test that --external flag works with Node.js built-in modules when using browser target.
// Issue: https://github.com/oven-sh/bun/issues/2701

test("--external works with Node.js built-in 'path' for browser target", async () => {
  using dir = tempDir("external-node-builtins", {
    "index.js": `import path from 'path';
console.log(path.join('a', 'b'));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--outfile", "out.js", "--external", "path"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const output = await Bun.file(`${dir}/out.js`).text();
  // The output should contain an external import, not the polyfill
  expect(output).toContain('from "path"');
  // Should NOT contain the polyfill implementation
  expect(output).not.toContain("normalizeArray");
  // Output should be small (just the preserved import), not the full polyfill (~10KB)
  expect(output.length).toBeLessThan(500);
});

test("--external works with Node.js built-in 'crypto' for browser target", async () => {
  using dir = tempDir("external-node-builtins", {
    "index.js": `import crypto from 'crypto';
console.log(crypto.randomBytes(16));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--outfile", "out.js", "--external", "crypto"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const output = await Bun.file(`${dir}/out.js`).text();
  // The output should contain an external import, not the polyfill
  expect(output).toContain('from "crypto"');
  // Output should be small (just the preserved import), not the full polyfill
  expect(output.length).toBeLessThan(500);
});

test("--external works with node: prefixed built-in for browser target", async () => {
  using dir = tempDir("external-node-builtins", {
    "index.js": `import path from 'node:path';
console.log(path.join('a', 'b'));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--outfile", "out.js", "--external", "node:path"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const output = await Bun.file(`${dir}/out.js`).text();
  // The output should contain an external import, not the polyfill
  expect(output).toContain('from "node:path"');
  // Output should be small (just the preserved import), not the full polyfill
  expect(output.length).toBeLessThan(500);
});

test("--external works with 'fs' for browser target (no polyfill)", async () => {
  using dir = tempDir("external-node-builtins", {
    "index.js": `import fs from 'fs';
console.log(fs.readFileSync('test.txt'));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--outfile", "out.js", "--external", "fs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const output = await Bun.file(`${dir}/out.js`).text();
  // The output should contain an external import, not the stub
  expect(output).toContain('from "fs"');
  // Should NOT contain the empty stub
  expect(output).not.toContain("(() => ({}))");
  // Output should be small
  expect(output.length).toBeLessThan(500);
});

test("--external with subpath works for Node.js built-in for browser target", async () => {
  using dir = tempDir("external-node-builtins", {
    "index.js": `import { join } from 'path/posix';
console.log(join('a', 'b'));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--outfile", "out.js", "--external", "path"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const output = await Bun.file(`${dir}/out.js`).text();
  // The output should contain an external import for path/posix
  expect(output).toContain('from "path/posix"');
  // Output should be small
  expect(output.length).toBeLessThan(500);
});

test("without --external, Node.js built-ins are still polyfilled for browser target", async () => {
  using dir = tempDir("external-node-builtins", {
    "index.js": `import path from 'path';
console.log(path.join('a', 'b'));`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.js", "--outfile", "out.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const output = await Bun.file(`${dir}/out.js`).text();
  // Without --external, the polyfill should be bundled
  expect(output).toContain("normalizeStringPosix");
  // Output should be large (the full polyfill)
  expect(output.length).toBeGreaterThan(1000);
});
