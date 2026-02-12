import { spawnSync } from "bun";
import { beforeAll, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";

let cwd: string;

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

beforeEach(() => {
  cwd = tmpdirSync();
});

test("missing literal workspace path should not error", () => {
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify(
      {
        name: "test",
        workspaces: ["terraform"],
      },
      null,
      2,
    ),
  );

  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const text = stderr!.toString();

  expect(text).not.toContain("Workspace not found");
  expect(exitCode).toBe(0);
});

test("missing glob workspace pattern should not error", () => {
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify(
      {
        name: "test",
        workspaces: ["terraform*"],
      },
      null,
      2,
    ),
  );

  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const text = stderr!.toString();

  expect(text).not.toContain("Workspace not found");
  expect(exitCode).toBe(0);
});

test("literal and glob missing workspaces behave the same", () => {
  // Test literal path
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify(
      {
        name: "test",
        workspaces: ["nonexistent"],
      },
      null,
      2,
    ),
  );

  const literalResult = spawnSync({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  // Test glob pattern
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify(
      {
        name: "test",
        workspaces: ["nonexistent*"],
      },
      null,
      2,
    ),
  );

  const globResult = spawnSync({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  // Both should succeed with exit code 0
  expect(literalResult.exitCode).toBe(0);
  expect(globResult.exitCode).toBe(0);
});
