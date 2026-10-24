// Packages that wrap a callback ask for its name first: `fn.name || "anonymous"`. The callback is a function made for the occasion, so each one is asked once. How many variables of its surroundings it
// holds says nothing about its name: the question may cost about the same for one that holds six as for one that holds two.
function nameOf(fn) { return fn.name || "anonymous"; }
function holdingTwo(a, b) { return function two(x) { return a + b + x; }; }
function holdingSix(a, b, c, d, e, f) { return function six(x) { return a + b + c + d + e + f + x; }; }
function fastestOf(runs, make) {
  let fastest = Infinity, letters = 0;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    for (let i = 0; i < 300000; i++) letters += nameOf(make(i, 1, 2, 3, 4, 5)).length;
    fastest = Math.min(fastest, performance.now() - began);
  }
  return { fastest, letters };
}
const two = fastestOf(5, holdingTwo), six = fastestOf(5, holdingSix);
console.log(two.letters, six.letters);
console.log(six.fastest < two.fastest * 5 ? "six variables in under five times the time of two" : "six variables took over five times the time of two");
