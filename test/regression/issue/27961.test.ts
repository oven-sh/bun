import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/27961
// On Windows, `cp` panics with "access of union field 'exec' while field 'ebusy'
// is active" when overwriting a running .exe (EBUSY error).
describe.if(process.platform === "win32")("cp over running exe on Windows", () => {
  test("does not panic when overwriting a running executable", async () => {
    using dir = tempDir("cp-ebusy-27961", {});
    const dummyExe = String(dir) + "\\dummy-process.exe";

    // Copy bun to create a dummy executable
    await using setup = Bun.spawn({
      cmd: [bunExe(), "-e", `require('fs').copyFileSync(process.execPath, ${JSON.stringify(dummyExe)})`],
      env: bunEnv,
      cwd: String(dir),
    });
    expect(await setup.exited).toBe(0);

    // Run the dummy executable (keeps it locked on Windows).
    // It prints "ready" to stdout so we can wait for it deterministically.
    await using proc = Bun.spawn({
      cmd: [dummyExe, "-e", "console.log('ready'); setTimeout(() => {}, 30000)"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
    });

    // Wait for the child to signal it has started (exe is now locked).
    const reader = proc.stdout.getReader();
    const { value } = await reader.read();
    expect(Buffer.from(value!).toString().trim()).toBe("ready");
    reader.releaseLock();

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
    });

    // Before the fix, this would panic with:
    // "access of union field 'exec' while field 'ebusy' is active"
    // The process should exit with code 1 (graceful error), not crash.
    expect(await cpProc.exited).toBe(1);

    proc.kill();
  });
});
