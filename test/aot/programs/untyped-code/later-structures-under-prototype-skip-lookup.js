// A name that an ordinary object lacks is looked for from its prototype on, and what one shape has learnt about a prototype the next shape under it need not look up again, whatever gave the objects their shapes.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lookedUp = () => count("MegamorphicCache::load:new-pair") + count("MegamorphicCache::absent:new-pair");
function Vehicle() { }
Vehicle.prototype.wheels = function () { return 4; };
Vehicle.prototype.kind = "vehicle";
function Car(i) { this.seats = i; } Car.prototype = Object.create(Vehicle.prototype);
function Van(i) { this.load = i; this.doors = 2; } Van.prototype = Car.prototype;
function Bus(i) { this.lines = i; this.stops = 3; this.fare = 1; } Bus.prototype = Car.prototype;
function grown(k) { const o = new Car(k); o["extra" + k] = k; return o; }
function wheelsOf(o, turns) { let s = 0; for (let i = 0; i < turns; i++) s += o.wheels(); return s; }
function kindOf(o, turns) { let s = ""; for (let i = 0; i < turns; i++) s = o.kind; return s; }
function colorOf(o, turns) { let s; for (let i = 0; i < turns; i++) s = o.color; return s; }
function textOf(o, turns) { let s = ""; for (let i = 0; i < turns; i++) s = o.toString(); return s; }
const all = o => [wheelsOf(o, 100), kindOf(o, 100), colorOf(o, 100), textOf(o, 100)].join();
console.log(all(new Car(1)));
const before = lookedUp();
console.log(all(new Van(1)), all(new Bus(1)), all(grown(1)), all(grown(2)));
const after = lookedUp();
console.log(after === before ? "the shapes that came later looked nothing up" : (after - before) + " pairs were looked up for the shapes that came later");

// What was learnt ends when the name arrives nearer by or changes.
Car.prototype.kind = "car";
console.log(kindOf(new Car(1), 50), kindOf(new Van(1), 50), kindOf(new Bus(1), 50), kindOf(grown(1), 50));
Vehicle.prototype.color = "grey";
console.log(colorOf(new Car(1), 50), colorOf(new Van(1), 50), colorOf(new Bus(1), 50), colorOf(grown(2), 50));
Vehicle.prototype.wheels = function () { return 6; };
console.log(wheelsOf(new Car(1), 50), wheelsOf(new Van(1), 50), wheelsOf(grown(1), 50));
Object.defineProperty(Car.prototype, "color", { get() { return "the color of " + Object.keys(this).join(); }, configurable: true });
console.log(colorOf(new Car(1), 50), colorOf(new Van(1), 50), colorOf(new Bus(1), 50));
delete Car.prototype.color;
delete Car.prototype.kind;
console.log(colorOf(new Van(1), 50), kindOf(new Van(1), 50));
const own = new Van(1);
own.kind = "my own";
console.log(kindOf(own, 50), kindOf(new Van(1), 50));
Object.setPrototypeOf(Car.prototype, { wheels() { return 3; }, kind: "tricycle" });
console.log(wheelsOf(new Bus(1), 50), kindOf(new Bus(1), 50), colorOf(new Bus(1), 50));
const underProxy = Object.create(new Proxy({}, { get(target, key, receiver) { return key === "kind" ? "a proxy for " + Object.keys(receiver).join() : undefined; } }));
underProxy.mine = 1;
console.log(kindOf(underProxy, 20), colorOf(underProxy, 20));
