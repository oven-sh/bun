import { spawnSync } from "bun";
import { test, describe, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";
import { mkdirSync, rmSync, writeFileSync } from "fs";

test("bad workspace path", () => {
  const cwd = "/tmp/bun-bad-workspace";
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd);
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify(
      {
        name: "hey",
        workspaces: ["i-dont-exist", "**/i-have-a-2-stars-and-i-dont-exist", "*/i-have-a-star-and-i-dont-exist"],
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

  expect(text).toContain('Workspace not found "i-dont-exist"');
  expect(text).toContain("multiple levels deep glob star");
  expect(text).toContain("glob star * in the middle of a path");
  console.log(text);
  expect(exitCode).toBe(1);
  rmSync(cwd, { recursive: true, force: true });
});
