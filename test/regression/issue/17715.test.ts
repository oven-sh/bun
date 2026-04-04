import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

it("duplicate dependency in same group should not corrupt bun.lock", () => {
  // Create package.json with a duplicate dependency entry in the same group.
  // JSON.stringify won't produce duplicates, so we hand-craft the JSON.
  const package_json = `{
  "name": "bun-reproduce-17715",
  "dependencies": {
    "empty-package-for-bun-test-runner": "1.0.0",
    "is-number": "^7.0.0",
    "empty-package-for-bun-test-runner": "1.0.0"
  }
}`;

  const dir = tempDirWithFiles("17715", {
    "package.json": package_json,
  });

  // First install: should warn about duplicate but not corrupt the lockfile
  const proc1 = Bun.spawnSync([bunExe(), "install"], {
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const stderr1 = proc1.stderr.toString("utf-8");
  expect(stderr1).toContain("warn: Duplicate dependency");
  expect(proc1.exitCode).toBe(0);

  // Verify the lockfile does NOT contain duplicate entries
  const lockContent1 = require("fs").readFileSync(join(dir, "bun.lock"), "utf-8");
  const occurrences1 = lockContent1.split('"empty-package-for-bun-test-runner"').length - 1;
  // The package name should only appear once in the dependencies section of the workspace.
  // It may appear elsewhere (e.g., in the packages section), but there should be no
  // duplicate key in the workspace dependencies object.
  const workspaceMatch1 = lockContent1.match(/"dependencies":\s*\{[^}]*\}/);
  expect(workspaceMatch1).not.toBeNull();
  const depsSection1 = workspaceMatch1![0];
  const depsOccurrences1 = depsSection1.split('"empty-package-for-bun-test-runner"').length - 1;
  expect(depsOccurrences1).toBe(1);

  // Now fix the package.json by removing the duplicate
  require("fs").writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "bun-reproduce-17715",
      dependencies: {
        "empty-package-for-bun-test-runner": "1.0.0",
        "is-number": "^7.0.0",
      },
    }),
  );

  // Second install: should not show the duplicate warning anymore
  const proc2 = Bun.spawnSync([bunExe(), "install"], {
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const stderr2 = proc2.stderr.toString("utf-8");
  expect(stderr2).not.toContain("warn: Duplicate");
  expect(stderr2).not.toContain("Duplicate key");
  expect(proc2.exitCode).toBe(0);

  // Verify the lockfile is clean after the second install
  const lockContent2 = require("fs").readFileSync(join(dir, "bun.lock"), "utf-8");
  const workspaceMatch2 = lockContent2.match(/"dependencies":\s*\{[^}]*\}/);
  expect(workspaceMatch2).not.toBeNull();
  const depsSection2 = workspaceMatch2![0];
  const depsOccurrences2 = depsSection2.split('"empty-package-for-bun-test-runner"').length - 1;
  expect(depsOccurrences2).toBe(1);
});
