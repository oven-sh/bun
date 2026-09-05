import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Bun builds mimalloc with MI_NO_PROCESS_DETACH, which disables mimalloc's
// automatic stats print on exit. Bun prints them manually in Bun__onExit,
// which runs on all platforms (atexit on macOS/ASAN, at_quick_exit on
// Linux, explicit call before ExitProcess on Windows).
test("MIMALLOC_SHOW_STATS=1 prints memory statistics on exit", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('hello')"],
    env: { ...bunEnv, MIMALLOC_SHOW_STATS: "1" },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // trim() because Windows writes CRLF
  expect(stdout.trim()).toBe("hello");
  // mimalloc stats include arenas and process sections
  expect(stderr).toContain("arenas");
  expect(stderr).toContain("process");
  expect(exitCode).toBe(0);
});
