interface Point {
  x: number;
  y: number;
}

class Pair {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

class Triple extends Pair {
  z = 3;
}

function walk(o: object): string {
  const keys: string[] = [];
  for (const key in o) keys.push(key);
  return keys.join();
}

function walkPoint(p: Point): string {
  let keys = "";
  for (const key in p) keys += key + ";";
  return keys;
}

function ownOnly(p: Point): string {
  let keys = "";
  for (const key in p) if (Object.hasOwn(p, key)) keys += key + ";";
  return keys;
}

const literal: Point = { x: 1, y: 2 };
const flipped: Point = { y: 2, x: 1 };
const pair = new Pair();
const triple = new Triple();
const bare: Point = Object.assign(Object.create(null), { x: 1, y: 2 });

function all(label: string): void {
  console.log(label + ": " + [literal, flipped, pair, triple, bare].map(walkPoint).join(" | "));
  console.log(label + ", own only: " + [literal, flipped, pair, triple, bare].map(ownOnly).join(" | "));
  console.log(label + ", keys: " + [literal, flipped, pair, triple, bare].map(p => Object.keys(p).join("")).join(" | "));
}

let length = 0;
for (let i = 0; i < 2000; i++) length += walkPoint(literal).length + walkPoint(pair).length;
console.log("2000 honest: " + length);
all("at first");

Object.assign(Pair.prototype, { shared: 1 });
all("Pair.prototype has an enumerable member");

Object.assign(Pair.prototype, { x: 100 });
all("a name that the instances have themselves");

Object.defineProperty(pair, "shared", { value: 2, enumerable: false, configurable: true });
all("an own hidden member covers an inherited one");

Reflect.deleteProperty(Pair.prototype, "shared");
Reflect.deleteProperty(Pair.prototype, "x");
Reflect.deleteProperty(pair, "shared");
all("taken away again");

const indexed = { b: 1, 2: 1, a: 1, 1: 1 };
console.log("index keys first: " + walk(indexed) + " then the parent's: " + walk(Object.create(indexed)) + " and both: " + walk(Object.assign(Object.create(indexed), { c: 1, 0: 1, a: 2 })));

function deleteWhileWalking(): string {
  const o: Record<string, number> = { a: 1, b: 2, c: 3, d: 4 };
  const seen: string[] = [];
  for (const key in o) {
    seen.push(key);
    if (key === "a") delete o.c;
  }
  return seen.join();
}

function addWhileWalking(): string {
  const o: Record<string, number> = { a: 1, b: 2 };
  const seen: string[] = [];
  for (const key in o) {
    seen.push(key);
    o["new" + key] = 1;
  }
  return seen.join() + " / " + Object.keys(o).join();
}

function storeWhileWalking(p: Point): string {
  const seen: string[] = [];
  for (const key in p) {
    seen.push(key + "=" + (key === "x" ? p.x : p.y));
    p.y = 50;
  }
  return seen.join();
}

console.log("a key deleted before it is reached: " + deleteWhileWalking());
console.log("keys added on the way: " + addWhileWalking());
console.log("a member stored on the way: " + storeWhileWalking({ x: 1, y: 2 }) + " | " + storeWhileWalking({ y: 2, x: 1 }));

const nothing: (Point | null | undefined)[] = [null, undefined];
for (const value of nothing) {
  let ran = false;
  for (const key in value) ran = key.length >= 0;
  console.log("over " + value + ": " + ran);
}

console.log("over text and lists: " + walk(Object("ab")) + " | " + walk([7, 8]) + " | " + walk(Object.assign([7], { name: "n" })));

export {};
