import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/28627
test.concurrent("bun add --production --no-save installs devDependency", async () => {
  using dir = tempDir("issue-28627", {
    "package.json": JSON.stringify({
      name: "test-issue-28627",
      devDependencies: {
        "is-number": "^7.0.0",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "add", "--production", "--no-save", "is-number"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("installed is-number");
  expect(existsSync(join(String(dir), "node_modules", "is-number"))).toBeTrue();
  expect(exitCode).toBe(0);
});

test.concurrent("bun add --production installs devDependency", async () => {
  using dir = tempDir("issue-28627-save", {
    "package.json": JSON.stringify({
      name: "test-issue-28627-save",
      devDependencies: {
        "is-number": "^7.0.0",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "add", "--production", "is-number"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("installed is-number");
  expect(existsSync(join(String(dir), "node_modules", "is-number"))).toBeTrue();
  expect(exitCode).toBe(0);
});
