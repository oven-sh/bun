import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

// Only Linux takes the thread-suspend lock in execve.
test.skipIf(!isLinux)(
  "--watch restarts after a crash on a thread that holds the thread-suspend lock",
  async () => {
    using dir = tempDir("restart-after-crash", {
      "index.js": `
        const { existsSync, writeFileSync } = require("node:fs");
        if (existsSync("crashed")) {
          console.log("restarted");
          process.exit(0);
        }
        writeFileSync("crashed", "");
        require("bun:internal-for-testing").crash_handler.segfaultHoldingThreadSuspendLock();
      `,
    });

    await using proc = Bun.spawn({
      // The last flag keeps debug builds from spawning llvm-symbolizer.
      cmd: [bunExe(), "--watch", "index.js", "--debug-crash-handler-use-trace-string"],
      env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Bun is auto-restarting due to crash");
    expect({ stdout, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "restarted\n",
      exitCode: 0,
      signalCode: null,
    });
  },
  60_000,
);
