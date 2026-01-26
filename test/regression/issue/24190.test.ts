import { file, spawn } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Test for https://github.com/oven-sh/bun/issues/24190
// bun link <package> fails in workspace with sibling dependencies

let globalLinkDir: string;
let depDir: string;

beforeAll(async () => {
  // Create a temp directory for the global link registry
  globalLinkDir = mkdirSync(join(require("os").tmpdir(), `bun-link-global-${Date.now()}`), { recursive: true }) ?? "";
  globalLinkDir = require("fs").realpathSync(globalLinkDir);

  // Create and register the external package to be linked
  depDir = join(globalLinkDir, "dep");
  mkdirSync(depDir, { recursive: true });
  writeFileSync(join(depDir, "package.json"), JSON.stringify({ name: "dep", version: "1.0.0" }));

  // Register it globally with bun link
  await using proc = spawn({
    cmd: [bunExe(), "link"],
    cwd: depDir,
    env: { ...bunEnv, BUN_INSTALL_GLOBAL_DIR: globalLinkDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await proc.exited).toBe(0);
});

afterAll(async () => {
  // Unlink the global package
  if (depDir) {
    await using proc = spawn({
      cmd: [bunExe(), "unlink"],
      cwd: depDir,
      env: { ...bunEnv, BUN_INSTALL_GLOBAL_DIR: globalLinkDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
  }
});

test("bun link works in workspace package with sibling dependencies", async () => {
  // Create workspace structure:
  // work/
  //   package.json (workspaces: ["foo", "bar"])
  //   foo/
  //     package.json (dependencies: { "bar": "workspace:*" })
  //   bar/
  //     package.json
  using dir = tempDir("bun-link-ws", {
    "package.json": JSON.stringify({
      name: "workspace-root",
      workspaces: ["foo", "bar"],
    }),
    foo: {
      "package.json": JSON.stringify({
        name: "foo",
        dependencies: {
          bar: "workspace:*",
        },
      }),
    },
    bar: {
      "package.json": JSON.stringify({
        name: "bar",
        version: "1.0.0",
      }),
    },
  });

  // First, run bun install to set up the workspace
  {
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_INSTALL_GLOBAL_DIR: globalLinkDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
  }

  // Now run `bun link dep --save` from within the foo workspace package
  // This should NOT fail with "Workspace dependency 'bar' not found"
  {
    await using proc = spawn({
      cmd: [bunExe(), "link", "dep", "--save"],
      cwd: join(String(dir), "foo"),
      env: { ...bunEnv, BUN_INSTALL_GLOBAL_DIR: globalLinkDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should not contain the error about workspace dependency not found
    expect(stderr).not.toContain('Workspace dependency "bar" not found');
    expect(stderr).not.toContain("bar@workspace:* failed to resolve");

    // Should succeed
    expect(exitCode).toBe(0);

    // Verify dep was linked to foo's package.json
    const fooPackageJson = await file(join(String(dir), "foo", "package.json")).json();
    expect(fooPackageJson.dependencies).toHaveProperty("dep");
    expect(fooPackageJson.dependencies.dep).toBe("link:dep");
  }
});
