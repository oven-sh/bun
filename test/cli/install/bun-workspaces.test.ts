import { spawnSync } from "bun";
import { bunExe, bunEnv as env, tmpdirSync } from "harness";
import { join } from "path";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { beforeEach, test, expect } from "bun:test";
import { install_test_helpers } from "bun:internal-for-testing";
const { printLockfileAsJSON } = install_test_helpers;

var testCounter: number = 0;

// not necessary, but verdaccio will be added to this file in the near future
var port: number = 4873;
var packageDir: string;

beforeEach(() => {
  packageDir = tmpdirSync("bun-workspaces-" + testCounter++ + "-");
  env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
  env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");
  writeFileSync(
    join(packageDir, "bunfig.toml"),
    `
[install]
cache = false
`,
  );
});

test("dependency on workspace without version in package.json", () => {
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      workspaces: ["packages/*"],
    }),
  );

  mkdirSync(join(packageDir, "packages", "mono"), { recursive: true });
  writeFileSync(
    join(packageDir, "packages", "mono", "package.json"),
    JSON.stringify({
      name: "lodash",
    }),
  );

  mkdirSync(join(packageDir, "packages", "bar"), { recursive: true });

  const shouldWork: string[] = ["*", "*.*.*", "latest", "", "=*", "kjwoehcojrgjoj", "*.1.*", "*-pre"];
  const shouldNotWork: string[] = ["1", "1.*", "1.1.*", "1.1.1", "*-pre+build", "*+build"];

  for (const version of shouldWork) {
    writeFileSync(
      join(packageDir, "packages", "bar", "package.json"),
      JSON.stringify({
        name: "bar",
        version: "1.0.0",
        dependencies: {
          lodash: version,
        },
      }),
    );

    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stderr: "inherit",
      stdout: "pipe",
      env,
    });

    expect(printLockfileAsJSON(packageDir)).toMatchSnapshot(`version: ${version}`);

    const out = stdout.toString();
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + bar@workspace:packages/bar",
      " + lodash@workspace:packages/mono",
      "",
      " 2 packages installed",
    ]);

    expect(exitCode).toBe(0);

    rmSync(join(packageDir, "node_modules"), { recursive: true, force: true });
    rmSync(join(packageDir, "bun.lockb"), { recursive: true, force: true });
  }

  // downloads the package from the registry instead of
  // using the workspace locally
  for (const version of shouldNotWork) {
    writeFileSync(
      join(packageDir, "packages", "bar", "package.json"),
      JSON.stringify({
        name: "bar",
        version: "1.0.0",
        dependencies: {
          lodash: version,
        },
      }),
    );

    const { exitCode, stdout } = spawnSync({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stderr: "inherit",
      stdout: "pipe",
      env,
    });

    expect(printLockfileAsJSON(packageDir)).toMatchSnapshot(`version: ${version}`);

    const out = stdout.toString();
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + bar@workspace:packages/bar",
      " + lodash@workspace:packages/mono",
      "",
      " 3 packages installed",
    ]);

    expect(exitCode).toBe(0);

    rmSync(join(packageDir, "node_modules"), { recursive: true, force: true });
    rmSync(join(packageDir, "packages", "bar", "node_modules"), { recursive: true, force: true });
    rmSync(join(packageDir, "bun.lockb"), { recursive: true, force: true });
  }
});
