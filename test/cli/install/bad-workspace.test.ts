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
