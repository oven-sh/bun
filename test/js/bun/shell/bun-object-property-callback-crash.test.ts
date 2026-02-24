import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: PropertyCallback handlers on the Bun object must not crash
// when an exception occurs during lazy property initialization.
// JSC's reifyStaticProperty passes the callback result directly to putDirect(),
// which calls isGetterSetter() on the value. An empty JSValue (encoded as 0)
// passes isCell() but asCell() returns null, causing a null pointer dereference.

test("accessing Bun.sql with tampered Array does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      globalThis.Array = undefined;
      try { Bun.sql; } catch(e) {}
      try { Bun.SQL; } catch(e) {}
      try { Bun.postgres; } catch(e) {}
      Bun.gc(true);
      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test("accessing Bun.$ during stack overflow does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function overflow() { overflow(); }
      try { overflow(); } catch(e) {}
      try { Bun.$; } catch(e) {}
      Bun.gc(true);
      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
