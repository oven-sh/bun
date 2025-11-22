import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// NOTE: The `dependencies` lifecycle script is an npm feature that runs after
// the dependency tree is modified. Bun's implementation improves on npm:
// - npm: only runs for root package, not for workspace packages
// - Bun: runs for both root and workspace packages (when dependencies change)
// This makes the dependencies script consistent with other lifecycle scripts like postinstall.

test("dependencies lifecycle script runs when dependencies change - issue #24901", async () => {
  using dir = tempDir("issue-24901-install", {
    "package.json": JSON.stringify({
      name: "test-dependencies-script",
      scripts: {
        dependencies: "echo 'dependencies script ran' > output.txt",
      },
      dependencies: {
        "is-odd": "3.0.1",
      },
    }),
  });

  // First install - should run the dependencies script
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

  if (exitCode1 !== 0) {
    console.error("Install failed:");
    console.error("STDOUT:", stdout1);
    console.error("STDERR:", stderr1);
  }

  expect(exitCode1).toBe(0);

  // Check that the dependencies script ran
  const outputFile = Bun.file(`${dir}/output.txt`);
  const outputExists = await outputFile.exists();
  expect(outputExists).toBe(true);

  if (outputExists) {
    const output = await outputFile.text();
    expect(output.trim()).toBe("dependencies script ran");
  }
});

test("dependencies lifecycle script does NOT run when dependencies don't change - issue #24901", async () => {
  using dir = tempDir("issue-24901-no-change", {
    "package.json": JSON.stringify({
      name: "test-dependencies-script-no-change",
      scripts: {
        dependencies: "echo 'dependencies script ran' > output.txt",
      },
      dependencies: {
        "is-odd": "3.0.1",
      },
    }),
  });

  // First install
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc1.exited;

  // Remove the output file
  const outputPath = `${dir}/output.txt`;
  try {
    await Bun.$`rm ${outputPath}`.cwd(String(dir));
  } catch {}

  // Second install without changes - should NOT run the dependencies script
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  if (exitCode2 !== 0) {
    console.error("Second install failed:");
    console.error("STDOUT:", stdout2);
    console.error("STDERR:", stderr2);
  }

  expect(exitCode2).toBe(0);

  // Check that the dependencies script did NOT run
  const outputFile = Bun.file(outputPath);
  const outputExists = await outputFile.exists();
  expect(outputExists).toBe(false);
});
