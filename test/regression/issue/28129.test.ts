import { spawn } from "bun";
import { afterAll, beforeAll, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { exists } from "fs/promises";
import { VerdaccioRegistry, assertManifestsPopulated, bunExe, bunEnv as env } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/28129
// User-specified trustedDependencies should be additive to the default trusted
// dependencies list, not replace it. Previously, specifying trustedDependencies
// in package.json would cause packages in the default list (like libpq) to have
// their lifecycle scripts blocked.

var verdaccio = new VerdaccioRegistry();
var packageDir: string;
var packageJson: string;

beforeAll(async () => {
  setDefaultTimeout(1000 * 60 * 5);
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

beforeEach(async () => {
  ({ packageDir, packageJson } = await verdaccio.createTestDir({ bunfigOpts: { linker: "hoisted" } }));
  env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
  env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");
});

test("specifying trustedDependencies should not block default trusted dependencies", async () => {
  // electron is in the default trusted dependencies list and has a preinstall script.
  // uses-what-bin is NOT in the default list and has an install script.
  // Setting trustedDependencies to ["uses-what-bin"] should:
  // - Run uses-what-bin scripts (explicitly trusted)
  // - Also run electron scripts (default trusted)
  // Previously, electron scripts would be blocked.
  await Bun.write(
    packageJson,
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "uses-what-bin": "1.0.0",
        electron: "1.0.0",
      },
      trustedDependencies: ["uses-what-bin"],
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });

  const err = await stderr.text();
  const out = await stdout.text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("error:");

  // Neither should be blocked
  expect(out).not.toContain("Blocked");

  // Both lifecycle scripts should have run
  expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
  expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
  expect(await exited).toBe(0);
  assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
});
