import { expect, test } from "bun:test";
import fs from "fs";
import { bunExe, bunEnv as env, isASAN, tmpdirSync } from "harness";
import path from "path";

const ASAN_MULTIPLIER = isASAN ? 3 : 1;

test(
  "vite build works",
  async () => {
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

    const out = await stdout.text();
    expect(out).toContain("done");
  },
  60_000 * ASAN_MULTIPLIER,
);
