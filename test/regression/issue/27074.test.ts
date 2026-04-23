import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "../../harness";

// https://github.com/oven-sh/bun/issues/27074
// `bun run --bun build` fails when a pre-script uses `node --run`
test("bun run --bun works with node --run in lifecycle scripts", () => {
  const temp = tempDirWithFiles("issue-27074", {
    "package.json": JSON.stringify({
      scripts: {
        echo_test: "echo echo_test_ran",
        prebuild: "node --run echo_test",
        build: "echo build_ran",
      },
    }),
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), "run", "--bun", "build"],
    cwd: temp,
    env: bunEnv,
  });

  const stdout = result.stdout.toString("utf8").trim();
  const stderr = result.stderr.toString("utf8").trim();

  expect(stdout).toContain("echo_test_ran");
  expect(stdout).toContain("build_ran");
  expect(result.exitCode).toBe(0);
});
