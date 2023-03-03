const interval = 10;
const now = performance.now();
console.time("Slept");
Bun.sleepSync(interval);
const elapsed = performance.now() - now;
if (elapsed < interval) {
  throw new Error("Didn't sleep");
}

console.timeEnd("Slept");
