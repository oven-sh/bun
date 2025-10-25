import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("child_process.unref() should allow parent to exit when IPC is established", async () => {
  using dir = tempDir("test-23686", {
    "parent.js": `
import {fork} from "node:child_process";

const child = fork("./child.js");

child.on('message', (msg) => {
  console.log(msg);
});

child.unref();
child.send('Hello from parent');
    `,
    "child.js": `
process.on('message', (msg) => {
  console.log(msg);
  process.send('Hello from child');
  process.disconnect();
});
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "parent.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Set a timeout to kill the process if it hangs
  const timeout = setTimeout(() => {
    proc.kill();
  }, 3000);

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  clearTimeout(timeout);

  // The parent should exit cleanly, not hang
  expect(exitCode).toBe(0);

  // We should see both messages
  expect(stdout).toContain("Hello from parent");
  expect(stdout).toContain("Hello from child");

  // No errors
  expect(stderr).toBe("");
}, 5000);
