var lastCall = performance.now();
const delta = 16;
let tries = 100;
setInterval(() => {
  const now = performance.now();
  console.log((now - lastCall) | 0, "ms since the last call");
  if (now - lastCall < ((delta / 2) | 0)) {
    process.exit(1);
  }
  lastCall = now;

  if (--tries === 0) {
    process.exit(0);
  }
}, delta);
