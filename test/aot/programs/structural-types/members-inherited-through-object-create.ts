interface Point {
  x: number;
  y: number;
}

function read(p: Point): number {
  return p.x * 100 + p.y;
}

function listing(p: Point): string {
  const walked: string[] = [];
  for (const key in p) walked.push(key);
  return [
    "keys[" + Object.keys(p).join() + "]",
    "for-in[" + walked.join() + "]",
    "json" + JSON.stringify(p),
    "spread" + JSON.stringify({ ...p }),
    "entries[" + Object.entries(p).join("|") + "]",
    "own x " + Object.hasOwn(p, "x"),
    "x in " + ("x" in p),
  ].join(" ");
}

function setX(p: Point, value: number): void {
  p.x = value;
}

const base = { x: 1, y: 2 };
const child: Point = Object.create(base);
const grandchild: Point = Object.create(child);
const half: Point = Object.assign(Object.create({ x: 3 }), { y: 4 });
const described: Point = Object.create(base, { y: { value: 6, enumerable: true, writable: true, configurable: true } });

console.log("child: " + read(child) + " " + listing(child));
console.log("grandchild: " + read(grandchild) + " " + listing(grandchild));
console.log("half: " + read(half) + " " + listing(half));
console.log("described: " + read(described) + " " + listing(described));

base.x = 10;
console.log("the base changed: " + read(child) + " " + read(grandchild) + " " + read(described));

setX(child, 20);
console.log("a store makes an own member: " + read(child) + " " + listing(child));
console.log("the base keeps its value: " + base.x + ", the grandchild sees the child's: " + read(grandchild));

setX(grandchild, 30);
console.log("each level has its own now: " + base.x + " " + child.x + " " + grandchild.x);

Reflect.deleteProperty(grandchild, "x");
console.log("deleted again: " + read(grandchild) + " " + listing(grandchild));

Object.setPrototypeOf(grandchild, { x: 40, y: 41 });
console.log("another prototype: " + read(grandchild) + " " + listing(grandchild));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += read({ x: 1, y: 2 });
console.log("2000 honest: " + sum);
console.log("then inherited: " + read(Object.create({ x: 5, y: 6 })) + ", half: " + read(half) + ", honest: " + read({ x: 7, y: 8 }));

class Holder {
  constructor(public point: Point) {}
  read(): number {
    return this.point.x * 100 + this.point.y;
  }
  move(): void {
    this.point.x++;
    this.point.y++;
  }
}

const shared = { x: 0, y: 0 };
const first = new Holder(Object.create(shared));
const second = new Holder(Object.create(shared));
first.move();
first.move();
console.log("incrementing an inherited member: " + first.read() + " " + second.read() + " " + JSON.stringify(shared));
console.log("own afterwards: " + JSON.stringify(first.point) + " " + JSON.stringify(second.point));

const list: Point[] = [base, child, grandchild, half, described];
console.log("elements: " + list.map(read).join());
console.log("json of the array: " + JSON.stringify(list));
const captured = () => child.x + grandchild.y;
console.log("captured: " + captured());

const chain: Point = Object.create(Object.create(Object.create(Object.create({ x: 8, y: 9 }))));
console.log("four levels up: " + read(chain));

export {};
