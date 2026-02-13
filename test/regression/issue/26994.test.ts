import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// Use a directory on the root filesystem rather than /tmp (tmpfs) since
// debug-mode standalone binaries are ~1.3GB each.
function makeTempDir(prefix: string): string {
  return mkdtempSync(join("/workspace", `.tmp-${prefix}-`));
}

describe("issue #26994 - NODE_ENV not baked into --compile output", () => {
  test("process.env.NODE_ENV and BUN_ENV read from runtime environment", () => {
    const dir = makeTempDir("issue-26994");
    try {
      writeFileSync(join(dir, "index.ts"), `console.log(process.env.NODE_ENV + "," + process.env.BUN_ENV);`);
      const binPath = join(dir, "test-bin");

      // Build standalone executable
      const buildResult = Bun.spawnSync({
        cmd: [bunExe(), "build", "--compile", join(dir, "index.ts"), "--outfile", binPath],
        env: bunEnv,
        stderr: "pipe",
      });
      expect(buildResult.stderr.toString()).toBe("");
      expect(buildResult.exitCode).toBe(0);

      // Run with NODE_ENV=production, BUN_ENV=production
      const runProduction = Bun.spawnSync({
        cmd: [binPath],
        env: { ...bunEnv, NODE_ENV: "production", BUN_ENV: "production" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(runProduction.stdout.toString().trim()).toBe("production,production");
      expect(runProduction.exitCode).toBe(0);

      // Run with NODE_ENV=development, BUN_ENV=staging
      const runDev = Bun.spawnSync({
        cmd: [binPath],
        env: { ...bunEnv, NODE_ENV: "development", BUN_ENV: "staging" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(runDev.stdout.toString().trim()).toBe("development,staging");
      expect(runDev.exitCode).toBe(0);

      // Run with NODE_ENV=test
      const runTest = Bun.spawnSync({
        cmd: [binPath],
        env: { ...bunEnv, NODE_ENV: "test", BUN_ENV: "test" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(runTest.stdout.toString().trim()).toBe("test,test");
      expect(runTest.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  test("NODE_ENV comparison works at runtime in compiled binary", () => {
    const dir = makeTempDir("issue-26994-cond");
    try {
      writeFileSync(
        join(dir, "index.ts"),
        `
        if (process.env.NODE_ENV === "production") {
          console.log("prod mode");
        } else {
          console.log("dev mode");
        }
      `,
      );
      const binPath = join(dir, "test-bin");

      // Build standalone executable
      const buildResult = Bun.spawnSync({
        cmd: [bunExe(), "build", "--compile", join(dir, "index.ts"), "--outfile", binPath],
        env: bunEnv,
        stderr: "pipe",
      });
      expect(buildResult.stderr.toString()).toBe("");
      expect(buildResult.exitCode).toBe(0);

      // Run with production
      const runProd = Bun.spawnSync({
        cmd: [binPath],
        env: { ...bunEnv, NODE_ENV: "production" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(runProd.stdout.toString().trim()).toBe("prod mode");
      expect(runProd.exitCode).toBe(0);

      // Run with development
      const runDev = Bun.spawnSync({
        cmd: [binPath],
        env: { ...bunEnv, NODE_ENV: "development" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(runDev.stdout.toString().trim()).toBe("dev mode");
      expect(runDev.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
