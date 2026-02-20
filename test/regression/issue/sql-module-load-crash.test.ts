import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

// Regression test: Bun.sql property access should not crash when the SQL
// module fails to load (e.g. due to globalThis.Array being tampered with).
// The PropertyCallback for Bun.sql previously returned an empty JSValue on
// exception, which caused a null pointer dereference in JSC's property
// reification.

test("Bun.sql does not crash when globalThis.Array is undefined", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `
      const origArray = globalThis.Array;
      globalThis.Array = undefined;
      try {
        const s = Bun.sql;
      } catch(e) {}
      globalThis.Array = origArray;
      console.log("OK");
    `],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test("Bun.SQL does not crash when globalThis.Array is undefined", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `
      const origArray = globalThis.Array;
      globalThis.Array = undefined;
      try {
        const S = Bun.SQL;
      } catch(e) {}
      globalThis.Array = origArray;
      console.log("OK");
    `],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
