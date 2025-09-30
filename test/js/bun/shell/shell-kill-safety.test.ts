import { $ } from "bun";
import { expect, test, describe } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Shell kill() - Safety and Correctness", () => {
  test("killed shell does not execute subsequent commands", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    const marker = join(tmpDir, "should-not-exist.txt");

    const p = new $.Shell()`sleep 1 && echo "bad" > ${marker}`;
    await Bun.sleep(50);
    p.kill();
    await p;

    // The file should not be created because the shell was killed
    expect(existsSync(marker)).toBe(false);
  });

  test("killed shell in if-then does not execute then branch", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    const marker = join(tmpDir, "should-not-exist.txt");

    const p = new $.Shell()`if sleep 1; then echo "bad" > ${marker}; fi`;
    await Bun.sleep(50);
    p.kill();
    await p;

    expect(existsSync(marker)).toBe(false);
  });

  test("killed shell in if-else does not execute else branch", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    const marker = join(tmpDir, "should-not-exist.txt");

    const p = new $.Shell()`if false; then echo "skip"; else sleep 1 && echo "bad" > ${marker}; fi`;
    await Bun.sleep(50);
    p.kill();
    await p;

    expect(existsSync(marker)).toBe(false);
  });

  test("killed shell does not leave zombie processes", async () => {
    // Create multiple shells that spawn subprocesses
    const promises = [];
    for (let i = 0; i < 10; i++) {
      const p = new $.Shell()`sleep 100 | sleep 100 | sleep 100`;
      await Bun.sleep(10);
      p.kill();
      promises.push(p);
    }

    await Promise.all(promises);

    // Wait a bit for processes to clean up
    await Bun.sleep(100);

    // Check that no sleep processes are still running
    // Note: This is a best-effort check - in production, the OS will clean up orphans
    const psResult = await $`ps aux`.text();
    const sleepCount = (psResult.match(/sleep 100/g) || []).length;

    // Should be 0 or very low (might catch some from other tests)
    expect(sleepCount).toBeLessThan(5);
  });

  test("kill during file write does not corrupt file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    const outFile = join(tmpDir, "output.txt");

    // Write a known good value first
    writeFileSync(outFile, "initial content\n");

    // Try to kill during a write operation
    const p = new $.Shell()`echo "test data" >> ${outFile}`;
    p.kill();
    await p;

    // File should either have the initial content or the appended content,
    // but should not be corrupted or truncated
    const content = readFileSync(outFile, "utf8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toMatch(/^initial content/);
  });

  test("kill does not affect other concurrent shells", async () => {
    const p1 = new $.Shell()`sleep 10`;
    const p2 = new $.Shell()`echo "success"`;
    const p3 = new $.Shell()`sleep 10`;

    // Kill p1 and p3 but let p2 complete
    p1.kill();
    p3.kill();

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1.exitCode).toBe(137);
    expect(r2.exitCode).toBe(0); // p2 should complete successfully
    expect(r2.stdout.toString().trim()).toBe("success");
    expect(r3.exitCode).toBe(137);
  });

  test("multiple awaits on killed shell return same result", async () => {
    const p = new $.Shell()`sleep 10`;
    p.kill();

    const r1 = await p;
    const r2 = await p;

    expect(r1.exitCode).toBe(137);
    expect(r2.exitCode).toBe(137);
    expect(r1).toBe(r2); // Should be the same object
  });

  test("kill with invalid signal throws or uses default", async () => {
    const p = new $.Shell()`sleep 10`;

    // Try various invalid signals - should either throw or default to SIGKILL
    try {
      p.kill(-1);
      const r = await p;
      // If it didn't throw, it should use a valid exit code
      expect([129, 137, 143]).toContain(r.exitCode);
    } catch (err) {
      // If it throws, that's also acceptable behavior
      expect(err).toBeDefined();
    }
  });

  test("kill during pipeline setup does not leak file descriptors", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));

    // Create many files to ensure glob is slow
    for (let i = 0; i < 100; i++) {
      writeFileSync(join(tmpDir, `file${i}.txt`), "test");
    }

    // Try to kill during pipeline setup (during glob expansion)
    for (let i = 0; i < 20; i++) {
      const p = new $.Shell()`cat ${tmpDir}/*.txt | wc -l`.cwd(tmpDir);
      // Kill immediately, might catch during setup
      p.kill();
      await p;
    }

    // If FDs leaked, subsequent file operations would fail
    const p = new $.Shell()`echo "test"`;
    const r = await p;
    expect(r.exitCode).toBe(0);
  });

  test("kill honors quiet mode (no stderr output)", async () => {
    const p = new $.Shell()`sleep 10`.quiet();
    p.kill();
    const r = await p;

    expect(r.exitCode).toBe(137);
    // In quiet mode, stderr should be empty
    expect(r.stderr.length).toBe(0);
  });

  test("killed shell can be safely garbage collected", async () => {
    // Create and kill many shells without holding references
    for (let i = 0; i < 50; i++) {
      const p = new $.Shell()`sleep 10`;
      p.kill();
      await p;
      // Let p go out of scope
    }

    // Force GC if available
    if (global.gc) {
      global.gc();
      await Bun.sleep(100);
      global.gc();
    }

    // System should still be stable
    const p = new $.Shell()`echo "stable"`;
    const r = await p;
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString().trim()).toBe("stable");
  });

  test("kill before any state transition", async () => {
    // Kill before the shell even starts parsing
    const p = new $.Shell()`echo "test" | cat | wc -l`;
    p.kill(); // Immediate kill
    const r = await p;
    expect(r.exitCode).toBe(137);
  });

  test("kill returns immediately even if processes take time to die", async () => {
    const p = new $.Shell()`sleep 100`;
    const start = Date.now();

    p.kill();
    const r = await p;

    const elapsed = Date.now() - start;

    expect(r.exitCode).toBe(137);
    // Should complete in under 1 second (kill should be fast)
    expect(elapsed).toBeLessThan(1000);
  });

  test("killed shell with command substitution", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    const marker = join(tmpDir, "should-not-exist.txt");

    const p = new $.Shell()`echo $(sleep 1 && echo "bad" > ${marker})`;
    await Bun.sleep(50);
    p.kill();
    await p;

    // The command substitution should be killed
    expect(existsSync(marker)).toBe(false);
  });

  test("kill complex nested structure does not execute inner commands", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    const marker = join(tmpDir, "should-not-exist.txt");

    const p = new $.Shell()`if true; then (sleep 1 && echo "bad" > ${marker}) && echo "never"; fi`;
    await Bun.sleep(50);
    p.kill();
    await p;

    expect(existsSync(marker)).toBe(false);
  });

  test("kill with very short sleep still returns killed exit code", async () => {
    // This tests the race between natural completion and kill
    const results = [];
    for (let i = 0; i < 20; i++) {
      const p = new $.Shell()`sleep 0.001`;
      p.kill();
      const r = await p;
      results.push(r.exitCode);
    }

    // Most should be killed (137), but some might complete naturally (0)
    const killedCount = results.filter(c => c === 137).length;
    const completedCount = results.filter(c => c === 0).length;

    // At least some should have been killed
    expect(killedCount).toBeGreaterThan(0);
    // Total should be 20
    expect(killedCount + completedCount).toBe(20);
  });
});