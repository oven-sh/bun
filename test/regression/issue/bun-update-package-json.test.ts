import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "node:path";

test("bun update should update package.json with preserved version range prefixes", async () => {
  const dir = tempDirWithFiles("bun-update-test", {
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        // Use different version range formats
        "react": "^18.0.0",
        "lodash": "~4.17.20",
        "express": "4.17.1", // exact version
      },
    }, null, 2),
  });

  // Install dependencies first
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
  });
  await proc1.exited;

  // Update react (caret range)
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "update", "react"],
    env: bunEnv,
    cwd: dir,
  });
  await proc2.exited;

  // Update lodash (tilde range)
  await using proc3 = Bun.spawn({
    cmd: [bunExe(), "update", "lodash"],
    env: bunEnv,
    cwd: dir,
  });
  await proc3.exited;

  // Update express (exact version)
  await using proc4 = Bun.spawn({
    cmd: [bunExe(), "update", "express"],
    env: bunEnv,
    cwd: dir,
  });
  await proc4.exited;

  // Read the updated package.json
  const packageJsonPath = join(dir, "package.json");
  const packageJsonContent = await Bun.file(packageJsonPath).text();
  const packageJson = JSON.parse(packageJsonContent);

  // Verify that version range prefixes are preserved
  expect(packageJson.dependencies.react).toMatch(/^\^18\./);
  expect(packageJson.dependencies.lodash).toMatch(/^~4\.17\./);
  expect(packageJson.dependencies.express).toMatch(/^4\.17\./); // should remain exact

  // Verify versions were actually updated (not just the exact same versions)
  expect(packageJson.dependencies.react).not.toBe("^18.0.0");
  expect(packageJson.dependencies.lodash).not.toBe("~4.17.20");
  // express might stay the same if no patch updates are available in the 4.17.x range
});

test("bun update with --latest should update to latest versions", async () => {
  const dir = tempDirWithFiles("bun-update-latest-test", {
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        "react": "^17.0.0", // old major version
      },
    }, null, 2),
  });

  // Install dependencies first
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
  });
  await proc1.exited;

  // Update react with --latest flag
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "update", "--latest", "react"],
    env: bunEnv,
    cwd: dir,
  });
  await proc2.exited;

  // Read the updated package.json
  const packageJsonPath = join(dir, "package.json");
  const packageJsonContent = await Bun.file(packageJsonPath).text();
  const packageJson = JSON.parse(packageJsonContent);

  // With --latest, should update to newest major version with caret prefix
  expect(packageJson.dependencies.react).toMatch(/^\^1[89]\./); // React 18 or 19
  expect(packageJson.dependencies.react).not.toBe("^17.0.0");
});