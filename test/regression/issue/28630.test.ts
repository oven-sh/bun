import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Windows uses ExitProcess which doesn't run atexit handlers
test.skipIf(isWindows)("MIMALLOC_SHOW_STATS=1 prints memory statistics on exit", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('hello')"],
    env: { ...bunEnv, MIMALLOC_SHOW_STATS: "1" },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("hello\n");
  // mimalloc prints stats to stderr
  expect(stderr).toContain("heap stats:");
  expect(exitCode).toBe(0);
});
