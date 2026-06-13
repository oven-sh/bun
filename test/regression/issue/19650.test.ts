import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Several lazy PropertyCallback entries on the Bun object (Bun.$, Bun.sql,
// Bun.SQL, ...) run JS on first access. If that JS throws (e.g. a stack
// overflow), the callback previously returned an empty JSValue, which JSC's
// reifyStaticProperty passes straight to putDirect without an exception
// check, crashing on a null JSCell dereference.
//
// Each subprocess must write "OK" to stdout after the pathological access
// pattern completes. Without the fix, release builds segfault and ASAN/UBSan
// builds abort on a null-pointer member call, so "OK" is never written.
test.concurrent.each(["$", "sql", "SQL", "postgres"] as const)(
  "accessing Bun.%s near stack overflow does not crash",
  async key => {
    const src = `
      function F() {
        try { new F(); } catch {}
        Bun[${JSON.stringify(key)}];
      }
      try { new F(); } catch {}
      Bun.gc(true);
      process.stdout.write("OK");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout, signalCode: proc.signalCode }).toEqual({ stdout: "OK", signalCode: null });
    expect([0, 1]).toContain(exitCode);
  },
);

test.concurrent.each(["$", "sql", "SQL", "postgres"] as const)(
  "accessing Bun.%s after clobbering Symbol does not crash",
  async key => {
    // process.stdout is lazily initialized via internal:primordials which
    // reads globalThis.Symbol, so take a reference before clobbering it.
    const src = `
      const stdout = process.stdout;
      globalThis.Symbol = NaN;
      try { Bun[${JSON.stringify(key)}]; } catch {}
      try { Bun[${JSON.stringify(key)}]; } catch {}
      Bun.gc(true);
      stdout.write("OK");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout, signalCode: proc.signalCode }).toEqual({ stdout: "OK", signalCode: null });
    expect([0, 1]).toContain(exitCode);
  },
);

// Bun.redis is a Zig-backed lazy PropertyCallback whose init reads REDIS_URL
// and throws a plain TypeError for an empty/invalid value. Same crash path
// as above; additionally verify the diagnostic isn't silently swallowed.
test.concurrent("accessing Bun.redis with invalid REDIS_URL does not crash and reports the error", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", 'process.stdout.write(String(Bun.redis)); process.stdout.write("OK")'],
    env: { ...bunEnv, REDIS_URL: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, signalCode: proc.signalCode }).toEqual({ stdout: "undefinedOK", signalCode: null });
  expect(stderr).toContain("Invalid URL");
  expect([0, 1]).toContain(exitCode);
});
