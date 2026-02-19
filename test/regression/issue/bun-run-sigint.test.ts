import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";

// Test that bun run forwards SIGINT to child and waits for graceful exit.
// On POSIX: process.kill sends a real signal that triggers handlers.
// On Windows: process.kill uses TerminateProcess, so this test is skipped.
// The Windows fix (console control handler) requires manual testing.
test.skipIf(isWindows)("bun run forwards SIGINT to child and waits for graceful exit", async () => {
  const dir = tempDirWithFiles("sigint-forward", {
    "server.js": `
console.log("ready");
process.on("SIGINT", () => {
  console.log("received SIGINT");
  process.exit(42);
});
setTimeout(() => {}, 999999);
`,
    "package.json": JSON.stringify({
      name: "sigint-forward",
      scripts: { start: "bun server.js" },
    }),
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "run", "start"],
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // Wait for ready
  const reader = proc.stdout.getReader();
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toContain("ready");

  // Send SIGINT
  process.kill(proc.pid, "SIGINT");

  // Collect remaining output
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += new TextDecoder().decode(value);
  }

  const exitCode = await proc.exited;

  expect(output).toContain("received SIGINT");
  expect(exitCode).toBe(42);
});
