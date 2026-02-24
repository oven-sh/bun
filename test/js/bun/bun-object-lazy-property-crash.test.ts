import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Test that accessing Bun lazy properties during a stack overflow doesn't crash.
// The Zig-backed PropertyCallback wrappers must return jsUndefined() instead of
// an empty JSValue (0x0) when the callback throws, because reifyStaticProperty
// passes the result to putDirect() which calls isGetterSetter() on it, causing
// a null pointer dereference on the empty value.
test("accessing Zig-backed Bun lazy properties during stack overflow does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      // Trigger a stack overflow while accessing Zig-backed lazy properties on Bun.
      // If the PropertyCallback wrapper doesn't guard against empty JSValues,
      // this will crash with a null pointer dereference in isGetterSetter().
      const v2 = { maxByteLength: 875 };
      const v4 = new ArrayBuffer(875, v2);
      try { v4.resize(875); } catch(e) {}
      new BigUint64Array(v4);

      function F8(a10, a11, a12, a13) {
        if (!new.target) { throw 'must be called with new'; }
        const v14 = this?.constructor;
        try { new v14(a12, v4, v2, v2); } catch(e) {}
        // Access Zig-backed lazy properties (not the C++ ones like Bun.$)
        Bun.semver;
        Bun.inspect;
        Bun.unsafe;
      }
      try {
        new F8(F8, v4, v2, BigUint64Array);
      } catch(e) {}
      Bun.gc(true);
      console.log("OK");
      `,
    ],
    env: bunEnv,
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
