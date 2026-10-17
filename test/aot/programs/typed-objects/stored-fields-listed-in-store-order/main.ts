// With "useDefineForClassFields": false a field with an initializer is a store in the constructor, and one without is no code at all. The keys of an object come in the order of the stores, also of
// those that the constructor of the class that is extended makes first.
const seen: string[] = [];
class Base {
  n = 0;
  constructor() {
    (this as unknown as Heir).y = 5;
    seen.push(Object.keys(this).join());
    this.hook();
    seen.push(Object.keys(this).join());
  }
  hook(): void {}
}
class Heir extends Base {
  y: number | undefined;
  z = 1;
  w: string | undefined;
  v = "v";
  override hook(): void { this.w = "early"; }
}
class WithParameters extends Base {
  first = 1;
  y: number | undefined;
  constructor(public given: string, readonly other: number) { super(); seen.push(Object.keys(this).join()); }
  last = seen.length;
}
class Quiet { a = 1; b: number | undefined; c = "c"; }
class QuietHeir extends Quiet { b = 2; d = 4; }
for (const made of [new Heir(), new WithParameters("g", 7), new Quiet(), new QuietHeir()]) {
  console.log(made.constructor.name, Object.keys(made).join(), JSON.stringify(made));
}
console.log(seen.join(" | "));
