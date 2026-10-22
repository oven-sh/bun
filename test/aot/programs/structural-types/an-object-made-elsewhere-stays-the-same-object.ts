interface Point {
  x: number;
  y: number;
}

class Holder {
  point: Point;
  points: Point[] = [];
  constructor(point: Point) {
    this.point = point;
    this.points.push(point);
  }
  move(): void {
    this.point.x += 1;
  }
}

function identity(p: Point): Point {
  return p;
}

function setX(p: Point, value: number): void {
  p.x = value;
}

function sum(p: Point): number {
  return p.x + p.y;
}

const outsideRead = new Function("o", "return o.x + ',' + o.y + ',' + Object.keys(o).join('');");
const outsideStore = new Function("o", "v", "o.x = v;");
const outsideSame = new Function("a", "b", "return a === b;");

const makers: [string, () => Point][] = [
  ["a literal", () => ({ x: 1, y: 2 })],
  ["JSON.parse", () => JSON.parse('{"x":1,"y":2}')],
  ["JSON.parse, other order and an extra", () => JSON.parse('{"z":0,"y":2,"x":1}')],
  ["structuredClone", () => structuredClone({ x: 1, y: 2 })],
  ["Object.assign", () => Object.assign({}, { x: 1 }, { y: 2 })],
  ["code made at run time", () => new Function("return { x: 1, y: 2 };")()],
  ["evaluated code", () => (0, eval)("({ y: 2, x: 1 })")],
  ["a reviver", () => JSON.parse('{"p":{"x":1,"y":2}}', (key, value: unknown) => value).p],
  ["Object.create and stores", () => {
    const made: Point = Object.create(Object.prototype);
    made.x = 1;
    made.y = 2;
    return made;
  }],
];

const notes = new WeakMap<Point, string>();

for (const [label, make] of makers) {
  const original = make();
  const through = identity(original);
  const holder = new Holder(original);
  const list: Point[] = [{ x: 0, y: 0 }, original];
  notes.set(original, label);
  const captured = () => original;
  console.log(
    label + ", the same object: " +
      [
        through === original,
        holder.point === original,
        holder.points[0] === original,
        list[1] === original,
        list.includes(original),
        list.indexOf(original),
        new Set(list).has(through),
        notes.get(holder.point) === label,
        captured() === through,
        Object.is(through, original),
        outsideSame(holder.point, original),
      ].join(" "),
  );
  setX(through, 10);
  console.log(label + ", a typed store seen from outside: " + outsideRead(original));
  outsideStore(original, 20);
  console.log(label + ", an outside store seen by typed code: " + sum(through) + " " + sum(holder.point) + " " + sum(list[1]));
  holder.move();
  console.log(label + ", a store through a field: " + outsideRead(original) + " " + original.x);
  list[1].y = 30;
  console.log(label + ", a store through an element: " + outsideRead(original) + " " + JSON.stringify(through));
}

let warm = 0;
const honest: Point = { x: 1, y: 2 };
for (let i = 0; i < 2000; i++) warm += sum(identity(honest));
console.log("2000 honest: " + warm);
const parsed: Point = JSON.parse('{"x":5,"y":6}');
console.log("then a parsed one: " + sum(identity(parsed)) + " " + (identity(parsed) === parsed));

const shared: Point = JSON.parse('{"x":0,"y":0}');
const holders = [new Holder(shared), new Holder(shared), new Holder(shared)];
for (const h of holders) h.move();
console.log("three holders of one object: " + shared.x + " " + holders.every(h => h.point === shared));

export {};
