import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/18115
// `String.raw` and `RegExp.prototype.source` must preserve non-ASCII bytes
// verbatim — the printer previously escaped them to `\uXXXX`, changing
// runtime values (e.g. `String.raw\`é\``.length was 6 instead of 1).

describe.concurrent("issue/18115", () => {
  test("String.raw preserves non-ASCII characters", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        "process.stdout.write(JSON.stringify([String.raw`Redémarrage`, String.raw`a中`, String.raw`╭─╮`, String.raw`🐰`]))",
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(JSON.stringify(["Redémarrage", "a中", "╭─╮", "🐰"]));
    expect(exitCode).toBe(0);
  });

  test("RegExp.source preserves non-ASCII characters", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "process.stdout.write(JSON.stringify([/Redémarrage/.source, /╭─╮/.source, /a中/.source]))"],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(JSON.stringify(["Redémarrage", "╭─╮", "a中"]));
    expect(exitCode).toBe(0);
  });

  // Exercises the disk-backed transpiler cache (≥ 4 KiB threshold) via the
  // JSC vtable `put()` path, where pre-fix `BunString::ascii` mis-tagged
  // UTF-8 output as Latin-1 and corrupted non-ASCII on the next read.
  test("runtime transpiler cache preserves non-ASCII (write + read)", async () => {
    // > 4 KiB padding to clear `MINIMUM_CACHE_SIZE` and force the cache path.
    // `Buffer.alloc(...).toString()` rather than `"x".repeat(...)` — the
    // latter is slow on debug JSC builds.
    const padding = "// " + Buffer.alloc(5000, "x").toString();
    using dir = tempDir("issue-18115-cache", {
      "fixture.js": `${padding}\nprocess.stdout.write(JSON.stringify([String.raw\`Redémarrage\`, String.raw\`╭─╮\`, String.raw\`🐰\`]))`,
    });
    const dirPath = String(dir);
    const scriptPath = join(dirPath, "fixture.js");
    const cacheDir = join(dirPath, ".cache");

    const env = {
      ...bunEnv,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: cacheDir,
      // Required in debug builds for the cache to be read back, not just written.
      BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
    };
    const expected = JSON.stringify(["Redémarrage", "╭─╮", "🐰"]);

    async function runFixture() {
      await using proc = Bun.spawn({ cmd: [bunExe(), scriptPath], env, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe(expected);
      expect(exitCode).toBe(0);
    }

    // First run: writes the entry via the JSC vtable `put()`.
    await runFixture();

    // Sanity: the cache must actually have been written; otherwise the
    // second run would re-transpile and the test would pass for the wrong
    // reason (i.e. without exercising the vtable read-back path at all).
    expect(existsSync(cacheDir)).toBeTrue();
    expect(readdirSync(cacheDir).length).toBeGreaterThan(0);

    // Second run: serves from cache — must produce identical output.
    await runFixture();
  });
});
