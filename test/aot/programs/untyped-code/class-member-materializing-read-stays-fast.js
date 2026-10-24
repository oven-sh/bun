// The prototype of a class makes its members once they have been asked for often enough. The method whose read makes them is read like every other inherited value from then on.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
class Counter {
  n = 0;
  add(k) { this.n += k; return this; }
  get twice() { return this.n * 2; }
  reset() { this.n = 0; return this; }
  name() { return "counter"; }
  toJSON() { return { n: this.n }; }
}
class Stepper extends Counter {
  step = 3;
  advance() { return this.add(this.step); }
}
function addMany(counter, turns) { for (let i = 0; i < turns; i++) counter.add(1); return counter.n; }
function advanceMany(stepper, turns) { for (let i = 0; i < turns; i++) stepper.advance(); return stepper.n; }
function readTwice(counter, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += counter.twice; return sum; }
const asked = () => count("operationAOTGetById") + count("operationAOTGetByIdAndCache");
const before = asked();
const counter = new Counter();
const stepper = new Stepper();
console.log(addMany(counter, 1000), advanceMany(stepper, 1000), addMany(stepper, 1000), readTwice(counter, 1000), readTwice(stepper, 1000));
const entered = asked() - before;
console.log(entered <= 100 ? "the run time was asked for a member at most 100 times" : "the run time was asked for a member " + entered + " times");

// What was learnt ends when it should.
Counter.prototype.add = function (k) { this.n += 2 * k; return this; };
console.log(addMany(counter.reset(), 10), advanceMany(stepper.reset(), 10));
Stepper.prototype.add = function (k) { this.n -= k; return this; };
console.log(addMany(counter.reset(), 10), advanceMany(stepper.reset(), 10), addMany(stepper.reset(), 10));
delete Stepper.prototype.add;
console.log(advanceMany(stepper.reset(), 10));
Object.defineProperty(Counter.prototype, "twice", { get() { return this.n * 3; }, configurable: true });
console.log(readTwice(counter.reset().add(1), 10), readTwice(stepper.reset().add(1), 10));
counter.add = function (k) { this.n += 100 * k; return this; };
console.log(addMany(counter.reset(), 10), Object.keys(counter).join(), JSON.stringify(counter), counter.name());
Object.setPrototypeOf(Stepper.prototype, { add(k) { this.n += 7 * k; return this; }, reset() { this.n = 0; return this; } });
console.log(advanceMany(stepper.reset(), 10), stepper.twice, typeof stepper.name);
delete Counter.prototype.add;
try { addMany(new Counter(), 1); } catch (error) { console.log(error.constructor.name); }
