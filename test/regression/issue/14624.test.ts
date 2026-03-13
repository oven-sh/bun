import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("uncaught promise rejection in async test should not hang", async () => {
  using dir = tempDir("issue-14624", {
    "hang.test.js": `
      import { test } from 'bun:test'

      test('async test with uncaught rejection', async () => {
        console.log('test start');
        // This creates an unhandled promise rejection
        (async () => { throw new Error('uncaught error'); })();
        await Bun.sleep(1);
        console.log('test end');
      })
    `,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "test", "hang.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Set a timeout to detect if the process hangs
  let timeout = false;
  const timer = setTimeout(() => {
    timeout = true;
    proc.kill();
  }, 3000);

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  clearTimeout(timer);

  const output = stdout + stderr;

  expect(timeout).toBeFalse();
  expect(output).toContain("test start");
  // expect(output).toContain("test end"); // the process exits before this executes
  expect(output).toContain("uncaught error");
  expect(exitCode).not.toBe(0);
  expect(output).toMatch(/✗|\(fail\)/);
  expect(output).toMatch(/\n 1 fail/);
});
