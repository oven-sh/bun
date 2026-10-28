// A constructor function with a method and a field stored on it by name, beside a class with static members, in a file that is loaded under a name known only when the program runs
function Stored() {}
Stored.handle = function (x) {
  return x + this.base;
};
Stored.base = 1;
Stored.prototype.other = function () {
  return 1;
};
class Declared {
  static base = 1;
  static handle(x) {
    return x + this.base;
  }
  other() {
    return 1;
  }
}
if (new Stored().other() !== new Declared().other()) console.log("another answer");
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
const ofTheClass = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + Declared.handle(i)) | 0;
  sums = (sums + sum) | 0;
});
const ofTheFunction = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + Stored.handle(i)) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums, Object.keys(Stored).join());
console.log(ofTheFunction < ofTheClass * 3 ? "under three times the time" : "over three times the time");
