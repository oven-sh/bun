// A name that is not among the own names of an object is looked for from its prototype on. Objects of several shapes under one prototype are asked for the same names.
function Vehicle() { }
Vehicle.prototype.wheels = function () { return 4; };
Vehicle.prototype.kind = "vehicle";
function Car(i) { this.seats = i; } Car.prototype = Object.create(Vehicle.prototype);
function Van(i) { this.load = i; this.doors = 2; } Van.prototype = Car.prototype;
function Bus(i) { this.lines = i; this.stops = 3; this.fare = 1; } Bus.prototype = Car.prototype;
function wheelsOf(o, turns) { let s = 0; for (let i = 0; i < turns; i++) s += o.wheels(); return s; }
function kindOf(o, turns) { let s = ""; for (let i = 0; i < turns; i++) s = o.kind; return s; }
function colorOf(o, turns) { let s; for (let i = 0; i < turns; i++) s = o.color; return s; }
function textOf(o, turns) { let s = ""; for (let i = 0; i < turns; i++) s = o.toString(); return s; }
function ownsOf(o, turns) { let n = 0; for (let i = 0; i < turns; i++) n += o.hasOwnProperty("a") ? 1 : 0; return n; }
function valueOf(o, turns) { let s; for (let i = 0; i < turns; i++) s = o.valueOf(); return s === o; }
console.log(textOf({ a: 1 }, 100), ownsOf({ a: 1 }, 100), valueOf({ a: 1 }, 100));
console.log(textOf({ a: 1, b: 2 }, 100), ownsOf({ a: 1, b: 2 }, 100), valueOf({ a: 1, b: 2 }, 100));
console.log(textOf({ b: 1, c: 2, d: 3 }, 100), ownsOf({ b: 1, c: 2, d: 3 }, 100), valueOf({ b: 1, c: 2, d: 3 }, 100));
console.log(wheelsOf(new Car(1), 100), kindOf(new Car(1), 100), colorOf(new Car(1), 100), textOf(new Car(1), 100));
console.log(wheelsOf(new Van(1), 100), kindOf(new Van(1), 100), colorOf(new Van(1), 100), textOf(new Van(1), 100));
console.log(wheelsOf(new Bus(1), 100), kindOf(new Bus(1), 100), colorOf(new Bus(1), 100), textOf(new Bus(1), 100));
console.log(textOf({ a: 1 }, 100), textOf({ a: 1, b: 2 }, 100), typeof kindOf({ a: 1 }, 100));

// What was learnt ends when the name arrives nearer by or changes.
Car.prototype.kind = "car";
console.log(kindOf(new Car(1), 50), kindOf(new Van(1), 50), kindOf(new Bus(1), 50));
Vehicle.prototype.color = "grey";
console.log(colorOf(new Car(1), 50), colorOf(new Van(1), 50), colorOf(new Bus(1), 50));
Vehicle.prototype.wheels = function () { return 6; };
console.log(wheelsOf(new Car(1), 50), wheelsOf(new Van(1), 50));
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
