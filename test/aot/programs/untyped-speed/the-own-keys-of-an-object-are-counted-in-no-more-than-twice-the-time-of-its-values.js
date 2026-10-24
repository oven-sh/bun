const shape = { a: 1, b: 2, c: 3, d: 4, e: 5 };
function countKeys(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += Object.keys(shape).length + (i & 1);
  return sum;
}
function countValues(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += Object.values(shape).length + (i & 1);
  return sum;
}
function fastestOf(runs, count) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    if (count(4_000_000) !== 22_000_000) console.log("a wrong sum");
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
fastestOf(2, countKeys), fastestOf(2, countValues);
const keys = fastestOf(5, countKeys), values = fastestOf(5, countValues);
console.log(keys < values * 2 ? "under twice the time" : "over twice the time");
