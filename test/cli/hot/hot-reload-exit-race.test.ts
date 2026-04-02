import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression: under ASAN, `Global.exit` runs mimalloc's atexit handler which
// poisons freed memory. The file watcher thread was not stopped first, so its
// next `bustDirCache` call would touch the resolver's BSSMap singleton after
// the memory was poisoned, tripping use-after-poison. Non-ASAN builds don't
// exhibit the crash but the test is still a useful shutdown smoke test.
test("bun --hot exits cleanly while watcher is dispatching events", async () => {
  using dir = tempDir("hot-exit-race", {
    "script.ts": `setTimeout(() => process.exit(0), 300); console.log("READY");\n`,
  });
  const scriptPath = `${String(dir)}/script.ts`;

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
  while (!stdout.includes("READY")) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += new TextDecoder().decode(value);
  }
  reader.releaseLock();

  // Rewrite the file in a tight loop to keep the watcher thread busy
  // dispatching events across the entire lifetime of the 300ms timer.
  // This widens the window where the main thread calls `Global.exit` while
  // the watcher thread is still inside `bustDirCache`.
  const rewrites = (async () => {
    for (let i = 0; i < 500; i++) {
      await Bun.write(scriptPath, `setTimeout(() => process.exit(0), 300); console.log("READY"); // ${i}\n`);
      if ((await Promise.race([proc.exited, Promise.resolve("alive")])) !== "alive") break;
    }
  })();

  const [exitCode, stderr] = await Promise.all([proc.exited, proc.stderr.text()]);
  await rewrites;

  expect(stderr).not.toContain("AddressSanitizer");
  expect(stderr).not.toContain("use-after-poison");
  // 134 == 128 + SIGABRT; ASAN aborts with that.
  expect(exitCode).toBe(0);
});
