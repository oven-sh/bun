const huge = Array.from({ length: 1000000 }, () => 0);
huge.fill(0);
const delta = 1;
const initialRuns = 5_000_000;
let runs = initialRuns;
var initial = 0;

const gc = typeof Bun !== "undefined" ? Bun.gc : typeof globalThis.gc !== "undefined" ? globalThis.gc : () => {};

function fn(huge) {
  huge.length;

  if (runs === initialRuns) {
    gc(true);
    initial = process.memoryUsage.rss();
    console.log(this);
  }

  if (--runs === 0) {
    const kb = (process.memoryUsage.rss() - initial) / 1024;
    console.log("Memory usage increase between timer runs:", kb | 0, "KB");
    if (kb > 2 * 1024) {
      process.exit(1);
    }

    process.exit(0);
  }
}

for (let i = 0; i < 50_000; i++) setInterval(fn, delta, huge);
