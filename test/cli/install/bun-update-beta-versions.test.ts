import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("bun update should prefer same pre-release tag (rolldown beta issue)", async () => {
  using dir = tempDir("rolldown-beta-test", {
    "package.json": JSON.stringify({
      name: "test-app",
      dependencies: {
        "rolldown": "^1.0.0-beta.43",
      },
    }),
  });

  // Install the package
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [installStdout, installStderr, installExitCode] = await Promise.all([
    installProc.stdout.text(),
    installProc.stderr.text(),
    installProc.exited,
  ]);

  console.log("Install stdout:", installStdout);
  console.log("Install stderr:", installStderr);

  // Now run update
  await using updateProc = Bun.spawn({
    cmd: [bunExe(), "update"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [updateStdout, updateStderr, updateExitCode] = await Promise.all([
    updateProc.stdout.text(),
    updateProc.stderr.text(),
    updateProc.exited,
  ]);

  console.log("Update stdout:", updateStdout);
  console.log("Update stderr:", updateStderr);

  // Read the package.json to see what version was installed
  const packageJson = JSON.parse(await Bun.file(join(String(dir), "package.json")).text());
  console.log("Final package.json:", packageJson);

  // Check node_modules to see which version was actually installed
  const installedPackageJson = JSON.parse(
    await Bun.file(join(String(dir), "node_modules", "rolldown", "package.json")).text(),
  );
  console.log("Installed version:", installedPackageJson.version);

  // The version should be beta.44 or higher, NOT beta.9
  expect(installedPackageJson.version).not.toContain("beta.9");

  // It should prefer beta.X versions over beta.X-commit.Y versions
  // since the range was ^1.0.0-beta.43
  const versionMatch = installedPackageJson.version.match(/^1\.0\.0-beta\.(\d+)$/);
  expect(versionMatch).toBeTruthy();

  if (versionMatch) {
    const betaNumber = parseInt(versionMatch[1], 10);
    expect(betaNumber).toBeGreaterThanOrEqual(44);
  }

  expect(installExitCode).toBe(0);
  expect(updateExitCode).toBe(0);
});
