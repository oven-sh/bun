// Runs a 16 ms interval 100 times and reports every run that was early.
//
// Run N is due N * delta ms after the interval was armed. Each run is scheduled delta ms after the
// run before it started, so this lower bound holds however late a run is. The gap between two runs
// has no such bound: the callback reads the clock some time after the timer fired, and a stall in
// between makes the next gap shorter.
const delta = 16;
const ticks = 100;
const early = [];
let count = 0;

const start = performance.now();
const timer = setInterval(() => {
  const elapsed = performance.now() - start;
  if (count === ticks) {
    console.error("The interval ran after clearInterval().");
    process.exit(1);
  }
  count++;
  // 1 ms of slack: performance.now() and the timers do not read the same clock on every platform.
  if (elapsed < count * delta - 1) early.push({ tick: count, elapsed });
  if (count === ticks) {
    clearInterval(timer);
    console.log(JSON.stringify({ ticks: count, early }));
  }
}, delta);
