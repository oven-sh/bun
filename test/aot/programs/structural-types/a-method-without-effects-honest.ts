class Circle {
  r = 2;
  area(): number {
    return this.r * this.r * 3;
  }
}

let calls = 0;

function counting(this: Circle): number {
  calls++;
  return this.r + calls;
}

function unused(c: Circle): string {
  c.area();
  c.area();
  return "nothing used";
}

function twice(c: Circle): number {
  return c.area() + c.area();
}

function loop(c: Circle, rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i++) total += c.area();
  return total;
}

function shortCircuit(c: Circle, flag: boolean): boolean {
  return flag && c.area() > 0;
}

function overwritten(c: Circle): number {
  let x = c.area();
  x = c.area();
  return x;
}

function timesZero(c: Circle): number {
  return c.area() * 0;
}

function inACondition(c: Circle): string {
  return c.area() === c.area() ? "equal" : "different";
}

function round(label: string, c: Circle): void {
  calls = 0;
  const parts: string[] = [];
  for (const [name, run] of [
    ["unused", () => unused(c)],
    ["twice", () => twice(c)],
    ["loop", () => loop(c, 5)],
    ["short circuit, true", () => shortCircuit(c, true)],
    ["short circuit, false", () => shortCircuit(c, false)],
    ["overwritten", () => overwritten(c)],
    ["times zero", () => timesZero(c)],
    ["in a condition", () => inACondition(c)],
  ] satisfies [string, () => unknown][]) {
    const before = calls;
    parts.push(name + " " + String(run()) + " (" + (calls - before) + ")");
  }
  console.log(label + ": " + parts.join(", "));
}

const c = new Circle();
const original = Circle.prototype.area;
let warm = 0;
for (let i = 0; i < 2000; i++) warm += twice(c) + loop(c, 3) + overwritten(c) + unused(c).length;
console.log("2000 honest: " + warm);
round("the method", c);
round("replaced", c);
round("a new circle", new Circle());
round("put back", c);

export {};
