import { spawnSync } from "bun";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { bunExe, bunEnv } from "harness";
import { join } from "path";
import { tmpdir } from "os";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(realpathSync(tmpdir()), "bad-workspace.test"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

test("bad workspace path", () => {
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
  expect(text).toContain("multi level globs");
  expect(text).toContain("glob star * in the middle of a path");

  expect(exitCode).toBe(1);
});
