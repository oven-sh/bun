// Arms many intervals that are all due in the same loop iteration. The first one to run clears all of
// them, so none of the others may run. Reports how many intervals it armed and how many runs it saw.
//
// usage: bun setinterval-cancel-fixture.js [timerCount]
const timerCount = Number(process.argv[2] ?? 50_000);

const huge = Array.from({ length: 1000000 }, () => 0);
huge.fill(0);
let runs = 0;
const gc = typeof Bun !== "undefined" ? Bun.gc : typeof globalThis.gc !== "undefined" ? globalThis.gc : () => {};

var timers = new Array(timerCount);

function fn(huge) {
  if (++runs > 1) {
    console.error("Timer ran more than once after being cancelled.");
    process.exit(1);
  }
  for (let i = 0; i < timers.length; i++) {
    clearInterval(timers[i]);
  }
  timers.length = 0;
  gc(true);

  // Every interval was due before this timer, so one that is still armed runs first.
  setTimeout(() => {
    console.log(JSON.stringify({ timers: timerCount, runs }));
  }, 10);
}

gc(true);
for (let i = 0; i < timers.length; i++) timers[i] = setInterval(fn, 1, huge);
