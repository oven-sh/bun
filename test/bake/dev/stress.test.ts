// Stress tests perform a large number of filesystem or network operations in a test.
// Run with DEV_SERVER_STRESS=FILTER to have the test run forever.
import { expect } from "bun:test";
import { devTest, minimalFramework } from "../bake-harness";

// https://github.com/oven-sh/bun/issues/18910
devTest("crash #18910", {
  files: {
    "index.html": `<script src="./b.js"></script>`,
    "b.js": ``,
  },
  async test(dev) {
    await using c = await dev.client('/', { allowUnlimitedReloads: true });

    const absPath = dev.join("b.js");

    await dev.stressTest(async() => {
      for (let i = 0; i < 100; i++) {
        await Bun.write(absPath, "let a = 0;");
        await Bun.sleep(2);
        await Bun.write(absPath, "// let a = 0;");
        await Bun.sleep(2);
      } 
    });

    await dev.write("b.js", "globalThis.a = 1;");
    expect(await c.js<number>`a`).toBe(1);
  },
});