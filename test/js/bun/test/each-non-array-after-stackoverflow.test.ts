import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression: calling .each() with a non-array object argument after catching
// a stack overflow would crash due to ConsoleObject.Formatter making JSC calls
// that trigger another stack overflow with an unchecked exception scope.
test("describe.each with non-array after caught stack overflow does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      var recovered = false;
      function F0() {
        if (!new.target) throw 'must be called with new';
        try { new F0(); } catch (e) { recovered = true; }
        if (recovered) {
          recovered = false;
          try { Bun.jest().xdescribe.each({}); } catch(e) { console.log(e.message); }
        }
      }
      new F0();
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("Expected array, got FinalObject");
  expect(exitCode).toBe(0);
});
