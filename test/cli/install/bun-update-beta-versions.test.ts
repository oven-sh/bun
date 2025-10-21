import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("bun update should use latest tag for pre-release versions", async () => {
  using dir = tempDir("rolldown-beta-test", {
    "package.json": JSON.stringify({
      name: "test-app",
      dependencies: {
        rolldown: "^1.0.0-beta.43",
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

  // Check node_modules to see which version was actually installed
  const installedPackageJson = JSON.parse(
    await Bun.file(join(String(dir), "node_modules", "rolldown", "package.json")).text(),
  );

  // Should install 1.0.0-beta.44 (the latest tag), not 1.0.0-beta.9-commit.d91dfb5
  expect(installedPackageJson.version).toBe("1.0.0-beta.44");
  expect(installStderr).toContain("Saved lockfile");
  expect(installExitCode).toBe(0);
});
