const huge = Array.from({ length: 1000000 }, () => 0);
huge.fill(0);
let hasRun = false;
const gc = typeof Bun !== "undefined" ? Bun.gc : typeof globalThis.gc !== "undefined" ? globalThis.gc : () => {};
const rss =
  process.platform === "darwin" && typeof Bun !== "undefined" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;

var timers = new Array(50_000);

function fn(huge) {
  if (hasRun) {
    console.error("Timer ran more than once after being cancelled.");
    process.exit(1);
  }
  hasRun = true;
  for (let i = 0; i < timers.length; i++) {
    clearInterval(timers[i]);
  }
  timers.length = 0;
  gc(true);

  setTimeout(() => {
    console.log("RSS:", (rss() / 1024 / 1024) | 0, "MB");
    process.exit(0);
  }, 10);
}

gc(true);
for (let i = 0; i < timers.length; i++) timers[i] = setInterval(fn, 1, huge);
