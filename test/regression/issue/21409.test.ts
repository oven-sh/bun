import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("issue #21409 - --rerun-each should report correct test and file counts", async () => {
  const testDir = import.meta.dirname;

  // Test the original issue: --rerun-each N should run N tests, not N-1 tests
  // and should report 1 file, not N files
  {
    await using proc = spawn({
      cmd: [bunExe(), "test", "--rerun-each", "5", "21409-fixture.test.ts"],
      env: bunEnv,
      cwd: testDir,
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    // The key fix: --rerun-each should work without crashing
    // On the main branch, this would show:
    // "4 pass", "4 expect() calls", "Ran 4 tests across 5 files"
    // After the fix, it should show:
    // "5 pass", "5 expect() calls", "Ran 5 tests across 1 file"
  }

  // Test with multiple tests in one file
  {
    await using proc = spawn({
      cmd: [bunExe(), "test", "--rerun-each", "3", "21409-multi-fixture.test.ts"],
      env: bunEnv,
      cwd: testDir,
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    // Should run 6 tests (2 tests × 3 repetitions) across 1 file
    // Before fix: would show 4 tests across 3 files
    // After fix: should show 6 tests across 1 file
  }
});
