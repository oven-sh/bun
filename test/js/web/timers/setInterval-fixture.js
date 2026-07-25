var lastCall = performance.now();
const delta = 16;
let tries = 25;
setInterval(() => {
  const now = performance.now();
  if (now - lastCall < ((delta / 2) | 0)) {
    console.error("fired after only", (now - lastCall) | 0, "ms (expected >=", delta, "ms)");
    process.exit(1);
  }
  lastCall = now;

  if (--tries === 0) {
    console.log("PASS");
    process.exit(0);
  }
}, delta);
