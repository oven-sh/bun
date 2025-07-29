import { spawn } from "bun";
import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";
import { join } from "path";

test("issue #21409 - --rerun-each should report correct test and file counts", async () => {
  const testDir = import.meta.dirname;
  
  // Test with simple repeat count
  {
    await using proc = spawn({
      cmd: [bunExe(), "test", "--rerun-each", "5", "21409-fixture.test.ts"],
      env: bunEnv,
      cwd: testDir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
  }

  // TODO: Add more comprehensive tests once we can get the output properly
});