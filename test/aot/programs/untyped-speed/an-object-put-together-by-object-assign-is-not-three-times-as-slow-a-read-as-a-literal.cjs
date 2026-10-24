// Options laid over defaults with Object.assign(), beside a literal with the same three fields. A read out of the one may cost a little more than a read out of the other, not three times as much.
const defaults = { a: 1, b: 2 };
function withDefaults(options) {
  return Object.assign({}, defaults, options);
}
const assigned = withDefaults({ c: 3 }),
  literal = { a: 1, b: 2, c: 3 };
let sums = 0;
function fastestOf(runs, loop) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    loop();
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const ofTheLiteral = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + literal.a + literal.b + literal.c + i) | 0;
  sums = (sums + sum) | 0;
});
const ofTheAssigned = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + assigned.a + assigned.b + assigned.c + i) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums, JSON.stringify(assigned));
console.log(ofTheAssigned < ofTheLiteral * 3 ? "under three times the time" : "over three times the time");
