import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

// --breakpoint-resolve / --breakpoint-print are debug-build-only flags that
// trap into an attached debugger when the resolver or printer encounters a
// path containing the given substring. Without a debugger attached the trap
// terminates the process via the crash handler.
test.skipIf(!isDebug)("--breakpoint-resolve fires when a matching import is resolved", async () => {
  using dir = tempDir("breakpoint-resolve", {
    "entry.ts": `import "./needle-mod.ts";\n`,
    "needle-mod.ts": `export {};\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--breakpoint-resolve=needle-mod", "run", "entry.ts"],
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The resolver prints a debug line and then raises SIGTRAP; without a
  // debugger attached the process crashes.
  expect(stderr).toContain("Resolving");
  expect(stderr).toContain("needle-mod");
  expect(stdout).toBe("");
  expect(exitCode).not.toBe(0);
});

test.skipIf(!isDebug)("--breakpoint-resolve does not fire when no import matches", async () => {
  using dir = tempDir("breakpoint-resolve-nomatch", {
    "entry.ts": `import "./other.ts"; console.log("ran");\n`,
    "other.ts": `export {};\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--breakpoint-resolve=never-appears-anywhere", "run", "entry.ts"],
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Resolving");
  expect(stdout).toBe("ran\n");
  expect(exitCode).toBe(0);
});
