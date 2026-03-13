import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.failing("issue #12250: afterAll hook should run even with --bail flag", async () => {
  using dir = tempDir("test-12250", {
    "test.spec.ts": `
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

describe('test', () => {
  beforeAll(async () => {
    console.log('Before');
  });

  afterAll(async () => {
    console.log('After');
  });

  it('should fail', async () => {
    expect(true).toBe(false);
  });

  it('should pass', async () => {
    expect(true).toBe(true);
  });
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--bail", "test.spec.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The test should fail with exit code 1
  expect(exitCode).toBe(1);

  // Before hook should run
  expect(stdout).toContain("Before");

  // Currently failing: afterAll hook should run even with --bail
  // TODO: Remove .todo() when fixed
  expect(stdout).toContain("After");

  // Should bail out after first failure
  expect(stdout).toContain("Bailed out after 1 failure");
  expect(stdout).toContain("Ran 1 tests");
});

test("issue #12250: afterAll hook runs normally without --bail flag", async () => {
  using dir = tempDir("test-12250-control", {
    "test.spec.ts": `
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

describe('test', () => {
  beforeAll(async () => {
    console.log('Before');
  });

  afterAll(async () => {
    console.log('After');
  });

  it('should fail', async () => {
    expect(true).toBe(false);
  });

  it('should pass', async () => {
    expect(true).toBe(true);
  });
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.spec.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The test should fail with exit code 1 (one test failed)
  expect(exitCode).toBe(1);

  // Before hook should run
  expect(stdout).toContain("Before");

  // Without --bail, afterAll should definitely run
  expect(stdout).toContain("After");

  // Without --bail, should NOT bail out early
  expect(stdout).not.toContain("Bailed out");
});
