import { test } from "bun:test";
import { expectRssDeltaBelow } from "harness";

// A spy that is garbage collected without mockRestore() must release what it
// holds on its target: a JSC::Weak handle and a ref on the property name atom.
// The name is 256 KiB and unique per spy so a leaked ref shows up in RSS.
test.concurrent("spyOn does not leak the target handle and property name of a collected spy", async () => {
  const code = /* js */ `
    const { spyOn } = require("bun:test");
    const base = Buffer.alloc(256 * 1024, "a").toString();
    function spy(i) {
      const name = base + i;
      const target = { [name]() {} };
      spyOn(target, name);
    }
    for (let i = 0; i < 20; i++) spy(i);
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    for (let i = 20; i < 420; i++) spy(i);
    Bun.gc(true);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
  `;

  // Unfixed: ~100 MiB (400 names of 256 KiB). Fixed: allocator slack only.
  await expectRssDeltaBelow(["--smol", "-e", code], { release: 40, debug: 55 });
});
