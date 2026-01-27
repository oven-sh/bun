import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26239
// process.exit() in a worker should immediately stop JavaScript execution
test("process.exit() in worker stops execution immediately", async () => {
  using dir = tempDir("issue-26239", {
    "worker_exit.js": `
import { Worker, isMainThread } from "node:worker_threads";

if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  worker.on("exit", (code) => process.exit(code ?? 0));
} else {
  console.log("before exit");
  process.exit(0);
  console.log("after exit");  // This should NOT be printed
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "worker_exit.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // "after exit" should NOT appear in the output - the bug was that JS continued executing
  expect(stdout).toContain("before exit");
  expect(stdout).not.toContain("after exit");
  expect(exitCode).toBe(0);
});
