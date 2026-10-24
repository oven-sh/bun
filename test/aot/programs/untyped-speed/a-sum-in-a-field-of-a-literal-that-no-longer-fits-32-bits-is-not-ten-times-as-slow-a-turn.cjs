// An object literal with a field that starts at one and a method that adds to it. One day the sum no longer fits 32 bits. From then on a turn may cost a few times what it cost before, not ten times.
const sum = {
  n: 1,
  add(x) {
    this.n += x;
    return this.n;
  },
};
function fastestOf(runs, loop) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    loop();
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const addMany = () => {
  for (let i = 0; i < 2_000_000; i++) sum.add(3);
};
const small = fastestOf(5, addMany);
for (let i = 0; i < 40_000; i++) sum.add(65_536);
const large = fastestOf(5, addMany);
console.log(sum.n, Object.keys(sum).join());
console.log(large < small * 10 ? "under ten times the time" : "over ten times the time");
