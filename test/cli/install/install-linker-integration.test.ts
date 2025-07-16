import { spawn } from "bun";
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("bun install --linker isolated creates lockfile with correct node_linker", async () => {
  const dir = tempDirWithFiles("linker-isolated-lockfile", {
    "package.json": JSON.stringify({
      name: "test-linker",
      version: "1.0.0",
      dependencies: {
        "is-number": "^7.0.0",
      },
    }),
  });

  await using proc = spawn({
    cmd: [bunExe(), "install", "--linker", "isolated"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const output = stdout + stderr;
  expect(output).not.toContain("Invalid --linker value");

  // Check that lockfile was created
  const lockbExists = existsSync(`${dir}/bun.lockb`);
  const lockExists = existsSync(`${dir}/bun.lock`);

  expect(lockbExists || lockExists).toBe(true);

  // If text lockfile exists, check it contains the node_linker setting
  if (lockExists) {
    const lockContent = readFileSync(`${dir}/bun.lock`, "utf8");
    expect(lockContent).toContain('"nodeLinker": "isolated"');
  }
});

test("bun install --linker hoisted creates lockfile with correct node_linker", async () => {
  const dir = tempDirWithFiles("linker-hoisted-lockfile", {
    "package.json": JSON.stringify({
      name: "test-linker",
      version: "1.0.0",
      dependencies: {
        "is-number": "^7.0.0",
      },
    }),
  });

  await using proc = spawn({
    cmd: [bunExe(), "install", "--linker", "hoisted"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const output = stdout + stderr;
  expect(output).not.toContain("Invalid --linker value");

  // Check that lockfile was created
  const lockbExists = existsSync(`${dir}/bun.lockb`);
  const lockExists = existsSync(`${dir}/bun.lock`);

  expect(lockbExists || lockExists).toBe(true);

  // If text lockfile exists, check it contains the node_linker setting
  if (lockExists) {
    const lockContent = readFileSync(`${dir}/bun.lock`, "utf8");
    expect(lockContent).toContain('"nodeLinker": "hoisted"');
  }
});
