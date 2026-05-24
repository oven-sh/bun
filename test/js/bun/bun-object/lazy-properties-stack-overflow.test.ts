import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Reifying a lazy property of the Bun object (e.g. Bun.$, Bun.sql) while the
// stack is nearly exhausted used to cache an empty JSValue and leave the stack
// overflow exception pending, crashing the process.
test("accessing Bun's lazy properties near stack exhaustion does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const names = Object.getOwnPropertyNames(Bun);
let remaining = -1;
function rec() {
  try { rec(); } catch (e) { if (remaining === -1) remaining = 50; }
  if (remaining > 0) {
    remaining--;
    for (const name of names) {
      try { Bun[name]; } catch (e) {}
    }
  }
}
rec();
for (const name of names) typeof Bun[name];
console.log("OK");`,
    ],
    env: bunEnv,
    stderr: "ignore",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("OK");
  expect(exitCode).toBe(0);
});
