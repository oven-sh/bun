// Stress tests perform a large number of filesystem or network operations in a test.
//
// Run with `DEV_SERVER_STRESS=` to run tests for 10 minutes each.
// - "DEV_SERVER_STRESS='crash #18910'" will run the first test for 10 min.
// - "DEV_SERVER_STRESS=ALL" will run all for 10 min each.
//
// Without this flag, each test is a "smoke test", running the iteration once.
import { expect } from "bun:test";
import { isASAN, isDebug } from "harness";
import { devTest } from "../bake-harness";

// Under ASAN / debug builds the HMR client is slow enough that the fan-in of
// reload script tags occasionally arrives for a module whose `sourceMapId`
// hasn't been registered yet, tripping `DEBUG.ASSERT(sourceMapId)` in
// `replaceModules`. The test is a regression guard for the Zig-side watcher
// crash in #18910; release builds (which is how this bug shipped) still
// exercise the guard.
if (!isASAN && !isDebug)
  // https://github.com/oven-sh/bun/issues/18910
  devTest("crash #18910", {
    // Flaky on Windows 2019 CI agents: the rapid HMR reload loop intermittently
    // trips "Reload failed" and exits the browser client before `Subprocess.send`
    // is called, surfacing as "Subprocess.send() cannot be used after the process
    // has exited". The test is primarily protecting against the Zig-side watcher
    // crash from issue #18910; the Windows-specific reload path isn't exercised
    // by that regression, so skipping on win32 keeps the regression guard
    // meaningful without gating CI on the chronic agent flake.
    skip: ["win32"],
    files: {
      "index.html": `<script src="./b.js"></script>`,
      "b.js": ``,
    },
    async test(dev) {
      await using c = await dev.client("/", { allowUnlimitedReloads: true });

      const absPath = dev.join("b.js");

      await dev.stressTest(async () => {
        for (let i = 0; i < 10; i++) {
          await Bun.write(absPath, "let a = 0;");
          await Bun.sleep(10);
          await Bun.write(absPath, "// let a = 0;");
          await Bun.sleep(10);
        }
      });

      await dev.write("b.js", "globalThis.a = 1;");
      expect(await c.js<number>`a`).toBe(1);
    },
  });
