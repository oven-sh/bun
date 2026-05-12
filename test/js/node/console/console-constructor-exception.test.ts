import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("console.Console getter", () => {
  test("handles exception from internal call without crashing", async () => {
    // When the stack is nearly exhausted, accessing console.Console triggers
    // profiledCall to createConsoleConstructor, which throws StackOverflow.
    // The C++ getter must return early after throwException, not continue
    // to putDirect with an invalid result.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // Exhaust most of the stack, then try to access console.Console
        // createConsoleConstructor needs significant stack space (require calls etc.)
        function exhaust() {
          try {
            exhaust();
          } catch (e) {
            // Near the stack limit - this access should throw cleanly, not crash
            try {
              void console.Console;
            } catch (e2) {
              // Expected: stack overflow, not a crash
            }
          }
        }
        exhaust();

        // After stack recovery, console.Console should still work
        const C = console.Console;
        if (typeof C !== "function") {
          process.exit(1);
        }
        console.log("OK");
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("Segmentation fault");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });
});
