interface Point {
  x: number;
  y: number;
}

class Pair {
  x = 1;
  y = 2;
}

let reads = 0;

const getter: PropertyDescriptor = {
  get() {
    reads++;
    return 70;
  },
  enumerable: true,
  configurable: true,
};

function facts(p: Point): string {
  const before = reads;
  const sum = p.x + p.y;
  return sum + " reads " + (reads - before) + " keys " + Object.keys(p).join("") + " json " + JSON.stringify(p) + " has " + ("x" in p);
}

function apply(action: (target: object, name: string, descriptor: PropertyDescriptor) => unknown, target: object): void {
  action(target, "x", getter);
}

const renamed = Object.defineProperty;
const { defineProperty: taken, deleteProperty: takenDelete } = Reflect;
const bound = Object.defineProperty.bind(Object);
const made = new Function("target", "descriptor", "Object.defineProperty(target, 'x', descriptor);");
const madeOldStyle = new Function("target", "getter", "target.__defineGetter__('x', getter);");
const madeDelete = new Function("target", "delete target.x;");
const madeDeleteByName = new Function("target", "name", "delete target[name];");
const evaluated: (target: object) => void = (0, eval)("(function (target) { delete target.x; })");

const changers: [string, (target: object) => void][] = [
  ["not at all", () => {}],
  ["defined directly", target => { Object.defineProperty(target, "x", getter); }],
  ["defineProperties", target => { Object.defineProperties(target, { x: getter }); }],
  ["Reflect", target => { Reflect.defineProperty(target, "x", getter); }],
  ["under another name", target => { renamed(target, "x", getter); }],
  ["taken out by a pattern", target => { taken(target, "x", getter); }],
  ["bound", target => { bound(target, "x", getter); }],
  ["call", target => { Object.defineProperty.call(Object, target, "x", getter); }],
  ["Reflect.apply", target => { Reflect.apply(Object.defineProperty, Object, [target, "x", getter]); }],
  ["handed to a function of ours", target => { apply(Object.defineProperty, target); }],
  ["a computed name", target => { Object.defineProperty(target, ["x"].join(""), getter); }],
  ["by code made at run time", target => { made(target, getter); }],
  ["the old way, by code made at run time", target => { madeOldStyle(target, getter.get); }],
  ["through a proxy", target => { Object.defineProperty(new Proxy(target, {}), "x", getter); }],
  ["deleted by Reflect", target => { Reflect.deleteProperty(target, "x"); }],
  ["deleted by Reflect under another name", target => { takenDelete(target, "x"); }],
  ["deleted by code made at run time", target => { madeDelete(target); }],
  ["deleted by name by code made at run time", target => { madeDeleteByName(target, "x"); }],
  ["deleted by evaluated code", target => { evaluated(target); }],
  ["deleted through a proxy", target => { Reflect.deleteProperty(new Proxy(target, {}), "x"); }],
  ["deleted and put back", target => {
    madeDelete(target);
    Object.assign(target, { x: 5 });
  }],
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += facts({ x: 1, y: 2 }).length + facts(new Pair()).length;
console.log("2000 honest: " + warm);

for (const [label, change] of changers) {
  const literal: Point = { x: 1, y: 2 };
  const instance = new Pair();
  change(literal);
  change(instance);
  console.log(label + ", literal: " + facts(literal));
  console.log(label + ", instance: " + facts(instance));
}

console.log("untouched afterwards: " + facts({ x: 1, y: 2 }) + " | " + facts(new Pair()));

export {};
