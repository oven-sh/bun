import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const isCanary = Bun.spawnSync([bunExe(), "--revision"]).stdout.toString().includes("-canary");

test.skipIf(!isCanary)(
  "run-parallel.ts reports a full disk when a program ends with ENOSPC",
  async () => {
    using dir = tempDir("run-parallel-full-disk-message", {
      "tsconfig.json": "{}",
      "writes.js": `throw Object.assign(new Error("ENOSPC: no space left on device, open 'a'"), { code: "ENOSPC" });\n`,
    });
    const root = String(dir);
    const { stdout, exitCode } = await run(
      [bunExe(), join(import.meta.dir, "run-parallel.ts"), `--root=${root}`, "--jobs=2", join(root, "writes.js")],
      root,
      bunEnv,
    );
    const failures = stdout
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(({ state }) => state === "fail")
      .map(({ stage, message }) => ({ stage, message }));
    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures)
      expect(failure).toEqual({
        stage: "run",
        message: expect.stringMatching(/it ended by exit code 1: the disk is full: \d+ MB are left for /),
      });
    expect(exitCode).toBe(1);
  },
  120_000,
);
