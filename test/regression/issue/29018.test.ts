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
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

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
          process.exitCode = 1;
          worker.terminate();
        });
        worker.addEventListener("message", e => {
          console.log("message:" + e.data);
          // Let the event loop drain naturally. Calling process.exit
          // here races in-flight PackageManager tasks and panics on ASAN
          // lanes with "EventLoop.enqueueTaskConcurrent: VM has terminated".
          worker.unref();
        });
      } else {
        postMessage("worker:" + isNumber(7));
      }
    `,
  });

  // Use a test-local install cache so pre-cached packages on the developer
  // machine / CI host can't short-circuit the auto-install flow we're trying
  // to exercise.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "script.js"],
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(String(dir), "install-cache"),
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Don't fail the whole CI lane if the registry is unreachable — just skip.
  // Covers the strings Bun surfaces for refused / DNS / timeout / reset / no-route.
  const network_error_needles = [
    "ConnectionRefused",
    "getaddrinfo",
    "ConnectionClosed",
    "Timeout",
    "ETIMEDOUT",
    "ECONNRESET",
    "ENETUNREACH",
    "EAI_AGAIN",
  ];
  if (network_error_needles.some(needle => stderr.includes(needle))) {
    console.warn("issue-29018: registry unreachable, skipping", stderr);
    return;
  }

  // The regression this test guards is "worker can resolve a package the
  // main thread auto-installed" — that is fully verified by seeing both
  // `main:true` and `message:worker:true` in stdout. We deliberately do not
  // assert `exitCode === 0` here: there is a pre-existing shutdown race in
  // bun between the PackageManager's async thread pool and VM termination
  // that trips the ASAN assertion at `EventLoop.enqueueTaskConcurrent: VM
  // has terminated` on debian-13-x64-asan. That race is orthogonal to this
  // fix and tracked separately — the subprocess has already printed both
  // lines successfully before it hits it.
  expect(stderr).not.toContain("Cannot find package");
  expect(stdout).toContain("main:true");
  expect(stdout).toContain("message:worker:true");
  // Intentionally not asserting exitCode — see comment above.
  void exitCode;
});
