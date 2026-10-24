class Base {
  x: number;
  tag = 7;
  constructor(x: number) {
    this.x = x;
  }
  who(): string {
    return "base";
  }
}
class Unrelated {
  name = "u";
  who(): string {
    return "unrelated";
  }
}
class Derived extends Base {
  y = 3;
  who(): string {
    return "derived";
  }
}
class List extends Array<number> {}
class Failure extends Error {}

function describe(label: string, made: any, target: any): void {
  console.log(
    label + ":",
    "keys", Object.keys(made).join(),
    "| x", made.x, "tag", made.tag, "y", made.y,
    "| who", typeof made.who === "function" ? made.who() : typeof made.who,
    "| Base", made instanceof Base, "Derived", made instanceof Derived, "Unrelated", made instanceof Unrelated,
    "| array", Array.isArray(made),
    "| prototype is the target's", Object.getPrototypeOf(made) === target.prototype,
  );
}

function OldStyle(this: any) {}
OldStyle.prototype.who = function () {
  return "old style";
};
const bound = Base.bind(null);
const handedOut: unknown[] = [Unrelated.prototype, Derived.prototype, null, 5, Base.prototype];
let reads = 0;
const proxy: any = new Proxy(function () {}, {
  get(target, key, receiver) {
    if (key === "prototype") return handedOut[reads++ % handedOut.length];
    return Reflect.get(target, key, receiver);
  },
});

for (let round = 0; round < 3; round++) {
  describe("new", new Base(round), Base);
  describe("itself", Reflect.construct(Base, [round], Base), Base);
  describe("another class", Reflect.construct(Base, [round], Unrelated), Unrelated);
  describe("a class below", Reflect.construct(Base, [round], Derived), Derived);
  describe("the class above", Reflect.construct(Derived, [round], Base), Base);
  describe("another class, from below", Reflect.construct(Derived, [round], Unrelated), Unrelated);
  describe("a subclass of Array", Reflect.construct(Base, [round], List), List);
  describe("a subclass of Error", Reflect.construct(Base, [round], Failure), Failure);
  describe("a function", Reflect.construct(Base, [round], OldStyle), OldStyle);
  describe("Object", Reflect.construct(Base, [round], Object), Object);
  describe("Map", Reflect.construct(Base, [round], Map), Map);
  describe("a bound function", Reflect.construct(Base, [round], bound), Object);
}
for (let round = 0; round < 10; round++) {
  const made: any = Reflect.construct(round & 1 ? Derived : Base, [round], proxy);
  const parent = Object.getPrototypeOf(made);
  const name = parent === Object.prototype ? "Object" : parent.constructor.name;
  console.log("a proxy:", round, "keys", Object.keys(made).join(), "x", made.x, "tag", made.tag, "y", made.y, "prototype of", name);
}
