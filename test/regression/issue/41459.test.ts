import { test } from "bun:test";
import { expectRssDeltaBelow, isASAN, isWindows } from "harness";

// https://github.com/oven-sh/bun/issues/41459
// Each WebAssembly.Memory reserves 4 GiB of address space (Wasm fast memory).
// JSC takes that reservation from mimalloc, which placed every one at a new
// address, and each new address cost a 4 KiB page-map entry that was never
// freed. JSC turns fast memory off under ASAN and on Windows, so the leak
// cannot show there.
test.skipIf(isWindows || isASAN)("WebAssembly.Memory does not leak RSS once collected", async () => {
  const code = /* js */ `
    function churn(n) {
      for (let i = 0; i < n; i++) new WebAssembly.Memory({ initial: 1 });
    }
    churn(500);
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    churn(4000);
    Bun.gc(true);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
  `;

  // Unfixed: about 4 KiB per memory, 15 to 18 MiB for 4000. Fixed: 2 to 4 MiB.
  // The child runs in about 1 s on a release build.
  await expectRssDeltaBelow(["--smol", "-e", code], { release: 8, debug: 8 });
});
