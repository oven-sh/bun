// Code made at run time reads a method off an instance of a typed class as it reads one off any other object, many times at one place, so that what the interpreter remembers of the holder is used.
class Counter {
  n: number = 0;
  bump(by: number): number {
    this.n += by;
    return this.n;
  }
  name(): string {
    return "counter";
  }
}
class Doubling extends Counter {
  factor: number = 2;
  bump(by: number): number {
    return super.bump(by * this.factor);
  }
}
class Heir extends Counter {
  more: string = "m";
}
function hide(value: unknown): any {
  return value;
}
let texts = 0;
const makeBumps = () => new Function("o", "turns", "let s = " + texts++ + " * 0; for (let i = 0; i < turns; i++) s += o.bump(1); return s;") as (o: unknown, turns: number) => number;
const makeNames = () => new Function("o", "turns", "let s = '" + texts++ + "'; for (let i = 0; i < turns; i++) s = o.name(); return s;") as (o: unknown, turns: number) => string;
const bumps = makeBumps();
const names = makeNames();
const reads = new Function("o", "return o.bump;") as (o: unknown) => unknown;
function measure(label: string, run: () => unknown) {
  const result = run();
  console.log(label + ":", result);
}
measure("its own method", () => bumps(new Counter(), 500));
measure("another instance of the class", () => bumps(new Counter(), 500));
measure("a method that overrides", () => makeBumps()(new Doubling(), 500));
measure("an inherited method", () => makeBumps()(new Heir(), 500));
measure("a second method", () => names(new Heir(), 500));
measure("behind another property of its own", () => {
  const marked = new Counter();
  hide(marked).extra = 1;
  return makeBumps()(marked, 500);
});
measure("of a frozen object", () => makeNames()(Object.freeze(new Heir()), 500));

const several: unknown[] = [new Counter(), new Doubling(), new Heir(), { bump: (by: number) => by * 10 }, JSON.parse('{"n":0}')];
hide(several[4]).bump = function (by: number) {
  return (this.n -= by);
};
console.log("objects of several kinds in turn:", [0, 1, 2, 3, 4, 0, 1, 2, 3, 4].map(i => bumps(several[i], 3)).join());
console.log("the same function each time:", reads(new Counter()) === reads(new Counter()), reads(new Heir()) === Counter.prototype.bump, reads(new Doubling()) === Doubling.prototype.bump);

const marked = new Counter();
bumps(marked, 20);
hide(marked).extra = 1;
console.log("behind another property of its own:", bumps(marked, 3), hide(marked).extra);
const frozen = Object.freeze(new Heir());
console.log("a frozen one:", names(frozen, 20), reads(frozen) === Counter.prototype.bump);
let total = 0;
for (let i = 0; i < 3000; i++) total += bumps(i & 1 ? new Counter() : new Heir(), 2) + [i].length;
console.log("many objects, and garbage between the calls:", total);
