import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://bugs.webkit.org/show_bug.cgi?id=293319
// AbortController.signal.reason is lost after garbage collection
describe("AbortController GC", () => {
  test("signal.reason survives GC when only controller is retained", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          function createAbortedController(message) {
            const controller = new AbortController();
            controller.abort(new Error(message));
            return controller;
          }

          const errorMessage = "my potato";
          const controller = createAbortedController(errorMessage);

          // Force GC multiple times to trigger collection of signal.reason
          // if it's not properly marked by JSAbortController::visitChildren
          for (let i = 0; i < 10; i++) {
            Bun.gc(true);
          }

          if (controller.signal.reason?.message !== errorMessage) {
            console.error("FAIL: reason was", controller.signal.reason);
            process.exit(1);
          }
          console.log("PASS");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("PASS");
    expect(exitCode).toBe(0);
  });

  test("signal.reason survives GC with many controllers", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const controllers = [];
          for (let i = 0; i < 100; i++) {
            const c = new AbortController();
            c.abort({ index: i, data: "x".repeat(100) });
            controllers.push(c);
          }

          for (let i = 0; i < 10; i++) {
            Bun.gc(true);
          }

          for (let i = 0; i < 100; i++) {
            const reason = controllers[i].signal.reason;
            if (!reason || reason.index !== i) {
              console.error("FAIL at index", i, "reason:", reason);
              process.exit(1);
            }
          }
          console.log("PASS");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("PASS");
    expect(exitCode).toBe(0);
  });
});
