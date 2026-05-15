import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("FinalizationRegistry cleanup callback that throws is reported as uncaught, not a crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let done = false;
        const sentinel = new FinalizationRegistry(() => { done = true; });
        const registry = new FinalizationRegistry(ArrayBuffer);
        (function () {
          for (let i = 0; i < 128; i++) {
            registry.register({}, i);
            sentinel.register({}, i);
          }
        })();
        while (!done) {
          Bun.gc(true);
          await new Promise(resolve => setImmediate(resolve));
        }
      `,
    ],
    env: bunEnv,
    stdout: "inherit",
    stderr: "pipe",
  });

  const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(proc.signalCode).toBeNull();
  expect([0, 1]).toContain(exitCode);
  expect(err).toContain("calling ArrayBuffer constructor without new is invalid");
});

test("FinalizationRegistry cleanup callback exception reaches process.on('uncaughtException')", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let caught = false;
        process.on("uncaughtException", err => {
          if (String(err).includes("boom")) caught = true;
        });
        const registry = new FinalizationRegistry(() => { throw new Error("boom"); });
        (function () {
          for (let i = 0; i < 128; i++) registry.register({}, i);
        })();
        while (!caught) {
          Bun.gc(true);
          await new Promise(resolve => setImmediate(resolve));
        }
        console.log("caught");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [out, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
  expect(out.trim()).toBe("caught");
});
