// A literal that Object.setPrototypeOf() puts below another literal with a getter, beside a class that says the same. A read through the one may cost a few times what a read through the other costs, not five times.
const above = {
  get twice() {
    return this.x * 2;
  },
};
function putBelow(object) {
  Object.setPrototypeOf(object, above);
  return object;
}
class Declared {
  constructor(x) {
    this.x = x;
  }
  get twice() {
    return this.x * 2;
  }
}
const below = putBelow({ x: 1 }),
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
  for (let i = 0; i < 5_000_000; i++) sum = (sum + declared.twice + i) | 0;
  sums = (sums + sum) | 0;
});
const ofTheLiteral = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + below.twice + i) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums, Object.getPrototypeOf(below) === above);
console.log(ofTheLiteral < ofTheClass * 5 ? "under five times the time" : "over five times the time");
