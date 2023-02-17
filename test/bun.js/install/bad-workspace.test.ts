import { spawnSync } from "bun";
import { test, describe, expect } from "bun:test";
import { bunEnv } from "bunEnv";
import { bunExe } from "bunExe";
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
        workspaces: ["i-dont-exist", "*/i-have-a-star-and-i-dont-exist"],
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
  expect(text).toContain('Workspace not found "*/i-have-a-star-and-i-dont-exist"');
  expect(exitCode).toBe(1);
  rmSync(cwd, { recursive: true, force: true });
});
