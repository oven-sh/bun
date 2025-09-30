import { spawnSync } from "bun";
import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("bun --filter works with uppercase directory names on case-sensitive filesystems", () => {
  const dir = tempDirWithFiles("issue-11295", {
    packages: {
      "Pkg-a": {
        "package.json": JSON.stringify({
          name: "pkg-a",
          scripts: {
            test: "echo 'pkg-a test'",
          },
        }),
      },
      "Pkg-B": {
        "package.json": JSON.stringify({
          name: "pkg-b",
          scripts: {
            test: "echo 'pkg-b test'",
          },
        }),
      },
      lowercase: {
        "package.json": JSON.stringify({
          name: "lowercase",
          scripts: {
            test: "echo 'lowercase test'",
          },
        }),
      },
    },
    "package.json": JSON.stringify({
      name: "root",
      workspaces: ["packages/*"],
    }),
  });

  const { exitCode, stdout, stderr } = spawnSync({
    cwd: dir,
    cmd: [bunExe(), "run", "--filter", "./packages/*", "test"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderrText = stderr.toString();
  const stdoutText = stdout.toString();

  expect(stderrText).not.toContain("ENOENT");
  expect(exitCode).toBe(0);

  expect(stdoutText).toContain("pkg-a test");
  expect(stdoutText).toContain("pkg-b test");
  expect(stdoutText).toContain("lowercase test");
});