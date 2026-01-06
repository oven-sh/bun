import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("repeated dynamic imports of file with parse error should not hang (#23139)", async () => {
  using dir = tempDir("issue-23139", {
    "repro.js": /* js */ `
      try {
        console.log("begin import 1");
        await import("./invalid_code");
      } catch(e) {
        console.log("error 1");
      }
      try {
        console.log("begin import 2");
        await import("./invalid_code");
      } catch(e) {
        console.log("error 2");
      }
    `,
    "invalid_code": /* js */ `
      def hello():
        print("Hello from Python!")
        return "This is Python code"
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "repro.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = setTimeout(() => {
    proc.kill();
  }, 5000);

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  clearTimeout(timeout);

  // Should not hang - both imports should complete
  expect(stdout).toContain("begin import 1");
  expect(stdout).toContain("error 1");
  expect(stdout).toContain("begin import 2");
  expect(stdout).toContain("error 2");

  // Should exit cleanly
  expect(exitCode).toBe(0);
});
