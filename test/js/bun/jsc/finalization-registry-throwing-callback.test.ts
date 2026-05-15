import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Exceptions thrown from a FinalizationRegistry cleanup callback are delivered
// to the deferred work task runner. Bun's override of that runner did not clear
// the pending exception, tripping `releaseAssertNoException()` in debug builds.

test("FinalizationRegistry cleanup callback that throws does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let caught = false;
        process.on("uncaughtException", e => { caught ||= e instanceof TypeError; });
        const fr = new FinalizationRegistry(ArrayBuffer);
        for (let i = 0; i < 100; i++) fr.register({}, i);
        Bun.gc(true);
        const iv = setInterval(() => {
          Bun.gc(true);
          if (caught) {
            clearInterval(iv);
            console.log("CAUGHT");
          }
        }, 10);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("CAUGHT");
  expect(exitCode).toBe(0);
});
