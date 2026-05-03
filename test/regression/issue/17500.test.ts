import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.spawn with bash -ci does not hang or stop the process", async () => {
  // Spawn a bun process that runs bash -ci multiple times.
  // Before the fix, the parent bun process could be stopped by SIGTTIN/SIGTTOU
  // when bash -ci takes foreground control of the terminal via tcsetpgrp().
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      for (let i = 0; i < 3; i++) {
        const child = Bun.spawn(["bash", "-ci", "echo iteration" + i], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        console.log(stdout.trim());
      }
      console.log("done");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timeout = false;
  const timer = setTimeout(() => {
    timeout = true;
    proc.kill();
  }, 10000);

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  clearTimeout(timer);

  expect(timeout).toBeFalse();
  expect(stdout).toContain("iteration0");
  expect(stdout).toContain("iteration1");
  expect(stdout).toContain("iteration2");
  expect(stdout).toContain("done");
  expect(exitCode).toBe(0);
});

test("SIGTTIN and SIGTTOU signals do not stop the process", async () => {
  // Verify that Bun ignores SIGTTIN and SIGTTOU by sending them to itself.
  // Before the fix, these signals would use the default handler (stop the process).
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const os = require("os");
      // Send SIGTTIN to self - should be ignored
      process.kill(process.pid, os.constants.signals.SIGTTIN);
      // Send SIGTTOU to self - should be ignored
      process.kill(process.pid, os.constants.signals.SIGTTOU);
      // If we reach here, the signals were properly ignored
      console.log("signals ignored successfully");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timeout = false;
  const timer = setTimeout(() => {
    timeout = true;
    proc.kill();
  }, 5000);

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  clearTimeout(timer);

  expect(timeout).toBeFalse();
  expect(stdout.trim()).toBe("signals ignored successfully");
  expect(exitCode).toBe(0);
});
