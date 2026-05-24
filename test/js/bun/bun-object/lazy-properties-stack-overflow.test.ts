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

// A lazy getter that throws a real error (here: an invalid REDIS_URL) used to
// cache an empty JSValue, so the second access crashed. The first access must
// still report the error and later accesses must see undefined.
test("a throwing lazy Bun property getter reports the error and does not corrupt the property", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let message = "";
try {
  Bun.redis;
} catch (e) {
  message = String(e?.message ?? e);
}
if (!/invalid url/i.test(message)) throw new Error("expected an invalid URL error, got: " + JSON.stringify(message));
if (typeof Bun.redis !== "undefined") throw new Error("expected Bun.redis to be undefined after failed initialization");
console.log("OK");`,
    ],
    env: { ...bunEnv, REDIS_URL: "not a url", VALKEY_URL: "not a url" },
    stderr: "ignore",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("OK");
  expect(exitCode).toBe(0);
});
