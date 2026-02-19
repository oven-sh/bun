// https://github.com/oven-sh/bun/issues/26207
// bun run --filter and --workspaces should fall back to bun's node symlink
// when NODE env var points to a non-existent path

import { expect, test } from "bun:test";
import { chmodSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";

test("bun run --workspaces creates node symlink when NODE env points to non-existent path", async () => {
  const dir = tempDirWithFiles("workspaces-node-fallback", {
    "package.json": JSON.stringify({
      name: "root",
      workspaces: ["packages/*"],
    }),
    "packages/a/package.json": JSON.stringify({
      name: "a",
      scripts: {
        test: "node -e \"console.log('node works')\"",
      },
    }),
  });

  // Set NODE to a non-existent path and remove system node from PATH
  const env = {
    ...bunEnv,
    NODE: "/nonexistent/path/to/node",
    PATH: "/usr/bin", // PATH without node
  };

  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--workspaces", "test"],
    env,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should succeed because bun creates a symlink to its own node
  expect(stdout).toContain("node works");
  expect(exitCode).toBe(0);
});

test("bun run --filter creates node symlink when NODE env points to non-existent path", async () => {
  const dir = tempDirWithFiles("filter-node-fallback", {
    "package.json": JSON.stringify({
      name: "root",
      workspaces: ["packages/*"],
    }),
    "packages/a/package.json": JSON.stringify({
      name: "a",
      scripts: {
        test: "node -e \"console.log('node works from filter')\"",
      },
    }),
  });

  // Set NODE to a non-existent path and remove system node from PATH
  const env = {
    ...bunEnv,
    NODE: "/nonexistent/path/to/node",
    PATH: "/usr/bin", // PATH without node
  };

  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--filter", "*", "test"],
    env,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should succeed because bun creates a symlink to its own node
  expect(stdout).toContain("node works from filter");
  expect(exitCode).toBe(0);
});

// Skip on Windows: shebang scripts (#!/usr/bin/env node) are Unix-specific
test.skipIf(isWindows)("bun run --workspaces runs scripts that have #!/usr/bin/env node shebang", async () => {
  const dir = tempDirWithFiles("workspaces-shebang", {
    "package.json": JSON.stringify({
      name: "root",
      workspaces: ["packages/*"],
    }),
    "packages/a/package.json": JSON.stringify({
      name: "a",
      scripts: {
        build: "./build.js",
      },
    }),
    // Create an executable script with node shebang
    "packages/a/build.js": "#!/usr/bin/env node\nconsole.log('build script ran');",
  });

  // Make the script executable
  chmodSync(`${dir}/packages/a/build.js`, 0o755);

  // Remove system node from PATH, and clear NODE/npm_node_execpath to avoid
  // interfering with bun's node symlink creation
  const env = {
    ...bunEnv,
    NODE: undefined,
    npm_node_execpath: undefined,
    PATH: "/usr/bin", // PATH without node
  };

  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "--workspaces", "build"],
    env,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should succeed because bun creates a symlink to its own node
  expect(stdout).toContain("build script ran");
  expect(exitCode).toBe(0);
});
