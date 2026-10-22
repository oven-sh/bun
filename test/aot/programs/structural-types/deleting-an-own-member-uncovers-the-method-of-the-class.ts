class Shape {
  side = 2;
  area?(): number;
  declare describe?: () => string;
}

Shape.prototype.area = function () {
  return this.side * this.side;
};
Shape.prototype.describe = function () {
  return "from the prototype";
};

function areaOf(s: Shape): string {
  return s.area ? "area " + s.area() : "no area";
}

function describe(s: Shape): string {
  return s.describe?.() ?? "nothing";
}

function report(label: string, s: Shape): void {
  console.log(label + ": " + areaOf(s) + ", " + describe(s) + ", own " + Object.hasOwn(s, "area") + " " + Object.hasOwn(s, "describe") + ", keys " + Object.keys(s).join());
}

const s = new Shape();
const untouched = new Shape();

let letters = 0;
for (let i = 0; i < 2000; i++) letters += areaOf(s).length + describe(s).length;
console.log("2000 honest rounds: " + letters);
report("before", s);

s.area = () => -1;
s.describe = () => "own";
report("covered", s);
report("the other", untouched);

delete s.area;
report("area uncovered", s);
delete s.describe;
report("both uncovered", s);

s.area = undefined;
report("covered by undefined", s);
delete s.area;
report("uncovered", s);

delete Shape.prototype.area;
report("gone from the prototype", s);
report("the other", untouched);
s.area = () => 7;
report("own and nothing below", s);
delete s.area;
report("nothing at all", s);

Shape.prototype.area = function () {
  return this.side + 100;
};
report("another one on the prototype", s);
report("a new one", new Shape());

class Base {
  name(): string {
    return "base";
  }
}

class Derived extends Base {
  name(): string {
    return "derived";
  }
}

function nameOf(b: Base): string {
  return b.name();
}

const d = new Derived();
const ownView: { name?: () => string } = d;
const prototypeView: { name?: () => string } = Derived.prototype;
const steps: string[] = [nameOf(d)];
d.name = () => "own";
steps.push(nameOf(d));
delete ownView.name;
steps.push(nameOf(d));
delete prototypeView.name;
steps.push(nameOf(d), d.name(), nameOf(new Derived()), nameOf(new Base()));
console.log("own, then the subclass, then the base: " + steps.join(" "));

export {};
