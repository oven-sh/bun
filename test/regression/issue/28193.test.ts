import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, VerdaccioRegistry } from "harness";

let registry: VerdaccioRegistry;

beforeAll(async () => {
  registry = new VerdaccioRegistry();
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

function bunfig(scanner: string) {
  return `[install]\ncache = false\nregistry = "${registry.registryUrl()}"\n\n[install.security]\nscanner = "${scanner}"\n`;
}

async function install(dir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("bun install prints error when security scanner is unavailable", async () => {
  using dir = tempDir("issue-28193", {
    "package.json": JSON.stringify({
      name: "test-28193",
      dependencies: {
        "no-deps": "1.0.0",
      },
    }),
    "bunfig.toml": bunfig("@nonexistent-scanner/does-not-exist"),
  });

  const { stderr, exitCode } = await install(String(dir));

  // Should print an error message about the scanner failure, not exit silently
  expect(stderr).toContain("security scanner failed: SecurityScannerNotInDependencies");
  expect(exitCode).toBe(1);
});

test.concurrent("bun install prints error when scanner package is invalid", async () => {
  // The scanner is a devDependency that installs fine but is not a scanner
  // module (no-deps exports its package.json); the install should fail with a
  // clear error message.
  using dir = tempDir("issue-28193-invalid", {
    "package.json": JSON.stringify({
      name: "test-28193-invalid",
      devDependencies: {
        "no-deps": "1.0.0",
      },
    }),
    "bunfig.toml": bunfig("no-deps"),
  });

  const { stdout, stderr, exitCode } = await install(String(dir));

  // Should print an error about the scanner, not exit silently
  expect(stdout).toContain("Security scanner installed successfully.");
  expect(stderr).toContain("security scanner failed: ScannerFailed");
  expect(exitCode).toBe(1);
});
