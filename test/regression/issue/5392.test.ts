import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import * as fs from "node:fs";

test("bun install should not create node_modules when there are no dependencies - issue #5392", async () => {
  using dir = tempDir("issue-5392", {
    "package.json": JSON.stringify({
      name: "bun-install-test",
      module: "index.ts",
      type: "module",
      devDependencies: {},
      peerDependencies: {},
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // node_modules should not exist
  const nodeModulesPath = `${dir}/node_modules`;
  const nodeModulesExists = fs.existsSync(nodeModulesPath);

  expect(nodeModulesExists).toBe(false);
  expect(exitCode).toBe(0);
});

test("bun install should create node_modules when there are dependencies", async () => {
  using dir = tempDir("issue-5392-with-deps", {
    "package.json": JSON.stringify({
      name: "bun-install-test-with-deps",
      dependencies: {
        "is-odd": "^3.0.1",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // node_modules should exist
  const nodeModulesPath = `${dir}/node_modules`;
  const nodeModulesExists = fs.existsSync(nodeModulesPath);

  expect(nodeModulesExists).toBe(true);
  expect(exitCode).toBe(0);
});
