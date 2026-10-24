// A function that carries a method and a field of its own and hands every call on to that method, beside an instance of a class. A call of the one may cost a little more than a call of the other, not three times as much.
function create() {
  const handler = function (x) {
    return handler.handle(x);
  };
  handler.handle = function (x) {
    return x + this.base;
  };
  handler.base = 1;
  return handler;
}
class Declared {
  base = 1;
  handle(x) {
    return x + this.base;
  }
  call(x) {
    return this.handle(x);
  }
}
const handler = create(),
  declared = new Declared();
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
  for (let i = 0; i < 5_000_000; i++) sum = (sum + declared.call(i)) | 0;
  sums = (sums + sum) | 0;
});
const ofTheFunction = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + handler(i)) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums, Object.keys(handler).join());
console.log(ofTheFunction < ofTheClass * 3 ? "under three times the time" : "over three times the time");
