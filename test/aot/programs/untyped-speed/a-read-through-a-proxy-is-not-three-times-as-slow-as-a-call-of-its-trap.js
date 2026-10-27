// A proxy whose handler counts the reads and answers out of the target, beside the same handler called by hand. A read through the proxy may cost a little more than the call, not three times as much.
class Counting {
  constructor() {
    this.reads = 0;
  }
  get(target, key) {
    this.reads++;
    return target[key];
  }
}
const handler = new Counting(),
  target = { alpha: 1, beta: 2 },
  proxy = new Proxy(target, handler);
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
  for (let i = 0; i < 3_000_000; i++) sum = (sum + handler.get(target, "alpha", proxy) + handler.get(target, "beta", proxy) + i) | 0;
  sums = (sums + sum) | 0;
});
const throughTheProxy = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 3_000_000; i++) sum = (sum + proxy.alpha + proxy.beta + i) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums, handler.reads);
console.log(throughTheProxy < byHand * 3 ? "under three times the time" : "over three times the time");
