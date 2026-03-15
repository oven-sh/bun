import { spawn } from "bun";
import { afterAll, beforeAll, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { exists } from "fs/promises";
import { VerdaccioRegistry, assertManifestsPopulated, bunExe, bunEnv as env } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/28129
// User-specified trustedDependencies should be additive to the default trusted
// dependencies list, not replace it. Previously, specifying trustedDependencies
// in package.json would cause transitive packages in the default list (like
// libpq, a transitive dep of pg-native) to have their lifecycle scripts blocked.

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

test("specifying trustedDependencies should not block transitive default trusted dependencies", async () => {
  // This mirrors the original issue: pg-native depends on libpq (default trusted,
  // has node-gyp rebuild). User trusts pg-native but not libpq explicitly.
  //
  // Here, "depends-on-electron" depends on "electron" (default trusted, has
  // preinstall script). "uses-what-bin" is explicitly trusted by the user.
  // Both electron's transitive scripts and uses-what-bin's scripts should run.
  await Bun.write(
    packageJson,
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "depends-on-electron": "1.0.0",
        "uses-what-bin": "1.0.0",
      },
      trustedDependencies: ["uses-what-bin"],
    }),
  );

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });

  const err = await proc.stderr.text();
  const out = await proc.stdout.text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("error:");

  // Neither should be blocked — electron is default trusted, uses-what-bin is explicitly trusted
  expect(out).not.toContain("Blocked");

  // Both lifecycle scripts should have run
  expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
  expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
  expect(await proc.exited).toBe(0);
  assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
});
