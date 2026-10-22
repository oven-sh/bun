interface Point {
  x: number;
  y: number;
}

function setX(p: Point, value: number): void {
  p.x = value;
}

function setBoth(p: Point, value: number): void {
  p.y = value;
  p.x = value + 0.5;
}

function bump(p: Point): number {
  p.x++;
  p.y += 10;
  return p.x + p.y;
}

function swap(p: Point): void {
  [p.x, p.y] = [p.y, p.x];
}

class Holder {
  constructor(public point: Point) {}
  move(by: number): void {
    this.point.x += by;
    this.point.y -= by;
  }
}

function fresh(): [string, Point, () => string][] {
  const honest = { x: 1, y: 2 };
  const flipped = { y: 2, x: 1 };
  const front = { a: "a", b: "b", x: 1, y: 2 };
  const between = { x: 1, a: "a", y: 2, b: "b" };
  const numbers = { u: 100, y: 2, v: 200, x: 1, w: 300 };
  const fractions = { u: 0.25, x: 1, v: 0.75, y: 2 };
  return [
    ["honest", honest, () => JSON.stringify(honest)],
    ["flipped", flipped, () => JSON.stringify(flipped)],
    ["extras in front", front, () => JSON.stringify(front)],
    ["extras between", between, () => JSON.stringify(between)],
    ["number extras", numbers, () => JSON.stringify(numbers)],
    ["fraction extras", fractions, () => JSON.stringify(fractions)],
  ];
}

for (const [name, p, whole] of fresh()) {
  setX(p, 50);
  console.log(name + ", x stored: " + whole());
}

for (const [name, p, whole] of fresh()) {
  setBoth(p, 60);
  console.log(name + ", both stored: " + whole());
}

for (const [name, p, whole] of fresh()) {
  console.log(name + ", bumped: " + bump(p) + " " + whole());
}

for (const [name, p, whole] of fresh()) {
  swap(p);
  console.log(name + ", swapped: " + whole());
}

for (const [name, p, whole] of fresh()) {
  new Holder(p).move(5);
  console.log(name + ", moved through a field: " + whole());
}

for (const [name, p, whole] of fresh()) {
  const store = (value: number) => {
    p.y = value;
  };
  store(-0);
  console.log(name + ", stored by a closure: " + whole() + " " + Object.is(p.y, -0));
}

for (const [name, p, whole] of fresh()) {
  Object.assign(p, { x: 8, y: 9 });
  console.log(name + ", Object.assign: " + whole());
}

const list = fresh().map(row => row[1]);
for (let i = 0; i < list.length; i++) list[i].x = i * 11;
console.log("stored through elements: " + JSON.stringify(list));

const target = { before: "before", y: 0, x: 0, after: "after" };
for (let i = 0; i < 2000; i++) setX({ x: 0, y: 0 }, i);
setX(target, 77);
setBoth(target, 88);
console.log("after 2000 honest stores: " + JSON.stringify(target));
