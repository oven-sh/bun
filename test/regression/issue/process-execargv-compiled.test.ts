import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("process.execArgv should be empty in compiled executables and argv should work correctly", async () => {
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
      cmd: [bunExe(), join(dir, "check-execargv.js"), "-a", "--b", "arg1", "arg2"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
    });

    const result = JSON.parse(await proc.stdout.text());
    expect(result.execArgv).toEqual([]);

    // Verify argv structure: [executable, script, ...userArgs]
    expect(result.argv.length).toBeGreaterThanOrEqual(4);
    expect(result.argv[result.argv.length - 4]).toBe("-a");
    expect(result.argv[result.argv.length - 3]).toBe("--b");
    expect(result.argv[result.argv.length - 2]).toBe("arg1");
    expect(result.argv[result.argv.length - 1]).toBe("arg2");
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

  // Test compiled executable - execArgv should be empty, argv should work normally
  {
    await using proc = Bun.spawn({
      cmd: [join(dir, "check-execargv"), "-a", "--b", "arg1", "arg2"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
    });

    const result = JSON.parse(await proc.stdout.text());

    // The fix: execArgv should be empty in compiled executables (no --compile-argv was used)
    expect(result.execArgv).toEqual([]);

    // argv should contain: ["bun", script_path, ...userArgs]
    expect(result.argv.length).toBe(6);
    expect(result.argv[0]).toBe("bun");
    // The script path contains "check-execargv" and uses platform-specific virtual paths
    // Windows: B:\~BUN\..., Unix: /$bunfs/...
    expect(result.argv[1]).toContain("check-execargv");
    expect(result.argv[2]).toBe("-a");
    expect(result.argv[3]).toBe("--b");
    expect(result.argv[4]).toBe("arg1");
    expect(result.argv[5]).toBe("arg2");
  }
});
