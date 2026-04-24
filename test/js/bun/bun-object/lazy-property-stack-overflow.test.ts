import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

// Lazily-initialized properties on the Bun object (PropertyCallback in the
// static hash table) run arbitrary code on first access. If that code throws
// (e.g. RangeError from stack exhaustion), the callback must still return a
// valid JSValue so that reifyStaticProperty does not pass an empty value to
// putDirect.
test.each(["sql", "SQL", "$", "Glob"])(
  "accessing Bun.%s near stack overflow does not crash",
  async prop => {
    const src = `
      function F() {
        try { new this.constructor(); } catch {}
        Bun[${JSON.stringify(prop)}];
      }
      try { new F(); } catch {}
      process.exitCode = 0;
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await proc.exited;
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  },
);
