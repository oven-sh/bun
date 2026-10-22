// A function of the program that is constructed by the engine, not by compiled code: Reflect.construct, a bound function, a Proxy, Array.from with a constructor for `this`.
// What the object inherits from, each time anew. Only the jsc shell can count. Elsewhere the program checks the answers alone.
const counts = typeof aotOperationCount === "function";
const count = counts ? aotOperationCount : () => 0;
function Params() {}
Params.prototype = Object.create(null);
function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.kind = "point";
function Other() {}
Other.prototype.kind = "other";
function AsksTarget() {
  this.target = new.target === undefined ? "none" : new.target.name;
}
class Plain {
  constructor(value) { this.value = value; }
  get kind() { return "plain"; }
}
class Heir extends Point {
  constructor(x, y) { super(x, y); this.z = 0; }
  get kind() { return "heir of " + super.kind; }
}
function describe(object) {
  return Object.keys(object).map(key => key + "=" + object[key]).join() + " " + object.kind;
}

const said = new Set();
const before = count("operationAOTCreateThis");
for (let i = 0; i < 2000; i++) {
  said.add(String(Object.getPrototypeOf(Reflect.construct(Params, [])) === Params.prototype));
  said.add(describe(Reflect.construct(Point, [1, 2])));
  said.add(describe(Reflect.construct(Point, [1, 2], Other)));
  said.add(describe(Reflect.construct(Other, [], Point)));
  said.add(describe(Reflect.construct(AsksTarget, [])));
  said.add(describe(Reflect.construct(AsksTarget, [], Point)));
  said.add(describe(Reflect.construct(Plain, [3])));
  said.add(describe(Reflect.construct(Heir, [4, 5])));
  said.add(describe(Reflect.construct(Point, [6, 7], Heir)));
}
const asked = count("operationAOTCreateThis") - before;
console.log([...said].join("\n"));
console.log(!counts || asked <= 13000 ? "what `this` is made of was remembered as a rule" : "the run time was asked what `this` is made of " + asked + " times");

// A `prototype` that is replaced is what the next object inherits from, whoever constructs.
const first = Point.prototype;
Point.prototype = { kind: "second" };
console.log(describe(Reflect.construct(Point, [1, 2])), describe(new Point(1, 2)), describe(Reflect.construct(Other, [], Point)));
Point.prototype = 7;
console.log(Object.getPrototypeOf(Reflect.construct(Point, [1, 2])) === Object.prototype);
Point.prototype = first;
console.log(describe(Reflect.construct(Point, [1, 2])));
first.kind = "point again";
console.log(describe(Reflect.construct(Point, [1, 2])));
Object.setPrototypeOf(first, { inherited: true });
console.log(Reflect.construct(Point, [1, 2]).inherited);

// A new.target whose `prototype` runs code is asked every time.
const log = [];
const bound = Point.bind(null, "bound");
console.log(describe(new bound(2)), describe(Reflect.construct(bound, [3])));
const watched = new Proxy(Point, { get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); } });
for (let i = 0; i < 3; i++) describe(Reflect.construct(Point, [1, 2], watched));
console.log(log.join());
function WithGetter() {}
let reads = 0;
const target = Object.defineProperty(function () {}.bind(), "prototype", { get() { reads++; return Other.prototype; } });
for (let i = 0; i < 3; i++) said.add(describe(Reflect.construct(WithGetter, [], target)));
console.log(reads, describe(Reflect.construct(WithGetter, [], target)));

// Other ways in.
console.log(describe(Array.from.call(Point, [1, 2, 3])));
console.log(describe(Array.of.call(Point, 1)));
for (const notConstructor of [() => 1, Math.max, {}, undefined]) {
  try {
    Reflect.construct(Point, [], notConstructor);
  } catch (error) {
    console.log(error.constructor.name);
  }
}

// Collections in between.
let kept = [];
for (let i = 0; i < 20000; i++) {
  const object = Reflect.construct(Point, [i, new Array(8).fill(i)]);
  if (i % 1000 === 0) kept.push(object);
}
console.log(kept.map(object => object.x + ":" + object.y[7] + ":" + object.kind).join(" "));
