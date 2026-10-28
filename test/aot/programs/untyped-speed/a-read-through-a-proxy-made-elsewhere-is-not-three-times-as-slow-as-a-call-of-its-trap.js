// A function makes the proxy, an object keeps it, and another function reads two names through it. Beside it the same trap called by hand. A read through the proxy may cost a little more than the call, not three times as much.
let reads = 0;
const handler = {
  get(target, key) {
    reads++;
    return target[key];
  },
};
function make(target) {
  return new Proxy(target, handler);
}
const target = { alpha: 1, beta: 2 },
  holder = { kept: make(target) };
function readThrough(from) {
  return from.kept.alpha + from.kept.beta;
}
function readByHand(from) {
  return handler.get(target, "alpha", from.kept) + handler.get(target, "beta", from.kept);
}
let sums = 0;
function fastestOf(turns, run) {
  let fastest = Infinity;
  for (let turn = 0; turn < turns; turn++) {
    const began = performance.now();
    run();
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const byHand = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 3_000_000; i++) sum = (sum + readByHand(holder) + i) | 0;
  sums = (sums + sum) | 0;
});
const throughTheProxy = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 3_000_000; i++) sum = (sum + readThrough(holder) + i) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums, reads);
console.log(throughTheProxy < byHand * 3 ? "under three times the time" : "over three times the time");
