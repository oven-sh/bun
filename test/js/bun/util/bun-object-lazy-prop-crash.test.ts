import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for null pointer dereference in reifyStaticProperty.
// When a lazy PropertyCallback getter on the Bun object returns an empty
// JSValue (due to an error in the Zig callback), reifyStaticProperty
// passes it to putDirect which calls isGetterSetter() on a null JSCell.
// The fix converts empty return values to jsUndefined() and clears the
// pending exception in the DEFINE_ZIG_BUN_OBJECT_GETTER_WRAPPER macro.

test("lazy BunObject getter returning empty value does not crash", async () => {
  // Bun.redis is a lazy PropertyCallback. When REDIS_URL contains an
  // unsupported protocol, the Zig getter throws an error and returns
  // .zero (empty JSValue). Without the fix, this crashes in
  // reifyStaticProperty -> putDirect -> isGetterSetter with a null
  // pointer dereference on JSCell.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      'try { Bun.redis } catch {} console.log("OK")',
    ],
    env: { ...bunEnv, REDIS_URL: "notavalidprotocol://x" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
