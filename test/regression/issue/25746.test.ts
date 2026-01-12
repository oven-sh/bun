// https://github.com/oven-sh/bun/issues/25746
// `bun link -g <package>` creates a broken symlink because the installation
// process deletes the source symlink before reading from it.

import { spawn } from "bun";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdir, writeFile } from "fs/promises";
import { bunEnv, bunExe, stderrForInstall, tempDir } from "harness";
import { join } from "path";

let link_dir: string;
let globalDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  link_dir = tempDir("bun-link-global", {});
  globalDir = tempDir("bun-global-dir", {});
  originalHome = bunEnv.HOME;
  // Override HOME so bun link uses our test global directory
  bunEnv.HOME = globalDir;
});

afterEach(async () => {
  if (originalHome !== undefined) {
    bunEnv.HOME = originalHome;
  }
});

it("should successfully link a package globally with bun link -g", async () => {
  // Create a test package with a bin entry
  await mkdir(join(link_dir, "bin"), { recursive: true });
  await writeFile(
    join(link_dir, "package.json"),
    JSON.stringify({
      name: "my-test-cli",
      version: "1.0.0",
      bin: {
        "my-test-cli": "./bin/cli.js",
      },
    }),
  );
  await writeFile(join(link_dir, "bin", "cli.js"), '#!/usr/bin/env node\nconsole.log("hello from my-test-cli");');

  // Step 1: Register the package with `bun link`
  const proc1 = spawn({
    cmd: [bunExe(), "link"],
    cwd: link_dir,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([
    new Response(proc1.stdout).text(),
    new Response(proc1.stderr).text(),
    proc1.exited,
  ]);

  expect(stderrForInstall(stderr1).split(/\r?\n/)).toEqual([""]);
  expect(stdout1).toContain('Success! Registered "my-test-cli"');
  expect(exitCode1).toBe(0);

  // Step 2: Link globally with `bun link -g my-test-cli`
  // This was failing with "FileNotFound: failed linking dependency/workspace to node_modules for package my-test-cli"
  const proc2 = spawn({
    cmd: [bunExe(), "link", "-g", "my-test-cli"],
    cwd: link_dir,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([
    new Response(proc2.stdout).text(),
    new Response(proc2.stderr).text(),
    proc2.exited,
  ]);

  // The install should succeed without FileNotFound errors
  const stderrFiltered = stderrForInstall(stderr2);
  expect(stderrFiltered).not.toContain("FileNotFound");
  expect(stderrFiltered).not.toContain("failed linking dependency");
  expect(stdout2).toContain("installed my-test-cli@link:my-test-cli");
  expect(exitCode2).toBe(0);

  // Verify the global package can be read (symlink is valid)
  const globalNodeModules = join(globalDir, ".bun", "install", "global", "node_modules");
  const packageJson = await Bun.file(join(globalNodeModules, "my-test-cli", "package.json")).json();
  expect(packageJson.name).toBe("my-test-cli");
  expect(packageJson.version).toBe("1.0.0");
});
