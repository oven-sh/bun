// https://github.com/oven-sh/bun/issues/29018
//
// Auto-install in a Worker thread used to fail with
//   "Cannot find package 'X' from '<script>'"
// because the worker's resolver did not inherit `global_cache` (and
// related install settings) from the parent VM. The worker's resolver
// defaulted to `global_cache = .disable`, which made `usePackageManager()`
// return false and short-circuit the resolve with "Cannot find package".
//
// This test spins up a bun process with an auto-installable entry point,
// creates a Worker from it, and asserts that both threads import the
// package successfully.
import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("auto-install works inside a Worker thread", async () => {
  using dir = tempDir("issue-29018", {
    // No package.json, no node_modules — force auto-install.
    "script.js": /* js */ `
      import isNumber from "is-number";

      if (Bun.isMainThread) {
        console.log("main:" + isNumber(42));
        const worker = new Worker(import.meta.url);
        worker.addEventListener("error", e => {
          console.error("worker-error:" + (e.message ?? String(e)));
          process.exit(1);
        });
        worker.addEventListener("message", e => {
          console.log("message:" + e.data);
          worker.terminate();
          process.exit(0);
        });
      } else {
        postMessage("worker:" + isNumber(7));
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "script.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Don't fail the whole CI lane if the registry is unreachable — just skip.
  if (stderr.includes("ConnectionRefused") || stderr.includes("getaddrinfo")) {
    console.warn("issue-29018: registry unreachable, skipping", stderr);
    return;
  }

  expect(stderr).not.toContain("Cannot find package");
  expect(stdout).toContain("main:true");
  expect(stdout).toContain("message:worker:true");
  expect(exitCode).toBe(0);
});
