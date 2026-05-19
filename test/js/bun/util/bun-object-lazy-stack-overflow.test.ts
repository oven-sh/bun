import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Lazy PropertyCallback initializers on the Bun object (e.g. Bun.$, Bun.SQL)
// call into JavaScript which can throw a RangeError when the stack is nearly
// exhausted. Previously the callback returned an empty JSValue on exception,
// which was passed to JSObject::putDirect and triggered a null JSCell deref.
test.concurrent.each(["$", "SQL", "sql", "postgres"])(
  "accessing Bun.%s for the first time near stack limit does not crash",
  async property => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `function f() { try { f(); } catch {} Bun[${JSON.stringify(property)}]; }
try { f(); } catch {}
console.log("OK");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("OK\n");
    expect(exitCode).toBe(0);
  },
);
