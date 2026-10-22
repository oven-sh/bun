import { addToX, fill, incrementX, mode, patternIntoX, setBoth, setByName, setX } from "./stores.cjs";

interface Point {
  x: number;
  y: number;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function strictSetX(point: Point, value: number): number {
  point.x = value;
  return point.x;
}

const strictMode = function (this: unknown): string {
  return this === undefined ? "strict" : "sloppy";
};

console.log("this module is " + strictMode() + ", the other one is " + mode());

const log: string[] = [];

const makers: [string, () => Point][] = [
  ["open", () => ({ x: 1, y: 2 })],
  ["frozen", () => Object.freeze({ x: 1, y: 2 })],
  ["frozen, other order", () => Object.freeze({ y: 2, x: 1 })],
  ["x is not writable", () => Object.defineProperty({ x: 1, y: 2 }, "x", { writable: false })],
  [
    "x has only a getter",
    () => ({
      get x() {
        log.push("get");
        return 1;
      },
      y: 2,
    }),
  ],
  ["inherited from a frozen object", () => Object.create(Object.freeze({ x: 1, y: 2 }))],
  ["sealed", () => Object.seal({ x: 1, y: 2 })],
];

for (const [label, make] of makers) {
  const uses: [string, (p: Point) => unknown][] = [
    ["strict store", p => strictSetX(p, 5)],
    ["sloppy store", p => setX(p, 5)],
    ["sloppy, two stores", p => setBoth(p, 6)],
    ["sloppy increment", p => incrementX(p)],
    ["sloppy +=", p => addToX(p, 10)],
    ["sloppy, by name", p => setByName(p, "x", 7)],
    ["sloppy pattern", p => patternIntoX(p, 8)],
  ];
  for (const [name, use] of uses) {
    const p = make();
    attempt(label + ", " + name, () => use(p));
    console.log("  holds " + p.x + "," + p.y + " own " + Object.keys(p).join() + " [" + log.join() + "]");
    log.length = 0;
  }
}

const open: Point = { x: 0, y: 0 };
for (let i = 0; i < 2000; i++) {
  setX(open, i);
  strictSetX(open, i);
}
console.log("2000 honest stores from both: " + open.x);
const frozen: Point = Object.freeze({ x: 1, y: 2 });
attempt("then frozen, sloppy", () => setX(frozen, 5));
attempt("then frozen, strict", () => strictSetX(frozen, 5));
attempt("then open, sloppy", () => setX(open, 5));

const many: Point[] = [];
for (let i = 0; i < 100; i++) many.push(i % 10 === 3 ? Object.freeze({ x: 0, y: i }) : { x: 0, y: i });
attempt("a sloppy loop over open and frozen elements", () => fill(many, 9));
console.log("sum afterwards: " + many.reduce((sum, p) => sum + p.x, 0));
