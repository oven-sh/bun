import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";

// Regression: a watcher thread dispatches through the resolver's BSSMap
// singletons (dir_cache, etc.). When `VirtualMachine.globalExit` /
// `Global.exit` tear those singletons down — either via the explicit
// `transpiler.deinit()` path behind `BUN_DESTRUCT_VM_ON_EXIT` or via
// mimalloc's ASAN atexit poisoning — a still-running watcher's next
// `bustDirCache` call touches freed memory and aborts the process with
// use-after-poison from thread T2 (File Watcher).
//
// The test forces the `BUN_DESTRUCT_VM_ON_EXIT` path (synchronous teardown)
// and has an outside shell helper keep writing sibling files non-stop while
// the child is in globalExit, so the watcher is almost certainly in
// `bustDirCache` when the singleton is freed. Gated on ASAN because that's
// the lane that deterministically catches the UAP. Empirically fails in
// ~40% of iterations without the fix, so the outer loop is sized to make
// the false-negative probability negligible.
async function runOnce(iteration: number): Promise<{ exitCode: number | null; signal: string | null; stderr: string }> {
  using dir = tempDir(`hot-exit-race-${iteration}`, {
    "script.ts": `setTimeout(() => process.exit(0), 250); console.log("READY"); setInterval(() => {}, 10_000);`,
  });
  const dirPath = String(dir);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--hot", "run", "script.ts"],
    cwd: dirPath,
    env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for READY — --hot initialized.
  let stdout = "";
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  while (!stdout.includes("READY")) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();

  // Keep writing sibling files in a tight outside-process loop. Each write
  // fires a directory-change inotify event, driving the watcher into
  // `bustDirCache` continuously. Doing this from a separate process means
  // the test runner's own event loop is not competing for cycles.
  await using writer = Bun.spawn({
    cmd: ["sh", "-c", `while true; do for i in $(seq 1 16); do echo x > "${dirPath}/sib$i.txt"; done; done`],
    stdout: "ignore",
    stderr: "ignore",
  });

  const exitCode = await Promise.race([proc.exited, Bun.sleep(4_000).then(() => null)]);
  writer.kill();
  const stderr = await proc.stderr.text();
  return { exitCode, signal: proc.signalCode, stderr };
}

const hasSh = (() => {
  try {
    return spawnSync({ cmd: ["sh", "-c", ":"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;
  } catch {
    return false;
  }
})();

test.skipIf(!isASAN || !hasSh)(
  "bun --hot exits cleanly while watcher is dispatching events",
  async () => {
    // At ~40% per-iteration failure rate without the fix, 25 iterations
    // give < 1e-5 probability of a false pass.
    for (let i = 0; i < 25; i++) {
      const { exitCode, signal, stderr } = await runOnce(i);
      if (
        exitCode !== 0 ||
        signal !== null ||
        stderr.includes("AddressSanitizer") ||
        stderr.includes("use-after-poison")
      ) {
        console.error(`iteration ${i} failed, exitCode=${exitCode}, signal=${signal}, stderr:\n${stderr}`);
      }
      expect(stderr).not.toContain("AddressSanitizer");
      expect(stderr).not.toContain("use-after-poison");
      expect(signal).not.toBe("SIGABRT");
      expect(exitCode).toBe(0);
    }
  },
  240_000,
);
