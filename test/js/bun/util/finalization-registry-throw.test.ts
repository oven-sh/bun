import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When a FinalizationRegistry cleanup callback throws, the exception should be
// reported as an uncaught exception rather than crashing the process with
// "Unexpected exception observed" from releaseAssertNoException().
test("FinalizationRegistry cleanup callback throwing does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let caught = 0;
        process.on("uncaughtException", () => { caught++; });
        const registry = new FinalizationRegistry(() => { throw new Error("boom"); });
        (function () {
          for (let i = 0; i < 200; i++) registry.register({}, i);
        })();
        for (let i = 0; i < 5; i++) {
          Bun.gc(true);
          await new Promise(r => setTimeout(r, 5));
        }
        console.log("caught=" + caught);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(stderr).not.toContain("Unexpected exception");
  expect(exitCode).toBe(0);
  expect(stdout).toContain("caught=");
});

test("FinalizationRegistry with non-constructor callback does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        process.on("uncaughtException", () => {});
        const registry = new FinalizationRegistry(ArrayBuffer);
        (function () {
          for (let i = 0; i < 200; i++) registry.register({}, i);
        })();
        for (let i = 0; i < 5; i++) {
          Bun.gc(true);
          await new Promise(r => setTimeout(r, 5));
        }
        console.log("done");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(stderr).not.toContain("Unexpected exception");
  expect(exitCode).toBe(0);
  expect(stdout).toContain("done");
});
