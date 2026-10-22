function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function later<T>(value: T): Promise<T> {
  return Promise.resolve().then(() => value);
}

let total = 0;
async function addToTheVariable(n: number): Promise<void> {
  total += await later(n);
}
await Promise.all([addToTheVariable(1), addToTheVariable(2), addToTheVariable(4)]);
console.log("a shared variable, += await: " + text(total));

total = 0;
async function addAfterwards(n: number): Promise<void> {
  const value = await later(n);
  total += value;
}
await Promise.all([addAfterwards(1), addAfterwards(2), addAfterwards(4)]);
console.log("a shared variable, await first: " + text(total));

total = 0;
async function addOnTheRight(n: number): Promise<void> {
  total = (await later(n)) + total;
}
await Promise.all([addOnTheRight(1), addOnTheRight(2), addOnTheRight(4)]);
console.log("a shared variable, read after the await: " + text(total));

class Counter {
  count: number = 0;
  words: string = "";
  async add(n: number): Promise<void> {
    this.count += await later(n);
  }
  async say(word: string): Promise<void> {
    this.words += await later(word);
  }
}
const counter = new Counter();
await Promise.all([counter.add(1), counter.add(2), counter.say("a"), counter.say("b")]);
console.log("a field: " + text(counter));

const cells: number[] = [0, 0, 0];
let cursor = 0;
async function addToACell(n: number): Promise<void> {
  cells[cursor++] += await later(n);
}
await Promise.all([addToACell(1), addToACell(2), addToACell(4)]);
console.log("an element with a moving index: " + text(cells) + " cursor " + cursor);

class Box {
  n: number = 10;
}
const holder = { box: new Box() };
const firstBox = holder.box;
async function addToTheBox(n: number): Promise<void> {
  holder.box.n += await later(n);
}
const adding = addToTheBox(5);
holder.box = new Box();
await adding;
console.log("the object is replaced while the function waits: old " + firstBox.n + ", new " + holder.box.n);

let awaited = 0;
async function counted<T>(value: T): Promise<T> {
  awaited++;
  return value;
}
let maybe: number | undefined;
let zero: number = 0;
let one: number = 1;
maybe ??= await counted(7);
maybe ??= await counted(8);
zero ||= await counted(9);
one ||= await counted(10);
one &&= await counted(11);
zero &&= await counted(12);
console.log("logical assignment: " + [maybe, zero, one].map(text).join(", ") + " after " + awaited + " awaits");

function* summing(): Generator<number, number, number> {
  let sum = 100;
  sum += yield sum;
  sum += yield sum;
  return sum;
}
const s = summing();
console.log("+= yield: " + [s.next(), s.next(1), s.next(2)].map(text).join(" "));

const shared = { sum: 0 };
function* sharing(): Generator<void, void, number> {
  shared.sum += yield;
  shared.sum += yield;
}
const a = sharing();
const b = sharing();
a.next();
b.next();
a.next(1);
b.next(2);
a.next(4);
b.next(8);
console.log("two generators over one field: " + text(shared));

let label = "x";
async function grow(part: string): Promise<void> {
  label = `${label}${await later(part)}${label}`;
}
const growing = grow("-");
label = "y";
await growing;
console.log("a template reads before and after the await: " + label);

export {};
