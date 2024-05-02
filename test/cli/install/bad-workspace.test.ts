import { spawnSync } from "bun";
import { afterEach, beforeEach, expect, test, beforeAll, setTimeout as jestSetTimeout } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { bunExe, bunEnv } from "harness";
import { join } from "path";
import { tmpdir } from "os";

let cwd: string;

beforeAll(() => {
  jestSetTimeout(1000 * 60 * 5);
});

beforeEach(() => {
  cwd = mkdtempSync(join(realpathSync(tmpdir()), "bad-workspace.test"));
});

test("bad workspace path", () => {
  writeFileSync(
    `${cwd}/package.json`,
    JSON.stringify(
      {
        name: "hey",
        workspaces: ["i-dont-exist"],
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

  expect(exitCode).toBe(1);
});
