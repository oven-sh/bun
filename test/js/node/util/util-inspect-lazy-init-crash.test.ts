import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Loading node:util inside the util.inspect LazyProperty initializer can throw if user
// code has broken globals (e.g. deleted Symbol.for). Previously this tripped a
// RELEASE_ASSERT in JSC::LazyProperty because the initializer returned without calling
// init.set(). It should now surface as a catchable JS error instead of aborting.
test("util.inspect lazy init failure does not crash", () => {
  const { exitCode, signalCode, stderr } = Bun.spawnSync({
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
  expect(stderr.toString()).not.toContain("ASSERTION FAILED");
  expect(exitCode).toBe(0);
});
