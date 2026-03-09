import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/27961
// On Windows, `cp` panics with "access of union field 'exec' while field 'ebusy'
// is active" when overwriting a running .exe (EBUSY error).
describe.if(process.platform === "win32")("cp over running exe on Windows", () => {
  test("does not panic when overwriting a running executable", async () => {
    using dir = tempDir("cp-ebusy-27961");
    const dummyExe = String(dir) + "\\dummy-process.exe";

    // Copy bun to create a dummy executable
    await using setup = Bun.spawn({
      cmd: [bunExe(), "-e", `require('fs').copyFileSync(process.execPath, ${JSON.stringify(dummyExe)})`],
      env: bunEnv,
      cwd: String(dir),
    });
    await setup.exited;

    // Run the dummy executable (keeps it locked on Windows)
    await using proc = Bun.spawn({
      cmd: [dummyExe, "-e", "setTimeout(() => {}, 30000)"],
      env: bunEnv,
      cwd: String(dir),
    });

    // Give the process time to start
    await Bun.sleep(500);

    // Try to overwrite the running exe via shell cp - this should fail
    // gracefully with an error, not panic.
    await using cpProc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { $ } = require("bun");
        $.nothrow();
        const result = await $\`cp \${process.execPath} ${JSON.stringify(dummyExe)}\`;
        process.exit(result.exitCode);
      `,
      ],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([cpProc.stderr.text(), cpProc.exited]);

    // The process should exit with code 1 (error), not crash with a panic.
    // Before the fix, this would panic with:
    // "access of union field 'exec' while field 'ebusy' is active"
    expect(stderr).not.toContain("panic");
    expect(exitCode).toBe(1);

    proc.kill();
  });
});
