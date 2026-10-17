// Many shapes are read by the same code under the same names, and then their prototypes change: a method is replaced, an absent name is added, a value is deleted and added again, a getter is replaced, a value becomes a getter, objects get own properties, prototypes are replaced. Every cached result in the by-name property table has to follow.
function makePlain(i) {
  const o = {};
  o["kind" + i] = i;
  o.first = i; o.second = 2; o.third = 3; o.fourth = 4; o.fifth = 5; o.sixth = 6; o.seventh = 7; o.eighth = 8;
  if (i % 7 === 0) Object.defineProperty(o, "ninth", { get() { return 9; }, configurable: true });
  return o;
}
function readPlain(o) { return o.first + o.second * 2 + o.third * 3 + o.fourth * 5 + o.fifth * 7 + o.sixth * 11 + o.seventh * 13 + o.eighth * 17 + (o.ninth === undefined ? 19 : o.ninth) + (o.tenth === undefined ? 23 : 0); }
const plain = [];
for (let i = 0; i < 1500; i++) plain.push(makePlain(i));
let sum = 0;
for (const o of plain) sum = sum + readPlain(o) | 0;
console.log("1500 plain shapes, ten names each:", sum);
plain[5].tenth = 10; plain[6].third = -3; plain[8].fourth = 40; delete plain[9].second;
for (const o of plain) sum = sum + (readPlain(o) | 0) | 0;
console.log(sum, readPlain(plain[5]), readPlain(plain[6]), readPlain(plain[7]), readPlain(plain[8]), readPlain(plain[9]));

class Shape {
  constructor(i) { this["own" + i] = i; this.width = i; }
  area() { return this.width * 2; }
  rim() { return this.width + 4; }
  get edges() { return 4; }
}
Shape.prototype.label = "shape";
Shape.prototype.weight = 3;
function use(s) { return s.width + s.area() + s.rim() * 3 + s.edges * 5 + s.label.length * 7 + s.weight * 11 + (s.missing === undefined ? 13 : s.missing) + (s.lost === undefined ? 17 : 0); }
const shapes = [];
for (let i = 0; i < 1000; i++) shapes.push(new Shape(i));
let total = 0;
const all = () => { for (const s of shapes) total = total + use(s) | 0; return total; };
console.log("1000 shapes of instances of one class, eight names each:", all());
Shape.prototype.area = function () { return this.width * 20; };
console.log("a method is replaced:", all(), use(shapes[3]));
Shape.prototype.missing = 1;
console.log("an absent name is added to the prototype:", all(), use(shapes[3]));
delete Shape.prototype.label; Shape.prototype.label = "another";
console.log("a value is deleted and added again:", all(), use(shapes[3]));
Object.defineProperty(Shape.prototype, "edges", { get() { return this.width & 1 ? 3 : 5; }, configurable: true });
console.log("a getter is replaced:", all(), use(shapes[3]), use(shapes[4]));
Object.defineProperty(Shape.prototype, "weight", { get() { return 2; }, configurable: true });
console.log("a value becomes a getter:", all(), use(shapes[3]));
shapes[3].rim = () => 100; shapes[4].lost = 1; Object.defineProperty(shapes[5], "edges", { value: 1 });
console.log("three objects get properties of their own:", all(), use(shapes[3]), use(shapes[4]), use(shapes[5]), use(shapes[6]));
Object.setPrototypeOf(shapes[7], { area() { return 1; }, rim() { return 2; }, edges: 3, label: "x", weight: 4 });
Object.setPrototypeOf(Shape.prototype, { lost: 5 });
console.log("prototypes are replaced:", all(), use(shapes[7]), use(shapes[8]));
for (let i = 1000; i < 1100; i++) shapes.push(new Shape(i));
console.log("a hundred more shapes:", all(), use(shapes[1050]));
