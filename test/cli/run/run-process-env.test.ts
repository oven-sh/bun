import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRunAsScript, tempDir } from "harness";
import { join } from "node:path";

// Run with `bun <file>` (not `bun run`), so it prints exactly what the
// `bun run <script>` under test exported instead of re-deriving the values.
const printNpmPackageEnv = `process.stdout.write(JSON.stringify({
  npm_package_name: process.env.npm_package_name,
  npm_package_version: process.env.npm_package_version,
  npm_package_json: process.env.npm_package_json,
  npm_config_local_prefix: process.env.npm_config_local_prefix,
}));`;

async function runScript(cwd: string, script: string, env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--silent", script],
    cwd,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

describe("process.env", () => {
  test("npm_lifecycle_event", () => {
    const scriptName = "start:dev";

    using dir = tempDir("processenv", {
      "package.json": JSON.stringify({ "scripts": { [`${scriptName}`]: `'${bunExe()}' run index.ts` } }),
      "index.ts": "console.log(process.env.npm_lifecycle_event);",
    });
    const { stdout } = bunRunAsScript(dir, scriptName);
    expect(stdout).toBe(scriptName);
  });

  // https://github.com/oven-sh/bun/issues/3589
  test("npm_lifecycle_event should have the value of the last call", () => {
    using dir = tempDir("processenv_ls_call", {
      "package.json": JSON.stringify({ scripts: { first: `'${bunExe()}' run --cwd lsc second` } }),
      "lsc": {
        "package.json": JSON.stringify({ scripts: { second: `'${bunExe()}' run index.ts` } }),
        "index.ts": "console.log(process.env.npm_lifecycle_event);",
      },
    });
    const { stdout } = bunRunAsScript(dir, "first");
    expect(stdout).toBe("second");
  });

  // https://github.com/oven-sh/bun/issues/11713
  test.concurrent("nested bun run exports the inner package's npm_package_* and npm_config_local_prefix", async () => {
    using dir = tempDir("processenv_nested_pkg", {
      "package.json": JSON.stringify({
        name: "outer-pkg",
        version: "1.0.0",
        scripts: { outer: `cd inner && '${bunExe()}' run --silent inner` },
      }),
      "print-env.js": printNpmPackageEnv,
      "inner": {
        "package.json": JSON.stringify({
          name: "inner-pkg",
          version: "2.0.0",
          scripts: { inner: `'${bunExe()}' ../print-env.js` },
        }),
      },
    });

    expect(await runScript(String(dir), "outer")).toEqual({
      npm_package_name: "inner-pkg",
      npm_package_version: "2.0.0",
      npm_package_json: join(String(dir), "inner", "package.json"),
      npm_config_local_prefix: join(String(dir), "inner"),
    });
  });

  // npm only exports name/version when the package.json has them, so the outer run's values stay visible.
  test.concurrent("unnamed inner package.json keeps the inherited npm_package_name/version", async () => {
    using dir = tempDir("processenv_nested_unnamed", {
      "package.json": JSON.stringify({
        name: "outer-pkg",
        version: "1.0.0",
        scripts: { outer: `'${bunExe()}' run --silent --cwd inner inner` },
      }),
      "print-env.js": printNpmPackageEnv,
      "inner": {
        "package.json": JSON.stringify({
          scripts: { inner: `'${bunExe()}' ../print-env.js` },
        }),
      },
    });

    expect(await runScript(String(dir), "outer")).toEqual({
      npm_package_name: "outer-pkg",
      npm_package_version: "1.0.0",
      npm_package_json: join(String(dir), "inner", "package.json"),
      npm_config_local_prefix: join(String(dir), "inner"),
    });
  });

  test.concurrent("npm_package_* and npm_config_local_prefix overwrite inherited environment values", async () => {
    using dir = tempDir("processenv_stale_pkg", {
      "package.json": JSON.stringify({
        name: "my-pkg",
        version: "3.0.0",
        scripts: { print: `'${bunExe()}' print-env.js` },
      }),
      "print-env.js": printNpmPackageEnv,
    });

    const stale = {
      npm_package_name: "stale-name",
      npm_package_version: "0.0.0-stale",
      npm_package_json: "/stale/package.json",
      npm_config_local_prefix: "/stale",
    };
    expect(await runScript(String(dir), "print", stale)).toEqual({
      npm_package_name: "my-pkg",
      npm_package_version: "3.0.0",
      npm_package_json: join(String(dir), "package.json"),
      npm_config_local_prefix: String(dir),
    });
  });
});
