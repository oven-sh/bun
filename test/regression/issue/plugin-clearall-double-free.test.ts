import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Tests that Bun.plugin.clearAll() doesn't cause a double-free when the
// process exits. Previously, `delete virtualModules` in clearAll didn't
// set the pointer to nullptr, so the OnLoad destructor would delete it
// again during VM destruction.
test("Bun.plugin.clearAll() after registering virtual module does not double-free", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      Bun.plugin({
        name: "test-virtual-module",
        setup(build) {
          build.module("virtual-test", () => {
            return { contents: "export default 42;", loader: "js" };
          });
        },
      });

      Bun.plugin.clearAll();
      console.log("OK");
      `,
    ],
    env: {
      ...bunEnv,
      // Enable VM destruction on exit so the OnLoad destructor runs,
      // which would trigger the double-free without the fix.
      BUN_DESTRUCT_VM_ON_EXIT: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(stderr).not.toContain("double-free");
  expect(stderr).not.toContain("AddressSanitizer");
  expect(stderr).not.toContain("pas panic");
  expect(exitCode).toBe(0);
});
