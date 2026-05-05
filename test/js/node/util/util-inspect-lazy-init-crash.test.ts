import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Loading node:util inside the util.inspect LazyProperty initializer can throw if user
// code has broken globals (e.g. deleted Symbol.for). Previously this tripped a
// RELEASE_ASSERT in JSC::LazyProperty because the initializer returned without calling
// init.set(). It should now surface as a catchable JS error instead of aborting.
//
// Kept in its own file because bun-inspect.test.ts has pre-existing debug-build stack-depth
// failures in the "depth = Infinity" tests that are unrelated to this change.
test("util.inspect lazy init failure does not crash", () => {
  const { exitCode, signalCode } = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `
        delete Symbol.for;
        const bc = new BroadcastChannel("x");
        let threw = false;
        try {
          console.log(bc);
        } catch (e) {
          threw = e instanceof TypeError;
        }
        // Second attempt should not crash either (lazy slot is now permanently null).
        try { console.log(bc); } catch {}
        // And neither should the colors path which goes through utilInspectStylizeColorFunction.
        const obj = { [Bun.inspect.custom]() { return "x"; } };
        try { Bun.inspect(obj, { colors: true }); } catch {}
        try { Bun.inspect(obj, { colors: true }); } catch {}
        bc.close();
        if (!threw) throw new Error("expected TypeError");
        process.exit(0);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(signalCode).toBeUndefined();
  expect(exitCode).toBe(0);
});
