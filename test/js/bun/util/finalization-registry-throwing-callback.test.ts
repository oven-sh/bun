import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("FinalizationRegistry callback that throws does not crash the process", async () => {
  // A FinalizationRegistry cleanup callback runs from a JSC DeferredWorkTimer
  // task. If the callback throws, the exception must be reported as an
  // uncaught exception rather than leaking past the task runner (which would
  // trip an exception-scope assertion in debug builds).
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const fr = new FinalizationRegistry(ArrayBuffer);
        (() => { fr.register({}, "held"); })();
        Bun.gc(true);
        setImmediate(() => {});
      `,
    ],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });

  const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(err).not.toContain("ASSERTION");
  expect(err).toContain("calling ArrayBuffer constructor without new is invalid");
  expect(exitCode).toBeLessThan(128);
});

test("FinalizationRegistry callback that throws is catchable via uncaughtException", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        process.on("uncaughtException", (err) => {
          console.log("caught:" + err.message);
        });
        const fr = new FinalizationRegistry(() => { throw new Error("boom"); });
        (() => { fr.register({}, 1); })();
        Bun.gc(true);
        setImmediate(() => {});
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).toBe("");
  expect(out).toContain("caught:boom");
  expect(exitCode).toBe(0);
});
