// Properties read from a parameter of type `any` in small functions that have no loop of their own.
// The compiler may expect an object of the class that is mostly passed. Every other value must behave as in plain JavaScript.
class Point {
  constructor(public x: number, public y: number) {}
}

class Point3 extends Point {
  constructor(x: number, y: number, public z: number) {
    super(x, y);
  }
}

function weigh(p: any): number {
  return p.x + p.y;
}

function labelOf(p: any): string {
  return String(p.x) + "," + String(p.missing);
}

function visit(node: any, depth: number): number {
  if (depth === 0) return weigh(node.point);
  return visit(node, depth - 1) + visit(node, depth - 1);
}

const held: unknown[] = [];
function anything(value: unknown): any {
  held.push(value);
  return held.pop();
}

function report(label: string, run: () => unknown): void {
  try {
    console.log(label + ":", String(run()));
  } catch (e) {
    console.log(label + ":", "throws", (e as Error).name);
  }
}

report("many objects of the class", () => visit({ point: new Point(1, 2) }, 12));
report("a subclass", () => weigh(anything(new Point3(1, 2, 3))));
report("a plain object", () => weigh(anything({ x: 5, y: 6 })));
report("a plain object, the other order", () => weigh(anything({ y: 6, x: 5 })));
report("parsed data", () => weigh(JSON.parse('{"y":1,"x":2}')));
report("getters", () => weigh(anything({ get x() { return 7; }, get y() { return 8; } })));
report("inherited from an object of the class", () => weigh(anything(Object.create(new Point(9, 10)))));
report("a proxy", () => {
  const seen: string[] = [];
  const total = weigh(anything(new Proxy(new Point(11, 12), { get(target, key, receiver) { seen.push(String(key)); return Reflect.get(target, key, receiver); } })));
  return total + " " + seen.join();
});
report("a property that is absent", () => weigh(anything({ x: 1 })));
report("a number", () => weigh(anything(5)));
report("a string", () => labelOf(anything("text")));
report("null", () => weigh(anything(null)));
report("undefined", () => weigh(anything(undefined)));
report("a name the class does not have", () => labelOf(new Point(13, 14)));
report("a property added to an object of the class", () => labelOf(Object.assign(new Point(15, 16), { missing: "found" })));
report("after a store through any", () => {
  const p: any = new Point(17, 18);
  p.x = 19;
  return weigh(p);
});
for (let i = 0; i < 4; i++) report("mixed " + i, () => weigh(i % 2 ? anything({ x: i, y: i }) : new Point(i, i)));
