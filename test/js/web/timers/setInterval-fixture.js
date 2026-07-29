const start = performance.now();
const delta = 16;
const total = 25;
let tries = total;
setInterval(() => {
  const now = performance.now();
  // The Nth tick is not allowed to fire before N*delta ms have elapsed. Checking against the
  // previous tick is wrong: if the event loop stalls for >delta, the catch-up tick correctly
  // fires immediately and the gap between ticks can legitimately be ~0ms.
  const ticks = total - tries + 1;
  const earliest = ticks * delta;
  if (now - start < earliest - 2) {
    console.error("tick", ticks, "fired at", (now - start) | 0, "ms (expected >=", earliest, "ms)");
    process.exit(1);
  }

  if (--tries === 0) {
    console.log("PASS");
    process.exit(0);
  }
}, delta);
