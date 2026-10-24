// A method of a class that is called by name is asked of the run time once for each shape of receiver, and the prototype need not make its members for that. What was learnt ends when the prototype changes.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
class Shape {
  sides = 0;
  area() { return 0; }
  name() { return "shape"; }
  describe() { return this.name() + " of " + this.sides + " sides and area " + this.area(); }
  scale(k) { return this; }
  get kind() { return "a " + this.name(); }
  toJSON() { return { sides: this.sides }; }
}
class Square extends Shape {
  sides = 4;
  side = 2;
  area() { return this.side * this.side; }
  name() { return "square"; }
  scale(k) { this.side *= k; return this; }
}
class Tile extends Square {
  color = "red";
  paint(color) { this.color = color; return this; }
}
function areas(shape, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += shape.area(); return sum; }
function names(shape, turns) { let text = ""; for (let i = 0; i < turns; i++) text = shape.name(); return text; }
function describes(shape, turns) { let text = ""; for (let i = 0; i < turns; i++) text = shape.describe(); return text; }
const all = () => [new Shape(), new Square(), new Tile()];
const asked = () => count("operationAOTGetByIdAndCache");
const [shape, square, tile] = all();
let most = 0;
const results = [];
for (const call of [areas, names]) {
  for (const receiver of [shape, square, tile]) {
    const before = asked();
    results.push(call(receiver, 500));
    most = Math.max(most, asked() - before);
  }
}
console.log(results.join());
console.log(most <= 3 ? "no method was asked of the run time more than three times" : "the run time was asked " + most + " times for one method of one class");
console.log(describes(shape, 50), "|", describes(square, 50), "|", describes(tile, 50));
console.log(shape.area === Shape.prototype.area, square.area === Square.prototype.area, tile.area === square.area, tile.describe === shape.describe, square.area !== shape.area);

// A method is replaced, shadowed, deleted and redefined.
Square.prototype.area = function () { return -1; };
console.log(areas(shape, 5), areas(square, 5), areas(tile, 5));
Tile.prototype.area = function () { return 7; };
console.log(areas(shape, 5), areas(square, 5), areas(tile, 5));
delete Tile.prototype.area;
delete Square.prototype.area;
console.log(areas(shape, 5), areas(square, 5), areas(tile, 5));
Object.defineProperty(Shape.prototype, "area", { get() { return () => this.sides; }, configurable: true });
console.log(areas(shape, 5), areas(square, 5), areas(tile, 5));
delete Shape.prototype.area;
console.log(attempt(() => areas(shape, 1)), attempt(() => areas(tile, 1)));

// One object gets a property of its own. The others go on as before.
class Meter { value = 1; read() { return this.value; } twice() { return 2 * this.read(); } }
function reads(meter, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += meter.read(); return sum; }
const first = new Meter();
const second = new Meter();
console.log(reads(first, 100), reads(second, 100));
first.read = () => 10;
console.log(reads(first, 100), reads(second, 100), first.twice(), second.twice());
delete first.read;
console.log(reads(first, 100), Object.keys(first).join());

// Two classes have a method of one name. What happens to one leaves the other alone.
class Left { go() { return "left"; } stay() { return "stays left"; } }
class Right { go() { return "right"; } stay() { return "stays right"; } }
function goes(walker, turns) { let text = ""; for (let i = 0; i < turns; i++) text = walker.go(); return text; }
const left = new Left();
const right = new Right();
console.log(goes(left, 100), goes(right, 100));
console.log(Object.getOwnPropertyNames(Left.prototype).join(), goes(left, 100), goes(right, 100));
Left.prototype.go = () => "left again";
console.log(goes(left, 100), goes(right, 100));
Right.prototype.go = () => "right again";
console.log(goes(left, 100), goes(right, 100), left.stay(), right.stay());

// The chain changes above and between.
class Base { who() { return "base"; } }
class Middle extends Base { }
class Leaf extends Middle { }
function whos(object, turns) { let text = ""; for (let i = 0; i < turns; i++) text = object.who(); return text; }
const leaf = new Leaf();
console.log(whos(leaf, 100));
Middle.prototype.who = function () { return "middle"; };
console.log(whos(leaf, 100), whos(new Base(), 100));
Object.setPrototypeOf(Leaf.prototype, { who() { return "stranger"; } });
console.log(whos(leaf, 100), leaf instanceof Middle);
Object.setPrototypeOf(leaf, Base.prototype);
console.log(whos(leaf, 100), leaf instanceof Base);
class Sealed { only() { return "only"; } }
function onlys(object, turns) { let text = ""; for (let i = 0; i < turns; i++) text = object.only(); return text; }
const sealed = new Sealed();
console.log(onlys(sealed, 100));
Object.freeze(Sealed.prototype);
console.log(attempt(() => { "use strict"; Sealed.prototype.only = 1; }), onlys(sealed, 100), attempt(() => { sealed.only = () => "own"; return onlys(sealed, 3); }));

// Objects of many shapes of one class.
class Bag { size() { return Object.keys(this).length; } }
function sizes(bag, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += bag.size(); return sum; }
let total = 0;
for (let i = 0; i < 40; i++) { const bag = new Bag(); for (let j = 0; j <= i % 8; j++) bag["k" + j] = j; total += sizes(bag, 10); }
console.log(total);
if (typeof gc === "function") gc(); else if (typeof Bun !== "undefined") Bun.gc(true);
console.log(names(new Tile(), 100), goes(new Right(), 100), whos(new Leaf(), 100), reads(new Meter(), 100));
