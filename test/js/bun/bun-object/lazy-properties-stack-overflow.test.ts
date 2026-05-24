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
      // Only the getters exercised by the fix are probed at depth; touching
      // every Bun property with almost no stack left can hit unrelated native
      // stack overflows (notably on Windows, where some getters use large
      // stack buffers).
      `const probed = ["$", "sql", "semver", "unsafe", "inspect", "SHA1"];
let remaining = -1;
function rec() {
  try { rec(); } catch (e) { if (remaining === -1) remaining = 50; }
  if (remaining > 0) {
    remaining--;
    for (const name of probed) {
      try { Bun[name]; } catch (e) {}
    }
  }
}
rec();
for (const name of Object.getOwnPropertyNames(Bun)) typeof Bun[name];
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
