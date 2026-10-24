interface Point {
  x: number;
  y: number;
}

function read(p: Point): number {
  return p.x * 1000 + p.y;
}

function store(p: Point, value: number): void {
  p.x = value;
  p.y = value + 1;
}

function keys(p: Point): string {
  return Object.keys(p).join();
}

function json(p: Point): string {
  return JSON.stringify(p);
}

function copy(p: Point): Point {
  return { ...p };
}

function walk(p: Point): string {
  let out = "";
  for (const key in p) out += key;
  return out;
}

let checksum = 0;
let letters = 0;
for (let i = 0; i < 2000; i++) {
  const honest: Point = { x: i, y: i + 1 };
  checksum += read(honest);
  store(honest, i + 2);
  checksum += read(honest);
  letters += keys(honest).length + json(honest).length + walk(honest).length + keys(copy(honest)).length;
}
console.log("2000 honest rounds: " + checksum + " " + letters);

const flipped: Point = { y: 2, x: 1 };
const wide = { a: "a", y: 4, b: "b", x: 3, c: "c" };
const single = { x: 5, y: 6 };

function round(label: string, p: Point): void {
  console.log(label + ", read: " + read(p));
  console.log(label + ", keys: " + keys(p));
  console.log(label + ", json: " + json(p));
  console.log(label + ", for-in: " + walk(p));
  console.log(label + ", copy: " + json(copy(p)));
  store(p, 70);
  console.log(label + ", after a store: " + read(p) + " " + json(p));
}

round("y before x", flipped);
round("honest again", single);
round("five members", wide);
round("honest once more", { x: 7, y: 8 });
console.log("the extras are untouched: " + wide.a + wide.b + wide.c);

let mixed = 0;
for (let i = 0; i < 2000; i++) {
  const p: Point = i % 500 === 499 ? { y: i, x: 1 } : { x: 1, y: i };
  mixed += read(p);
  if (i % 500 === 499) console.log("in the loop at " + i + ": " + read(p) + " " + keys(p) + " " + json(copy(p)));
}
console.log("mixed loop: " + mixed);
