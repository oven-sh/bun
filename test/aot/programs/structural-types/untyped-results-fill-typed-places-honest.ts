interface Point {
  x: number;
  y: number;
}

type Step = (n: number) => number;

function sum(p: Point): number {
  return p.x + p.y;
}

function plusOne(n: number): number {
  return n + 1;
}

function twice(f: Step): number {
  return f(f(1));
}

class Holder {
  p: Point;
  n: number;
  step: Step;
  constructor(p: Point, n: number, step: Step) {
    this.p = p;
    this.n = n;
    this.step = step;
  }
  all(): number {
    return this.p.x + this.p.y + this.step(this.n);
  }
}

const table = [10, 20, 30, 40];
const key: string = "v";
const same: Function = (value: unknown) => value;

function viaArguments(...rest: unknown[]) {
  return arguments[0];
}

const points: [string, () => Point][] = [
  ["JSON.parse", () => JSON.parse('{"x":1,"y":2}')],
  ["Reflect.get", () => Reflect.get({ v: { x: 1, y: 2 } }, key)],
  ["a value of type Function", () => same({ x: 1, y: 2 })],
  ["Reflect.apply", () => Reflect.apply(same, undefined, [{ x: 1, y: 2 }])],
  ["arguments", () => viaArguments({ x: 1, y: 2 })],
  ["a descriptor", () => Object.getOwnPropertyDescriptor({ v: { x: 1, y: 2 } }, key)?.value],
  ["Object()", () => Object({ x: 1, y: 2 })],
  ["structuredClone", () => structuredClone(same({ x: 1, y: 2 }))],
];

const numbers: [string, () => number][] = [
  ["JSON.parse", () => JSON.parse("3")],
  ["Reflect.get", () => Reflect.get({ v: 3 }, key)],
  ["a value of type Function", () => same(3)],
  ["Reflect.apply", () => Reflect.apply(same, undefined, [3])],
  ["arguments", () => viaArguments(3)],
  ["a descriptor", () => Object.getOwnPropertyDescriptor({ v: 3 }, key)?.value],
  ["structuredClone", () => structuredClone(same(3))],
];

const steps: [string, () => Step][] = [
  ["Reflect.get", () => Reflect.get({ v: plusOne }, key)],
  ["a value of type Function", () => same(plusOne)],
  ["arguments", () => viaArguments(plusOne)],
];

for (const [name, make] of points) {
  let total = 0;
  const list: Point[] = [];
  const map = new Map<string, Point>();
  for (let i = 0; i < 2000; i++) {
    const p: Point = make();
    total += p.x + p.y + sum(make());
    list.push(make());
    map.set("k" + (i % 8), make());
  }
  for (const p of list) total += p.x;
  for (const p of map.values()) total += p.y;
  console.log("points from " + name + ": " + total + " " + Object.keys(make()).join() + " " + JSON.stringify(make()));
}

for (const [name, make] of numbers) {
  let total = 0;
  const list: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const n: number = make();
    total += n + 1 + n * 2 + table[n] + plusOne(make());
    list.push(make());
  }
  for (const n of list) total += n;
  console.log("numbers from " + name + ": " + total + " " + typeof make());
}

for (const [name, make] of steps) {
  let total = 0;
  for (let i = 0; i < 2000; i++) {
    const f: Step = make();
    total += f(i) + twice(make()) + new Holder({ x: 1, y: 2 }, i, make()).all();
  }
  console.log("functions from " + name + ": " + total);
}

export {};
