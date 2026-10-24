// Two instances of one untyped class whose field begins at zero. One is handed small numbers, the other the time of day in milliseconds, which does not fit 32 bits. A turn with the second may cost a few times what a turn with the first costs, not ten times.
class Stamp {
  constructor() {
    this.at = 0;
    this.count = 0;
  }
  touch(at) {
    this.at = at;
    this.count++;
  }
}
function fastestOf(runs, loop) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    loop();
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const early = new Stamp(),
  late = new Stamp(),
  now = Date.now();
const small = fastestOf(5, () => {
  for (let i = 0; i < 2_000_000; i++) early.touch(i);
});
const large = fastestOf(5, () => {
  for (let i = 0; i < 2_000_000; i++) late.touch(now + i);
});
console.log(early.at, early.count, late.at - now, late.count, Object.keys(late).join());
console.log(large < small * 10 ? "under ten times the time" : "over ten times the time");
