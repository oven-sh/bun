import { test, expect } from "bun:test";
import { tmpdirSync, bunExe, bunEnv as env, runBunInstall } from "harness";
import fs from "fs";
import path from "path";

test("vite build works", async () => {
  const testDir = tmpdirSync();

  fs.cpSync(path.join(import.meta.dir, "the-test-app"), testDir, { recursive: true, force: true });

  const { exited: installExited } = Bun.spawn({
    cmd: [bunExe(), "install", "--ignore-scripts"],
    cwd: testDir,
    env,
  });

  expect(await installExited).toBe(0);

  const { stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "node_modules/vite/bin/vite.js", "build"],
    cwd: testDir,
    stdout: "pipe",
    stderr: "inherit",
    env,
  });

  expect(await exited).toBe(0);

  const out = await Bun.readableStreamToText(stdout);
  expect(out).toContain("done");
}, 60_000);
