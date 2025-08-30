import { describe, expect, test } from "bun:test";
import fs, { mkdtempSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";

describe("pnpm real Next.js repo migration", () => {
  test("migrates real Next.js monorepo pnpm lockfile", async () => {
    // Create temp directory
    const tempDir = mkdtempSync(join(tmpdir(), "nextjs-real-"));

    // Copy fixture files to temp directory
    const fixtureDir = join(__dirname, "pnpm", "nextjs-real");
    fs.cpSync(fixtureDir, tempDir, { recursive: true });
    fs.rmSync(join(tempDir, "node_modules"), { recursive: true, force: true });
    fs.rmSync(join(tempDir, "bun.lock"), { force: true });

    // Run bun pm migrate
    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "migrate"],
      cwd: tempDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.log("Migration stdout:", stdout);
      console.log("Migration stderr:", stderr);
      console.log("Migration exitCode:", exitCode);
    }

    // Check migration succeeded
    expect(exitCode).toBe(0);
    expect(stderr).toContain("migrated lockfile from pnpm-lock.yaml");

    // Check that bun.lock was created
    expect(fs.existsSync(join(tempDir, "bun.lock"))).toBe(true);

    // Read the migrated lockfile (it's JSONC format with trailing commas)
    const bunLockContent = fs.readFileSync(join(tempDir, "bun.lock"), "utf8");

    // Snapshot the entire lockfile string
    expect(bunLockContent).toMatchSnapshot("nextjs-full-lockfile");
    expect(Bun.file(join(tempDir, "package.json")).text()).resolves.toMatchSnapshot("nextjs-package-json");

    // Basic validation - check it contains expected strings
    expect(bunLockContent).toContain('"lockfileVersion": 1');
    expect(bunLockContent).toContain('"workspaces"');
    expect(bunLockContent).toContain('"packages"');
    expect(bunLockContent).toContain('"packages/next"');
    expect(bunLockContent).toContain('"packages/create-next-app"');
    expect(bunLockContent).toContain('"packages/eslint-config-next"');

    console.log(`Migrated lockfile size: ${bunLockContent.length} bytes (JSONC format)`);

    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });
});
