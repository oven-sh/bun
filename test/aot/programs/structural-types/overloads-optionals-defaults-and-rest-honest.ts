class Vector {
  x: number;
  y: number;
  constructor(x: number, y: number = x) {
    this.x = x;
    this.y = y;
  }
  scale(by: number, around?: Vector): Vector {
    if (around === undefined) return new Vector(this.x * by, this.y * by);
    return new Vector(around.x + (this.x - around.x) * by, around.y + (this.y - around.y) * by);
  }
  plus(...others: Vector[]): Vector {
    let x = this.x;
    let y = this.y;
    for (const other of others) {
      x += other.x;
      y += other.y;
    }
    return new Vector(x, y);
  }
}

function measure(item: string): number;
function measure(item: number[]): number;
function measure(item: Vector): number;
function measure(item: string | number[] | Vector): number {
  if (typeof item === "string") return item.length;
  if (item instanceof Vector) return Math.abs(item.x) + Math.abs(item.y);
  let sum = 0;
  for (const n of item) sum += n;
  return sum;
}

function repeat(word: string, times: number = 2, separator: string = "-"): string {
  let out = word;
  for (let i = 1; i < times; i++) out += separator + word;
  return out;
}

function clamp(n: number, low: number = 0, high: number = low + 10): number {
  return n < low ? low : n > high ? high : n;
}

function total(first: number, ...others: number[]): number {
  let sum = first;
  for (let i = 0; i < others.length; i++) sum += others[i];
  return sum;
}

function describe(name: string, age?: number): string {
  return age === undefined ? name : name + " " + age;
}

function apply(f: (n: number) => number, n: number): number {
  return f(n);
}

function each(items: number[], visit: (item: number, index: number) => void): void {
  for (let i = 0; i < items.length; i++) visit(items[i], i);
}

type Step = [kind: "move", dx: number, dy: number] | [kind: "turn", degrees: number];
function walk(...step: Step): number {
  return step[0] === "move" ? step[1] + step[2] : step[1] / 90;
}

interface Hooks {
  before?(): number;
  after?: () => number;
}
function run(hooks: Hooks): number {
  return (hooks.before?.() ?? 0) + (hooks.after?.() ?? 0);
}

let sum = 0;
let letters = 0;
const center = new Vector(1);
for (let i = 0; i < 2000; i++) {
  sum += measure("abc") + measure([i, 1]) + measure(new Vector(i, 2));
  letters += repeat("a").length + repeat("a", 3).length + repeat("a", 3, "++").length;
  sum += clamp(i) + clamp(i, 5) + clamp(i, 5, 7);
  sum += total(i) + total(i, 1) + total(i, 1, 2, 3);
  letters += describe("n").length + describe("n", i & 7).length;
  sum += apply(n => n + 1, i);
  sum += new Vector(i).scale(2).x + new Vector(i, 1).scale(2, center).y + new Vector(i).plus().x + new Vector(i).plus(center, center).y;
  sum += walk("move", i, 1) + walk("turn", 180);
  sum += run({}) + run({ before: () => 1 }) + run({ before: () => 1, after: () => 2 });
}
console.log("sum " + sum + ", letters " + letters);

let visited = 0;
each([1, 2, 3], (item, index) => {
  visited += item * index;
});
each([4, 5], item => {
  visited += item;
});
console.log("visited " + visited);

const pair: [number, number] = [3, 4];
const triple: [number, number, number] = [1, 2, 3];
console.log("spread " + new Vector(...pair).y + " " + total(...triple) + " " + clamp(...triple));

const double = total.bind(null, 10);
console.log("bound " + double() + " " + double(1, 2));
console.log("texts " + repeat("ab") + " " + repeat("ab", 1) + " " + repeat("ab", undefined, "+") + " " + describe("x", 0) + " " + describe("x", undefined));
