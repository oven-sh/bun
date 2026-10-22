interface Point {
  x: number;
  y: number;
  z?: number;
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

function frozenThenStored(): string {
  const p: Point = { x: 1, y: 2 };
  Object.freeze(p);
  try {
    p.x = 5;
    return "stored " + p.x;
  } catch (error) {
    return "threw " + nameOf(error) + " " + p.x;
  }
}

function sealedThenGrown(): string {
  const p: Point = { x: 1, y: 2 };
  Object.seal(p);
  try {
    p.z = 3;
    return "grown " + p.z;
  } catch (error) {
    return "threw " + nameOf(error) + " " + p.z;
  }
}

function lockedThenStored(): string {
  const p: Point = { x: 1, y: 2 };
  Object.defineProperty(p, "y", { writable: false });
  try {
    p.x = 5;
    p.y = 6;
    return "stored";
  } catch (error) {
    return "threw " + nameOf(error) + " " + p.x + "," + p.y;
  }
}

function getterDefined(): number {
  const p: Point = { x: 1, y: 2 };
  let reads = 0;
  Object.defineProperty(p, "x", { get: () => ++reads });
  return p.x * 100 + p.x * 10 + reads;
}

function keysInOrder(): string {
  const p: Point = { y: 2, x: 1 };
  p.z = 3;
  return Object.keys(p).join("");
}

function deletedAndAdded(): string {
  const p: Point = { x: 1, y: 2, z: 3 };
  delete p.z;
  const without = Object.keys(p).join("") + ("z" in p) + p.z;
  p.z = 4;
  return without + " " + Object.keys(p).join("") + p.z;
}

function undefinedIsPresent(): string {
  const p: Point = { x: 1, y: 2, z: undefined };
  const q: Point = { x: 1, y: 2 };
  return ("z" in p) + " " + ("z" in q) + " " + Object.keys(p).length + " " + Object.keys(q).length + " " + JSON.stringify(p) + JSON.stringify(q);
}

function reparented(): string {
  const p: Point = { x: 1, y: 2 };
  Object.setPrototypeOf(p, { z: 9 });
  let walked = "";
  for (const key in p) walked += key;
  return p.z + " " + walked + " " + Object.keys(p).join("");
}

function copied(): string {
  const wide = { w: 0, y: 2, x: 1 };
  const p: Point = wide;
  const copy = { ...p };
  return JSON.stringify(copy) + Object.keys(copy).length;
}

function hidden(): string {
  const p: Point = { x: 1, y: 2 };
  Object.defineProperty(p, "x", { enumerable: false });
  return JSON.stringify(p) + Object.keys(p).join("") + JSON.stringify({ ...p }) + p.x;
}

function aliased(): number {
  const p: Point = { x: 1, y: 2 };
  const q: { x: number } = p;
  q.x = 10;
  return p.x + q.x;
}

class Pair {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

function localInstance(): string {
  const p = new Pair();
  p.sum = () => -1;
  return p.sum() + " " + Object.keys(p).join("");
}

function localLookAlike(): string {
  const p: Pair = { x: 5, y: 6, sum: () => 0 };
  return p.sum() + " " + (p instanceof Pair) + " " + p.constructor.name;
}

function localFrozenInstance(): string {
  const p = Object.freeze(new Pair());
  const open: { x: number } = p;
  try {
    open.x = 9;
    return "stored";
  } catch (error) {
    return "threw " + nameOf(error) + " " + p.sum();
  }
}

const cases: [string, () => unknown][] = [
  ["frozen, then stored", frozenThenStored],
  ["sealed, then grown", sealedThenGrown],
  ["one member locked", lockedThenStored],
  ["a getter defined", getterDefined],
  ["keys in order", keysInOrder],
  ["deleted and added", deletedAndAdded],
  ["undefined is present", undefinedIsPresent],
  ["another prototype", reparented],
  ["copied", copied],
  ["hidden", hidden],
  ["aliased", aliased],
  ["an instance with an own method", localInstance],
  ["a look-alike", localLookAlike],
  ["a frozen instance", localFrozenInstance],
];

for (const [label, run] of cases) console.log(label + ": " + String(run()));

console.log("called directly: " + frozenThenStored() + " | " + getterDefined() + " | " + keysInOrder() + " | " + undefinedIsPresent());

for (const [label, run] of cases) {
  let last: unknown;
  for (let i = 0; i < 2000; i++) last = run();
  console.log(label + ", the 2000th time: " + String(last));
}

export {};
