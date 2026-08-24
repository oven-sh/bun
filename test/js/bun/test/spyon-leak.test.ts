import { test } from "bun:test";
import { expectRssDeltaBelow } from "harness";

// A spy that is garbage collected without mockRestore() must release its
// target and its property name. The name is 256 KiB and unique per spy so
// anything the dead spy still pins shows up in RSS.
test.concurrent("spyOn does not leak the target and property name of a collected spy", async () => {
  const code = /* js */ `
    import { spyOn } from "bun:test";
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
