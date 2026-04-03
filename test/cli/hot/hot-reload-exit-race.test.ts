import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";

// Regression: under ASAN, `Global.exit` runs mimalloc's atexit handler which
// poisons freed memory. The file watcher thread was not stopped first, so its
// next `bustDirCache` call would touch the resolver's BSSMap singleton after
// the memory was poisoned, aborting the process with use-after-poison from
// thread T2 (File Watcher). The crash is ASAN-specific (mimalloc only poisons
// under ASAN), so the test is gated on ASAN builds.
async function runOnce(iteration: number): Promise<{ signal: string | null; stderr: string }> {
  using dir = tempDir(`hot-exit-race-${iteration}`, {
    "script.ts": `setTimeout(() => process.exit(0), 120); console.log("READY");\n`,
    "touch.txt": `0`,
  });
  const touchPath = `${String(dir)}/touch.txt`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--hot", "run", "script.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for the child to print READY so we know --hot is initialized.
  let stdout = "";
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  while (!stdout.includes("READY")) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();

  // Touch a sibling file in a tight loop. This fires directory-change events
  // at the watcher without racing the entrypoint reloader against its own
  // in-flight rewrites. The goal is to keep the watcher thread churning
  // inside `bustDirCache` right up until `process.exit` tears the VM down.
  const rewrites = (async () => {
    for (let i = 0; i < 2000; i++) {
      await Bun.write(touchPath, String(i));
      if ((await Promise.race([proc.exited, Promise.resolve("alive")])) !== "alive") break;
    }
  })();

  const [, stderr] = await Promise.all([proc.exited, proc.stderr.text()]);
  await rewrites;

  return { signal: proc.signalCode, stderr };
}

test.skipIf(!isASAN)("bun --hot exits cleanly while watcher is dispatching events", async () => {
  // Loop several times because the race is timing-sensitive. Without the
  // fix, a watcher-thread use-after-poison tends to trip within a few
  // iterations.
  for (let i = 0; i < 10; i++) {
    const { signal, stderr } = await runOnce(i);
    if (stderr.includes("AddressSanitizer") || stderr.includes("use-after-poison") || signal === "SIGABRT") {
      console.error(`iteration ${i} failed, signal=${signal}, stderr:\n${stderr}`);
    }
    expect(stderr).not.toContain("AddressSanitizer");
    expect(stderr).not.toContain("use-after-poison");
    // SIGABRT (exit 134) is what ASAN raises after reporting an error.
    expect(signal).not.toBe("SIGABRT");
  }
}, 60_000);
