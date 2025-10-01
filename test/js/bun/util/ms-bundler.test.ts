import { test, expect } from "bun:test";
import { bunExe, tempDir } from "harness";

// Test that Bun.ms works correctly in bundled code
test("Bun.ms works in bundled code", async () => {
  using dir = tempDir("ms-bundler-test", {
    "entry.ts": `
      // Test various Bun.ms calls
      console.log(JSON.stringify({
        oneSecond: Bun.ms("1s"),
        oneMinute: Bun.ms("1m"),
        oneHour: Bun.ms("1h"),
        oneDay: Bun.ms("1d"),
        twoWeeks: Bun.ms("2w"),
        halfYear: Bun.ms("0.5y"),
        withSpaces: Bun.ms("5 minutes"),
        negative: Bun.ms("-10s"),
        decimal: Bun.ms("1.5h"),
        justNumber: Bun.ms("100"),
        caseInsensitive: Bun.ms("2D"),
        formatShort: Bun.ms(1000),
        formatLong: Bun.ms(60000, { long: true }),
      }));
    `,
  });

  // Bundle the code
  await using buildProc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.ts", "--outdir", ".", "--minify"],
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  await buildProc.exited;
  expect(buildProc.exitCode).toBe(0);

  // Run the bundled code
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  expect(runProc.exitCode).toBe(0);
  expect(stderr).toBe("");

  const result = JSON.parse(stdout.trim());

  // Verify all values are correct
  expect(result).toEqual({
    oneSecond: 1000,
    oneMinute: 60000,
    oneHour: 3600000,
    oneDay: 86400000,
    twoWeeks: 1209600000,
    halfYear: 15778800000,
    withSpaces: 300000,
    negative: -10000,
    decimal: 5400000,
    justNumber: 100,
    caseInsensitive: 172800000,
    formatShort: "1s",
    formatLong: "1 minute",
  });
});

// Note: Compile-time inlining of Bun.ms("literal") would be a future optimization
// For now, this test verifies that Bun.ms works correctly at runtime in bundled code
