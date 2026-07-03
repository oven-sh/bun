import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A broken `Buffer.from` builtin aborts the whole process, so this has to be a
// spawned fixture: an in-process test in buffer.test.js would take the test
// runner down with it and never get reported as a failure.
test("Buffer.from honors a Symbol.toPrimitive accessor", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const value = {};
       Object.defineProperty(value, Symbol.toPrimitive, { get: () => () => "via getter" });
       console.log(Buffer.from(value).toString(), Buffer.from(value).equals(Buffer.from("via getter")));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    expect(stderr).toBe("");
  }
  expect({ stdout, exitCode }).toEqual({ stdout: "via getter true\n", exitCode: 0 });
});
