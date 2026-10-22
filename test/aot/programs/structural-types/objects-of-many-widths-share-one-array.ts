interface Point {
  x: number;
  y: number;
}

function read(p: Point): number {
  return p.x * 1000 + p.y;
}

function widen(count: number, x: number, y: number, where: "front" | "middle" | "behind"): Point {
  const extras: Record<string, number> = {};
  if (where === "behind") Object.assign(extras, { x, y });
  for (let i = 0; i < count; i++) {
    if (where === "middle" && i === count >> 1) Object.assign(extras, { y, x });
    extras["k" + i] = -i;
  }
  return Object.assign(extras, { x, y });
}

const literals: Point[] = [
  { x: 1, y: 2 },
  ((o: { a: number; x: number; y: number }) => o)({ a: 0, x: 3, y: 4 }),
  ((o: { a: number; b: number; c: number; d: number; e: number; f: number; x: number; y: number }) => o)({
    a: 0,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
    f: 0,
    x: 5,
    y: 6,
  }),
];
console.log("literals: " + literals.map(read).join());

const widths = [0, 1, 2, 3, 5, 6, 7, 8, 15, 16, 17, 31, 33, 63, 64, 65, 100, 300];
const all: Point[] = [];
for (const where of ["front", "middle", "behind"] satisfies ("front" | "middle" | "behind")[]) {
  for (const width of widths) all.push(widen(width, width + 1, width + 2, where));
}

console.log("read: " + all.map(read).join());
console.log("counts: " + all.map(p => Object.keys(p).length).join());
console.log("place of x: " + all.map(p => Object.keys(p).indexOf("x")).join());
console.log("place of y: " + all.map(p => Object.keys(p).indexOf("y")).join());

let total = 0;
for (const p of all) total += p.x - p.y;
console.log("x - y over all: " + total);

for (const p of all) {
  p.x += 1;
  p.y = p.x * 2;
}
console.log("after stores: " + all.map(read).join());
console.log("extras untouched: " + all.map(p => Object.values(p).reduce((a, b) => a + b, 0) - p.x - p.y).join());
console.log("copies: " + all.map(p => Object.keys({ ...p }).length).join());
console.log("json lengths: " + all.map(p => JSON.stringify(p).length).join());

const shrunk: Record<string, number> & Point = Object.assign({ x: 7, y: 8 }, { a: 1, b: 2, c: 3 });
const view: Point = shrunk;
delete shrunk.a;
delete shrunk.c;
console.log("after deleting extras: " + read(view) + " " + JSON.stringify(view));
shrunk.d = 4;
console.log("after adding one: " + read(view) + " " + JSON.stringify(view));
