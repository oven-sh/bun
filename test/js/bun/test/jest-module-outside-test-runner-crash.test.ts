import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Reduced from a Fuzzilli-generated sample: create the lazy `Bun.jest()` test
// module and an `expect()` value outside of the test runner, poke at matchers
// with bogus receivers, then force a full GC. None of this should crash.
test("Bun.jest() and expect() outside of the test runner do not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const received = Bun.jest().expect();
      const hasAssertions = received?.hasAssertions;
      try { new hasAssertions(); } catch {}
      const toEndWith = received.toEndWith;
      try { toEndWith.call(toEndWith); } catch {}
      Bun.gc(true);
      console.log("ok");
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

// The lazy test module initializer must tolerate `Bun__Jest__createTestModuleObject`
// failing (it returns an empty JSValue with a pending exception). Calling
// `Bun.jest()` at maximum call depth is the historical way to make that happen.
test("Bun.jest() does not crash when called under stack pressure", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function F0() {
        const v = this.constructor;
        try { new v(); } catch {}
        try { Bun.jest(); } catch {}
      }
      try { new F0(); } catch {}
      console.log("ok:" + (typeof Bun.jest() === "object"));
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok:true");
  expect(exitCode).toBe(0);
});
