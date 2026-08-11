import { afterAll, beforeAll, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir, VerdaccioRegistry } from "harness";

let registry: VerdaccioRegistry;

beforeAll(async () => {
  registry = new VerdaccioRegistry();
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

it("duplicate dependencies should warn instead of error", async () => {
  const package_json = JSON.stringify({
    devDependencies: {
      "no-deps": "1.0.0",
    },
    dependencies: {
      "no-deps": "1.0.0",
    },
  });

  using dir = tempDir("07740", {
    "bunfig.toml": `[install]\ncache = false\nregistry = "${registry.registryUrl()}"\n`,
    "package.json": package_json,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error: Duplicate dependency:");
  expect(stderr).toContain("warn: Duplicate dependency");
  expect(stdout).toContain("1 package installed");
  expect(exitCode).toBe(0);
});
