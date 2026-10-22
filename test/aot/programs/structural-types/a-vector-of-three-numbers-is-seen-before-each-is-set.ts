function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const seen: string[] = [];

function look(when: string, v: Vector): void {
  seen.push(
    when +
      ": " +
      [v.x, v.y, v.z].map(n => typeof n + " " + n).join(", ") +
      " | sum " +
      (v.x + v.y + v.z) +
      " | length " +
      v.length() +
      " | whole " +
      ((v.x | 0) + (v.y | 0) + (v.z | 0)) +
      " | keys " +
      Object.keys(v).join("+"),
  );
}

class Vector {
  x: number;
  y: number;
  z: number;
  constructor(x: number, y: number, z: number) {
    look("nothing set", this);
    this.x = x;
    look("x set", this);
    this.y = y;
    look("y set", this);
    this.z = z;
    look("all set", this);
  }
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
}

new Vector(1.5, 2.5, 3.5);
new Vector(3, 4, 0);
new Vector(-0, NaN, 1e300);
for (const entry of seen) console.log(entry);
seen.length = 0;

class Whole {
  a: number;
  b: number;
  constructor(visit: (w: Whole) => void) {
    visit(this);
    this.a = 1;
    visit(this);
    this.b = 2;
    visit(this);
  }
}

function aOf(w: Whole): number {
  return w.a;
}
function bOf(w: Whole): number {
  return w.b;
}
function sumOf(w: Whole): number {
  return w.a + w.b;
}
function bIsMissing(w: Whole): boolean {
  return w.b === undefined;
}

const finished = new Whole(() => {});
let total = 0;
for (let i = 0; i < 2000; i++) total += sumOf(finished);
show("2000 finished ones", () => total);

const steps: string[] = [];
new Whole(w => {
  steps.push(typeof aOf(w) + " " + aOf(w) + ", " + typeof bOf(w) + " " + bOf(w) + ", " + sumOf(w) + ", " + bIsMissing(w));
});
for (const step of steps) console.log("step: " + step);

const stored: number[] = [];
new Whole(w => {
  stored.push(w.a, w.b);
});
show("stored in a number[]", () => stored.map(n => typeof n + " " + n).join());
show("added up", () => {
  let sum = 0;
  for (const n of stored) sum += n;
  return sum;
});
show("as float64", () => Array.from(new Float64Array(stored)).join());
show("as int32", () => Array.from(new Int32Array(stored)).join());
