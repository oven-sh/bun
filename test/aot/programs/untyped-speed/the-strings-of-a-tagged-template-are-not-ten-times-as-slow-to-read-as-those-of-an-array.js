// A tag function reads `strings[k]`. The strings object is frozen; a read of it may cost more than a read of an array that the program wrote itself, but not ten times as much.
function lengths(strings, ...values) {
  let sum = 0;
  for (let k = 0; k < values.length; k++) sum += strings[k].length + values[k];
  return sum;
}
const written = ["a", "bc", "d"];
function tagged(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += lengths`a${i & 7}bc${2}d`;
  return sum;
}
function called(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += lengths(written, i & 7, 2);
  return sum;
}
function fastestOf(runs, run) {
  let fastest = Infinity;
  for (let k = 0; k < runs; k++) {
    const began = performance.now();
    if (run(800_000) !== 6_800_000) console.log("a wrong sum");
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
fastestOf(2, tagged), fastestOf(2, called);
console.log(fastestOf(5, tagged) < fastestOf(5, called) * 10 ? "under ten times the time" : "over ten times the time");
