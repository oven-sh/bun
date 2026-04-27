import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: Bun.sql / Bun.SQL property access should not crash when
// the SQL module fails to load (e.g. due to globalThis.Array being tampered
// with). The PropertyCallback previously returned an empty JSValue on
// exception, which caused a null pointer dereference in JSC's property
// reification.
//
// `Bun.sql` and `Bun.SQL` are distinct properties backed by separate
// PropertyCallback functions (defaultBunSQLObject / constructBunSQLObject),
// so both must be exercised.

test.each(["sql", "SQL"] as const)("Bun.%s does not crash when globalThis.Array is undefined", async prop => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const origArray = globalThis.Array;
      globalThis.Array = undefined;
      try {
        void Bun.${prop};
      } catch {}
      globalThis.Array = origArray;
      console.log("OK");
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect(exitCode).toBe(0);
});
