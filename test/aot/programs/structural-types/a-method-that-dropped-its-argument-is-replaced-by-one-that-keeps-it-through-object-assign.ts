interface Pair {
  x: number;
  y: number;
}

class Sink {
  take(p: Pair): void {}
  takeList(list: number[]): void {}
  takeFunction(f: () => number): void {}
}

const keptPairs: Pair[] = [];
const keptLists: number[][] = [];
const keptFunctions: (() => number)[] = [];

function keepPair(p: Pair): void {
  keptPairs.push(p);
  p.y = 1000 + p.x;
}

function keepList(list: number[]): void {
  keptLists.push(list);
  list.push(-1);
}

function keepFunction(f: () => number): void {
  keptFunctions.push(f);
}

function feed(s: Sink, i: number): number {
  const p = { x: i, y: i * 2 };
  s.take(p);
  return p.x + p.y;
}

function feedList(s: Sink, i: number): string {
  const list = [i, i + 1];
  s.takeList(list);
  return list.length + ":" + list.join();
}

function feedFunction(s: Sink, i: number): number {
  let count = i;
  s.takeFunction(() => ++count);
  return count;
}

function churn(): number {
  let total = 0;
  for (let i = 0; i < 20000; i++) {
    const junk = { x: -i, y: -i, z: [i, i, i] };
    total += junk.z.length + junk.x - junk.y;
  }
  return total;
}

function round(label: string, s: Sink): void {
  const parts: string[] = [];
  for (let i = 1; i <= 3; i++) parts.push(feed(s, i) + " " + feedList(s, i) + " " + feedFunction(s, i));
  console.log(label + ": " + parts.join(" | "));
}

const s = new Sink();
const originals = { take: s.take, takeList: s.takeList, takeFunction: s.takeFunction };
let warm = 0;
for (let i = 0; i < 2000; i++) warm += feed(s, i) + feedList(s, i).length + feedFunction(s, i);
console.log("2000 honest: " + warm);
round("the methods", s);

Object.assign(Sink.prototype, { take: keepPair });
Object.assign(Sink.prototype, { takeList: keepList });
Object.assign(Sink.prototype, { takeFunction: keepFunction });
round("ones that keep what they get", s);
console.log("churn: " + churn());
Bun.gc(true);
console.log("churn: " + churn());
console.log("kept pairs: " + JSON.stringify(keptPairs));
console.log("kept lists: " + JSON.stringify(keptLists));
console.log("kept functions: " + keptFunctions.map(f => f() + " " + f()).join());

Object.assign(Sink.prototype, { take: originals.take });
Object.assign(Sink.prototype, { takeList: originals.takeList });
Object.assign(Sink.prototype, { takeFunction: originals.takeFunction });
round("put back", s);
console.log("kept since: " + keptPairs.length + " " + keptLists.length + " " + keptFunctions.length);

export {};
