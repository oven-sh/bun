import { file, write } from "bun";
import { readTarball } from "bun:internal-for-testing";
import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { spawn } from "bun";
import { join } from "path";

var packageDir: string;

beforeEach(() => {
  packageDir = tmpdirSync();
});

async function createTarball(cwd: string, env: NodeJS.Dict<string>): Promise<string> {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "pack"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env,
  });

  const err = await stderr.text();
  const out = await stdout.text();
  const exitCode = await exited;

  expect(exitCode).toBe(0);
  expect(err).not.toContain("error:");

  // Extract tarball filename from output
  const lines = out.split("\n");
  const tarballLine = lines.find(line => line.endsWith(".tgz"));
  expect(tarballLine).toBeDefined();

  return join(cwd, tarballLine!.trim());
}

describe("publishConfig field overrides", () => {
  test("publishConfig does NOT override in bun pack (only in bun publish)", async () => {
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "pack-publishconfig-1",
        version: "1.0.0",
        main: "./src/index.ts",
        exports: "./src/index.ts",
        publishConfig: {
          main: "./dist/index.js",
          exports: "./dist/index.js",
        },
      }),
    );

    const tarballPath = await createTarball(packageDir, bunEnv);
    const tarball = readTarball(tarballPath);

    // Find package.json in tarball
    const pkgJsonEntry = tarball.entries.find((e: any) => e.pathname === "package/package.json");
    expect(pkgJsonEntry).toBeDefined();

    const pkgJson = JSON.parse(pkgJsonEntry.contents);

    // bun pack should NOT apply publishConfig overrides
    // (only bun publish does)
    expect(pkgJson.main).toBe("./src/index.ts");
    expect(pkgJson.exports).toBe("./src/index.ts");
    expect(pkgJson.publishConfig).toEqual({
      main: "./dist/index.js",
      exports: "./dist/index.js",
    });
  });

  test("original package.json on disk remains unchanged", async () => {
    const pkgJsonPath = join(packageDir, "package.json");
    const originalPkg = {
      name: "pack-publishconfig-2",
      version: "1.0.0",
      main: "./src/main.ts",
      publishConfig: {
        main: "./dist/main.js",
      },
    };

    await write(pkgJsonPath, JSON.stringify(originalPkg, null, 2));

    await createTarball(packageDir, bunEnv);

    // Original file should be unchanged
    const pkgJsonAfter = await file(pkgJsonPath).json();
    expect(pkgJsonAfter).toEqual(originalPkg);
  });
});

