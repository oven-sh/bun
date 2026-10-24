// A constructor written as a function, with its method stored on the prototype, beside a class that says the same. A call of the one may cost a little more than a call of the other, not three times as much.
function Stored(x) {
  this.x = x;
}
Stored.prototype.get = function () {
  return this.x;
};
class Declared {
  constructor(x) {
    this.x = x;
  }
  get() {
    return this.x;
  }
}
const stored = new Stored(1),
  declared = new Declared(1);
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
  for (let i = 0; i < 5_000_000; i++) sum = (sum + declared.get() + i) | 0;
  sums = (sums + sum) | 0;
});
const ofTheFunction = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + stored.get() + i) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums);
console.log(ofTheFunction < ofTheClass * 3 ? "under three times the time" : "over three times the time");
