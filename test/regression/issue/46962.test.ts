import { file, spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/46962
// `bun add -g .` before bun 1.4.4 wrote `"": "."` into the global package.json. A later bun must
// still read that file: it skips the row with a warning instead of refusing every global command.
test("bun add -g and bun remove -g skip an empty dependency name in the global package.json", async () => {
  using dir = tempDir("global-empty-dep-name", {
    ".bun/install/global/package.json": JSON.stringify({ dependencies: { "": "." } }, null, 2),
    "pkg/package.json": JSON.stringify({ name: "mypkg", version: "1.0.0" }),
    "pkg/index.js": "",
  });
  const home = String(dir);
  const globalPackageJson = join(home, ".bun", "install", "global", "package.json");

  async function runGlobal(...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), ...args, "-g"],
      cwd: home,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...bunEnv,
        HOME: home,
        BUN_INSTALL: join(home, ".bun"),
        BUN_INSTALL_GLOBAL_DIR: join(home, ".bun", "install", "global"),
        BUN_INSTALL_BIN: join(home, ".bun", "bin"),
        BUN_INSTALL_CACHE_DIR: join(home, ".bun", "install", "cache"),
      },
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  {
    const { stdout, stderr, exitCode } = await runGlobal("add", "./pkg");
    expect(stderr).not.toContain("empty dependency name");
    expect(stderr).toContain('skipping unnamed dependency ("." in "dependencies")');
    expect(stdout).toContain("installed mypkg@");
    expect(exitCode).toBe(0);
  }
  expect((await file(globalPackageJson).json()).dependencies.mypkg).toBe(join(home, "pkg").replaceAll("\\", "/"));

  {
    const { stdout, stderr, exitCode } = await runGlobal("remove", "mypkg");
    expect(stderr).not.toContain("empty dependency name");
    expect(stdout).toContain("mypkg");
    expect(exitCode).toBe(0);
  }
  expect((await file(globalPackageJson).json()).dependencies.mypkg).toBeUndefined();
});
