import { spawnSync } from "bun";
import { bunExe, bunEnv as env, toBeValidBin, toHaveBins, tmpdirSync } from "harness";
import { join, s } from "path";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { beforeEach, test, expect } from "bun:test";

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
registry = "http://localhost:${port}/"
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
      name: "mono",
    }),
  );

  mkdirSync(join(packageDir, "packages", "bar"), { recursive: true });

  const shouldWork: string[] = ["*", "*.*.*", "latest", "", "=*", "kjwoehcojrgjoj", "*.1.*"];
  const shouldNotWork: string[] = ["1", "1.1.*", "1.1.*", "1.1.1"];

  for (const version of shouldWork) {
    writeFileSync(
      join(packageDir, "packages", "bar", "package.json"),
      JSON.stringify({
        name: "bar",
        version: "1.0.0",
        dependencies: {
          mono: version,
        },
      }),
    );

    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stderr: "pipe",
      stdout: "pipe",
      env,
    });

    const err = stderr.toString();

    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("warn:");
    expect(err).not.toContain("panic:");
    expect(err).not.toContain("failed");

    const out = stdout.toString();
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + bar@workspace:packages/bar",
      " + mono@workspace:packages/mono",
      "",
      " 2 packages installed",
    ]);

    expect(exitCode).toBe(0);

    rmSync(join(packageDir, "node_modules"), { recursive: true, force: true });
    rmSync(join(packageDir, "bun.lockb"), { recursive: true, force: true });
  }

  for (const version of shouldNotWork) {
    writeFileSync(
      join(packageDir, "packages", "bar", "package.json"),
      JSON.stringify({
        name: "bar",
        version: "1.0.0",
        dependencies: {
          mono: version,
        },
      }),
    );

    const { stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stderr: "pipe",
      stdout: "pipe",
      env,
    });

    const err = stderr.toString();
    expect(err).toContain("failed to resolve");
    expect(err).not.toContain("Saved lockfile");
    expect(exitCode).toBe(1);
  }
});
