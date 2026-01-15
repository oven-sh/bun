import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/3775
// module.register() should emit a warning since it's not implemented
test("module.register() emits a warning", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `import { register } from 'node:module'; register('./test.mjs', import.meta.url);`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Check that the warning is emitted
  expect(stderr).toContain("module.register() is not implemented in Bun");
  expect(stderr).toContain("BUN_UNSUPPORTED_REGISTER");
  expect(stderr).toContain("https://bun.sh/docs/bundler/plugins");

  // Exit code should be 0 (warning, not error)
  expect(exitCode).toBe(0);
});

test("module.register() with require syntax emits a warning", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `const { register } = require('node:module'); register('./test.mjs');`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Check that the warning is emitted
  expect(stderr).toContain("module.register() is not implemented in Bun");
  expect(stderr).toContain("BUN_UNSUPPORTED_REGISTER");

  // Exit code should be 0 (warning, not error)
  expect(exitCode).toBe(0);
});

test("module.register() emits warning only once per call", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { register } from 'node:module';
      register('./test1.mjs', import.meta.url);
      register('./test2.mjs', import.meta.url);
    `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The warning should be emitted twice (once per call)
  const warningMatches = stderr.match(/module\.register\(\) is not implemented in Bun/g);
  expect(warningMatches?.length).toBe(2);

  // Exit code should be 0
  expect(exitCode).toBe(0);
});
