import { test } from "bun:test";
import { expectRssDeltaBelow, isASAN, isLinux } from "harness";

// https://github.com/oven-sh/bun/issues/41459
// Each WebAssembly.Memory reserves 4 GiB of address space (Wasm fast memory).
// On Linux that reservation is a huge mimalloc allocation. mimalloc placed
// every one at a new address, and each new address cost a 4 KiB page-map
// entry that was never freed. Fast memory is off under ASAN and on Windows,
// so the leak is only observable on a Linux release build.
test.skipIf(!isLinux || isASAN)("WebAssembly.Memory does not leak RSS once collected", async () => {
  const code = /* js */ `
    function churn(n) {
      for (let i = 0; i < n; i++) new WebAssembly.Memory({ initial: 1 });
    }
    churn(500);
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    churn(8000);
    Bun.gc(true);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
  `;

  // Unfixed: about 4 KiB per memory, 33 MiB for 8000. Fixed: allocator slack only.
  await expectRssDeltaBelow(["-e", code], { release: 12, debug: 12 });
});
