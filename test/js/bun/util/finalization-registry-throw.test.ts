import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A FinalizationRegistry cleanup callback that throws (e.g. a native
// constructor called without `new`) must not crash the process. The
// exception should surface as an uncaughtException, matching Node.js.
test("FinalizationRegistry cleanup callback that throws reports uncaughtException instead of crashing", async () => {
  const src = `
    let caught;
    process.on("uncaughtException", e => { caught = e; });
    const reg = new FinalizationRegistry(ArrayBuffer);
    (() => { reg.register({}, "held"); })();
    for (let i = 0; !caught && i < 200; i++) {
      Bun.gc(true);
      await new Promise(r => setImmediate(r));
    }
    if (!(caught instanceof TypeError)) {
      console.error("cleanup callback error was not delivered");
      process.exit(1);
    }
    process.stdout.write("ok");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("ok");
  expect(exitCode).toBe(0);
});
