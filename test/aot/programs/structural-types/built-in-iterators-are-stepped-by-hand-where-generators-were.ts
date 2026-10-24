function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function* counting(): Generator<number, undefined, unknown> {
  yield 1;
  yield 2;
  return undefined;
}

function shape(result: IteratorResult<number, undefined>): string {
  return Object.keys(result).join() + " " + text(result.value) + " " + text(result.done);
}

function stepFour(walk: IterableIterator<number, undefined, unknown>): string {
  const out: string[] = [];
  for (let i = 0; i < 4; i++) out.push(shape(walk.next()));
  return out.join(" | ");
}

function isItsOwnIterator(walk: IterableIterator<number, undefined, unknown>): boolean {
  return walk[Symbol.iterator]() === walk;
}

function freshResults(walk: IterableIterator<number, undefined, unknown>): boolean {
  const a = walk.next();
  const b = walk.next();
  return a !== b;
}

function listOfArguments(...rest: number[]): IterableIterator<number, undefined, unknown> {
  return rest[Symbol.iterator]();
}

let warm = "";
for (let i = 0; i < 2000; i++) warm = stepFour(counting());
console.log("2000 generators: " + warm);

const makers: [string, () => IterableIterator<number, undefined, unknown>][] = [
  ["a generator", counting],
  ["array values", () => [1, 2].values()],
  ["array keys", () => ["x", "y"].keys()],
  ["an array with a hole", () => [1, , 3].values().map(n => (n === undefined ? -1 : n))],
  ["set values", () => new Set([1, 2]).values()],
  ["map keys", () => new Map([[1, "x"], [2, "y"]]).keys()],
  ["map values", () => new Map([["x", 1], ["y", 2]]).values()],
  ["typed array values", () => new Uint8Array([1, 2]).values()],
  ["a rest parameter", () => listOfArguments(1, 2)],
  ["a helper", () => [0, 1].values().map(n => n + 1)],
  ["a helper over a generator", () => counting().filter(n => n > 0)],
  ["Iterator.from a generator", () => Iterator.from(counting())],
];

for (const [label, make] of makers) {
  console.log(label + ": " + stepFour(make()));
  console.log(label + ", its own iterator: " + isItsOwnIterator(make()) + ", fresh results: " + freshResults(make()));
  console.log(label + ", tag: " + Object.prototype.toString.call(make()));
}

console.log("a generator again: " + stepFour(counting()));

const growing = [1];
const walker = growing.values();
console.log("first: " + shape(walker.next()));
growing.push(2);
console.log("after a push: " + shape(walker.next()));
console.log("at the end: " + shape(walker.next()));
growing.push(3);
console.log("a push after the end: " + shape(walker.next()));

const members = new Set([1, 2, 3]);
const setWalker = members.values();
console.log("set first: " + shape(setWalker.next()));
members.delete(2);
members.add(4);
console.log("set after a delete and an add: " + shape(setWalker.next()) + " | " + shape(setWalker.next()) + " | " + shape(setWalker.next()));
