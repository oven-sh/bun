import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("process.execArgv should be empty in compiled executables", async () => {
  const dir = tempDirWithFiles("process-execargv-compile", {
    "check-execargv.js": `
      console.log(JSON.stringify({
        argv: process.argv,
        execArgv: process.execArgv,
      }));
    `,
  });

  // First test regular execution - execArgv should be empty for script args
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "check-execargv.js"), "-a", "--b"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
    });

    const result = JSON.parse(await proc.stdout.text());
    expect(result.execArgv).toEqual([]);
    expect(result.argv).toContain("-a");
    expect(result.argv).toContain("--b");
  }

  // Build compiled executable
  {
    await using buildProc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "check-execargv.js", "--outfile=check-execargv"],
      env: bunEnv,
      cwd: dir,
    });

    expect(await buildProc.exited).toBe(0);
  }

  // Test compiled executable - execArgv should be empty
  {
    await using proc = Bun.spawn({
      cmd: [join(dir, "check-execargv"), "-a", "--b"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
    });

    const result = JSON.parse(await proc.stdout.text());

    // The fix: execArgv should be empty in compiled executables
    expect(result.execArgv).toEqual([]);

    // argv should still contain all arguments
    expect(result.argv).toContain("-a");
    expect(result.argv).toContain("--b");
  }
});
