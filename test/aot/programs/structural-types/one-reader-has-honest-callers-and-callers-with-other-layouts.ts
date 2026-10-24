interface Point {
  x: number;
  y: number;
}

function read(p: Point): number {
  return p.x * 1000 + p.y;
}

function describe(p: Point): string {
  let listed = "";
  for (const key in p) listed += key;
  return read(p) + " " + listed + " " + JSON.stringify(p) + " " + JSON.stringify({ ...p });
}

function honestCallerOne(): string {
  return describe({ x: 1, y: 2 });
}

function honestCallerTwo(): string {
  const p: Point = { x: 3, y: 4 };
  return describe(p);
}

function honestCallerThree(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += read({ x: i, y: i });
  return total;
}

function flippedCaller(): string {
  return describe({ y: 6, x: 5 });
}

function wideCaller(): string {
  const wide = { name: "wide", y: 8, x: 7, tail: [1] };
  return describe(wide);
}

const table = { describe, read };
const inAList = [describe];

class Reader {
  reader: (p: Point) => string = describe;
  run(p: Point): string {
    return this.reader(p);
  }
}

function through(f: (p: Point) => string, p: Point): string {
  return f(p);
}

const flipped = { y: 10, x: 9 };
const wide = { a: 0, b: 0, c: 0, y: 12, d: 0, x: 11 };
const name: string = ["desc", "ribe"].join("");

console.log("odd caller first: " + flippedCaller());
console.log("honest one: " + honestCallerOne());
console.log("honest two: " + honestCallerTwo());
console.log("honest three: " + honestCallerThree(2000));
console.log("flipped: " + flippedCaller());
console.log("wide: " + wideCaller());
console.log("honest one again: " + honestCallerOne());

console.log("call: " + describe.call(undefined, flipped));
console.log("apply: " + describe.apply(undefined, [wide]));
console.log("bind: " + describe.bind(undefined, flipped)());
console.log("Reflect.apply: " + Reflect.apply(describe, undefined, [wide]));
console.log("a built-in calls it: " + [flipped, { x: 1, y: 2 }, wide].map(p => describe(p)).join(" | "));
console.log("a built-in calls read: " + [flipped, { x: 1, y: 2 }, wide].map(read).join());
console.log("a member of an object: " + table.describe(flipped));
console.log("a member by a computed name: " + (name === "describe" ? table[name](wide) : "no"));
console.log("an element: " + inAList[0](flipped));
console.log("a field: " + new Reader().run(wide));
console.log("a parameter: " + through(describe, flipped));
console.log("sorted by read: " + JSON.stringify([wide, flipped, { x: 1, y: 2 }].sort((a, b) => read(a) - read(b))));

const later = Promise.resolve(wide).then(describe);
console.log("a promise reaction: " + (await later));
console.log("honest at the end: " + honestCallerTwo());

export {};
