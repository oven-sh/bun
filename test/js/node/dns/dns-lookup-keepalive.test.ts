import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("expect dns.lookup to keep the process alive", () => {
  expect([join(import.meta.dir, "dns-fixture.js")]).toRun();
});

// The callback used to run inside lookup()'s `.then`, whose chained `.catch`
// re-invoked it with the callback's own exception as the lookup error.
test("dns.lookup invokes its callback exactly once when the callback throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let calls = 0;
      process.on("uncaughtException", () => {});
      require("dns").lookup("localhost", err => {
        calls++;
        if (calls === 1) {
          if (err) throw new Error("localhost did not resolve: " + err.code);
          // setImmediate runs after every microtask + nextTick the first
          // invocation can schedule, so it observes any second invocation.
          setImmediate(() => console.log("calls=" + calls));
          throw new Error("boom from the lookup callback");
        }
      });`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "calls=1\n", exitCode: 0 });
});
