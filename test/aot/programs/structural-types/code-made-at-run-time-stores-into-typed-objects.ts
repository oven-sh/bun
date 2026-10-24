interface Point {
  x: number;
  y: number;
  z?: number;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const sloppySetX = new Function("point", "value", "point.x = value; return point.x;");
const strictSetX = new Function("point", "value", "'use strict'; point.x = value; return point.x;");
const sloppyAddZ = new Function("point", "value", "point.z = value; return 'z' in point;");
const sloppyDropY = new Function("point", "return delete point.y;");
const sloppyMode = new Function("return this === undefined ? 'strict' : 'sloppy';");

function read(p: Point): string {
  return p.x + "," + p.y + "," + p.z + " " + Object.keys(p).join("");
}

function sum(p: Point): number {
  return p.x + p.y;
}

console.log("code made at run time is " + sloppyMode());

const makers: [string, () => Point][] = [
  ["open", () => ({ x: 1, y: 2 })],
  ["frozen", () => Object.freeze({ x: 1, y: 2 })],
  ["sealed", () => Object.seal({ x: 1, y: 2 })],
  ["not extensible", () => Object.preventExtensions({ x: 1, y: 2 })],
  ["x is not writable", () => Object.defineProperty({ x: 1, y: 2 }, "x", { writable: false })],
  ["x has only a getter", () => ({ get x() { return 1; }, y: 2 })],
];

for (const [label, make] of makers) {
  const uses: [string, (p: Point) => unknown][] = [
    ["sloppy store", p => sloppySetX(p, 5)],
    ["strict store", p => strictSetX(p, 5)],
    ["sloppy add", p => sloppyAddZ(p, 6)],
    ["sloppy delete", p => sloppyDropY(p)],
  ];
  for (const [name, use] of uses) {
    const p = make();
    attempt(label + ", " + name, () => use(p));
    console.log("  holds " + read(p) + " sum " + sum(p));
  }
}

const steady: Point = { x: 1, y: 2 };
let total = 0;
for (let i = 0; i < 2000; i++) total += sum(steady);
console.log("2000 honest sums: " + total);
sloppySetX(steady, "text");
console.log("a string was stored where the type says number: " + typeof steady.x + " " + sum(steady) + " " + (steady.x | 0) + " " + JSON.stringify(steady));
sloppySetX(steady, 1.5);
console.log("a fraction: " + sum(steady));
sloppySetX(steady, undefined);
console.log("undefined: " + sum(steady) + " " + JSON.stringify(steady));
sloppyDropY(steady);
console.log("a required member deleted: " + sum(steady) + " " + read(steady));
sloppySetX(steady, 1);
Object.assign(steady, { y: 2 });
console.log("repaired: " + sum(steady) + " " + read(steady));

const looped: Point = { x: 1, y: 1 };
let running = 0;
for (let i = 0; i < 2000; i++) {
  running += looped.x;
  if (i === 999) sloppySetX(looped, 2);
}
console.log("stored in the middle of a loop: " + running);

export {};
