import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: formatting an Expect object whose prototype has been
// replaced with a Proxy should not crash when toBe() fails and the error
// message formatter walks the prototype chain.
test("expect error formatting does not crash with Proxy prototype", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const v1 = Bun.jest();
const v2 = v1.expect(v1);
Object.setPrototypeOf(v2, new Proxy(Object.getPrototypeOf(v2), {}));
try { v2.toBe(v2); } catch (e) {}
console.log("OK");`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});
