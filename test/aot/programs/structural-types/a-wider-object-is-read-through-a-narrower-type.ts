interface Point {
  x: number;
  y: number;
}

function show(label: string, value: number): void {
  console.log(label + ": " + (Object.is(value, -0) ? "-0" : String(value)));
}

function read(p: Point): number {
  return p.x * 100 + p.y;
}

function readInALoop(p: Point): number {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    try {
      total += p.x * 100 + p.y;
    } catch {
      total = -1;
    }
  }
  return total;
}

class Holder {
  point: Point;
  constructor(point: Point) {
    this.point = point;
  }
  read(): number {
    return this.point.x * 100 + this.point.y;
  }
}

const honest = { x: 1, y: 2 };
const front = { a: "a", b: "b", x: 3, y: 4 };
const between = { x: 5, a: "a", y: 6 };
const behind = { x: 7, y: 8, a: "a", b: "b" };
const around = { a: 0.5, x: 9, b: { x: -1, y: -1 }, y: 10, c: [11], d: null, e: true, f: "f", g: 12 };

function choose(which: number): Point {
  if (which === 0) return honest;
  if (which === 1) return front;
  if (which === 2) return between;
  if (which === 3) return behind;
  return around;
}

const local: Point = around;
show("local", local.x * 100 + local.y);
show("parameter", read(around));
show("parameter in a loop", readInALoop(around));
const result = choose(4);
show("result", result.x * 100 + result.y);
show("field", new Holder(around).read());
const pair: Point[] = [honest, around];
show("element", pair[1].x * 100 + pair[1].y);
const captured = () => local.x * 100 + local.y;
show("captured", captured());

const table: [string, Point][] = [
  ["honest", honest],
  ["extras in front", front],
  ["an extra between", between],
  ["extras behind", behind],
  ["extras all around", around],
];

for (const [name, p] of table) {
  show(name + ", local", p.x * 100 + p.y);
  show(name + ", parameter", read(p));
  show(name + ", parameter in a loop", readInALoop(p));
  show(name + ", field", new Holder(p).read());
  const closure = () => p.y * 100 + p.x;
  show(name + ", captured", closure());
}

for (let which = 0; which < 5; which++) {
  const chosen = choose(which);
  show("result " + which, chosen.x * 100 + chosen.y);
}

const holder = new Holder(honest);
for (const [name, p] of table) {
  holder.point = p;
  show(name + ", stored into one field", holder.read());
}

let total = 0;
for (const p of table.map(row => row[1])) total += p.x;
show("sum of x over the elements", total);
