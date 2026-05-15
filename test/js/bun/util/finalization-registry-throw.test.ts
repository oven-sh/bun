import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("throwing FinalizationRegistry callback does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        process.on("uncaughtException", e => {
          console.log("uncaught:" + e.message);
        });
        const fr = new FinalizationRegistry(() => {
          throw new TypeError("thrown from finalizer");
        });
        (function () {
          fr.register({}, "held");
        })();
        await new Promise(r => setTimeout(r, 1));
        Bun.gc(true);
        await new Promise(r => setTimeout(r, 1));
        Bun.gc(true);
        await new Promise(r => setTimeout(r, 1));
        console.log("done");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(exitCode).toBe(0);
  expect(stdout).toContain("uncaught:thrown from finalizer");
  expect(stdout).toContain("done");
});

test("FinalizationRegistry callback throwing without handler reports the error and exits non-zero", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const fr = new FinalizationRegistry(ArrayBuffer);
        (function () {
          fr.register({}, "held");
        })();
        await new Promise(r => setTimeout(r, 1));
        Bun.gc(true);
        await new Promise(r => setTimeout(r, 1));
        Bun.gc(true);
        await new Promise(r => setTimeout(r, 1));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("ASSERTION FAILED");
  expect(proc.signalCode).toBeNull();
  expect(stderr).toContain("calling ArrayBuffer constructor without new is invalid");
  expect(exitCode).toBe(1);
});
