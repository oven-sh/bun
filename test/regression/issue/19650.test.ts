import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Several lazy PropertyCallback entries on the Bun object (Bun.$, Bun.sql,
// Bun.SQL, ...) run JS on first access. If that JS throws (e.g. a stack
// overflow), the callback previously returned an empty JSValue, which JSC's
// reifyStaticProperty passes straight to putDirect without an exception
// check, crashing on a null JSCell dereference.
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
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await proc.exited;
    expect(proc.signalCode).toBeNull();
    expect([0, 1]).toContain(exitCode);
  },
);

test.concurrent.each(["$", "sql", "SQL", "postgres"] as const)(
  "accessing Bun.%s after clobbering Symbol does not crash",
  async key => {
    const src = `
      globalThis.Symbol = NaN;
      try { Bun[${JSON.stringify(key)}]; } catch {}
      try { Bun[${JSON.stringify(key)}]; } catch {}
      Bun.gc(true);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await proc.exited;
    expect(proc.signalCode).toBeNull();
    expect([0, 1]).toContain(exitCode);
  },
);
