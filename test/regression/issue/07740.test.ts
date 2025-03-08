import { bunEnv, bunExe, tempDirWithFiles } from "harness";

it("duplicate dependencies should warn instead of error", () => {
  const package_json = JSON.stringify({
    devDependencies: {
      "empty-package-for-bun-test-runner": "1.0.0",
    },
    dependencies: {
      "empty-package-for-bun-test-runner": "1.0.0",
    },
  });

  const dir = tempDirWithFiles("07740", {
    "package.json": package_json,
  });

  const proc = Bun.spawnSync([bunExe(), "install"], {
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
  });

  const stderr = proc.stderr.toString("utf-8").trim();

  expect(stderr).not.toContain("error: Duplicate dependency:");
  expect(stderr).toContain("warn: Duplicate dependency");
});
