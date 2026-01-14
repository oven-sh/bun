import { spawn, write } from "bun";
import { afterAll, beforeAll, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { bunExe, bunEnv as env, VerdaccioRegistry } from "harness";
import { join } from "path";

// Test for https://github.com/oven-sh/bun/issues/26076
// Peer dependency warning messages should include:
// 1. The requiring package name and version
// 2. The actual resolved version
// 3. The expected version range

let registry: VerdaccioRegistry;
let packageDir: string;
let packageJson: string;

setDefaultTimeout(1000 * 60 * 5);

// Helper to get IPv6-compatible registry URL
function registryUrl() {
  // Verdaccio binds to IPv6 by default when running under Bun, use [::1] instead of localhost
  return `http://[::1]:${registry.port}/`;
}

beforeAll(async () => {
  registry = new VerdaccioRegistry();
  await registry.start();

  // Wait for the registry to be fully ready (verdaccio binds to IPv6)
  let retries = 10;
  while (retries > 0) {
    try {
      const resp = await fetch(registryUrl());
      if (resp.ok) break;
    } catch {
      await Bun.sleep(500);
      retries--;
    }
  }
});

afterAll(() => {
  registry.stop();
});

beforeEach(async () => {
  ({ packageDir, packageJson } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: false, linker: "hoisted" },
  }));
  env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
  env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");

  // Override the bunfig.toml to use IPv6 address
  const bunfigPath = join(packageDir, "bunfig.toml");
  await write(
    bunfigPath,
    `[install]
cache = "${join(packageDir, ".bun-cache")}"
saveTextLockfile = false
registry = "${registryUrl()}"
linker = "hoisted"
`,
  );
});

test("peer dependency warnings include helpful version information", async () => {
  // peer-deps-fixed has peerDependencies: { "no-deps": "^1.0.0" }
  // Installing no-deps@2.0.0 should trigger a peer dependency warning
  await write(
    packageJson,
    JSON.stringify({
      name: "test-peer-warning",
      version: "1.0.0",
      dependencies: {
        "peer-deps-fixed": "1.0.0",
        "no-deps": "2.0.0",
      },
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const out = await stdout.text();
  const err = await stderr.text();
  const exitCode = await exited;

  // Should complete successfully
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("error:");

  // Verify the improved warning message format:
  // "peer-deps-fixed@1.0.0" has incorrect peer dependency "no-deps@2.0.0" (expected "^1.0.0")
  expect(err).toContain("incorrect peer dependency");
  expect(err).toContain("peer-deps-fixed@1.0.0");
  expect(err).toContain("no-deps@2.0.0");
  expect(err).toContain("^1.0.0");

  expect(exitCode).toBe(0);
});
